"""notify (A03) and session_revoke (A06) on the in-memory store: the handlers' own logic, run through the real job
loop. tests/test_invitations_pg.py runs the same paths on Postgres, Mailpit and the RPCs."""
import hashlib
import logging
import re
from datetime import UTC, datetime, timedelta

import pytest
from botocore.exceptions import ClientError
from fakes import FakeMailer, FakeStore

from nutrivo_worker import email_templates, mail
from nutrivo_worker.config import ConfigError, Settings
from nutrivo_worker.handlers import notify  # noqa: F401  registers notify and session_revoke
from nutrivo_worker.jobs import process_message, registry

S = Settings(max_attempts=3)
WS, INV, JOB = "20000000-0000-4000-8105-00000000000a", "60000000-0000-4000-8105-000000000001", "job-1"
LINK = re.compile(r"http://localhost:3000/invite/([A-Za-z0-9_-]+)")


def invitation(**kw):
    return {"id": INV, "workspace_id": WS, "email": "maria@halden.test", "role": "editor",
            "expires_at": datetime.now(UTC) + timedelta(days=7), "accepted_at": None, "revoked_at": None,
            "workspace_name": "Halden Pet Nutrition", "inviter_name": "Johanna Holm", **kw}


@pytest.fixture
def mailer(monkeypatch):
    m = FakeMailer()
    monkeypatch.setattr(mail, "mailer_for", lambda settings: m)
    return m


def setup(store, **inv):
    store.invitations[INV] = invitation(**inv)
    return store.add(JOB, "notify", workspace_id=WS, payload={"template": "invitation", "invitation_id": INV})


def token_of(email) -> str:
    [token] = set(LINK.findall(email.text)) | set(LINK.findall(email.html))
    return token


def test_A03_main_the_notify_job_mints_a_token_stores_only_its_hash_and_emails_the_link(mailer):
    store = FakeStore()
    assert process_message(store, registry, setup(store), S) == "succeeded"
    [email] = mailer.sent
    assert email.to == "maria@halden.test" and email.template == "invitation"
    assert email.subject == "Johanna Holm has invited you to Halden Pet Nutrition on Nutrivo"
    token = token_of(email)
    assert len(token) == 43                                   # 32 random bytes, URL-safe (docs/09)
    assert store.invitations[INV]["token_hash"] == hashlib.sha256(token.encode()).digest()
    assert store.jobs[JOB].status == "succeeded"
    assert store.jobs[JOB].progress == {"email": "sent", "outcome": "sent", "message_id": "msg-1"}


def test_A03_must_2_the_raw_token_is_never_stored_logged_or_put_in_the_job(mailer, caplog):
    store = FakeStore()
    with caplog.at_level(logging.DEBUG):
        process_message(store, registry, setup(store), S)
    token = token_of(mailer.sent[0])
    stored = repr(store.invitations) + repr(store.jobs) + repr(store.queue)
    assert token not in stored and token.encode() not in store.invitations[INV]["token_hash"]
    assert token not in caplog.text and "maria@halden.test" not in caplog.text
    assert set(store.jobs[JOB].payload) == {"template", "invitation_id"}


def test_A03_must_2_a_failed_send_retries_with_a_new_token_and_the_undelivered_one_is_dead(monkeypatch):
    m = FakeMailer(fail=1)
    monkeypatch.setattr(mail, "mailer_for", lambda settings: m)
    store = FakeStore()
    msg = setup(store)
    assert process_message(store, registry, msg, S) == "retry"
    first_hash = store.invitations[INV]["token_hash"]
    assert store.jobs[JOB].last_error == "MailError: Mailpit refused the invitation email (URLError)"
    store.vt[msg.msg_id] = 0
    assert process_message(store, registry, msg, S) == "succeeded"
    token = token_of(m.sent[0])
    assert store.invitations[INV]["token_hash"] == hashlib.sha256(token.encode()).digest() != first_hash


def test_A03_fail_2_a_redelivered_notify_job_never_sends_a_second_email(mailer):
    store = FakeStore()
    msg = setup(store)
    process_message(store, registry, msg, S)
    store.jobs[JOB].status = "running"
    store.jobs[JOB].stale = True                              # as if the worker died before acknowledging
    store.send("notify", {"job_id": JOB})
    [again] = [m for m in store.queue.values()]
    assert process_message(store, registry, again, S) == "succeeded"
    assert len(mailer.sent) == 1 and store.jobs[JOB].progress["outcome"] == "already_sent"


@pytest.mark.parametrize("state,outcome", [
    ({"revoked_at": datetime.now(UTC)}, "skipped_revoked"),
    ({"accepted_at": datetime.now(UTC)}, "skipped_accepted"),
    ({"expires_at": datetime.now(UTC) - timedelta(minutes=1)}, "skipped_expired"),
])
def test_an_invitation_no_longer_pending_gets_no_email_and_no_token(mailer, state, outcome):
    store = FakeStore()
    assert process_message(store, registry, setup(store, **state), S) == "succeeded"
    assert mailer.sent == [] and "token_hash" not in store.invitations[INV]
    assert store.jobs[JOB].progress == {"outcome": outcome}


def test_a_revoke_that_lands_between_read_and_write_wins(mailer, monkeypatch):
    store = FakeStore()
    msg = setup(store)
    monkeypatch.setattr(store, "set_invitation_token", lambda *a: False)
    assert process_message(store, registry, msg, S) == "succeeded"
    assert mailer.sent == [] and store.jobs[JOB].progress == {"outcome": "skipped_not_pending"}


@pytest.mark.parametrize("payload,error", [
    ({"template": "newsletter", "invitation_id": INV}, "unknown notify template 'newsletter'"),
    ({"template": "invitation", "invitation_id": "not-a-uuid"}, "payload invitation_id is not a uuid"),
    ({"template": "invitation", "invitation_id": "60000000-0000-4000-8105-0000000000ff"}, "does not exist"),
])
def test_a_malformed_notify_job_fails_at_once_with_a_safe_error(mailer, payload, error):
    store = FakeStore()
    store.invitations[INV] = invitation()
    msg = store.add(JOB, "notify", workspace_id=WS, payload=payload)
    assert process_message(store, registry, msg, S) == "failed"
    assert error in store.jobs[JOB].last_error and store.jobs[JOB].attempts == 1 and mailer.sent == []


def test_a_notify_job_never_sends_an_invitation_of_another_workspace(mailer):
    store = FakeStore()
    store.invitations[INV] = invitation(workspace_id="20000000-0000-4000-8105-00000000000b")
    msg = store.add(JOB, "notify", workspace_id=WS, payload={"template": "invitation", "invitation_id": INV})
    assert process_message(store, registry, msg, S) == "failed" and mailer.sent == []


# ── the template ───────────────────────────────────────────────────────────────────────────────────────
def render(**kw):
    args = {"to": "maria@halden.test", "inviter": "Johanna Holm", "workspace": "Halden Pet Nutrition",
            "role": "editor", "expires_at": datetime(2026, 10, 30, 9, tzinfo=UTC),
            "url": "http://localhost:3000/invite/abc", **kw}
    return email_templates.invitation(**args)


def test_the_invitation_follows_template_02_and_reads_as_plain_text():
    e = render()
    assert e.subject == "Johanna Holm has invited you to Halden Pet Nutrition on Nutrivo"
    for part in ("Johanna has invited you to Halden Pet Nutrition", email_templates.EDITOR_LINE,
                 "Create your user: http://localhost:3000/invite/abc",
                 "The invitation expires on 30 October 2026. If it lapses, ask Johanna to send another",
                 "You received this because Johanna Holm entered your address", email_templates.OPERATOR):
        assert part in e.text
    assert e.text.count("http") == 1                                     # one action per email
    assert 'href="http://localhost:3000/invite/abc"' in e.html and "Create your user</a>" in e.html
    assert "#2f5eff" in e.html and "Two fields and you are in." in e.html


def test_the_invitation_escapes_names_and_never_implies_a_cost_for_a_viewer():
    e = render(inviter="<b>Eve</b> & co", workspace='Acme "Pets"', role="viewer")
    assert "<b>Eve</b>" not in e.html and "&lt;b&gt;Eve&lt;/b&gt; &amp; co" in e.html
    assert "Acme &quot;Pets&quot;" in e.html
    assert "You are joining as a viewer." in e.text
    assert not re.search(r"(?i)\b(seat|cost|price|pay|€|eur)\b", e.text)


# ── email configuration (D-16) ─────────────────────────────────────────────────────────────────────────
def test_only_staging_and_prod_send_through_ses_and_never_through_mailpit():
    assert Settings.from_env({"NUTRIVO_ENV": "ci"}).email_mode == "mailpit"
    assert Settings.from_env({"NUTRIVO_ENV": "prod"}).email_mode == "ses"
    for env, mode in (("local", "ses"), ("dev", "ses"), ("ci", "ses"), ("staging", "mailpit"), ("prod", "mailpit")):
        with pytest.raises(ConfigError, match="is refused"):
            Settings.from_env({"NUTRIVO_ENV": env, "EMAIL_MODE": mode})


def test_ses_needs_a_sender_and_the_links_need_https_in_deployed_environments():
    prod = Settings.from_env({"NUTRIVO_ENV": "prod"})
    with pytest.raises(mail.MailError, match="SES_FROM_ADDRESS is not set"):
        mail.mailer_for(prod)
    with pytest.raises(ConfigError, match="APP_BASE_URL is not set"):
        prod.require_app_base_url()
    with pytest.raises(ConfigError, match="https"):
        Settings.from_env({"NUTRIVO_ENV": "staging", "APP_BASE_URL": "http://x.test"}).require_app_base_url()
    assert Settings().require_app_base_url() == "http://localhost:3000"


class FakeSes:
    def __init__(self, error=None):
        self.calls, self.error = [], error

    def send_email(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return {"MessageId": "ses-1"}


def test_ses_sends_html_and_text_from_the_configured_sender_in_eu_central_1():
    assert mail.SES_REGION == "eu-central-1"
    client = FakeSes()
    assert mail.SesMailer("noreply@mail.nutrivo.test", client).send(render()) == "ses-1"
    [call] = client.calls
    assert call["FromEmailAddress"] == "Nutrivo <noreply@mail.nutrivo.test>"
    assert call["Destination"] == {"ToAddresses": ["maria@halden.test"]}
    assert set(call["Content"]["Simple"]["Body"]) == {"Html", "Text"}


def test_an_ses_error_becomes_a_safe_error_without_the_recipient():
    err = ClientError({"Error": {"Code": "MessageRejected", "Message": "maria@halden.test is not verified"}}, "Send")
    with pytest.raises(mail.MailError) as exc:
        mail.SesMailer("noreply@mail.nutrivo.test", FakeSes(err)).send(render())
    assert "maria" not in str(exc.value) and "ClientError" in str(exc.value)


# ── session_revoke (A06) ───────────────────────────────────────────────────────────────────────────────
MEM, USER = "50000000-0000-4000-8105-0000000000c1", "00000000-0000-4000-8105-0000000000c1"


def revoke_setup(store, ended_at, user_id=USER):
    store.memberships[MEM] = {"id": MEM, "workspace_id": WS, "person_id": "p", "ended_at": ended_at,
                              "user_id": user_id}
    return store.add("job-r", "session_revoke", workspace_id=WS, payload={"membership_id": MEM, "person_id": "p"})


def test_session_revoke_signs_out_sessions_from_before_the_removal_and_is_idempotent():
    store, ended = FakeStore(), datetime.now(UTC)
    store.sessions = [{"user_id": USER, "created_at": ended - timedelta(hours=2)},
                      {"user_id": USER, "created_at": ended + timedelta(minutes=5)},     # signed in again later
                      {"user_id": "someone-else", "created_at": ended - timedelta(hours=1)}]
    msg = revoke_setup(store, ended)
    assert process_message(store, registry, msg, S) == "succeeded"
    assert store.jobs["job-r"].progress == {"outcome": "revoked", "sessions_revoked": 1}
    assert len(store.sessions) == 2
    store.jobs["job-r"].status = "queued"
    store.send("session_revoke", {"job_id": "job-r"})
    [again] = list(store.queue.values())
    process_message(store, registry, again, S)
    assert store.jobs["job-r"].progress["sessions_revoked"] == 0 and len(store.sessions) == 2


@pytest.mark.parametrize("ended,user,outcome", [(None, USER, "skipped_active"),
                                                (datetime.now(UTC), None, "skipped_no_user")])
def test_session_revoke_never_signs_out_an_active_member_or_an_erased_person(ended, user, outcome):
    store = FakeStore()
    store.sessions = [{"user_id": USER, "created_at": datetime.now(UTC) - timedelta(days=1)}]
    assert process_message(store, registry, revoke_setup(store, ended, user), S) == "succeeded"
    assert store.jobs["job-r"].progress == {"outcome": outcome, "sessions_revoked": 0} and len(store.sessions) == 1
