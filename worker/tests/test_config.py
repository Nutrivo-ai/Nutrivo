import pytest
from fakes import MARKER, fake_secret

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
    s = Settings.from_env({"DATABASE_URL": fake_secret("postgresql://u:") + "@h/db",
                           "LANGFUSE_SECRET_KEY": fake_secret("sk-lf-"), "ANTHROPIC_API_KEY": fake_secret("sk-ant-"),
                           "SENTRY_DSN_WORKER": "https://" + fake_secret() + "@sentry"})
    assert MARKER not in repr(s) and MARKER not in s.model_dump_json()


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


@pytest.mark.parametrize("env", ["staging", "prod"])
@pytest.mark.parametrize("name", ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_JUDGEMENT", "ANTHROPIC_MODEL_TRIAGE",
                                  "ANTHROPIC_MODEL_EXTRACTION", "ANTHROPIC_MODEL_SOMETHING_ELSE"])
def test_anthropic_api_is_refused_when_deployed(env, name):
    with pytest.raises(ConfigError, match=f"refused in {env}.*{name}") as exc:
        Settings.from_env({"NUTRIVO_ENV": env, name: fake_secret("sk-ant-")})
    assert MARKER not in str(exc.value)


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_anthropic_api_refused_for_settings_built_directly(env):
    from pydantic import SecretStr
    with pytest.raises(ValueError, match="refused"):   # pydantic wraps the ConfigError in a ValidationError
        Settings(env=env, anthropic_api_key=SecretStr("k"))
    with pytest.raises(ValueError, match="refused"):
        Settings(env=env, anthropic_models={"judgement": "claude-sonnet-4-6"})


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_empty_anthropic_values_do_not_block_a_deployed_start(env):
    s = Settings.from_env({"NUTRIVO_ENV": env, "ANTHROPIC_API_KEY": " ", "ANTHROPIC_MODEL_JUDGEMENT": ""})
    assert s.anthropic_api_key is None and s.anthropic_models == {}


@pytest.mark.parametrize("env", ["local", "dev", "ci"])
def test_anthropic_api_stays_allowed_outside_staging_and_prod(env):
    s = Settings.from_env({"NUTRIVO_ENV": env, "ANTHROPIC_API_KEY": "sk-ant-x",
                           "ANTHROPIC_MODEL_JUDGEMENT": "claude-sonnet-4-6"})
    assert s.anthropic_models == {"judgement": "claude-sonnet-4-6"}


def test_cli_refuses_to_start_with_the_anthropic_api_in_prod(monkeypatch, capsys):
    from nutrivo_worker import cli
    monkeypatch.setenv("NUTRIVO_ENV", "prod")
    monkeypatch.setenv("ANTHROPIC_API_KEY", fake_secret("sk-ant-"))
    assert cli.main(["work"]) == 2
    err = capsys.readouterr().err
    assert "ANTHROPIC_API_KEY" in err and MARKER not in err
