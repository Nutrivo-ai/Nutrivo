"""T-901 · J03 end to end on the local stack: a released diff's diff_fanout job, run through the real loop on PgStore,
writes alerts from the applied-rule join (BE-24); the daily sweep job queues the batched rule_changed notify job,
whose email names the recipe; read state is per person (BE-39).

Each test runs in one transaction that is rolled back; ref rows are synthetic and never leave it. The mailer is in
memory. Locally the tests skip without the stack; CI's worker job fails such a skip (tests/pgtest.py)."""
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime

import psycopg
import pytest
from fakes import FakeMailer
from pgtest import DSN, connect_or_skip

from nutrivo_worker import mail
from nutrivo_worker import observability as obs
from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import diff_fanout, notify
from nutrivo_worker.jobs import Message, Registry, process_message

S = Settings(max_attempts=5, app_base_url="https://app.nutrivo.test")


class World:
    """Workspace W: Anna (admin) and Ben (viewer); recipe 'Senior range' with product 'Senior salmon' whose latest check
    in EU-FR applied the rule, and 'Puppy mini' whose check applied another rule. Workspace O: Olga, whose product also
    applied the rule."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws, self.other = self.id(), self.id()
        self.anna, self.ben, self.olga = self.person("anna"), self.person("ben"), self.person("olga")
        self.ruleset = f"T901-{self.tag}"
        self.rule, self.rule2 = f"TEST.T901.{self.tag.upper()}", f"TEST.T901.{self.tag.upper()}.OTHER"
        conn.execute("insert into ref.ruleset_versions (id, notes) values (%s, 'T-901 test')", (self.ruleset,))
        for key in (self.rule, self.rule2):
            conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values "
                         "(%s, 'prescribed_wording', 'claims_wording', 'EU-FR', 'Synthetic rule for the T-901 tests')",
                         (key,))
        for ws, name, people in ((self.ws, "Halden Pet Nutrition", ((self.anna, "admin"), (self.ben, "viewer"))),
                                 (self.other, "Other Pet Co", ((self.olga, "admin"),))):
            conn.execute("insert into app.workspaces (id, name) values (%s, %s)", (ws, name))
            conn.execute("insert into app.allowances (workspace_id) values (%s)", (ws,))
            for who, role in people:
                conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, %s)",
                             (ws, who["pid"], role))
        self.salmon = self.product(self.ws, "Senior range", "Senior salmon", self.rule)
        self.puppy = self.product(self.ws, "Puppy range", "Puppy mini", self.rule2)
        self.other_product = self.product(self.other, "Other range", "Other dry", self.rule)
        self.mailer = FakeMailer()
        self.reg = Registry()
        self.reg.register("diff_fanout")(lambda j, ctx: diff_fanout.run(j, ctx, ctx.store))
        self.reg.register("notify")(lambda j, ctx: notify.send_rule_changed(j, ctx, ctx.store, self.mailer))

    @staticmethod
    def id():
        return str(uuid.uuid4())

    def person(self, name):
        uid, pid, email = self.id(), self.id(), f"{name}.{self.tag}@halden.test"
        self.conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
        self.conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, %s, %s)",
                          (pid, uid, name.title(), email))
        return {"uid": uid, "pid": pid, "email": email}

    def product(self, ws, family, name, rule):
        fam, pid = self.id(), self.id()
        self.conn.execute("insert into app.families (id, workspace_id, name) values (%s, %s, %s)", (fam, ws, family))
        self.conn.execute("insert into app.products (id, workspace_id, family_id, name, stage) "
                          "values (%s, %s, %s, %s, 'active')", (pid, ws, fam, name))
        self.conn.execute("insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, "
                          "applied_rule_keys) values (%s, %s, 'EU-FR', %s, 'action', %s)",
                          (ws, pid, self.ruleset, [rule]))
        return pid

    def diff(self, effect="prescribed_wording", effective_from="2099-01-01"):
        return str(self.conn.execute(
            "insert into ref.rule_diffs (ruleset_version, rule_key, from_version, to_version, effect_type, "
            "effective_from) values (%s, %s, 1, 2, %s, %s) returning id",
            (self.ruleset, self.rule, effect, effective_from)).fetchone()["id"])

    def enqueue(self, key, payload, ws=None):
        return str(self.conn.execute("select private.enqueue(%s, %s, %s, %s::jsonb) as id",
                                     ("diff_fanout", ws, key, psycopg.types.json.Jsonb(payload))).fetchone()["id"])

    def run(self, kind, job_id):
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s",
                                (str(job_id),)).fetchone()
        outcome = process_message(PgStore(self.conn), self.reg, Message(msg["msg_id"], kind, {"job_id": str(job_id)}), S)
        return outcome, self.conn.execute("select status, progress, last_error from app.jobs where id = %s",
                                          (job_id,)).fetchone()

    def alerts(self, diff):
        return self.conn.execute("select workspace_id::text, product_id::text, node_id, phase from app.alerts "
                                 "where rule_diff_id = %s order by workspace_id, product_id", (diff,)).fetchall()

    @contextmanager
    def as_user(self, who):
        self.conn.execute("select set_config('request.jwt.claims', %s, true)",
                          (f'{{"sub":"{who["uid"]}","role":"authenticated"}}',))
        self.conn.execute("set role authenticated")
        try:
            yield
        finally:
            if self.conn.info.transaction_status != psycopg.pq.TransactionStatus.INERROR:
                self.conn.execute("reset role")
                self.conn.execute("select set_config('request.jwt.claims', '', true)")


@pytest.fixture
def world(monkeypatch):
    checkins = []
    monkeypatch.setattr(obs.crons, "capture_checkin", lambda **kw: checkins.append(kw) or "ci-1")
    monkeypatch.setattr(mail, "mailer_for", lambda settings: pytest.fail("the test's FakeMailer must be used"))
    conn = connect_or_skip(connect, DSN)
    conn.autocommit = False
    try:
        w = World(conn)
        w.checkins = checkins
        yield w
    finally:
        conn.rollback()
        conn.close()


def test_J03_main_a_released_diff_becomes_alerts_then_one_batched_email_per_workspace(world):
    w = world
    diff = w.diff()
    job = w.enqueue(f"diff_fanout:{diff}", {"rule_diff_id": diff})
    outcome, row = w.run("diff_fanout", job)
    assert outcome == "succeeded", row
    assert row["progress"] == {"outcome": "fanned_out", "rule_diff_id": diff, "alerts": 2, "workspaces": 2,
                               "superseded_reports": 0, "superseded_certificates": 0}   # no report (T-903)
    assert w.alerts(diff) == sorted([
        {"workspace_id": w.ws, "product_id": w.salmon, "node_id": "EU-FR", "phase": "coming"},
        {"workspace_id": w.other, "product_id": w.other_product, "node_id": "EU-FR", "phase": "coming"},
    ], key=lambda a: (a["workspace_id"], a["product_id"]))

    # Delivered again: nothing new.
    w.conn.execute("update app.jobs set status = 'queued' where id = %s", (job,))
    w.conn.execute("select pgmq.send('diff_fanout', %s::jsonb)", (f'{{"job_id":"{job}"}}',))
    assert w.run("diff_fanout", job)[1]["progress"]["alerts"] == 0
    assert len(w.alerts(diff)) == 2

    # Puppy mini is re-checked after the fan-out and now applies the rule: contract 5 would name it, but it has no
    # alert, so the email (built from the alerts) must not name it either.
    w.conn.execute("insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, "
                   "applied_rule_keys, at) values (%s, %s, 'EU-FR', %s, 'action', %s, now() + interval '1 minute')",
                   (w.ws, w.puppy, w.ruleset, [w.rule]))

    # The daily sweep queues one rule_changed job per affected workspace, inside its cron check-in.
    sweep = str(w.conn.execute("select private.enqueue_alert_sweep() as id").fetchone()["id"])
    outcome, row = w.run("diff_fanout", sweep)
    assert outcome == "succeeded", row
    assert row["progress"]["outcome"] == "swept"
    assert [c["status"] for c in w.checkins] == ["in_progress", "ok"]
    assert w.checkins[0]["monitor_slug"] == "alert-sweep"
    notify_jobs = w.conn.execute("select id::text, workspace_id::text from app.jobs where kind = 'notify' "
                                 "and idempotency_key like %s order by workspace_id",
                                 (f"rule_changed:{diff}:%",)).fetchall()
    assert sorted(j["workspace_id"] for j in notify_jobs) == sorted([w.ws, w.other])

    # The batched email for W names the recipe the alert came from, to both of W's members.
    mine = next(j["id"] for j in notify_jobs if j["workspace_id"] == w.ws)
    outcome, row = w.run("notify", mine)
    assert outcome == "succeeded", row
    assert sorted(e.to for e in w.mailer.sent) == sorted([w.anna["email"], w.ben["email"]])
    assert all("Senior salmon" in e.text and "Puppy mini" not in e.text for e in w.mailer.sent)   # what the inbox shows


def test_J03_must_1_alerts_name_recipes_through_the_applied_rule_join(world):
    w = world
    diff = w.diff()
    w.run("diff_fanout", w.enqueue(f"diff_fanout:{diff}", {"rule_diff_id": diff}))
    named = w.conn.execute("""select f.name as recipe, pr.name as product from app.alerts a
                                join app.products pr on pr.id = a.product_id
                                join app.families f on f.id = pr.family_id
                               where a.rule_diff_id = %s and a.workspace_id = %s""", (diff, w.ws)).fetchall()
    assert named == [{"recipe": "Senior range", "product": "Senior salmon"}]   # Puppy mini never applied the rule
    # The alerts are exactly contract 5's rows: a join over the applied-rule record, never a re-evaluation.
    contract = w.conn.execute("select workspace_id::text, product_id::text, node_id from app.affected_objects(%s) "
                              "order by 1, 2", (diff,)).fetchall()
    assert contract == [{k: a[k] for k in ("workspace_id", "product_id", "node_id")} for a in w.alerts(diff)]


def test_J03_must_2_read_state_is_per_person(world):
    w = world
    diff = w.diff()
    w.run("diff_fanout", w.enqueue(f"diff_fanout:{diff}", {"rule_diff_id": diff}))
    alert = w.conn.execute("select id::text from app.alerts where rule_diff_id = %s and workspace_id = %s",
                           (diff, w.ws)).fetchone()["id"]
    with w.as_user(w.anna):
        assert w.conn.execute("select app.mark_alerts_read(%s::uuid[]) as n", ([alert],)).fetchone()["n"] == 1
        assert w.conn.execute("select count(*)::int as n from app.alert_reads").fetchone()["n"] == 1
    with w.as_user(w.ben):
        assert w.conn.execute("select count(*)::int as n from app.alerts where id = %s", (alert,)).fetchone()["n"] == 1
        assert w.conn.execute("select count(*)::int as n from app.alert_reads").fetchone()["n"] == 0   # unread for Ben
    w.conn.execute("savepoint olga")
    with pytest.raises(psycopg.errors.InsufficientPrivilege), w.as_user(w.olga):
        w.conn.execute("select app.mark_alerts_read(%s::uuid[])", ([alert],))
    w.conn.execute("rollback to savepoint olga")
    w.conn.execute("reset role")
    with w.as_user(w.olga):
        assert w.conn.execute("select count(*)::int as n from app.alerts where id = %s", (alert,)).fetchone()["n"] == 0


def test_T901_an_editorial_diff_writes_no_alert(world):
    w = world
    diff = w.diff(effect="editorial")
    outcome, row = w.run("diff_fanout", w.enqueue(f"diff_fanout:{diff}", {"rule_diff_id": diff}))
    assert outcome == "succeeded" and row["progress"]["outcome"] == "skipped_editorial"
    assert w.alerts(diff) == []


def test_T901_an_unknown_diff_fails_without_retrying(world):
    w = world
    missing = str(uuid.uuid4())
    outcome, row = w.run("diff_fanout", w.enqueue(f"diff_fanout:{missing}", {"rule_diff_id": missing}))
    assert outcome == "failed" and row["status"] == "failed"
    assert "does not exist" in row["last_error"]


def test_T901_the_sweep_moves_an_arrived_alert_in_force_with_a_new_row(world):
    w = world
    today = datetime.now(UTC).date()
    diff = w.diff(effective_from=today.isoformat())
    w.conn.execute("insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, "
                   "effective_from) values (%s, %s, %s, 'EU-FR', 'coming', 'prescribed_wording', %s)",
                   (w.ws, diff, w.salmon, today))
    w.run("diff_fanout", str(w.conn.execute("select private.enqueue_alert_sweep() as id").fetchone()["id"]))
    assert sorted(a["phase"] for a in w.alerts(diff)) == ["coming", "in_force"]


def test_J03_must_1_a_recipe_rechecked_without_the_rule_gets_no_in_force_alert(world):
    w = world
    today = datetime.now(UTC).date()
    diff = w.diff(effective_from=today.isoformat())
    w.conn.execute("insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, "
                   "effective_from) values (%s, %s, %s, 'EU-FR', 'coming', 'prescribed_wording', %s)",
                   (w.ws, diff, w.salmon, today))
    # Reformulated and re-checked: the latest check no longer applies or withholds the rule.
    w.conn.execute("insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, "
                   "applied_rule_keys, at) values (%s, %s, 'EU-FR', %s, 'action', %s, now() + interval '1 minute')",
                   (w.ws, w.salmon, w.ruleset, [w.rule2]))
    w.run("diff_fanout", str(w.conn.execute("select private.enqueue_alert_sweep() as id").fetchone()["id"]))
    assert [a["phase"] for a in w.alerts(diff)] == ["coming"]
