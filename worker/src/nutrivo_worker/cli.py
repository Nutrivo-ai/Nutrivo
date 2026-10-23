"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md).

  nutrivo work     the job loop: every registered handler, the Sentry heartbeat, the reaper every 5 minutes
  nutrivo reap     one reaper pass
  nutrivo sources fetch   official texts from content/sources.yaml into the 'sources' bucket and ref.sources
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
from .logs import get_logger, setup_logging

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
    if args.command != "config":
        _start(settings)
    try:
        if args.command == "sources":
            return cmd_sources_fetch(settings, args)
        return {"work": cmd_work, "reap": cmd_reap, "config": cmd_config}[args.command](settings)
    except ConfigError as exc:
        print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
