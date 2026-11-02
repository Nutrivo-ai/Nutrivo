"""I04 on real Postgres: public.verify_reference, the only thing the verify Edge Function calls, answers current,
superseded or unknown for anyone holding a reference, reads nothing else, and keeps answering after the workspace's
subscription has ended and the workspace is closed (BE-28, BE-36, CLAUDE.md non-negotiable 9).

Everything runs in one transaction that is rolled back (app.reports and app.supersessions are insert-only, and the gate
tests assume an empty tenant dataset). The ruleset is the empty one every stack releases, never law."""
import uuid

import psycopg
import pytest
from pgtest import DSN, skip_no_database
from psycopg.rows import dict_row

EXPOSED = ("app", "ref", "private", "public")
PUBLIC_FUNCTIONS = {"public.verify_reference", "public.coverage_snapshot"}


@pytest.fixture
def conn():
    try:
        c = psycopg.connect(DSN, row_factory=dict_row, connect_timeout=10)   # not autocommit: rolled back below
    except psycopg.OperationalError:
        skip_no_database()
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def one(conn, sql, *args):
    return conn.execute(sql, args).fetchone()


def new_ref() -> str:
    return uuid.uuid4().hex[:26].upper()


def seed_report(conn, *, has_not_assessed=True):
    person = one(conn, "insert into app.people (display_name) values ('T-406 admin') returning id")["id"]
    ws = one(conn, "insert into app.workspaces (name, plan, created_by) values ('T-406', 'basic', %s) returning id",
             person)["id"]
    conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, 'admin')", (ws, person))
    family = one(conn, "insert into app.families (workspace_id, name) values (%s, 'Adult') returning id", ws)["id"]
    product = one(conn, "insert into app.products (workspace_id, family_id, name, stage) "
                        "values (%s, %s, 'Salmon & Rice', 'in_development') returning id", ws, family)["id"]
    conn.execute("insert into app.subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, plan, term, "
                 "status, regions) values (%s, %s, %s, 'basic', 'monthly', 'active', '{EU}')",
                 (ws, f"cus_{ws.hex[:12]}", f"sub_{ws.hex[:12]}"))
    ref = new_ref()
    report = one(conn, "insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, "
                       "artwork_sha, has_not_assessed) values (%s, %s, 'EU-DE', %s, '{}', '0000.00-empty', %s, %s) "
                       "returning id, created_at", ws, product, ref, "a" * 64, has_not_assessed)
    return {"ws": ws, "person": person, "product": product, "ref": ref, "id": report["id"],
            "issued_at": report["created_at"]}


def verify(conn, ref, *, as_anon=True):
    """Call verify_reference the way the Edge Function does: as anon, by reference, nothing else."""
    if as_anon:
        conn.execute("set local role anon")
    try:
        return one(conn, "select public.verify_reference(%s) as v", ref)["v"]
    finally:
        if as_anon:
            conn.execute("reset role")


def test_I04_main_public_verification_answers_current_then_superseded(conn):
    """[I04.main] Public verification: the main path works end to end. A report's reference answers current with its
    issue date, ruleset version and whether Not assessed items existed, and nothing else; after a material
    supersession it answers superseded with the same facts."""
    r = seed_report(conn)
    v = verify(conn, r["ref"])
    assert set(v) == {"status", "issued_at", "ruleset_version", "has_not_assessed"}
    assert (v["status"], v["ruleset_version"], v["has_not_assessed"]) == ("current", "0000.00-empty", True)
    assert one(conn, "select %s::timestamptz = %s as same", v["issued_at"], r["issued_at"])["same"]

    conn.execute("insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version) "
                 "values (%s, 'report', %s, 'eu.t406.synthetic', '0000.00-empty')", (r["ws"], r["id"]))
    w = verify(conn, r["ref"])
    assert w == {**v, "status": "superseded"}


def test_I04_must_1_the_anon_role_reads_no_table(conn):
    """[I04.must.1] The anon role reads no table (BE-28). In every schema the API exposes or the function could reach,
    anon holds no privilege on any table, view or sequence, no usage on app, ref or private, and can execute exactly the
    two public functions; reading a tenant table as anon is refused outright."""
    r = seed_report(conn)
    rels = conn.execute(
        "select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = any(%s) and c.relkind in ('r','p','v','m','f','S') "
        "and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') "
        "  or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))",
        (list(EXPOSED),)).fetchall()
    assert rels == []
    usage = {row["nspname"]: row["ok"] for row in conn.execute(
        "select nspname, has_schema_privilege('anon', nspname, 'usage') as ok from pg_namespace "
        "where nspname in ('app','ref','private','pgmq')")}
    assert usage == {"app": False, "ref": False, "private": False, "pgmq": False}
    fns = {row["name"] for row in conn.execute(
        "select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname = any(%s) and has_function_privilege('anon', p.oid, 'execute') "
        "and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')", (list(EXPOSED),))}
    assert fns == PUBLIC_FUNCTIONS

    conn.execute("savepoint anon_read")
    conn.execute("set local role anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("select ref from app.reports where ref = %s", (r["ref"],))
    conn.execute("rollback to savepoint anon_read")
    conn.execute("reset role")
    assert verify(conn, r["ref"])["status"] == "current", "and yet anon can verify the reference"


@pytest.mark.parametrize("status", ["dunning", "new_artwork_stopped", "dormant", "closed"])
def test_I04_must_2_a_closed_workspace_still_verifies(conn, status):
    """[I04.must.2] Independent of the subscription: a closed workspace still verifies. The subscription ends, every
    membership ends and the workspace moves through dunning to closed; the answer is the same as on the day of issue."""
    r = seed_report(conn)
    before = verify(conn, r["ref"])
    conn.execute("update app.subscriptions set status = 'canceled', current_period_end = now() - interval '1 day' "
                 "where workspace_id = %s", (r["ws"],))
    conn.execute("update app.memberships set ended_at = now(), ended_reason = 'workspace_closed' "
                 "where workspace_id = %s", (r["ws"],))
    conn.execute("update app.workspaces set status = %s where id = %s", (status, r["ws"]))
    assert verify(conn, r["ref"]) == before
    assert before["status"] == "current"


def test_I04_fail_1_unknown_reference_reveals_nothing_about_similar_references(conn):
    """[I04.fail.1] Unknown reference: 'unknown', revealing nothing about similar references. A missing reference,
    near misses of a real one (one character off, a prefix, a longer string, another case) and malformed input all
    get the identical answer, with no hint of how close they came."""
    r = seed_report(conn)
    ref = r["ref"]
    probes = [new_ref(), ref[:-1] + ("A" if ref[-1] != "A" else "B"), ref[:20], ref + "0", ref.lower(),
              f" {ref}", "", "x", "y" * 65, None]
    answers = [verify(conn, p) for p in probes]
    assert all(a == {"status": "unknown"} for a in answers), answers
    assert verify(conn, ref)["status"] == "current"
