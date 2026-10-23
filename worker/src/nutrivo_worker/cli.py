"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md).

  nutrivo work     the job loop: every registered handler, the Sentry heartbeat, the reaper every 5 minutes
  nutrivo reap     one reaper pass
  nutrivo config   the resolved settings, secrets masked
  nutrivo fixtures run --ruleset <id>
                   rule fixtures, synthetic and golden labels against a ruleset (exit 0 passed, 1 not, 2 error)"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import models, observability
from .config import ConfigError, Settings
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
    return {"work": cmd_work, "reap": cmd_reap, "config": cmd_config}[args.command](settings)


if __name__ == "__main__":
    sys.exit(main())
