"""Outgoing email (D-16): AWS SES in eu-central-1 for staging and prod, Mailpit on the local stack and in CI.

Settings refuses any other pairing, so only a deployed worker can reach a real inbox. Every email is sent as HTML and
as plain text (the design's rule: "Every email must read as plain text with the styling stripped"). Recipients,
subjects and bodies are customer data: they are never logged and never reach Sentry; the provider's message id is.
An email with attachments (Template 06 carries its invoice PDF) goes to SES as raw MIME and to Mailpit as base64.
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any, Protocol

import sentry_sdk

from .config import Settings
from .errors import PermanentJobError, SafeError

SES_REGION = "eu-central-1"   # D-02 and D-16: never another region
FROM_NAME = "Nutrivo"


@dataclass(frozen=True)
class Attachment:
    filename: str
    content_type: str        # "application/pdf"
    content: bytes


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    html: str
    text: str
    template: str            # for logs and spans: the template name, never content
    attachments: tuple[Attachment, ...] = ()


def mime(email: Email, from_header: str) -> bytes:
    """The whole message as MIME: text and HTML alternatives, then each attachment."""
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = from_header, email.to, email.subject
    msg.set_content(email.text)
    msg.add_alternative(email.html, subtype="html")
    for a in email.attachments:
        maintype, _, subtype = a.content_type.partition("/")
        msg.add_attachment(a.content, maintype=maintype, subtype=subtype, filename=a.filename)
    return msg.as_bytes()


class MailError(SafeError):
    """The provider refused or could not be reached. The job retries from the queue (docs/18)."""


class PermanentMailError(MailError, PermanentJobError):
    """The provider rejected this message for good (a bad address, an unverified sender, a suspended account, an
    oversize message): retrying cannot help. A delivery records the recipient and carries on with the others."""


# SES v2 errors no retry can fix; throttling, limits and service errors stay MailError and retry.
SES_PERMANENT = frozenset({"BadRequestException", "MessageRejected", "MailFromDomainNotVerifiedException",
                           "AccountSuspendedException", "SendingPausedException", "NotFoundException"})


class Mailer(Protocol):
    def send(self, email: Email) -> str | None: ...


class SesMailer:
    def __init__(self, from_address: str, client: Any = None):
        self.from_address = from_address
        if client is None:
            import boto3  # credentials from the platform's AWS chain, never from the repository

            client = boto3.client("sesv2", region_name=SES_REGION)
        self.client = client

    def send(self, email: Email) -> str | None:
        from botocore.exceptions import BotoCoreError, ClientError

        sender = f"{FROM_NAME} <{self.from_address}>"
        content: dict[str, Any] = {"Raw": {"Data": mime(email, sender)}} if email.attachments else {"Simple": {
            "Subject": {"Data": email.subject, "Charset": "UTF-8"},
            "Body": {"Html": {"Data": email.html, "Charset": "UTF-8"},
                     "Text": {"Data": email.text, "Charset": "UTF-8"}},
        }}
        try:
            out = self.client.send_email(
                FromEmailAddress=sender,
                Destination={"ToAddresses": [email.to]},
                Content=content,
                EmailTags=[{"Name": "template", "Value": email.template}],
            )
        except ClientError as exc:                    # its message can quote the recipient: keep the code
            code = str(exc.response.get("Error", {}).get("Code", ""))
            cls = PermanentMailError if code in SES_PERMANENT else MailError
            raise cls(f"SES refused the {email.template} email ({code or type(exc).__name__})") from None
        except BotoCoreError as exc:
            raise MailError(f"SES refused the {email.template} email ({type(exc).__name__})") from None
        return str(out.get("MessageId")) if out.get("MessageId") else None


class MailpitMailer:
    """Mailpit's HTTP send API (the local stack exposes its web port, not SMTP)."""

    def __init__(self, base_url: str, from_address: str = "no-reply@nutrivo.local", timeout_s: float = 10.0):
        self.base_url, self.from_address, self.timeout_s = base_url.rstrip("/"), from_address, timeout_s

    def send(self, email: Email) -> str | None:
        message: dict[str, Any] = {"From": {"Email": self.from_address, "Name": FROM_NAME}, "To": [{"Email": email.to}],
                                   "Subject": email.subject, "HTML": email.html, "Text": email.text,
                                   "Tags": [email.template]}
        if email.attachments:
            message["Attachments"] = [{"Filename": a.filename, "ContentType": a.content_type,
                                       "Content": base64.b64encode(a.content).decode()} for a in email.attachments]
        body = json.dumps(message).encode()
        req = urllib.request.Request(f"{self.base_url}/api/v1/send", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return str(json.loads(resp.read() or b"{}").get("ID") or "") or None
        except urllib.error.HTTPError as exc:
            cls = PermanentMailError if 400 <= exc.code < 500 else MailError
            raise cls(f"Mailpit refused the {email.template} email (HTTP {exc.code})") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise MailError(f"Mailpit refused the {email.template} email ({type(exc).__name__})") from None


def send(mailer: Mailer, email: Email) -> str | None:
    with sentry_sdk.start_span(op="email.send", name=f"email:{email.template}"):
        return mailer.send(email)


_mailers: dict[tuple[str, str | None, str], Mailer] = {}


def mailer_for(settings: Settings) -> Mailer:
    """One mailer per configuration. A missing sender address fails the email job, not the worker."""
    key = (settings.email_mode, settings.ses_from_address, settings.mailpit_url)
    if key not in _mailers:
        if settings.email_mode == "ses":
            if not settings.ses_from_address:
                raise MailError("email is not configured: SES_FROM_ADDRESS is not set")
            _mailers[key] = SesMailer(settings.ses_from_address)
        else:
            _mailers[key] = MailpitMailer(settings.mailpit_url, settings.ses_from_address or "no-reply@nutrivo.local")
    return _mailers[key]
