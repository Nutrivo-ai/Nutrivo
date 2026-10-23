"""Errors whose message is written by us and holds ids only, so it may reach app.jobs.last_error (members read it)
and Sentry. Any other exception is reported by its type alone, because its message can carry label text."""
from __future__ import annotations


class SafeError(Exception):
    """Base for errors with a message that is safe to show: ids and reason codes, never customer text."""


class PermanentJobError(SafeError):
    """The job cannot succeed by retrying (a malformed payload, a missing row): fail it now."""


class ModelError(SafeError):
    """A model call did not produce a usable output. Callers withhold; they never pass."""

    reason = "model_error"


class ModelUnavailable(ModelError):
    """Every configured provider failed or the circuit is open: the reason code callers record is model_unavailable."""

    reason = "model_unavailable"


class ModelRefused(ModelError):
    reason = "model_refused"


class ModelOutputInvalid(ModelError):
    reason = "model_output_invalid"


class CassetteMissing(ModelError):
    """Replay mode found no recorded response for this input; record it with MODELS_MODE=record."""

    reason = "cassette_missing"


def public_message(exc: BaseException) -> str:
    if isinstance(exc, SafeError):
        return f"{type(exc).__name__}: {exc}"[:500]
    return type(exc).__name__
