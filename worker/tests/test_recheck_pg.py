"""T-903 · J05 scoped re-check and I05 supersession, end to end on the local stack.

Two synthetic released rulesets (T903A-*, then T903B-*): the designation wording rule changes from version 1 to 2 (a
material 'prescribed_wording' diff) and the batch particular does not. N recipes were checked under the first. Staff
request the scoped re-check of the diff: one recheck job per recipe (BE-42), each re-evaluating only the changed rule
and carrying the rest forward (BE-25). The diff's diff_fanout job supersedes the reports and certificates that relied on
the rule (BE-30): never for an editorial diff, and superseded is never 'invalid'.

Everything runs in one transaction that is rolled back; rules, terms and rulesets are synthetic, never law."""
import uuid
from collections import Counter

import psycopg
import pytest
from psycopg.types.json import Jsonb
from test_check_pg import DOMAINS, one, pg_conn, request_check, run_job, seed_product

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.engine import core
from nutrivo_worker.handlers import diff_fanout
from nutrivo_worker.handlers import recheck as recheck_handler
from nutrivo_worker.jobs import Message, Registry, process_message

S = Settings(max_attempts=5, stale_after_s=900)
BATCH, DESIG = "TEST.T903.BATCH", "TEST.T903.DESIG"
N = 3


@pytest.fixture
def conn():
    yield from pg_conn()


def seed_rulesets(conn, person):
    """A: batch v1 (EU) and designation v1 (EU-SE). B: batch v1 and designation v2, whose register term is new.
    A is released a minute from now, so request_check picks it; B (release_b) two minutes from now, after the checks."""
    tag = uuid.uuid4().hex[:8]
    a, b = f"T903A-{tag}", f"T903B-{tag}"
    conn.execute("insert into ref.ruleset_versions (id, notes, released_at) values "
                 "(%s, 'T-903 test A', now() + interval '1 minute')", (a,))
    for key, shape, node, domain in ((BATCH, "mandatory_particular", "EU", "mandatory_particulars"),
                                     (DESIG, "prescribed_wording", "EU-SE", "claims_wording")):
        conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values (%s, %s, %s, %s,"
                     " 'Synthetic test rule') on conflict do nothing", (key, shape, domain, node))
    for key, version, params in ((BATCH, 1, {"particular": "Test batch", "detect": {"term_keys": ["t903_batch"]}}),
                                 (DESIG, 1, {"term_key": "t903_desig"}), (DESIG, 2, {"term_key": "t903_desig_v2"})):
        conn.execute("insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref,"
                     " source_excerpt, accepted_by, accepted_at) values (%s, %s, 'accepted', %s,"
                     " '{\"eq\": [\"species\", \"cat\"]}', 'TEST Art. 1', 'synthetic', %s, now())"
                     " on conflict do nothing", (key, version, Jsonb(params), person))
    seed_members(conn, a, b, (a,))
    return a, b


def release_b(conn, a, b):
    conn.execute("insert into ref.ruleset_versions (id, notes, released_at) values "
                 "(%s, 'T-903 test B', now() + interval '2 minutes')", (b,))
    seed_members(conn, a, b, (b,))


def seed_members(conn, a, b, which):
    for rv, desig in ((a, 1), (b, 2)):
        if rv not in which:
            continue
        conn.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version) values (%s, %s, 1),"
                     " (%s, %s, %s)", (rv, BATCH, rv, DESIG, desig))
        for d in DOMAINS:
            conn.execute("insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded)"
                         " values (%s, 'EU-SE', %s, 'complete', 1)", (rv, d))
    terms = {a: (("t903_batch", "sv", "Testparti"), ("t903_batch", "en", "Test lot"),
                 ("t903_desig", "sv", "Testfoder för katter"), ("t903_desig", "en", "Test food for cats")),
             b: (("t903_batch", "sv", "Testparti"), ("t903_batch", "en", "Test lot"),
                 ("t903_desig_v2", "sv", "Helfoder för katter"), ("t903_desig_v2", "en", "Test food for cats"))}
    for rv, entries in terms.items():
        if rv not in which:
            continue
        for key, lang, term in entries:
            conn.execute("insert into ref.term_entries (term_key, language, term, kind, article_ref, status,"
                         " ruleset_version) values (%s, %s, %s, 'heading', 'TEST', 'accepted', %s)",
                         (key, lang, term, rv))


def staff(conn):
    tag = uuid.uuid4().hex[:8]
    user = one(conn, "insert into auth.users (id, email) values (gen_random_uuid(), %s) returning id",
               f"t903-staff-{tag}@nutrivo.test")["id"]
    person = one(conn, "insert into app.people (user_id, display_name, email) values (%s, 'T-903 staff', %s)"
                       " returning id", user, f"t903-staff-{tag}@nutrivo.test")["id"]
    return {"user": str(user), "person": str(person)}


def as_staff(conn, who, sql, *args):
    with conn.transaction():
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{who["user"]}","role":"authenticated","app_metadata":{{"nutrivo_staff":true}}}}',))
        conn.execute("set local role authenticated")
        row = one(conn, sql, *args)
        conn.execute("reset role")
        conn.execute("select set_config('request.jwt.claims', '', true)")
    return row


def diff(conn, ruleset, effect="prescribed_wording", rule=DESIG, from_v=1, to_v=2):
    return str(one(conn, "insert into ref.rule_diffs (ruleset_version, rule_key, from_version, to_version,"
                         " effect_type) values (%s, %s, %s, %s, %s) returning id",
                   ruleset, rule, from_v, to_v, effect)["id"])


def run(conn, kind, job_id, reg):
    msg = one(conn, f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s order by msg_id desc limit 1",
              job_id)
    assert msg, f"{kind} job {job_id} has no message"
    outcome = process_message(PgStore(conn), reg, Message(msg["msg_id"], kind, {"job_id": job_id}), S)
    return outcome, one(conn, "select status, progress, last_error from app.jobs where id = %s", job_id)


def registry():
    reg = Registry()
    reg.register("recheck")(recheck_handler.recheck)
    reg.register("diff_fanout")(lambda j, ctx: diff_fanout.run(j, ctx, ctx.store))
    return reg


@pytest.fixture
def world(conn):
    """N recipes in EU-SE checked under ruleset A, plus one product whose latest check never touched the rule."""
    s0 = seed_product(conn)
    a, b = seed_rulesets(conn, s0["person"])
    recipes = [s0] + [seed_product(conn) for _ in range(N - 1)]
    base_jobs = []
    for s in recipes:
        job = request_check(conn, s)
        assert run_job(conn, job) == "succeeded"
        base_jobs.append(job)
    conn.execute("select set_config('request.jwt.claims', '', true)")   # request_check leaves the editor's claims
    release_b(conn, a, b)
    bystander = seed_product(conn)
    conn.execute("insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,"
                 " applied_rule_keys) values (%s, %s, 'EU-SE', %s, 'action', %s)",
                 (bystander["ws"], bystander["product"], a, [BATCH]))
    return {"a": a, "b": b, "recipes": recipes, "base_jobs": base_jobs, "bystander": bystander, "staff": staff(conn)}


def latest_checks(conn, product):
    return conn.execute("select c.* from app.checks c where c.product_id = %s and c.trigger = 'rule_diff'"
                        " order by c.language", (product,)).fetchall()


def test_J05_main_staff_recheck_a_material_diff_one_job_per_recipe(conn, world):
    w = world
    d = diff(conn, w["b"])
    out = as_staff(conn, w["staff"], "select app.request_scoped_recheck(%s) as r", d)["r"]
    assert out["ruleset_version"] == w["b"]
    jobs = out["jobs"]
    assert sorted(j["product_id"] for j in jobs) == sorted(s["product"] for s in w["recipes"])   # not the bystander
    assert all(j["node_ids"] == ["EU-SE"] for j in jobs)
    # The jobs carry ids only, are scoped to their recipe and market, and were requested by the staff member.
    for j in jobs:
        row = one(conn, "select kind, workspace_id::text, product_id::text, node_ids, payload, idempotency_key,"
                        " requested_by::text from app.jobs where id = %s", j["job_id"])
        assert row["kind"] == "recheck" and row["product_id"] == j["product_id"] and row["node_ids"] == ["EU-SE"]
        assert set(row["payload"]) <= {"product_id", "node_ids", "rule_diff_id", "request_id"}
        assert row["idempotency_key"] == f"recheck:{d}:{j['product_id']}"
        assert row["requested_by"] == w["staff"]["person"]
    # Asking again queues nothing new.
    again = as_staff(conn, w["staff"], "select app.request_scoped_recheck(%s) as r", d)["r"]
    assert sorted(j["job_id"] for j in again["jobs"]) == sorted(j["job_id"] for j in jobs)
    assert one(conn, "select count(*)::int as n from app.jobs where idempotency_key like %s", f"recheck:{d}:%")["n"] == N

    reg = registry()
    for j, s in zip(sorted(jobs, key=lambda j: j["product_id"]),
                    sorted(w["recipes"], key=lambda s: s["product"]), strict=True):
        outcome, row = run(conn, "recheck", j["job_id"], reg)
        assert outcome == "succeeded", row
        assert row["progress"]["outcome"] == "rechecked"
        assert row["progress"]["evaluated_rule_keys"] == [DESIG]
        new = latest_checks(conn, s["product"])
        assert [c["language"] for c in new] == ["en", "sv"]                 # every language panel of the market
        for c in new:
            assert c["ruleset_version"] == w["b"] and str(c["job_id"]) == j["job_id"]
            assert c["artwork_sha"] == "a" * 64 and str(c["artwork_version_id"]) == s["av"]
        sv = next(c for c in new if c["language"] == "sv")
        # The Swedish panel prints the version 1 designation, which version 2 no longer accepts: an action, judged on
        # the printed Swedish string (BE-22), with the new rule version and a rule key.
        findings = conn.execute("select rule_key, rule_version, state, provenance from app.check_findings"
                                " where check_id = %s order by rule_key", (sv["id"],)).fetchall()
        assert {"rule_key": DESIG, "rule_version": 2, "state": "action",
                "provenance": "deterministic_rule"} in findings
        assert sv["label_state"] == "action"
        node = one(conn, "select label_state, ruleset_version, last_check_job_id::text from app.product_nodes"
                         " where product_id = %s and node_id = 'EU-SE'", s["product"])
        assert node == {"label_state": "action", "ruleset_version": w["b"], "last_check_job_id": j["job_id"]}
        # One event per recipe (BE-42).
        assert one(conn, "select count(*)::int as n from app.audit_events where kind = 'check.completed'"
                         " and object_id = %s", j["job_id"])["n"] == 1
        # A duplicate delivery writes nothing.
        conn.execute("update app.jobs set status = 'queued' where id = %s", (j["job_id"],))
        conn.execute("select pgmq.send('recheck', %s::jsonb)", (f'{{"job_id":"{j["job_id"]}"}}',))
        assert run(conn, "recheck", j["job_id"], reg)[1]["progress"]["outcome"] == "already_rechecked"
        assert len(latest_checks(conn, s["product"])) == 2
    # Contract 5 now reads the re-checked rows as the latest.
    assert {str(r["product_id"]) for r in conn.execute("select product_id from app.affected_objects(%s)",
                                                         (d,)).fetchall()} == {s["product"] for s in w["recipes"]}


def test_J05_must_1_a_one_rule_change_across_N_recipes_runs_only_the_scoped_evaluations(conn, world, monkeypatch):
    w = world
    calls: Counter = Counter()
    real = core.evaluate_rule

    def spy(ctx):
        calls[ctx.rule.rule_key] += 1
        return real(ctx)

    monkeypatch.setattr(core, "evaluate_rule", spy)
    d = diff(conn, w["b"])
    jobs = as_staff(conn, w["staff"], "select app.request_scoped_recheck(%s) as r", d)["r"]["jobs"]
    assert len(jobs) == N                                       # one job per recipe, none for the bystander
    reg = registry()
    for j in jobs:
        assert run(conn, "recheck", j["job_id"], reg)[0] == "succeeded"
    # Only the changed rule, once per recipe × language panel (2 panels): never the unchanged batch rule.
    assert calls == Counter({DESIG: N * 2})
    for s, base_job in zip(w["recipes"], w["base_jobs"], strict=True):
        base = {c["language"]: c for c in conn.execute("select * from app.checks where job_id = %s", (base_job,))}
        for c in latest_checks(conn, s["product"]):
            b = base[c["language"]]
            # The batch rule's outcome is carried forward exactly as last judged.
            assert (BATCH in c["applied_rule_keys"]) == (BATCH in b["applied_rule_keys"])
            assert (BATCH in c["passed_rule_keys"]) == (BATCH in b["passed_rule_keys"])
            assert (BATCH in c["withheld_rule_keys"]) == (BATCH in b["withheld_rule_keys"])
            carried = conn.execute("select state, reason_code, rule_version, message from app.check_findings"
                                   " where check_id = %s and rule_key = %s", (c["id"], BATCH)).fetchall()
            before = conn.execute("select state, reason_code, rule_version, message from app.check_findings"
                                  " where check_id = %s and rule_key = %s", (b["id"], BATCH)).fetchall()
            assert carried == before
    # A recipe whose latest check is already on the diff's ruleset is skipped, not re-evaluated. (Every row of this
    # test transaction shares one now(), so the later check is dated explicitly.)
    r0 = w["recipes"][0]
    conn.execute("insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,"
                 " applied_rule_keys, at) values (%s, %s, 'EU-SE', %s, 'action', %s, now() + interval '1 hour')",
                 (r0["ws"], r0["product"], w["b"], [DESIG]))
    again = str(one(conn, "insert into app.jobs (kind, workspace_id, idempotency_key, payload) values"
                          " ('recheck', %s, %s, %s) returning id", r0["ws"], f"t903-again-{uuid.uuid4()}",
                    Jsonb({"product_id": r0["product"], "node_ids": ["EU-SE"], "rule_diff_id": d}))["id"])
    conn.execute("select pgmq.send('recheck', %s::jsonb)", (f'{{"job_id":"{again}"}}',))
    calls.clear()
    outcome, row = run(conn, "recheck", again, reg)
    assert outcome == "succeeded", row
    assert row["progress"]["outcome"] == "nothing_to_recheck"
    assert row["progress"]["skipped"] == {"EU-SE": "already_current"}
    assert calls == Counter()


def test_J05_an_editorial_diff_or_a_non_staff_caller_queues_nothing(conn, world):
    w = world
    ed = diff(conn, w["b"], effect="editorial")
    out = as_staff(conn, w["staff"], "select app.request_scoped_recheck(%s) as r", ed)["r"]
    assert out["jobs"] == [] and out["skipped"] == "editorial"
    d = diff(conn, w["b"])
    member = w["recipes"][0]
    with pytest.raises(psycopg.errors.InsufficientPrivilege), conn.transaction():
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{member["user"]}","role":"authenticated"}}',))
        conn.execute("set local role authenticated")
        conn.execute("select app.request_scoped_recheck(%s)", (d,))
    assert one(conn, "select count(*)::int as n from app.jobs where idempotency_key like %s", f"recheck:{d}:%")["n"] == 0


def report_for(conn, s, check_job, ruleset, *, certificate=False):
    ids = [str(r["id"]) for r in conn.execute("select id from app.checks where job_id = %s", (check_job,))]
    ref = f"T903-{uuid.uuid4().hex}"
    rep = str(one(conn, "insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version,"
                        " artwork_sha, has_not_assessed) values (%s, %s, 'EU-SE', %s, %s::uuid[], %s, %s, false)"
                        " returning id", s["ws"], s["product"], ref, ids, ruleset, "a" * 64)["id"])
    cert = None
    if certificate:
        grant = one(conn, "insert into app.signing_grants (workspace_id, person_id, node_id, granted_by)"
                          " values (%s, %s, 'EU-SE', %s) returning id", s["ws"], s["person"], s["person"])["id"]
        cert = str(one(conn, "insert into app.certificates (workspace_id, report_id, product_id, node_id, signer_id,"
                             " grant_id, hash) values (%s, %s, %s, 'EU-SE', %s, %s, %s) returning id",
                       s["ws"], rep, s["product"], s["person"], grant, f"t903-{uuid.uuid4().hex}")["id"])
    return rep, ref, cert


def fan_out(conn, d):
    job = str(one(conn, "select private.enqueue('diff_fanout', null, %s, %s::jsonb) as id",
                  f"diff_fanout:{d}", Jsonb({"rule_diff_id": d}))["id"])
    return run(conn, "diff_fanout", job, registry())


def test_I05_main_a_material_diff_supersedes_the_reports_and_certificates_that_relied_on_the_rule(conn, world):
    w = world
    s0, s1 = w["recipes"][0], w["recipes"][1]
    rep, ref, cert = report_for(conn, s0, w["base_jobs"][0], w["a"], certificate=True)
    rep_other, _ref_other, _ = report_for(conn, s1, w["base_jobs"][1], w["a"])
    assert one(conn, "select public.verify_reference(%s) as v", ref)["v"]["status"] == "current"
    d = diff(conn, w["b"])
    outcome, row = fan_out(conn, d)
    assert outcome == "succeeded", row
    assert row["progress"]["superseded_reports"] == 2 and row["progress"]["superseded_certificates"] == 1
    rows = conn.execute("select artefact_type, artefact_id::text, rule_key, rule_diff_id::text, ruleset_version,"
                        " product_id::text, node_id from app.supersessions where rule_diff_id = %s"
                        " order by artefact_type, artefact_id", (d,)).fetchall()
    assert {(r["artefact_type"], r["artefact_id"]) for r in rows} == {("report", rep), ("report", rep_other),
                                                                      ("certificate", cert)}
    assert all(r["rule_key"] == DESIG and r["ruleset_version"] == w["b"] and r["node_id"] == "EU-SE" for r in rows)
    # Verification says superseded, with the report's own issue and ruleset, and nothing more.
    v = one(conn, "select public.verify_reference(%s) as v", ref)["v"]
    assert v["status"] == "superseded" and v["ruleset_version"] == w["a"]
    assert one(conn, "select count(*)::int as n from app.audit_events where kind = 'artefact.superseded'"
                     " and object_id = %s", d)["n"] == 2                      # one per workspace
    # Run again (a retry of the job): nothing new.
    assert one(conn, "select app.supersede_for_rule_diff(%s) as r", d)["r"] == {
        "rule_diff_id": d, "effect_type": "prescribed_wording", "reports": 0, "certificates": 0}
    # A report issued on the diff's own ruleset (after the re-check) already reflects the change.
    jobs = as_staff(conn, w["staff"], "select app.request_scoped_recheck(%s) as r", d)["r"]["jobs"]
    job0 = next(j["job_id"] for j in jobs if j["product_id"] == s0["product"])
    assert run(conn, "recheck", job0, registry())[0] == "succeeded"
    _new_rep, new_ref, _ = report_for(conn, s0, job0, w["b"])
    assert one(conn, "select app.supersede_for_rule_diff(%s) as r", d)["r"]["reports"] == 0
    assert one(conn, "select public.verify_reference(%s) as v", new_ref)["v"]["status"] == "current"


def test_I05_must_1_editorial_diffs_never_supersede_and_superseded_is_never_invalid(conn, world):
    w = world
    s0 = w["recipes"][0]
    rep, ref, cert = report_for(conn, s0, w["base_jobs"][0], w["a"], certificate=True)
    ed = diff(conn, w["b"], effect="editorial")
    outcome, row = fan_out(conn, ed)
    assert outcome == "succeeded", row
    assert row["progress"]["outcome"] == "skipped_editorial" and "superseded_reports" not in row["progress"]
    r = one(conn, "select app.supersede_for_rule_diff(%s) as r", ed)["r"]
    assert r["skipped"] == "editorial" and r["reports"] == 0
    assert one(conn, "select count(*)::int as n from app.supersessions where artefact_id in (%s, %s)", rep, cert)["n"] == 0
    assert one(conn, "select public.verify_reference(%s) as v", ref)["v"]["status"] == "current"
    # The schema refuses an editorial supersession and one whose rule is not its diff's.
    for diff_id, rule in ((ed, DESIG), (diff(conn, w["b"]), BATCH)):
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute("insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key,"
                         " rule_diff_id, ruleset_version) values (%s, 'report', %s, %s, %s, %s)",
                         (s0["ws"], rep, rule, diff_id, w["b"]))
    # A material diff supersedes; the status is 'superseded', never 'invalid', and the report row is untouched.
    d = diff(conn, w["b"])
    fan_out(conn, d)
    v = one(conn, "select public.verify_reference(%s) as v", ref)["v"]
    assert v["status"] == "superseded" and v["status"] != "invalid"
    assert set(v) == {"status", "issued_at", "ruleset_version", "has_not_assessed"}
    assert one(conn, "select count(*)::int as n from app.reports where id = %s", rep)["n"] == 1
    # Supersessions are insert-only.
    with pytest.raises(psycopg.Error), conn.transaction():
        conn.execute("update app.supersessions set rule_key = 'x' where artefact_id = %s", (rep,))
