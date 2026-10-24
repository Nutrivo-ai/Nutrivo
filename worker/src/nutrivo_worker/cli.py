"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md).

  nutrivo work     the job loop: every registered handler, the Sentry heartbeat, the reaper every 5 minutes
  nutrivo reap     one reaper pass
  nutrivo sources fetch   official texts from content/sources.yaml into the 'sources' bucket and ref.sources
  nutrivo sources watch   new documents linked to those acts, triaged by the model into a report for a person (J01)
  nutrivo horizon record  a person records a horizon item from a watch report, with the stage and dates they give
  nutrivo content extract  K01/K02: candidates from content/candidates/eu-core.yaml over the stored sources
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


def cmd_config(settings: Settings) -> int:
    print(settings.model_dump_json(indent=2))
    return 0


def cmd_fixtures_run(settings: Settings, args: argparse.Namespace) -> int:
    """Read only. stdout carries the report alone, so --format json stays machine-readable."""
    import sentry_sdk

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
    content = sub.add_parser("content", help="content operations over stored sources (docs/12)")
    content_sub = content.add_subparsers(dest="content_command", metavar="command", required=True)
    x = content_sub.add_parser("extract", help="K01/K02: two independent extractions per target into candidates")
    x.add_argument("--targets", default=str(WORKER_ROOT.parent / "content" / "candidates" / "eu-core.yaml"))
    x.add_argument("--sources", default=str(WORKER_ROOT.parent / "content" / "sources.yaml"))
    x.add_argument("--target", action="append", help="only this rule key (repeatable)")
    x.add_argument("--lang", action="append", help="only this language (repeatable)")
    x.add_argument("--dry-run", action="store_true", help="extract and compare; write no candidate")
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
    if args.command != "config":   # the watch's stdout carries its report alone
        watching = args.command == "sources" and args.sources_command == "watch"
        _start(settings, log_stream=sys.stderr if watching else None)
    try:
        if args.command == "sources":
            if args.sources_command == "watch":
                return cmd_sources_watch(settings, args)
            return cmd_sources_fetch(settings, args)
        if args.command == "horizon":
            return cmd_horizon_record(settings, args)
        if args.command == "content":
            return cmd_content_extract(settings, args)
        return {"work": cmd_work, "reap": cmd_reap, "config": cmd_config}[args.command](settings)
    except ConfigError as exc:
        print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
