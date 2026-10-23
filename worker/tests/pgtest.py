"""Postgres-backed tests: one DSN and one way to skip when there is no database.

Locally they run against the local Supabase database (`make verify-fast` starts it) or NUTRIVO_TEST_DATABASE_URL, and
skip where there is none. CI's `worker` job starts the database and sets NUTRIVO_REQUIRE_DB=1, and then conftest.py
turns these skips into failures, so a database test can never pass CI by skipping."""
import os

import psycopg
import pytest

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
# conftest.py matches this prefix; keep the wording of skips written before this helper ("no local database").
SKIP_PREFIX = "no local database"


def skip_no_database(why: str = "run make db-start"):
    pytest.skip(f"{SKIP_PREFIX}: {why}")


def connect_or_skip(connect, dsn: str = DSN):
    """connect(dsn), or skip the test when nothing answers at dsn."""
    try:
        return connect(dsn)
    except psycopg.OperationalError:
        skip_no_database()
