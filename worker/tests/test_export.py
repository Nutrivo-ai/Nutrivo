"""O03 export handler without Postgres: the archive's shape, determinism, path scoping and idempotent upload."""
import io
import json
import zipfile

import pytest
from fakes import FakeJob, FakeStore

from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.handlers import export
from nutrivo_worker.jobs import Job, JobContext

WS = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class FakeReader:
    def __init__(self, files=()):
        self.asked: list[tuple[str, str]] = []
        self._files = list(files)

    def rows(self, table, workspace_id):
        self.asked.append((table.select, workspace_id))
        if table.file == "checks.csv":
            return ["id", "workspace_id", "label_state", "withheld_rule_keys", "ruleset_version"], [{"id": "c1", "workspace_id": workspace_id, "label_state": "not_assessed",
                     "withheld_rule_keys": ["k1"], "ruleset_version": "0000.00-empty"}]
        if table.file == "recipes.csv":
            return ["id", "workspace_id", "name", "ruleset_version"], [{"id": "f1", "workspace_id": workspace_id, "name": "Adult, chicken", "ruleset_version": None}]
        return ["id", "workspace_id"], []

    def files(self, workspace_id):
        return self._files


class FakeStorage:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.puts: list[tuple[str, str, int]] = []

    def put(self, bucket, path, body, content_type):
        self.puts.append((bucket, path, len(body)))
        self.objects.setdefault((bucket, path), body)       # no upsert: a second put of the same path is a no-op

    def get_if_exists(self, bucket, path):
        return self.objects.get((bucket, path))


def ctx_for(job):
    store = FakeStore()
    store.jobs[job.id] = FakeJob("export", status="running", workspace_id=job.workspace_id)
    return JobContext(job, store, Settings()), store


def job(ws=WS, job_id="33333333-3333-3333-3333-333333333333"):
    return Job(job_id, "export", ws, {"request_id": "req-1"}, 1)


def unzip(body):
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def test_O03_main_archive_holds_every_record_kind_with_ruleset_version_and_the_workspace_files():
    j = job()
    storage = FakeStorage({("reports", f"{WS}/r1.pdf"): b"%PDF-report", ("documents", f"{WS}/d1.pdf"): b"%PDF-doc"})
    reader = FakeReader([("reports", f"reports/{WS}/r1.pdf", "reports/r1.pdf"),
                         ("documents", f"{WS}/d1.pdf", "documents/d1.pdf"),
                         ("documents", f"{OTHER}/stolen.pdf", "documents/d2.pdf"),
                         ("documents", f"{WS}/gone.pdf", "documents/d3.pdf")])
    c, _ = ctx_for(j)
    result = export.run(j, c, storage=storage, reader=reader)

    assert result["path"] == f"{WS}/{j.id}.zip" and result["bucket"] == "exports"
    files = unzip(storage.objects[("exports", result["path"])])
    for t in export.TABLES:
        assert t.file in files
    assert {"recipes.csv", "checks.csv", "findings.csv", "reports.csv", "certificates.csv", "documents.csv"} <= set(files)
    assert files["certificates.csv"] == b"id,workspace_id,ruleset_version\n"     # an empty table keeps its header
    header = files["checks.csv"].decode().splitlines()[0].split(",")
    assert header[-1] == "ruleset_version"
    assert files["checks.csv"].decode().splitlines()[1].endswith(",0000.00-empty")
    assert files["reports/r1.pdf"] == b"%PDF-report" and files["documents/d1.pdf"] == b"%PDF-doc"
    manifest = json.loads(files["manifest.json"])
    assert manifest["files_missing"] == ["documents/d2.pdf", "documents/d3.pdf"]   # never another workspace's file
    assert manifest["request_id"] == "req-1" and manifest["records"]["recipes.csv"] == 1
    assert all(ws == WS for _, ws in reader.asked)


def test_O03_main_progress_holds_the_path_and_never_a_signed_url():
    j = job()
    c, _ = ctx_for(j)
    progress: list[dict] = []
    c.heartbeat = lambda **p: progress.append(p)   # type: ignore[method-assign]
    export.run(j, c, storage=FakeStorage(), reader=FakeReader())
    final = progress[-1]
    assert final["stage"] == "ready" and final["path"] == f"{WS}/{j.id}.zip"
    assert not any("token" in json.dumps(p).lower() or "sign" in json.dumps(p).lower() for p in progress)


def test_O03_main_the_archive_is_deterministic_and_a_retry_uploads_the_same_path():
    j = job()
    storage = FakeStorage()
    first = export.run(j, ctx_for(j)[0], storage=storage, reader=FakeReader())
    second = export.run(j, ctx_for(j)[0], storage=storage, reader=FakeReader())
    assert first == second
    assert [p[:2] for p in storage.puts] == [("exports", first["path"])] * 2


def test_O03_must_1_the_handler_never_reads_plan_subscription_or_workspace_status():
    reader = FakeReader()
    j = job()
    export.run(j, ctx_for(j)[0], storage=FakeStorage(), reader=reader)
    statements = " ".join(s for s, _ in reader.asked).lower()
    for gate in ("subscriptions", "app.workspaces", "allowance", "plan", "billing", "payment"):
        assert gate not in statements


def test_a_job_without_a_workspace_fails_permanently():
    j = job(ws=None)
    with pytest.raises(PermanentJobError):
        export.run(j, ctx_for(j)[0], storage=FakeStorage(), reader=FakeReader())


@pytest.mark.parametrize("path, expected", [
    (f"{WS}/a.pdf", f"{WS}/a.pdf"),
    (f"reports/{WS}/a.pdf", f"{WS}/a.pdf"),
    (f"/{WS}/a.pdf", f"{WS}/a.pdf"),
    (f"{OTHER}/a.pdf", None),
    (f"{WS}/../{OTHER}/a.pdf", None),
    ("a.pdf", None),
])
def test_object_paths_stay_inside_the_workspace_folder(path, expected):
    assert export.object_path("reports", path, WS) == expected


def test_csv_cells_are_plain_text_json_or_empty():
    body = export.to_csv(["a", "b", "c", "ruleset_version", "d"], [{"a": None, "b": {"x": 1}, "c": True, "ruleset_version": "v", "d": ["k"]}]).decode()
    assert body.splitlines() == ["a,b,c,d,ruleset_version", ',"{""x"": 1}",true,"[""k""]",v']
