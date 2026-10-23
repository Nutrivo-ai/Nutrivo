"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md).

  nutrivo work     the job loop: every registered handler, the Sentry heartbeat, the reaper every 5 minutes
  nutrivo reap     one reaper pass
  nutrivo config   the resolved settings, secrets masked"""
from __future__ import annotations

import argparse
import json
import sys

from . import models, observability
from .config import ConfigError, Settings
from .logs import get_logger, setup_logging

log = get_logger("nutrivo")


def _start(settings: Settings) -> None:
    setup_logging(settings.release)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nutrivo", description="Nutrivo worker commands")
    sub = parser.add_subparsers(dest="command", metavar="command")
    sub.add_parser("work", help="run the job loop")
    sub.add_parser("reap", help="requeue jobs running past their lease, once")
    sub.add_parser("config", help="print the resolved settings with secrets masked")
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"nutrivo: configuration error: {exc}", file=sys.stderr)
        return 2
    if args.command != "config":
        _start(settings)
    return {"work": cmd_work, "reap": cmd_reap, "config": cmd_config}[args.command](settings)


if __name__ == "__main__":
    sys.exit(main())
