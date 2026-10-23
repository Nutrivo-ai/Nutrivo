"""The CLI and the image definition. The image itself is built by `docker build -f worker/Dockerfile .` (the
staging pipeline, T-010); these checks keep the Dockerfile's contract without needing Docker in the test run."""
import json
import re
from pathlib import Path

from nutrivo_worker import cli

DOCKERFILE = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()


def test_dockerfile_pins_python_312_and_uv():
    assert re.search(r"^FROM python:3\.12-slim$", DOCKERFILE, re.MULTILINE)
    assert re.search(r"ghcr\.io/astral-sh/uv:\d+\.\d+\.\d+ ", DOCKERFILE) and "uv:latest" not in DOCKERFILE
    assert "UV_PYTHON_DOWNLOADS=never" in DOCKERFILE and "--frozen --no-dev" in DOCKERFILE


def test_dockerfile_runs_the_worker_unprivileged_without_tests_or_local_venv():
    assert "USER nutrivo" in DOCKERFILE and 'CMD ["/app/worker/.venv/bin/nutrivo", "work"]' in DOCKERFILE
    copies = re.findall(r"^COPY (?!--from)(\S+)", DOCKERFILE, re.MULTILINE)
    assert copies == ["worker/pyproject.toml", "worker/src", "worker/prompts"]


def test_config_command_masks_secrets(monkeypatch, capsys):
    monkeypatch.setenv("NUTRIVO_ENV", "dev")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-hunter2")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:hunter2@h/db")
    assert cli.main(["config"]) == 0
    out = capsys.readouterr().out
    assert "hunter2" not in out and json.loads(out)["env"] == "dev"


def test_bad_configuration_exits_2(monkeypatch, capsys):
    monkeypatch.setenv("BEDROCK_MODEL_JUDGEMENT", "global.anthropic.claude-sonnet-4-6")
    assert cli.main(["config"]) == 2 and "non-EU" in capsys.readouterr().err


def test_no_command_prints_help(capsys):
    assert cli.main([]) == 0 and "work" in capsys.readouterr().out
