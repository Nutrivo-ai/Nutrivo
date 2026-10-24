"""Tests on the local stack (Postgres, Mailpit): where to find it, and one way to skip when it is not running.

Locally they run against the local Supabase stack (`make verify-fast` starts it), or NUTRIVO_TEST_DATABASE_URL and
MAILPIT_URL, and skip where it is not running. CI's `worker` job starts the database and Mailpit and sets
NUTRIVO_REQUIRE_DB=1, and then conftest.py turns these skips into failures, so such a test never passes CI by skipping.
Every skip for a missing local service starts with SKIP_PREFIX ("no local database: ...", "no local Mailpit: ...")."""
import os

import psycopg
import pytest

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
MAILPIT_URL = os.environ.get("MAILPIT_URL", "http://127.0.0.1:54324")
# conftest.py matches this prefix; it is the wording of skips written before this helper ("no local database",
# "no local Mailpit").
SKIP_PREFIX = "no local "


def skip_no_service(service: str, why: str = "run make db-start"):
    pytest.skip(f"{SKIP_PREFIX}{service}: {why}")


def skip_no_database(why: str = "run make db-start"):
    skip_no_service("database", why)


def connect_or_skip(connect, dsn: str = DSN):
    """connect(dsn), or skip the test when nothing answers at dsn."""
    try:
        return connect(dsn)
    except psycopg.OperationalError:
        skip_no_database()
