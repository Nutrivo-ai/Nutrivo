"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md).

  nutrivo work     the job loop: every registered handler, the Sentry heartbeat, the reaper every 5 minutes
  nutrivo reap     one reaper pass
  nutrivo sources fetch   official texts from content/sources.yaml into the 'sources' bucket and ref.sources
  nutrivo sources import  the Feed Additives Register → ref.feed_additives; the Catalogue → ref.feed_materials
  nutrivo sources watch   new documents linked to those acts, triaged by the model into a report for a person (J01)
  nutrivo horizon record  a person records a horizon item from a watch report, with the stage and dates they give
  nutrivo content extract  K01/K02: candidates from content/candidates/eu-core.yaml over the stored sources
  nutrivo evals claims --rule-key <key> | --synthetic --lang xx
                   the claims evaluation harness as a Langfuse dataset run (exit 0 threshold met, 1 not, 2 error)
  nutrivo report rerender <ref> [--out file.pdf]
                   re-render an issued label report from its stored model and compare it with the issued PDF (BE-26;
                   exit 0 identical, 1 not, 2 unknown reference)
  nutrivo config   the resolved settings, secrets masked
  nutrivo fixtures run --ruleset <id>
                   rule fixtures, synthetic and golden labels against a ruleset (exit 0 passed, 1 not, 2 error)"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from . import models, observability
from .config import WORKER_ROOT, ConfigError, Settings
from .logs import get_logger, kv, setup_logging

log = get_logger("nutrivo")


def _start(settings: Settings, log_stream: object = None) -> None:
    setup_logging(settings.release, stream=log_stream)
    observability.init_sentry(settings)
    observability.init_langfuse(settings)
    models.configure(settings)


def cmd_work(settings: Settings) -> int:
    from . import handlers  # noqa: F401  registers the handlers that exist at this milestone
    from .db import PgStore
    from .jobs import Worker, registry

    dsn = settings.require_database()
    worker = Worker(settings, registry, lambda: PgStore.from_dsn(dsn))
    worker.install_signal_handlers()
    try:
        worker.run()
    finally:
        observability.flush()
    return 0


def cmd_reap(settings: Settings) -> int:
    from .db import PgStore
    from .jobs import reap

    try:
        reaped = reap(PgStore.from_dsn(settings.require_database()), settings)
    finally:
        observability.flush()
    print(json.dumps({"reaped": [r.__dict__ for r in reaped]}))
    return 0


def cmd_report_rerender(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 when the re-rendered document hashes to app.reports.pdf_sha256 and its check events still match."""
    import sentry_sdk

    from .db import connect
    from .logs import log_context
    from .reporting.service import ReportNotFound, rerender
    from .reporting.store import PgReportStore
    from .sources.store import StorageClient

    storage = StorageClient(*settings.require_storage())
    with connect(settings.require_database()) as conn, log_context(request_id=str(uuid.uuid4())), \
            sentry_sdk.start_transaction(op="report", name="report:rerender"):
        try:
            result = rerender(PgReportStore(conn), storage, args.ref)
        except ReportNotFound:
            print(json.dumps({"ref": args.ref, "found": False}))
            return 2
    if args.out:
        Path(args.out).write_bytes(result.pdf)
    print(json.dumps({"ref": result.ref, "found": True, "identical": result.identical,
                      "pinned_match": result.pinned_match, "sha256": result.sha256,
                      "expected_sha256": result.expected_sha256}))
    return 0 if result.identical and result.pinned_match else 1


def cmd_sources_fetch(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 when every document is stored, unchanged or (dry run) fetched; 1 when any failed."""
    import sentry_sdk

    from .logs import log_context
    from .sources import fetch
    from .sources.http import PoliteClient, RecordingTransport, ReplayTransport, Transport, UrllibTransport

    acts, languages, licence = fetch.load_sources(Path(args.sources))
    if args.celex:
        acts = [a for a in acts if a.celex in set(args.celex)]
        if len(acts) != len(set(args.celex)):
            print("nutrivo: --celex names an act that is not in the sources file", file=sys.stderr)
            return 2
    if args.lang:
        languages = [lang for lang in languages if lang in set(args.lang)]
    transport: Transport = ReplayTransport(Path(args.replay)) if args.replay else UrllibTransport()
    if args.record:
        transport = RecordingTransport(transport, Path(args.record))
    client = PoliteClient(transport, min_interval_s=0.0 if args.replay else args.min_interval)

    store = None
    if not args.dry_run:
        from .db import connect
        from .sources.store import PgSourceStore, StorageClient

        storage = StorageClient(*settings.require_storage())
        store = PgSourceStore(connect(settings.require_database()), storage)
    with log_context(request_id=str(uuid.uuid4())), \
            sentry_sdk.start_transaction(op="content", name="sources:fetch"):
        results = fetch.run(acts, languages, client, store, licence=licence)
    for r in results:
        print(json.dumps(r.as_dict(), ensure_ascii=False))
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(json.dumps({"summary": counts, "requests": client.requests_sent}))
    observability.flush()
    return 1 if counts.get("failed") else 0


def cmd_sources_import(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 when every pull is stored, unchanged or (dry run) fetched; 1 when any failed. Skipped and stale entries
    are reported, not failures: they are the register as it stands (docs/12)."""
    from contextlib import nullcontext

    import sentry_sdk

    from .logs import log_context
    from .sources import catalogue, fetch, register
    from .sources.http import PoliteClient, RecordingTransport, ReplayTransport, Transport, UrllibTransport
    from .sources.imports import summary

    acts, languages, licence = fetch.load_sources(Path(args.sources))
    transport: Transport = ReplayTransport(Path(args.replay)) if args.replay else UrllibTransport()
    if args.record:
        transport = RecordingTransport(transport, Path(args.record))
    client = PoliteClient(transport, min_interval_s=0.0 if args.replay else args.min_interval,
                          https_hosts=("publications.europa.eu", "eur-lex.europa.eu", "ec.europa.eu"))

    conn = store = None
    if not args.dry_run:
        from .db import connect
        from .sources.store import PgSourceStore, StorageClient

        storage = StorageClient(*settings.require_storage())
        conn = connect(settings.require_database())
        store = PgSourceStore(conn, storage)
    transaction = conn.transaction if conn is not None else nullcontext
    with log_context(request_id=str(uuid.uuid4())), \
            sentry_sdk.start_transaction(op="content", name=f"sources:import:{args.what}"):
        if args.what == "additives":
            table = register.PgAdditiveTable(conn) if conn is not None else None
            outcomes = register.run(client, store, table, licence=licence, transaction=transaction)
        else:
            act = next((a for a in acts if a.celex == catalogue.ACT), None)
            if act is None:
                print(f"nutrivo: {catalogue.ACT} is not in the sources file", file=sys.stderr)
                return 2
            mtable = catalogue.PgMaterialTable(conn) if conn is not None else None
            outcomes = catalogue.run(client, store, mtable, languages, title=act.title, licence=licence,
                                     transaction=transaction)
    for o in outcomes:
        print(json.dumps(o.as_dict(), ensure_ascii=False))
    print(json.dumps({"summary": summary(outcomes), "requests": client.requests_sent}))
    observability.flush()
    return 1 if any(o.status == "failed" for o in outcomes) else 0
def cmd_sources_watch(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 when every act was queried (withheld items are not failures); 1 when any act failed."""
    from datetime import UTC, datetime, timedelta

    import sentry_sdk

    from .logs import log_context
    from .sources import fetch, watch
    from .sources.http import PoliteClient, RecordingTransport, ReplayTransport, Transport, UrllibTransport

    acts, _, _ = fetch.load_sources(Path(args.sources))
    if args.celex:
        acts = [a for a in acts if a.celex in set(args.celex)]
        if len(acts) != len(set(args.celex)):
            print("nutrivo: --celex names an act that is not in the sources file", file=sys.stderr)
            return 2
    today = datetime.fromisoformat(args.today).date() if args.today else datetime.now(UTC).date()
    since = (datetime.fromisoformat(args.since).date() if args.since
             else today - timedelta(days=watch.DEFAULT_LOOKBACK_DAYS))
    transport: Transport = ReplayTransport(Path(args.replay)) if args.replay else UrllibTransport()
    if args.record:
        transport = RecordingTransport(transport, Path(args.record))
    client = PoliteClient(transport, min_interval_s=0.0 if args.replay else args.min_interval)

    conn, store, known = None, None, set()
    if settings.database_url:   # model calls are recorded and items already recorded are skipped
        from .db import PgStore, connect
        from .sources.horizon import PgHorizonStore

        conn = connect(settings.require_database())
        store, known = PgStore(conn), PgHorizonStore(conn).known_celex()

    def emit(report: watch.Report) -> None:
        body = report.to_json()
        if args.out:
            Path(args.out).write_text(body, encoding="utf-8")
            print(json.dumps({"summary": report.counts(), "out": args.out}))
        else:
            print(body, end="")

    run_id = str(uuid.uuid4())
    try:
        with log_context(request_id=run_id), \
                observability.cron_checkin(observability.SOURCE_WATCH_MONITOR), \
                sentry_sdk.start_transaction(op="content", name="sources:watch"), \
                observability.content_observation(f"sources:watch:{run_id}", {"request_id": run_id}):
            report = watch.run(acts, client, models.configure(settings), run_id=run_id, since=since, today=today,
                               known_celex=known, store=store, max_items=args.max_items)
            emit(report)                 # the report is written even when an act failed
            if report.failures:          # and the check-in reports the run as an error
                raise watch.WatchFailed(f"{len(report.failures)} of {len(acts)} acts failed")
    except watch.WatchFailed as exc:
        print(f"nutrivo: {exc}", file=sys.stderr)
        return 1
    finally:
        if conn is not None:
            conn.close()
        observability.flush()
    return 0


def cmd_horizon_record(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 recorded or unchanged; 3 refused, including a conflict with an existing row (reason code on stderr)."""
    from datetime import date

    from .db import connect
    from .sources import horizon

    def day(value: str | None) -> date | None:
        try:
            return date.fromisoformat(value) if value else None
        except ValueError:
            raise horizon.RecordRefused(f"{value[:20]!r} is not a date (YYYY-MM-DD)", "bad_date") from None

    try:
        item = horizon.report_item(Path(args.report), args.celex)
        rec = horizon.recording(item, args.stage, expected_date=day(args.expected_date),
                                effective_from=day(args.effective_from), notes=args.notes)
    except horizon.RecordRefused as exc:
        print(f"nutrivo: refused ({exc.reason}): {exc}", file=sys.stderr)
        return 3
    conn = connect(settings.require_database())
    try:
        status, item_id = horizon.PgHorizonStore(conn).record(rec)
    except horizon.RecordRefused as exc:
        print(f"nutrivo: refused ({exc.reason}): {exc}", file=sys.stderr)
        return 3
    finally:
        conn.close()
    log.info("horizon item " + status, extra=kv(celex=rec.celex, stage=rec.stage, horizon_item_id=item_id))
    print(json.dumps({"status": status, "id": item_id, "celex": rec.celex, "stage": rec.stage}))
    return 0


def cmd_content_extract(settings: Settings, args: argparse.Namespace) -> int:
    """Exit 0 when every pair is stored, updated, unchanged, extracted (dry run), skipped or withheld; 1 when any
    failed. Withheld and skipped are visible states with a reason, not failures: a person reads them in the output."""
    import sentry_sdk

    from .content import extract, targets
    from .content.store import PgCandidateStore, PgSourceReader
    from .db import connect
    from .logs import log_context
    from .sources import fetch
    from .sources.store import StorageClient

    acts, languages, _ = fetch.load_sources(Path(args.sources))
    chosen = targets.load_targets(Path(args.targets), {a.celex for a in acts})
    if args.target:
        chosen = [t for t in chosen if t.key in set(args.target)]
        if len(chosen) != len(set(args.target)):
            print("nutrivo: --target names a key that is not in the targets file", file=sys.stderr)
            return 2
    if args.lang:
        languages = [lang for lang in languages if lang in set(args.lang)]
    conn = connect(settings.require_database())
    try:
        reader = PgSourceReader(conn, StorageClient(*settings.require_storage()))
        store = None if args.dry_run else PgCandidateStore(conn)
        with log_context(request_id=str(uuid.uuid4())), \
                sentry_sdk.start_transaction(op="content", name="content:extract"):
            results = extract.run(chosen, reader, store, models.configure(settings), languages=languages)
    finally:
        conn.close()
    for r in results:
        print(json.dumps(r.as_dict(), ensure_ascii=False))
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(json.dumps({"summary": counts}))
    observability.flush()
    return 1 if counts.get("failed") else 0


def cmd_evals_claims(settings: Settings, args: argparse.Namespace) -> int:
    """Read only. Exit 0 when every language meets the threshold (a synthetic run: when every case ran and was
    recorded), 1 when not, 2 when the set or the rule cannot be read. stdout carries the report alone."""
    import sentry_sdk

    from .evals import claims
    from .logs import log_context

    languages = sorted(set(args.lang))
    try:
        if args.synthetic:
            spec = claims.load_synthetic_rule(Path(args.evals) / "synthetic")
            cases = claims.load_sets(Path(args.evals) / "synthetic", languages, synthetic=True)
        else:
            from .db import connect

            conn = connect(settings.require_database())
            try:
                conn.execute("set session characteristics as transaction read only")
                found = claims.PgRuleReader(conn).claim_rule(args.rule_key, args.rule_version)
            finally:
                conn.close()
            if found is None:
                print(f"nutrivo: no claim_judgement rule version for {args.rule_key}", file=sys.stderr)
                return 2
            spec = found
            cases = claims.load_sets(Path(args.evals), languages, synthetic=False)
    except (claims.EvalSetInvalid, claims.RuleSpecInvalid) as exc:
        print(f"nutrivo: {exc}", file=sys.stderr)
        return 2
    recorder = claims.LangfuseRecorder(observability.langfuse(), send=settings.langfuse_enabled)
    try:
        with log_context(request_id=str(uuid.uuid4())), \
                sentry_sdk.start_transaction(op="eval", name="evals:claims") as txn:
            txn.set_tag("rule_key", spec.rule_key)
            report = claims.run(models.configure(settings), spec, cases, recorder,
                                prompt_version=args.prompt_version)
            txn.set_tag("passed", report.passed)
    except claims.EvalSetInvalid as exc:
        print(f"nutrivo: {exc}", file=sys.stderr)
        return 2
    finally:
        observability.flush()
    body = json.dumps(report.to_dict(), indent=2, ensure_ascii=False, default=str)
    if args.out:
        Path(args.out).write_text(body + "\n", encoding="utf-8")
    print(body)
    if not report.complete:
        return 1
    return 0 if report.synthetic or report.passed else 1


def cmd_config(settings: Settings) -> int:
    print(settings.model_dump_json(indent=2))
    return 0


def cmd_fixtures_run(settings: Settings, args: argparse.Namespace) -> int:
    """Read only. stdout carries the report alone, so --format json stays machine-readable."""
    import sentry_sdk

    from . import engine  # noqa: F401  registers the evaluators in fixtures_runner.EVALUATORS
    from . import fixtures_runner as fr
    from .db import connect

    dsn = settings.require_database()
    try:
        with sentry_sdk.start_transaction(op="cli", name="fixtures.run") as txn:
            txn.set_tag("ruleset_version", args.ruleset)
            conn = connect(dsn)
            try:
                conn.execute("set session characteristics as transaction read only")
                with conn.transaction():
                    report = fr.run(fr.PgFixtureStore(conn), args.ruleset, Path(args.synth), Path(args.golden))
            finally:
                conn.close()
            txn.set_tag("passed", report.passed)
    except fr.UnknownRuleset as exc:
        print(f"nutrivo: {exc}", file=sys.stderr)
        return 2
    finally:
        observability.flush()
    body = json.dumps(report.to_dict(), indent=2, default=str)
    if args.out:
        Path(args.out).write_text(body + "\n", encoding="utf-8")
    if args.junit:
        Path(args.junit).write_text(fr.to_junit(report) + "\n", encoding="utf-8")
    print(body if args.format == "json" else fr.format_text(report))
    return 0 if report.passed else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nutrivo", description="Nutrivo worker commands")
    sub = parser.add_subparsers(dest="command", metavar="command")
    sub.add_parser("work", help="run the job loop")
    sub.add_parser("reap", help="requeue jobs running past their lease, once")
    sub.add_parser("config", help="print the resolved settings with secrets masked")
    sources = sub.add_parser("sources", help="official source texts (docs/12)")
    sources_sub = sources.add_subparsers(dest="sources_command", metavar="command", required=True)
    f = sources_sub.add_parser("fetch", help="fetch the latest consolidated texts and store them with sha256")
    f.add_argument("--sources", default=str(WORKER_ROOT.parent / "content" / "sources.yaml"))
    f.add_argument("--celex", action="append", help="only this act (repeatable)")
    f.add_argument("--lang", action="append", help="only this language (repeatable)")
    f.add_argument("--dry-run", action="store_true", help="fetch and hash only; write nothing")
    f.add_argument("--min-interval", type=float, default=2.0, help="seconds between requests (default 2)")
    f.add_argument("--record", metavar="DIR", help="also write every exchange to DIR (test recordings)")
    f.add_argument("--replay", metavar="DIR", help="serve recorded exchanges from DIR instead of the network")
    imp = sources_sub.add_parser("import", help="import the Feed Additives Register or the Catalogue of feed materials")
    imp.add_argument("what", choices=("additives", "materials"))
    imp.add_argument("--sources", default=str(WORKER_ROOT.parent / "content" / "sources.yaml"))
    imp.add_argument("--dry-run", action="store_true", help="fetch, hash and plan only; write nothing")
    imp.add_argument("--min-interval", type=float, default=2.0, help="seconds between requests (default 2)")
    imp.add_argument("--record", metavar="DIR", help="also write every exchange to DIR (test recordings)")
    imp.add_argument("--replay", metavar="DIR", help="serve recorded exchanges from DIR instead of the network")
    w = sources_sub.add_parser("watch", help="list new documents linked to the followed acts, triaged for a person")
    w.add_argument("--sources", default=str(WORKER_ROOT.parent / "content" / "sources.yaml"))
    w.add_argument("--celex", action="append", help="only this act (repeatable)")
    w.add_argument("--since", help="documents dated on or after this day (default: 14 days before --today)")
    w.add_argument("--today", help="the run date, YYYY-MM-DD (default: today, UTC)")
    w.add_argument("--max-items", type=int, default=60, help="model calls per run at most (default 60)")
    w.add_argument("--out", help="write the JSON report to this file instead of stdout")
    w.add_argument("--min-interval", type=float, default=2.0, help="seconds between requests (default 2)")
    w.add_argument("--record", metavar="DIR", help="also write every exchange to DIR (test recordings)")
    w.add_argument("--replay", metavar="DIR", help="serve recorded exchanges from DIR instead of the network")
    hz = sub.add_parser("horizon", help="horizon items (J01)").add_subparsers(dest="horizon_command",
                                                                           metavar="command", required=True)
    rec = hz.add_parser("record", help="a person records a horizon item from a source-watch report")
    rec.add_argument("--report", required=True, help="the JSON report written by `nutrivo sources watch`")
    rec.add_argument("--celex", required=True, help="the item's CELEX id, as the report lists it")
    rec.add_argument("--stage", required=True, help="proposal, draft, consultation, adopted, published or in_force")
    rec.add_argument("--expected-date", help="YYYY-MM-DD, as the person reads it in the official text")
    rec.add_argument("--effective-from", help="YYYY-MM-DD; only for adopted, published or in_force (BE-37)")
    rec.add_argument("--notes", help="the person's own note")
    report = sub.add_parser("report", help="label report PDFs (I01)").add_subparsers(dest="report_command",
                                                                                metavar="command", required=True)
    rr = report.add_parser("rerender", help="re-render an issued report by its reference and compare (BE-26)")
    rr.add_argument("ref", help="the report's reference, as printed on it")
    rr.add_argument("--out", help="also write the re-rendered PDF to this file")
    content = sub.add_parser("content", help="content operations over stored sources (docs/12)")
    content_sub = content.add_subparsers(dest="content_command", metavar="command", required=True)
    x = content_sub.add_parser("extract", help="K01/K02: two independent extractions per target into candidates")
    x.add_argument("--targets", default=str(WORKER_ROOT.parent / "content" / "candidates" / "eu-core.yaml"))
    x.add_argument("--sources", default=str(WORKER_ROOT.parent / "content" / "sources.yaml"))
    x.add_argument("--target", action="append", help="only this rule key (repeatable)")
    x.add_argument("--lang", action="append", help="only this language (repeatable)")
    x.add_argument("--dry-run", action="store_true", help="extract and compare; write no candidate")
    evals = sub.add_parser("evals", help="model evaluation harnesses (docs/07)")
    evals_sub = evals.add_subparsers(dest="evals_command", metavar="command", required=True)
    ev = evals_sub.add_parser("claims", help="judge a claim rule's evaluation sets; a Langfuse dataset run")
    which = ev.add_mutually_exclusive_group(required=True)
    which.add_argument("--rule-key", help="the claim_judgement rule to evaluate (its params come from ref)")
    which.add_argument("--synthetic", action="store_true", help="the harness's own synthetic rule and cases")
    ev.add_argument("--rule-version", type=int, help="this rule version (default: the latest not rejected)")
    ev.add_argument("--lang", action="append", required=True, help="a language set to run (repeatable)")
    ev.add_argument("--evals", default=str(WORKER_ROOT / "evals" / "claims"), help="the evaluation sets")
    ev.add_argument("--prompt-version", default="v1", help="claim_judgement prompt version (default v1)")
    ev.add_argument("--out", help="also write the JSON report to this file")
    from .fixtures_runner import GOLDEN_DIR, SYNTH_DIR
    fixtures = sub.add_parser("fixtures", help="fixture commands").add_subparsers(dest="fixtures_command",
                                                                                   metavar="subcommand")
    fx_run = fixtures.add_parser("run", help="run the fixtures against a ruleset and compare with the ground truth")
    fx_run.add_argument("--ruleset", required=True, help="the ruleset version id, e.g. 2026.11-a")
    fx_run.add_argument("--format", choices=("text", "json"), default="text", help="stdout format")
    fx_run.add_argument("--out", help="also write the JSON report to this file")
    fx_run.add_argument("--junit", help="also write a JUnit XML report to this file")
    fx_run.add_argument("--synth", default=str(SYNTH_DIR), help="synthetic truth files (default fixtures/synth/out)")
    fx_run.add_argument("--golden", default=str(GOLDEN_DIR), help="golden labels, read only (default fixtures/golden)")
    args = parser.parse_args(argv)
    if not args.command or (args.command == "fixtures" and not args.fixtures_command):
        parser.print_help()
        return 0
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
        return 2
    if args.command == "fixtures":
        _start(settings, log_stream=sys.stderr)   # stdout carries the report only
        try:
            return cmd_fixtures_run(settings, args)
        except ConfigError as exc:
            print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
            return 2
    if args.command != "config":   # the watch's and the harness's stdout carry their reports alone
        watching = (args.command == "sources" and args.sources_command == "watch") or args.command == "evals"
        _start(settings, log_stream=sys.stderr if watching else None)
    try:
        if args.command == "sources":
            if args.sources_command == "watch":
                return cmd_sources_watch(settings, args)
            if args.sources_command == "import":
                return cmd_sources_import(settings, args)
            return cmd_sources_fetch(settings, args)
        if args.command == "horizon":
            return cmd_horizon_record(settings, args)
        if args.command == "content":
            return cmd_content_extract(settings, args)
        if args.command == "report":
            return cmd_report_rerender(settings, args)
        if args.command == "evals":
            return cmd_evals_claims(settings, args)
        return {"work": cmd_work, "reap": cmd_reap, "config": cmd_config}[args.command](settings)
    except ConfigError as exc:
        print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
