import io
import json
import logging

from nutrivo_worker.logs import get_logger, kv, log_context, setup_logging, workspace_hash


def test_json_lines_carry_the_docs_17_fields():
    out = io.StringIO()
    setup_logging("sha1", stream=out)
    with log_context(job_id="j1", job_kind="notify", request_id="r1", workspace=workspace_hash("ws-uuid")):
        get_logger("t").info("job started", extra=kv(attempt=2))
    line = json.loads(out.getvalue().strip().splitlines()[-1])
    assert {k: line[k] for k in ("level", "msg", "release", "job_id", "job_kind", "request_id")} == \
        {"level": "info", "msg": "job started", "release": "sha1", "job_id": "j1", "job_kind": "notify",
         "request_id": "r1"}
    assert line["workspace"] == workspace_hash("ws-uuid") != "ws-uuid" and line["attempt"] == 2 and "ts" in line


def test_exceptions_are_logged_by_type_only():
    out = io.StringIO()
    setup_logging("dev", stream=out)
    try:
        raise ValueError("Ingredients: chicken 40%, rice")
    except ValueError:
        logging.getLogger("t").exception("failed")
    text = out.getvalue()
    assert "chicken" not in text and json.loads(text.strip())["error_type"] == "ValueError"


def test_context_does_not_leak_between_jobs():
    out = io.StringIO()
    setup_logging("dev", stream=out)
    with log_context(job_id="a"):
        pass
    get_logger("t").info("idle")
    assert "job_id" not in json.loads(out.getvalue().strip())
