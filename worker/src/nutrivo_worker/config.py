"""Worker settings, read once from the environment. Names follow config/secrets.yaml; values come from Infisical
(scripts/env/run.sh) or the platform, never from files in the repository. Secrets are SecretStr, so a repr or a log
line never shows them."""
from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

WORKER_ROOT = Path(__file__).resolve().parents[2]

Env = Literal["local", "dev", "ci", "staging", "prod"]
ModelsMode = Literal["live", "record", "replay"]
ModelClass = Literal["judgement", "triage", "extraction"]


class ConfigError(ValueError):
    """The environment is incomplete or unsafe: the worker refuses to start."""


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    env: Env = "local"
    release: str = "dev"
    database_url: SecretStr | None = None

    # Job loop (docs/18): 5 attempts, a job running for over 15 min is stale, bounded concurrency per kind.
    max_attempts: int = Field(5, ge=1)
    stale_after_s: int = Field(15 * 60, ge=60)
    read_vt_s: int = Field(30, ge=5)
    poll_interval_s: float = Field(1.0, gt=0)
    backoff_base_s: int = Field(10, ge=1)
    backoff_cap_s: int = Field(15 * 60, ge=1)
    concurrency: int = Field(1, ge=1)
    heartbeat_every_s: int = 60
    reap_every_s: int = 300

    # Sentry (docs/17)
    sentry_dsn: SecretStr | None = None

    # Langfuse EU (docs/17, D-17): OTLP export through the Langfuse Python SDK.
    langfuse_public_key: SecretStr | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_base_url: str = "https://cloud.langfuse.com"

    # Models (docs/07, D-11). Ids live in configuration only.
    models_mode: ModelsMode = "live"
    cassette_dir: Path = WORKER_ROOT / "tests" / "cassettes"
    prompts_dir: Path = WORKER_ROOT / "prompts"
    aws_region: str | None = None
    bedrock_models: dict[ModelClass, str] = Field(default_factory=dict)
    anthropic_api_key: SecretStr | None = None
    anthropic_models: dict[ModelClass, str] = Field(default_factory=dict)
    model_timeout_s: float = 120.0
    model_max_retries: int = 2

    @field_validator("bedrock_models")
    @classmethod
    def _eu_profiles_only(cls, v: dict[str, str]) -> dict[str, str]:
        # docs/14 §1: geo and global profiles route outside the EU; only eu.* profiles or in-Region ids are allowed.
        for cls_, model in v.items():
            if model.startswith(("global.", "us.", "apac.", "us-gov.")):
                raise ConfigError(f"BEDROCK_MODEL_{cls_.upper()} uses a non-EU inference profile")
        return v

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)

    @property
    def traces_sample_rate(self) -> float:
        return 0.2 if self.env == "prod" else 1.0

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        e = os.environ if environ is None else environ

        def get(name: str) -> str | None:
            value = (e.get(name) or "").strip()
            return value or None

        def secret(name: str) -> SecretStr | None:
            value = get(name)
            return SecretStr(value) if value else None

        def models(prefix: str) -> dict[str, str]:
            out = {c: get(f"{prefix}{c.upper()}") for c in ("judgement", "triage", "extraction")}
            return {k: v for k, v in out.items() if v}

        env = get("NUTRIVO_ENV") or "local"
        mode = get("MODELS_MODE") or ("replay" if env == "ci" else "live")
        values: dict = {
            "env": env,
            "release": get("NUTRIVO_RELEASE") or get("RENDER_GIT_COMMIT") or "dev",
            "database_url": secret("DATABASE_URL"),
            "sentry_dsn": secret("SENTRY_DSN_WORKER"),
            "langfuse_public_key": secret("LANGFUSE_PUBLIC_KEY"),
            "langfuse_secret_key": secret("LANGFUSE_SECRET_KEY"),
            "models_mode": mode,
            "aws_region": get("AWS_REGION"),
            "bedrock_models": models("BEDROCK_MODEL_"),
            "anthropic_api_key": secret("ANTHROPIC_API_KEY"),
            "anthropic_models": models("ANTHROPIC_MODEL_"),
        }
        if get("LANGFUSE_BASE_URL"):
            values["langfuse_base_url"] = get("LANGFUSE_BASE_URL")
        if get("MODELS_CASSETTE_DIR"):
            values["cassette_dir"] = Path(get("MODELS_CASSETTE_DIR"))
        for field, name in (("concurrency", "WORKER_CONCURRENCY"), ("max_attempts", "WORKER_MAX_ATTEMPTS")):
            if get(name):
                values[field] = int(get(name))
        try:
            return cls(**values)
        except ConfigError:
            raise
        except ValueError as exc:
            raise ConfigError(str(exc)) from exc

    def require_database(self) -> str:
        if not self.database_url:
            raise ConfigError("DATABASE_URL is not set")
        return self.database_url.get_secret_value()
