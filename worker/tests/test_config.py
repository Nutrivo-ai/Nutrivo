import pytest

from nutrivo_worker.config import ConfigError, Settings


def test_reads_the_secrets_yaml_names():
    s = Settings.from_env({
        "NUTRIVO_ENV": "dev", "DATABASE_URL": "postgresql://u:pw@h/db", "SENTRY_DSN_WORKER": "https://k@o.ingest.de.sentry.io/1",
        "LANGFUSE_PUBLIC_KEY": "pk-lf-1", "LANGFUSE_SECRET_KEY": "sk-lf-1", "LANGFUSE_BASE_URL": "https://cloud.langfuse.com",
        "AWS_REGION": "eu-central-1", "BEDROCK_MODEL_JUDGEMENT": "eu.anthropic.claude-sonnet-4-6",
        "BEDROCK_MODEL_TRIAGE": "eu.anthropic.claude-haiku-4-5-20251001-v1:0", "RENDER_GIT_COMMIT": "abc123",
    })
    assert s.env == "dev" and s.release == "abc123" and s.models_mode == "live"
    assert s.bedrock_models == {"judgement": "eu.anthropic.claude-sonnet-4-6",
                                "triage": "eu.anthropic.claude-haiku-4-5-20251001-v1:0"}
    assert s.langfuse_enabled and s.require_database() == "postgresql://u:pw@h/db"


def test_secrets_never_appear_in_repr_or_dump():
    s = Settings.from_env({"DATABASE_URL": "postgresql://u:hunter2@h/db", "LANGFUSE_SECRET_KEY": "sk-lf-hunter2",
                           "ANTHROPIC_API_KEY": "sk-ant-hunter2", "SENTRY_DSN_WORKER": "https://hunter2@sentry"})
    assert "hunter2" not in repr(s) and "hunter2" not in s.model_dump_json()


def test_ci_defaults_to_replay_and_mode_is_explicit_otherwise():
    assert Settings.from_env({"NUTRIVO_ENV": "ci"}).models_mode == "replay"
    assert Settings.from_env({"NUTRIVO_ENV": "dev", "MODELS_MODE": "record"}).models_mode == "record"
    with pytest.raises(ConfigError):
        Settings.from_env({"MODELS_MODE": "sometimes"})


@pytest.mark.parametrize("profile", ["global.anthropic.claude-sonnet-4-6", "us.anthropic.claude-haiku-4-5"])
def test_non_eu_inference_profiles_are_refused(profile):
    with pytest.raises(ConfigError, match="non-EU"):
        Settings.from_env({"BEDROCK_MODEL_JUDGEMENT": profile})


def test_sample_rate_and_missing_database():
    assert Settings.from_env({"NUTRIVO_ENV": "prod"}).traces_sample_rate == 0.2
    assert Settings.from_env({"NUTRIVO_ENV": "staging"}).traces_sample_rate == 1.0
    with pytest.raises(ConfigError):
        Settings.from_env({}).require_database()
