"""T-802 · the scan handler (H03 step 2), the scanners, the supplier request email and the supplier-upload Edge
Function's node tests. tests/test_supplier_links_pg.py runs the same paths on Postgres, Mailpit and Storage."""
import os
import shutil
import stat
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pgtest import skip_no_service

from nutrivo_worker import email_templates
from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.handlers import scan
from nutrivo_worker.jobs import Job
from nutrivo_worker.scanning import EICAR, ClamScanner, EicarOnlyScanner, ScanError, ScanResult, scanner_for

ROOT = Path(__file__).resolve().parents[2]
WS, REQ, DOC = "20000000-0000-4000-8802-00000000000a", "60000000-0000-4000-8802-00000000000a", "70000000-0000-4000-8802-000000000001"
PATH = f"{WS}/{REQ}/premix-spec.pdf"
PDF = b"%PDF-1.7\n%%EOF\n"


@dataclass
class Ctx:
    settings: Settings = field(default_factory=lambda: Settings(scan_mode="eicar_only"))
    beats: list = field(default_factory=list)

    def heartbeat(self, **progress):
        self.beats.append(progress)


class Store:
    def __init__(self, **doc):
        self.doc = {"id": DOC, "workspace_id": WS, "storage_path": f"quarantine/{PATH}", "scan_status": "quarantine",
                    "uploaded_via": "supplier_link", "request_id": REQ, "promoted_from": None, "result_id": None, **doc}
        self.recorded = []

    def quarantined_upload(self, document_id):
        return self.doc if document_id == DOC else None

    def record_scan_result(self, document_id, outcome):
        self.recorded.append((document_id, outcome))
        return {"status": "recorded", "document_id": "promoted-1", "scan_status": outcome}


class Storage:
    def __init__(self, data=PDF):
        self.objects = {("quarantine", PATH): data}
        self.puts = []

    def get(self, bucket, path):
        return self.objects[(bucket, path)]

    def put(self, bucket, path, body, content_type):
        self.puts.append((bucket, path, content_type))
        self.objects[(bucket, path)] = body


class Broken:
    name = "broken"

    def scan(self, data):
        raise ScanError("clamscan exited with status 2")


def job(workspace=WS, **payload):
    return Job(id="job-1", kind="scan", workspace_id=workspace, payload={"document_id": DOC, **payload},
               attempts=1)


def test_H03_main_a_clean_upload_is_copied_to_documents_and_recorded_as_a_new_clean_row():
    store, storage, ctx = Store(), Storage(), Ctx()
    progress = scan.run(job(), ctx, store=store, storage=storage, scanner=EicarOnlyScanner())
    assert storage.puts == [("documents", PATH, "application/pdf")]
    assert storage.objects[("documents", PATH)] == PDF
    assert store.recorded == [(DOC, "clean")]
    assert progress == {"stage": "done", "outcome": "promoted", "result_document_id": "promoted-1",
                        "scanner": "eicar_only"}
    assert all("premix" not in str(b) for b in ctx.beats), "no file name in progress"


def test_H03_must_1_an_infected_upload_is_rejected_and_never_leaves_quarantine():
    store, storage = Store(), Storage(PDF + EICAR)
    progress = scan.run(job(), Ctx(), store=store, storage=storage, scanner=EicarOnlyScanner())
    assert storage.puts == [] and store.recorded == [(DOC, "rejected")]
    assert progress["outcome"] == "rejected" and progress["signature"] == "Eicar-Test-Signature"


def test_H03_must_1_a_file_that_could_not_be_scanned_is_never_promoted():
    store, storage = Store(), Storage()
    with pytest.raises(ScanError):
        scan.run(job(), Ctx(), store=store, storage=storage, scanner=Broken())
    assert storage.puts == [] and store.recorded == []


def test_H03_main_a_recorded_result_is_not_scanned_again():
    store, storage = Store(result_id="promoted-0"), Storage()
    progress = scan.run(job(), Ctx(), store=store, storage=storage, scanner=Broken())
    assert progress["outcome"] == "already_recorded" and store.recorded == [] and storage.puts == []


@pytest.mark.parametrize("doc, workspace", [
    ({}, "20000000-0000-4000-8802-00000000000b"),                       # another workspace's job
    ({"uploaded_via": "member"}, WS),                                   # not a supplier upload
    ({"scan_status": "clean"}, WS),                                     # not in quarantine
    ({"storage_path": f"documents/{PATH}"}, WS),                        # not in the quarantine bucket
    ({"storage_path": f"quarantine/{WS}/other/premix-spec.pdf"}, WS),   # not its request's folder
    ({"storage_path": f"quarantine/{WS}/{REQ}/premix-spec.exe"}, WS),   # a type the function refuses
])
def test_H03_must_1_the_scan_touches_only_its_own_quarantined_upload(doc, workspace):
    store, storage = Store(**doc), Storage()
    with pytest.raises(PermanentJobError):
        scan.run(job(workspace), Ctx(), store=store, storage=storage, scanner=EicarOnlyScanner())
    assert storage.puts == [] and store.recorded == []


def fake_clamscan(tmp_path, status, out=""):
    exe = tmp_path / "clamscan"
    exe.write_text(f"#!/bin/sh\ncat > /dev/null\nprintf '%s' '{out}'\nexit {status}\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return str(exe)


def test_H03_main_clamscan_exit_status_is_the_verdict(tmp_path):
    assert ClamScanner(fake_clamscan(tmp_path, 0)).scan(PDF) == ScanResult("clean")
    assert ClamScanner(fake_clamscan(tmp_path, 1, "stdin: Win.Test.EICAR_HDB-1 FOUND")).scan(PDF) == \
        ScanResult("infected", "Win.Test.EICAR_HDB-1")
    with pytest.raises(ScanError, match="status 2"):
        ClamScanner(fake_clamscan(tmp_path, 2)).scan(PDF)
    with pytest.raises(ScanError, match="not installed"):
        ClamScanner(str(tmp_path / "missing")).scan(PDF)


def test_H03_main_the_real_clamscan_finds_eicar_when_it_is_installed():
    if shutil.which("clamscan") is None:
        pytest.skip("ClamAV is not installed here; the worker image installs it (worker/Dockerfile)")
    clam = ClamScanner()
    try:
        assert clam.scan(EICAR).verdict == "infected"
    except ScanError:
        pytest.skip("clamscan has no signature database here (freshclam runs when the image is built)")
    assert clam.scan(PDF).verdict == "clean"


def test_T802_the_test_scanner_is_refused_when_deployed_and_ci_defaults_to_it(monkeypatch):
    for env in ("staging", "prod"):
        with pytest.raises(ValueError, match="SCAN_MODE"):   # pydantic wraps the ConfigError
            Settings(env=env, scan_mode="eicar_only")
    for k in list(os.environ):
        if k in ("NUTRIVO_ENV", "SCAN_MODE", "MODELS_MODE"):
            monkeypatch.delenv(k)
    monkeypatch.setenv("NUTRIVO_ENV", "ci")
    assert Settings.from_env().scan_mode == "eicar_only"
    monkeypatch.setenv("NUTRIVO_ENV", "dev")
    assert Settings.from_env().scan_mode == "clamav"
    assert isinstance(scanner_for(Settings()), ClamScanner)


def test_T802_the_worker_image_installs_clamav_with_signatures():
    dockerfile = (ROOT / "worker" / "Dockerfile").read_text()
    assert "clamav clamav-freshclam" in dockerfile and "RUN freshclam" in dockerfile


def test_H02_main_the_supplier_email_says_what_is_asked_and_escapes_it():
    email = email_templates.supplier_request(to="specs@aldrich.test", requester="Carl Berg", workspace="Kruuse",
                                             title="Spec <b>PMX-118</b>", expires_at=datetime(2026, 11, 24, tzinfo=UTC),
                                             url="https://app.nutrivo.ai/supplier/abc")
    assert email.subject == "Kruuse has asked you for a document" and email.template == "supplier_request"
    assert "Spec &lt;b&gt;PMX-118&lt;/b&gt;" in email.html and "<b>PMX-118" not in email.html
    assert "https://app.nutrivo.ai/supplier/abc" in email.text and "24 November 2026" in email.text


def test_H03_main_the_supplier_upload_function_node_tests():
    """[H03.main] [H03.must.1] [H03.fail.1] supabase/functions/supplier-upload/upload.test.mjs under Node's runner."""
    node = shutil.which("node")
    if node is None:
        skip_no_service("node", "install Node 20 or later")
    run = subprocess.run([node, "--test", "upload.test.mjs"], cwd=ROOT / "supabase" / "functions" / "supplier-upload",
                         capture_output=True, text=True, check=False, timeout=120)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
    assert "# fail 0" in run.stdout and "# pass 10" in run.stdout
