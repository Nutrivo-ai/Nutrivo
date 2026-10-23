"""A03 and A04 end to end on the local stack: app.invite_member as the admin, the notify job through the real loop
and Mailpit, then app.accept_invitation as the invitee with the token from the email. Plus session_revoke after
app.remove_member (A06).

Each test runs in one transaction that is rolled back (audit_events is insert-only, so nothing could be cleaned up
otherwise); the worker's PgStore shares that connection. Emails really reach Mailpit, each to a fresh address, and
are deleted afterwards. Like tests/test_jobs_pg.py these skip without the local database, so they skip in CI's
worker job until T-009 brings the full stack to it (T-105 question 5 on #27)."""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager

import psycopg
import pytest

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import notify  # also registers session_revoke
from nutrivo_worker.jobs import Message, process_message, registry

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
MAILPIT = os.environ.get("MAILPIT_URL", "http://127.0.0.1:54324")
S = Settings(max_attempts=5, mailpit_url=MAILPIT)
LINK = re.compile(r"/invite/([A-Za-z0-9_-]{43})")


def mailpit(path, method="GET"):
    with urllib.request.urlopen(urllib.request.Request(f"{MAILPIT}{path}", method=method), timeout=5) as r:
        return json.loads(r.read() or b"{}") if method == "GET" else None


class World:
    """One workspace with an admin, an editor and a viewer, three editor seats of which two are used."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws = self.new_id()
        conn.execute("insert into app.workspaces (id, name) values (%s, 'Halden Pet Nutrition')", (self.ws,))
        conn.execute("insert into app.subscriptions (workspace_id, plan, status, editor_seats) "
                     "values (%s, 'basic', 'active', 3)", (self.ws,))
        self.admin = self.user("johanna", "Johanna Holm", "admin")
        self.editor = self.user("carl", "Carl Berg", "editor")
        self.viewer = self.user("vera", "Vera Lind", "viewer")
        self.outsider = self.user("bob", "Bob Other", None)

    @staticmethod
    def new_id():
        return str(uuid.uuid4())

    def address(self, name):
        return f"{name}.{self.tag}@halden.test"

    def user(self, name, display, role):
        uid, pid = self.new_id(), self.new_id()
        self.conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, self.address(name)))
        self.conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, %s, %s)",
                          (pid, uid, display, self.address(name)))
        mid = None
        if role:
            mid = self.conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, %s)"
                                    " returning id::text", (self.ws, pid, role)).fetchone()["id"]
        return {"uid": uid, "pid": pid, "mid": mid, "email": self.address(name)}

    @contextmanager
    def as_user(self, who):
        """The caller's JWT and role for one statement group, in a savepoint so a refusal leaves the test usable."""
        with self.conn.transaction():
            self.conn.execute("select set_config('request.jwt.claims', %s, true)",
                              (json.dumps({"sub": who["uid"], "role": "authenticated"}),))
            self.conn.execute("set local role authenticated")
            yield
            self.conn.execute("reset role")

    def invite(self, who, email, role="editor", external=False, ends_at=None):
        with self.as_user(who):
            return self.conn.execute("select app.invite_member(%s, %s, %s, %s, null, null, %s)::text as id",
                                     (self.ws, email, role, external, ends_at)).fetchone()["id"]

    def accept(self, who, token):
        with self.as_user(who):
            return self.conn.execute("select app.accept_invitation(%s)::text as ws", (token,)).fetchone()["ws"]

    def run(self, kind, key):
        job = self.conn.execute("select id::text from app.jobs where idempotency_key = %s", (key,)).fetchone()
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s",
                                (job["id"],)).fetchone()
        outcome = process_message(PgStore(self.conn), registry, Message(msg["msg_id"], kind, {"job_id": job["id"]}), S)
        return outcome, self.conn.execute("select status, payload, progress, last_error from app.jobs where id = %s",
                                          (job["id"],)).fetchone()

    def send_invitation(self, inv):
        outcome, job = self.run("notify", f"invite:{inv}")
        assert outcome == "succeeded", job
        return job

    def emails_to(self, address):
        return mailpit(f"/api/v1/search?query=to:{urllib.parse.quote(address)}")["messages"]

    def token_for(self, address):
        [m] = self.emails_to(address)
        text = mailpit(f"/api/v1/message/{m['ID']}")["Text"]
        [token] = set(LINK.findall(text))
        return token

    def invitation(self, inv):
        return self.conn.execute("select * from app.invitations where id = %s", (inv,)).fetchone()


@pytest.fixture
def world():
    try:
        conn = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database (the CI worker job has none until T-009); run make db-start")
    try:
        mailpit("/api/v1/info")
    except OSError:
        conn.close()
        pytest.skip("no local Mailpit (the CI worker job has none until T-009); run make db-start")
    conn.autocommit = False
    w = World(conn)
    try:
        yield w
    finally:
        conn.rollback()
        conn.close()
        for m in mailpit(f"/api/v1/search?query={w.tag}")["messages"]:
            mailpit(f"/api/v1/messages?ids={m['ID']}", method="DELETE")  # best effort; the next run uses a new tag


def refused(world, sqlstate, fn, *args, **kw):
    with pytest.raises(psycopg.Error) as exc:
        fn(*args, **kw)
    assert exc.value.sqlstate == sqlstate, exc.value
    return exc.value


# ── A03 · invite a member ──────────────────────────────────────────────────────────────────────────────
def test_A03_main_an_admin_invites_and_the_worker_emails_a_link_whose_hash_alone_is_stored(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria.upper())
    row = world.invitation(inv)
    assert row["token_hash"] is None and row["email"] == maria and row["role"] == "editor"
    job = world.send_invitation(inv)
    assert job["payload"] == {"template": "invitation", "invitation_id": inv}
    assert job["progress"]["email"] == "sent" and job["last_error"] is None
    [m] = world.emails_to(maria)
    assert m["Subject"] == "Johanna Holm has invited you to Halden Pet Nutrition on Nutrivo"
    token = world.token_for(maria)
    assert bytes(world.invitation(inv)["token_hash"]) == hashlib.sha256(token.encode()).digest()
    dump = world.conn.execute("select (select json_agg(j)::text from app.jobs j where j.idempotency_key = %s) "
                              "|| (select json_agg(a)::text from app.audit_events a where a.workspace_id = %s) as t",
                              (f"invite:{inv}", world.ws)).fetchone()["t"]
    assert token not in dump
    audit = world.conn.execute("select actor_id::text, after from app.audit_events where workspace_id = %s "
                               "and kind = 'invitation.sent'", (world.ws,)).fetchone()
    assert audit["actor_id"] == world.admin["pid"] and audit["after"]["role"] == "editor"


def test_A03_must_1_only_admins_invite(world):
    for who in (world.editor, world.viewer, world.outsider):
        refused(world, "42501", world.invite, who, world.address("x"))
    assert world.conn.execute("select count(*) as n from app.invitations where workspace_id = %s",
                              (world.ws,)).fetchone()["n"] == 0


def test_A03_must_3_viewers_never_use_a_seat_external_editors_do(world):
    world.conn.execute("update app.subscriptions set editor_seats = 2 where workspace_id = %s", (world.ws,))
    world.invite(world.admin, world.address("viewer1"), role="viewer")      # both seats taken: viewers still free
    world.invite(world.admin, world.address("viewer2"), role="viewer", external=True)
    refused(world, "P0033", world.invite, world.admin, world.address("agency"), role="editor", external=True)
    world.conn.execute("update app.subscriptions set editor_seats = 3 where workspace_id = %s", (world.ws,))
    agency = world.address("agency")
    inv = world.invite(world.admin, agency, role="editor", external=True)
    world.send_invitation(inv)
    world.accept(world.user("agency", "Ann Agency", None), world.token_for(agency))
    refused(world, "P0033", world.invite, world.admin, world.address("next"), role="editor")


def test_A03_fail_1_no_seat_left_is_P0033_and_nothing_is_written(world):
    world.conn.execute("update app.subscriptions set editor_seats = 2 where workspace_id = %s", (world.ws,))
    err = refused(world, "P0033", world.invite, world.admin, world.address("maria"))
    assert "no editor seat left" in str(err)
    assert world.conn.execute("select (select count(*) from app.invitations where workspace_id = %(ws)s) "
                              "+ (select count(*) from app.jobs where workspace_id = %(ws)s) as n",
                              {"ws": world.ws}).fetchone()["n"] == 0


def test_A03_fail_2_a_second_invite_for_a_pending_address_never_duplicates(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria)
    world.send_invitation(inv)
    refused(world, "23505", world.invite, world.admin, maria)
    assert world.conn.execute("select count(*) as n from app.invitations where workspace_id = %s",
                              (world.ws,)).fetchone()["n"] == 1
    assert len(world.emails_to(maria)) == 1


@pytest.mark.xfail(strict=True, raises=psycopg.Error,
                   reason="needs a db task: app.invite_member refuses a pending address (23505) and nothing re-enqueues "
                          "the notify job (T-105 question 1 on #27)")
def test_A03_fail_2_a_second_invite_for_a_pending_address_resends_the_email(world):
    maria = world.address("maria")
    world.send_invitation(world.invite(world.admin, maria))
    world.invite(world.admin, maria)
    assert len(world.emails_to(maria)) == 2


# ── A04 · accept an invitation ─────────────────────────────────────────────────────────────────────────
def test_A04_main_the_invitee_accepts_with_the_emailed_link(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria, role="editor", ends_at="2027-01-31T00:00:00Z")
    world.send_invitation(inv)
    invitee = world.user("maria", "Maria Sand", None)
    assert world.accept(invitee, world.token_for(maria)) == world.ws
    m = world.conn.execute("select role, is_external, access_ends_at::date::text as ends from app.memberships "
                           "where workspace_id = %s and person_id = %s and ended_at is null",
                           (world.ws, invitee["pid"])).fetchone()
    assert m == {"role": "editor", "is_external": False, "ends": "2027-01-31"}
    assert world.invitation(inv)["accepted_at"] is not None
    assert world.conn.execute("select count(*) as n from app.audit_events where workspace_id = %s and "
                              "kind = 'membership.created'", (world.ws,)).fetchone()["n"] == 1


def test_A04_must_1_one_time_and_email_bound(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria)
    world.send_invitation(inv)
    emailed = world.token_for(maria)
    invitee = world.user("maria", "Maria Sand", None)
    token, token_hash = notify.new_token()                                 # as a retry of the notify job would
    assert PgStore(world.conn).set_invitation_token(inv, token_hash)
    refused(world, "P0040", world.accept, invitee, emailed)                # a replaced token is dead
    refused(world, "P0041", world.accept, world.outsider, token)           # bound to the invited address
    assert world.accept(invitee, token) == world.ws
    refused(world, "P0040", world.accept, invitee, token)                  # one time


def test_A04_must_2_the_external_flag_is_stamped_at_write_time(world):
    agency = world.address("agency")
    inv = world.invite(world.admin, agency, role="editor", external=True)
    world.send_invitation(inv)
    ann = world.user("agency", "Ann Agency", None)
    world.accept(ann, world.token_for(agency))
    world.conn.execute("update app.memberships set is_external = false where person_id = %s", (ann["pid"],))
    after = world.conn.execute("select after from app.audit_events where workspace_id = %s and "
                               "kind = 'membership.created'", (world.ws,)).fetchone()["after"]
    assert after["is_external"] is True                                    # as it was when written (BE-06)


def test_A04_fail_1_an_expired_invitation_is_P0040_and_gets_no_email(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria)
    world.send_invitation(inv)
    token = world.token_for(maria)
    world.conn.execute("update app.invitations set expires_at = now() - interval '1 minute' where id = %s", (inv,))
    refused(world, "P0040", world.accept, world.user("maria", "Maria Sand", None), token)
    late = world.address("late")
    inv2 = world.invite(world.admin, late)
    world.conn.execute("update app.invitations set expires_at = now() - interval '1 minute' where id = %s", (inv2,))
    assert world.send_invitation(inv2)["progress"] == {"outcome": "skipped_expired"}
    assert world.emails_to(late) == [] and world.invitation(inv2)["token_hash"] is None


def test_A04_fail_2_a_different_email_is_P0041(world):
    maria = world.address("maria")
    world.send_invitation(world.invite(world.admin, maria))
    refused(world, "P0041", world.accept, world.viewer, world.token_for(maria))


def test_A04_fail_3_already_a_member_is_P0042(world):
    carl = world.editor["email"]
    world.send_invitation(world.invite(world.admin, carl, role="admin"))
    refused(world, "P0042", world.accept, world.editor, world.token_for(carl))


def test_a_revoked_invitation_gets_no_email_and_no_token(world):
    maria = world.address("maria")
    inv = world.invite(world.admin, maria)
    with world.as_user(world.admin):
        world.conn.execute("select app.revoke_invitation(%s)", (inv,))
    outcome, job = world.run("notify", f"invite:{inv}")
    assert outcome == "duplicate" and job["status"] == "cancelled"       # revoke cancelled the queued job
    key = f"invite:{inv}"
    world.conn.execute("update app.jobs set status = 'queued' where idempotency_key = %s", (key,))
    world.conn.execute("select pgmq.send('notify', jsonb_build_object('job_id', id)) from app.jobs "
                       "where idempotency_key = %s", (key,))
    outcome, job = world.run("notify", f"invite:{inv}")                  # had it run anyway, it sends nothing
    assert outcome == "succeeded" and job["progress"] == {"outcome": "skipped_revoked"}
    assert world.emails_to(maria) == [] and world.invitation(inv)["token_hash"] is None


# ── A06 · session_revoke ───────────────────────────────────────────────────────────────────────────────
def test_session_revoke_signs_the_removed_member_out_of_sessions_from_before_the_removal(world):
    carl = world.editor
    old = world.conn.execute("insert into auth.sessions (id, user_id, created_at) values (%s, %s, now() - interval "
                             "'1 hour') returning id::text", (world.new_id(), carl["uid"])).fetchone()["id"]
    world.conn.execute("insert into auth.refresh_tokens (token, user_id, session_id, revoked) values (%s, %s, %s, "
                       "false)", (uuid.uuid4().hex, carl["uid"], old))
    other = world.conn.execute("insert into auth.sessions (id, user_id, created_at) values (%s, %s, now() - interval "
                               "'1 hour') returning id::text", (world.new_id(), world.viewer["uid"])).fetchone()["id"]
    with world.as_user(world.admin):
        world.conn.execute("select app.remove_member(%s, 'left the company')", (carl["mid"],))
    later = world.conn.execute("insert into auth.sessions (id, user_id, created_at) values (%s, %s, now() + interval "
                               "'1 minute') returning id::text", (world.new_id(), carl["uid"])).fetchone()["id"]
    outcome, job = world.run("session_revoke", f"session_revoke:{carl['mid']}")
    assert outcome == "succeeded" and job["progress"] == {"outcome": "revoked", "sessions_revoked": 1}
    left = {r["id"] for r in world.conn.execute("select id::text from auth.sessions where id = any(%s::uuid[])",
                                                ([old, other, later],)).fetchall()}
    assert left == {other, later}
    assert world.conn.execute("select count(*) as n from auth.refresh_tokens where session_id = %s",
                              (old,)).fetchone()["n"] == 0
