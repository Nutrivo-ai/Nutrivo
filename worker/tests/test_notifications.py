"""O01 on the in-memory store: the five templates T-602 adds to notify (01 report, 03 rule_changed, 04
document_expiring, 05 allowance_used, 06 receipt), the in-app rows, preferences and idempotency, run through the real
job loop. tests/test_notifications_pg.py runs the main path and the editorial rule on Postgres and Mailpit."""
import email
import hashlib
import logging
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fakes import FakeMailer, FakeStore

from nutrivo_worker import email_templates as T
from nutrivo_worker import mail
from nutrivo_worker.config import Settings
from nutrivo_worker.handlers import notify  # noqa: F401  registers notify
from nutrivo_worker.jobs import process_message, registry

S = Settings(max_attempts=3)
WS = "20000000-0000-4000-8602-00000000000a"
ANNA, BORIS, CARL = ("30000000-0000-4000-8602-0000000000a1", "30000000-0000-4000-8602-0000000000b2",
                     "30000000-0000-4000-8602-0000000000c3")
DIFF, DOC, SHARE, REPORT = ("40000000-0000-4000-8602-000000000001", "40000000-0000-4000-8602-000000000002",
                            "40000000-0000-4000-8602-000000000003", "40000000-0000-4000-8602-000000000004")
SALMON, TOPPER = "50000000-0000-4000-8602-000000000001", "50000000-0000-4000-8602-000000000002"
EVT = "evt_1T602receipt"
TODAY = datetime.now(UTC).date()


@pytest.fixture
def mailer(monkeypatch):
    m = FakeMailer()
    monkeypatch.setattr(mail, "mailer_for", lambda settings: m)
    return m


def run(store, payload, job="job-1", ws=WS):
    return process_message(store, registry, store.add(job, "notify", workspace_id=ws, payload=payload), S)


def rule_world(effect_type="prescribed_wording", effective_from=TODAY + timedelta(days=58)):
    store = FakeStore()
    store.members |= {ANNA, BORIS}
    store.diffs[DIFF] = {"id": DIFF, "effect_type": effect_type, "effective_from": effective_from,
                         "rule_title": "Joint-function claims on complementary feed", "held_in": "France"}
    store.affected[DIFF] = [
        {"person_id": ANNA, "email": "anna@halden.test", "product_id": SALMON, "product_name": "Senior salmon · complete dry",
         "node_id": "EU-FR"},
        {"person_id": ANNA, "email": "anna@halden.test", "product_id": TOPPER, "product_name": "Joint support topper",
         "node_id": "EU-FR"},
        {"person_id": BORIS, "email": "boris@halden.test", "product_id": SALMON,
         "product_name": "Senior salmon · complete dry", "node_id": "EU-FR"},
        {"person_id": CARL, "email": "carl@halden.test", "product_id": SALMON,   # no longer a member
         "product_name": "Senior salmon · complete dry", "node_id": "EU-FR"},
    ]
    return store


# ── Template 03 and the in-app rows (O01 steps 1 and 3) ────────────────────────────────────────────────
def test_O01_main_a_material_rule_change_writes_a_row_and_an_email_per_person_in_scope(mailer):
    store = rule_world()
    assert run(store, {"template": "rule_changed", "rule_diff_id": DIFF}) == "succeeded"
    assert [(n["person_id"], n["kind"], n["severity"]) for n in store.notifications] == [
        (ANNA, "rule_changed", "warning"), (BORIS, "rule_changed", "warning")]
    assert store.notifications[0]["object_ref"] == {"rule_diff_id": DIFF, "product_ids": sorted([SALMON, TOPPER])}
    assert all(n["read_at"] is None for n in store.notifications)       # read state is per person, per row
    anna, boris = mailer.sent
    assert anna.to == "anna@halden.test" and boris.to == "boris@halden.test"
    assert anna.subject == "A prescribed wording changed in France. Two of your recipes use it."
    assert boris.subject == "A prescribed wording changed in France. One of your recipes uses it."
    assert "Joint support topper and Senior salmon · complete dry use it." in anna.text
    assert f"See the two recipes: http://localhost:3000/w/{WS}/alerts" in anna.text
    assert f"See the recipe: http://localhost:3000/w/{WS}/products/{SALMON}" in boris.text
    assert store.jobs["job-1"].progress == {"in_app": 2, "emailed": [ANNA, BORIS], "email": "sent", "outcome": "sent",
                                            "emails": 2}


def test_O01_must_1_an_editorial_rule_change_never_notifies_anyone(mailer):
    store = rule_world(effect_type="editorial")
    assert run(store, {"template": "rule_changed", "rule_diff_id": DIFF}) == "succeeded"
    assert store.notifications == [] and mailer.sent == []
    assert store.jobs["job-1"].progress == {"outcome": "skipped_editorial"}


def test_O01_must_1_no_preference_can_make_an_editorial_change_notify_and_the_template_refuses_one(mailer):
    store = rule_world(effect_type="editorial")
    store.prefs.update({(ANNA, "rule_changed", "email"): True, (ANNA, "rule_changed", "in_app"): True})
    run(store, {"template": "rule_changed", "rule_diff_id": DIFF})
    assert store.notifications == [] and mailer.sent == []
    with pytest.raises(KeyError):
        T.rule_changed(to="a@x.test", effect_type="editorial", held_in="France", rule_title="t", effective_from=None,
                       recipes=["A"], markets=["EU-FR"], url="http://x", today=TODAY)


def test_preferences_gate_each_channel_per_person_and_a_missing_row_means_on(mailer):
    store = rule_world()
    store.prefs[(ANNA, "rule_changed", "email")] = False         # Anna: in app only
    store.prefs[(BORIS, "rule_changed", "in_app")] = False       # Boris: email only
    store.prefs[(BORIS, "document_expiring", "email")] = False   # another kind changes nothing here
    run(store, {"template": "rule_changed", "rule_diff_id": DIFF})
    assert [n["person_id"] for n in store.notifications] == [ANNA]
    assert [e.to for e in mailer.sent] == ["boris@halden.test"]


def test_a_change_touching_none_of_the_workspaces_products_sends_nothing(mailer):
    store = rule_world()
    store.affected[DIFF] = []
    assert run(store, {"template": "rule_changed", "rule_diff_id": DIFF}) == "succeeded"
    assert store.notifications == [] and mailer.sent == []
    assert store.jobs["job-1"].progress == {"outcome": "skipped_no_impact"}


def test_a_failed_email_retries_without_a_second_row_or_a_second_email_to_anyone_already_sent(monkeypatch):
    m = FakeMailer()
    calls = []

    def flaky(e):
        calls.append(e.to)
        if len(calls) == 2:
            raise mail.MailError("Mailpit refused the rule_changed email (URLError)")
        return m.send(e)

    monkeypatch.setattr(mail, "mailer_for", lambda settings: type("M", (), {"send": staticmethod(flaky)})())
    store = rule_world()
    msg = store.add("job-1", "notify", workspace_id=WS, payload={"template": "rule_changed", "rule_diff_id": DIFF})
    assert process_message(store, registry, msg, S) == "retry"
    assert len(store.notifications) == 2 and store.jobs["job-1"].progress["emailed"] == [ANNA]
    store.vt[msg.msg_id] = 0
    assert process_message(store, registry, msg, S) == "succeeded"
    assert len(store.notifications) == 2                                 # no second row on retry
    assert [e.to for e in m.sent] == ["anna@halden.test", "boris@halden.test"]   # nobody emailed twice


def test_a_redelivered_job_that_already_sent_does_nothing(mailer):
    store = rule_world()
    msg = store.add("job-1", "notify", workspace_id=WS, payload={"template": "rule_changed", "rule_diff_id": DIFF})
    process_message(store, registry, msg, S)
    store.jobs["job-1"].status, store.jobs["job-1"].stale = "running", True
    [again] = [store.send("notify", {"job_id": "job-1"})]
    assert process_message(store, registry, again, S) == "succeeded"
    assert len(store.notifications) == 2 and len(mailer.sent) == 2
    assert store.jobs["job-1"].progress["outcome"] == "already_sent"


def test_names_and_addresses_never_reach_the_logs_or_the_job(mailer, caplog):
    store = rule_world()
    with caplog.at_level(logging.DEBUG):
        run(store, {"template": "rule_changed", "rule_diff_id": DIFF})
    job = repr(store.jobs["job-1"])
    for secret in ("anna@halden.test", "Senior salmon", "France"):
        assert secret not in caplog.text and secret not in job


@pytest.mark.parametrize("payload,error", [
    ({"template": "rule_changed", "rule_diff_id": "nope"}, "payload rule_diff_id is not a uuid"),
    ({"template": "rule_changed", "rule_diff_id": DOC}, "does not exist"),
    ({"template": "document_expiring", "document_id": DOC, "notice_days": 14}, "notice_days is not 60, 30 or 7"),
    ({"template": "receipt", "payment_event_id": "in_123"}, "is not a Stripe event id"),
    ({"template": "report", "share_id": SHARE}, "does not exist"),
])
def test_a_malformed_job_fails_at_once_with_a_safe_error(mailer, payload, error):
    store = rule_world()
    assert run(store, payload) == "failed"
    assert error in store.jobs["job-1"].last_error and store.jobs["job-1"].attempts == 1 and mailer.sent == []


def test_the_rule_template_follows_template_03():
    e = T.rule_changed(to="a@x.test", effect_type="tightened_threshold", held_in="European Union",
                       rule_title="Joint-function claims", effective_from=date(2026, 11, 1),
                       recipes=["Senior salmon · complete dry"], markets=["EU-FR", "EU-DE"], url="http://x/p",
                       today=date(2026, 9, 4))
    assert e.subject == "A rule changed in European Union. One of your recipes uses it."
    for part in ("Tightened threshold · effective 1 November 2026", "Joint-function claims",
                 "- Recipes affected: 1", "- Markets affected: EU · FR, EU · DE", "- Effective: 1 NOV 2026",
                 "- Days to comply: 58", "See the recipe: http://x/p", T.RULE_FOOTER, T.OPERATOR):
        assert part in e.text
    assert e.text.count("http") == 1


# ── Template 04 ────────────────────────────────────────────────────────────────────────────────────────
def doc_world(valid_to=TODAY + timedelta(days=30)):
    store = FakeStore()
    store.members |= {ANNA, BORIS}
    store.people = [{"person_id": ANNA, "email": "anna@halden.test", "role": "editor"},
                    {"person_id": BORIS, "email": "boris@halden.test", "role": "admin"}]
    store.documents[DOC] = {"id": DOC, "workspace_id": WS, "doc_type": "PMX-118 premix specification",
                            "valid_to": valid_to, "supplier_name": "Nordwild Feeds", "recipes": 3, "registrations": 1}
    return store


def test_a_document_notice_goes_to_its_owners_and_to_admins_only_at_seven_days(mailer):
    store = doc_world()
    run(store, {"template": "document_expiring", "document_id": DOC, "notice_days": 30, "person_ids": [ANNA]})
    assert [n["person_id"] for n in store.notifications] == [ANNA] and [e.to for e in mailer.sent] == ["anna@halden.test"]
    assert store.notifications[0]["object_ref"] == {"document_id": DOC, "notice_days": 30}
    [e] = mailer.sent
    assert e.subject == "The PMX-118 premix specification expires in 30 days"
    assert "It is evidence for three recipes and one registration." in e.html
    for part in ("PMX-118 premix specification · Nordwild Feeds", "- Recipes citing it: 3",
                 "- Registrations at risk: 1", "- Supplier: NORDWILD FEEDS",
                 "You can request a current version from Nordwild Feeds", f"Request the current version: http://localhost:3000/w/{WS}/documents"):
        assert part in e.text

    store = doc_world(valid_to=TODAY + timedelta(days=7))
    mailer.sent.clear()
    run(store, {"template": "document_expiring", "document_id": DOC, "notice_days": 7, "person_ids": [ANNA]})
    assert sorted(e.to for e in mailer.sent) == ["anna@halden.test", "boris@halden.test"]


def test_document_notices_honour_preferences_and_skip_a_document_not_yet_due(mailer):
    store = doc_world()
    store.prefs[(ANNA, "document_expiring", "email")] = False
    run(store, {"template": "document_expiring", "document_id": DOC, "notice_days": 30, "person_ids": [ANNA]})
    assert len(store.notifications) == 1 and mailer.sent == []

    for valid_to in (TODAY + timedelta(days=45), TODAY - timedelta(days=1), None):
        store = doc_world(valid_to=valid_to)
        run(store, {"template": "document_expiring", "document_id": DOC, "notice_days": 30, "person_ids": [ANNA]})
        assert store.notifications == [] and store.jobs["job-1"].progress == {"outcome": "skipped_not_expiring"}


# ── Template 01 ────────────────────────────────────────────────────────────────────────────────────────
def report_world(**share):
    store = FakeStore()
    store.shares[SHARE] = {"id": SHARE, "workspace_id": WS, "report_id": REPORT, "channel": "email",
                           "recipient": "buyer@retail.test", "expires_at": None, "revoked_at": None,
                           "workspace_name": "Halden Pet Nutrition", "sender_name": "Johanna Holm", **share}
    store.reports[REPORT] = {"product": "Adult dog · complete dry · chicken", "ruleset_version": "2026.08-b",
                             "checked_at": datetime(2026, 9, 4, 9, 41, tzinfo=UTC), "markets": 3, "panels": 3,
                             "clear": 14, "action": 3, "not_assessed": 2, "blocked": 1}
    return store


def test_a_report_sent_by_email_mints_its_link_stores_only_the_hash_and_writes_no_row(mailer):
    store = report_world()
    assert run(store, {"template": "report", "share_id": SHARE}) == "succeeded"
    [e] = mailer.sent
    [token] = re.findall(r"http://localhost:3000/share/([A-Za-z0-9_-]{43})", e.text)
    assert store.shares[SHARE]["token_hash"] == hashlib.sha256(token.encode()).digest()
    assert token not in repr(store.jobs) and store.notifications == []
    assert e.subject == "Halden Pet Nutrition sent you a label compliance report"
    assert "Adult dog · complete dry · chicken. Three markets, one of them blocked on registration." in e.html
    for part in ("Johanna Holm at Halden Pet Nutrition sent you a report",
                 ("Checked against ruleset 2026.08-b on 4 September 2026, for three markets and three printed "
                  "language panels."), "- Clear: 14", "- Action needed: 3", "- Not assessed: 2", "- Blocked: 1",
                 "Two items are marked Not assessed, which means nothing was checked for them", T.REPORT_BOUNDARY):
        assert part in e.text
    assert e.text.count("http") == 1 and "Texas" not in e.text


def test_a_report_never_drops_the_not_assessed_count_and_never_scores():
    s = T.ReportSummary("P", "2026.08-b", datetime(2026, 9, 4, tzinfo=UTC), 1, 1, 9, 0, 0, 0)
    e = T.report(to="x@y.test", sender="A B", workspace="W", summary=s, url="http://x")
    assert "- Not assessed: 0" in e.text and "- Blocked: 0" in e.text
    assert not re.search(r"%|score|pass mark", e.text, re.IGNORECASE)


@pytest.mark.parametrize("state,outcome", [({"revoked_at": datetime.now(UTC)}, "skipped_revoked"),
                                           ({"expires_at": datetime.now(UTC) - timedelta(minutes=1)}, "skipped_expired")])
def test_a_revoked_or_expired_share_gets_no_email_and_no_token(mailer, state, outcome):
    store = report_world(**state)
    assert run(store, {"template": "report", "share_id": SHARE}) == "succeeded"
    assert mailer.sent == [] and "token_hash" not in store.shares[SHARE]
    assert store.jobs["job-1"].progress == {"outcome": outcome}


def test_a_report_retried_after_its_email_went_never_mints_a_new_link(mailer):
    store = report_world()
    msg = store.add("job-1", "notify", workspace_id=WS, payload={"template": "report", "share_id": SHARE})
    store.jobs["job-1"].progress = {"in_app": 0, "emailed": ["recipient"]}   # sent, then died before "email": "sent"
    assert process_message(store, registry, msg, S) == "succeeded"
    assert mailer.sent == [] and "token_hash" not in store.shares[SHARE]
    assert store.jobs["job-1"].progress["outcome"] == "already_sent"


# ── Template 05 ────────────────────────────────────────────────────────────────────────────────────────
def allowance_world(used=3):
    store = FakeStore()
    store.members.add(ANNA)
    store.allowances[WS] = {"labels_used": used, "labels_allowed": 3, "checks": 61, "creator_person_id": ANNA,
                            "creator_email": "anna@halden.test"}
    return store


def test_the_third_free_label_email_goes_once_to_the_creator_with_the_configured_prices(mailer):
    store = allowance_world()
    assert run(store, {"template": "allowance_used"}) == "succeeded"
    [e] = mailer.sent
    assert e.to == "anna@halden.test" and e.subject == "That was your third free label"
    assert [n["kind"] for n in store.notifications] == ["allowance_used"]
    for part in ("You have used all three free labels", "All three labels stay, the 61 checks you have run stay",
                 "What stops is adding a fourth label.",
                 ("Basic is €249 a month and covers ten recipes in one region. Standard is €499 and covers thirty in "
                  "one region. Both exclude VAT, and an annual term is ten months for twelve."),
                 f"See your plan: http://localhost:3000/w/{WS}/billing/plans"):
        assert part in e.text
    for dropped in ("trial", "three days", "stays open", "Blocked", "7 September"):
        assert dropped not in e.text


def test_the_allowance_email_waits_for_the_last_label():
    store = allowance_world(used=2)
    assert run(store, {"template": "allowance_used"}) == "succeeded"
    assert store.jobs["job-1"].progress == {"outcome": "skipped_not_used_up"} and store.notifications == []


def test_the_prices_in_template_05_are_config_pricing_ts():
    src = (Path(__file__).resolve().parents[2] / "config" / "pricing.ts").read_text()
    for p in T.PRICED_PLANS:
        row = re.search(rf'name: "{p.name}", recipes: (\d+), regionsIncluded: (\d+),.*?prices: eur\(([\d_]+), ([\d_]+)\)',
                        src, re.DOTALL)
        assert row, p.name
        recipes, regions, month, year = (int(x.replace("_", "")) for x in row.groups())
        assert (recipes, regions, month * 100, year * 100) == (p.recipes, p.regions, p.month_cents, p.year_cents)


# ── Template 06 ────────────────────────────────────────────────────────────────────────────────────────
def receipt_world(pdf=b"%PDF-1.7 invoice"):
    store = FakeStore()
    store.payments[EVT] = {
        "workspace_id": WS, "type": "invoice.paid", "plan": "standard", "term": "annual",
        "current_period_end": datetime(2027, 9, 4, tzinfo=UTC),
        "payload": {"data": {"object": {
            "id": "in_1T602", "number": "NTV-2026-0418", "currency": "eur", "customer_email": "finance@halden.test",
            "subtotal": 499000, "tax": 124750, "amount_paid": 623750,
            "lines": {"data": [{"period": {"start": int(datetime(2026, 9, 4, tzinfo=UTC).timestamp()),
                                           "end": int(datetime(2027, 9, 3, tzinfo=UTC).timestamp())}}]}}}},
    }
    if pdf:
        store.pdfs[EVT] = pdf
    return store


def test_the_receipt_goes_to_the_payer_with_its_pdf_and_writes_no_row(mailer):
    store = receipt_world()
    assert run(store, {"template": "receipt", "payment_event_id": EVT}) == "succeeded"
    [e] = mailer.sent
    assert e.to == "finance@halden.test" and store.notifications == []
    assert e.subject == "Nutrivo invoice NTV-2026-0418 · €6,237.50 paid"
    assert e.attachments == (mail.Attachment("NTV-2026-0418.pdf", "application/pdf", b"%PDF-1.7 invoice"),)
    for part in ("Thank you. Standard is live on your workspace.", "Invoice NTV-2026-0418 · paid in full",
                 "Standard, billed annually for 4 September 2026 to 3 September 2027.", "- Subtotal: €4,990.00",
                 "- VAT: €1,247.50", "- Paid: €6,237.50", "- Next renewal: 4 SEP 2027",
                 f"View invoice: http://localhost:3000/w/{WS}/billing/invoices/in_1T602"):
        assert part in e.text
    assert not re.search(r"(?i)upgrade|advanced", e.text)                  # never upsells


def test_no_pdf_no_receipt_the_job_fails_visibly(mailer):
    store = receipt_world(pdf=None)
    assert run(store, {"template": "receipt", "payment_event_id": EVT}) == "failed"
    assert mailer.sent == [] and store.jobs["job-1"].last_error.endswith("the invoice PDF is not available")


# ── Attachments through both providers ─────────────────────────────────────────────────────────────────
def receipt_email():
    inv = T.Invoice("NTV-1", "Basic", "monthly", date(2026, 9, 4), date(2026, 10, 3), 24900, 6225, 31125, None)
    return T.receipt(to="p@x.test", invoice=inv, url="http://x", pdf=b"%PDF-1.7 x")


def test_ses_sends_an_email_with_an_attachment_as_raw_mime_in_eu_central_1():
    class Ses:
        def send_email(self, **kw):
            self.kw = kw
            return {"MessageId": "ses-2"}

    client = Ses()
    assert mail.SesMailer("noreply@mail.nutrivo.test", client).send(receipt_email()) == "ses-2"
    msg = email.message_from_bytes(client.kw["Content"]["Raw"]["Data"])
    assert msg["To"] == "p@x.test" and msg["From"] == "Nutrivo <noreply@mail.nutrivo.test>"
    parts = {p.get_content_type(): p for p in msg.walk()}
    assert {"text/plain", "text/html", "application/pdf"} <= set(parts)
    assert parts["application/pdf"].get_filename() == "NTV-1.pdf"
    assert parts["application/pdf"].get_payload(decode=True) == b"%PDF-1.7 x"


def test_mailpit_receives_the_attachment_base64(monkeypatch):
    import json
    import urllib.request

    seen = {}

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"ID": "mp-1"}'

    def urlopen(req, timeout):
        seen.update(json.loads(req.data))
        return Resp()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert mail.MailpitMailer("http://mailpit.test").send(receipt_email()) == "mp-1"
    assert seen["Attachments"] == [{"Filename": "NTV-1.pdf", "ContentType": "application/pdf",
                                    "Content": "JVBERi0xLjcgeA=="}]
