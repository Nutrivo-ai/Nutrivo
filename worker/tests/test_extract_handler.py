"""T-303: the `extract` handler without Postgres: what it reads, what it refuses and what it hands the store.
The database side (one run, panels, text objects, idempotency) is in test_extract_pg.py."""
import hashlib
from pathlib import Path

import pytest
from fakes import FakeStore

from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.extraction import idempotency_key
from nutrivo_worker.handlers import extract as h
from nutrivo_worker.jobs import Job, JobContext, Registry, process_message, registry
from nutrivo_worker.sources.store import StorageClient, StorageError, StorageNotFound

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "fixtures" / "synth" / "out"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


class MemArtworks:
    def __init__(self, art=None):
        self.art, self.runs, self.persisted = art, {}, []

    def artwork(self, av_id):
        return self.art if self.art and self.art.id == av_id else None

    def run_for(self, key):
        return self.runs.get(key)

    def persist(self, art, key, result, started_at):
        self.persisted.append(result)
        self.runs[key] = {"id": "run-1", "status": result.status, "failure_codes": result.failure_codes,
                          "panels": len(result.panels),
                          "panels_extracted": sum(p.status == "extracted" for p in result.panels),
                          "text_objects": sum(len(p.text_objects) for p in result.panels)}
        return self.runs[key]


def art_for(data: bytes, ext="pdf", path=None):
    sha = hashlib.sha256(data).hexdigest()
    return h.Artwork("av-1", "ws", "prod", sha, path or f"ws/prod/{sha}.{ext}")


def ctx_for(payload):
    store = FakeStore()
    store.add("job-1", "extract", payload=payload)
    job = Job("job-1", "extract", "ws", payload, 1)
    return job, JobContext(job, store, Settings()), store


def test_the_extract_handler_is_registered_for_its_kind():
    assert registry.get("extract") is not None and registry.get("extract").fn is h.extract


@pytest.mark.parametrize("data", [PNG, JPEG], ids=["png", "jpeg"])
def test_D01_fail_1_a_photo_is_rasterised_with_no_geometry(data):
    store = MemArtworks(art_for(data))
    job, ctx, fake = ctx_for({"artwork_version_id": "av-1"})
    run = h.run_extract(job, ctx, store, lambda bucket, path: data)
    [result] = store.persisted
    assert [(p.status, p.failure_code, p.bbox_mm, p.text_objects) for p in result.panels] == \
        [("not_assessable", "rasterised", [0.0, 0.0, 0.0, 0.0], [])]
    assert result.page_size_mm == [] and run["status"] == "failed"
    assert fake.jobs["job-1"].progress["stage"] == "done"
    assert fake.jobs["job-1"].progress["failure_codes"] == ["rasterised"]


def test_bytes_are_typed_by_magic_numbers_not_by_name():
    assert h.file_kind(PNG) == h.file_kind(JPEG) == "raster"
    assert h.file_kind(b"%PDF-1.7") == "pdf" and h.file_kind(b"GIF89a") == "pdf"   # the engine names it unreadable


def test_a_file_that_is_not_a_pdf_or_image_is_a_named_unreadable_panel_not_a_job_error():
    data = b"GIF89a not an artwork"
    store = MemArtworks(art_for(data))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    run = h.run_extract(job, ctx, store, lambda b, p: data)
    assert [(p.status, p.failure_code) for p in store.persisted[0].panels] == [("not_assessable", "unreadable")]
    assert run["failure_codes"] == ["unreadable"]


def test_the_object_is_read_from_the_artwork_bucket_at_the_registered_path():
    data = (SYNTH / "small_netqty.pdf").read_bytes()
    seen = []
    store = MemArtworks(art_for(data))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    h.run_extract(job, ctx, store, lambda bucket, path: seen.append((bucket, path)) or data)
    assert seen == [("artwork", f"ws/prod/{hashlib.sha256(data).hexdigest()}.pdf")]


@pytest.mark.parametrize("path", [
    "other-ws/other-prod/{sha}.pdf",          # another workspace's object, registered with its hash
    "ws/other-prod/{sha}.pdf",                # another product
    "ws/prod/../../other-ws/x/{sha}.pdf",
    "ws/prod/{sha}.gif",
    "ws/prod/{sha}",
])
def test_only_the_artworks_own_content_addressed_path_is_ever_read(path):
    sha = hashlib.sha256(PNG).hexdigest()
    store = MemArtworks(art_for(PNG, path=path.format(sha=sha)))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    with pytest.raises(PermanentJobError) as err:
        h.run_extract(job, ctx, store, lambda b, p: pytest.fail("fetched"))
    assert "other" not in str(err.value) and sha not in str(err.value)   # ids only, never the path
    assert store.persisted == []


@pytest.mark.parametrize("ext", ["pdf", "png", "jpg"])
def test_each_upload_extension_is_its_own_path(ext):
    store = MemArtworks(art_for(PNG, ext=ext))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    assert h.run_extract(job, ctx, store, lambda b, p: PNG)["failure_codes"] == ["rasterised"]


def test_a_persisted_run_is_not_read_or_extracted_again():
    data = PNG
    store = MemArtworks(art_for(data))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    h.run_extract(job, ctx, store, lambda b, p: data)
    h.run_extract(job, ctx, store, lambda b, p: pytest.fail("read again"))
    assert len(store.persisted) == 1


def test_the_run_key_is_the_engine_key_for_this_artwork_version():
    sha = "a" * 64
    assert h.run_key("av-1", sha) == f"{idempotency_key(sha)}:av-1" != h.run_key("av-2", sha)


@pytest.mark.parametrize("payload", [{}, {"artwork_version_id": "missing"}])
def test_a_job_without_its_artwork_fails_permanently(payload):
    job, ctx, _ = ctx_for(payload)
    with pytest.raises(PermanentJobError):
        h.run_extract(job, ctx, MemArtworks(), lambda b, p: b"")


def test_a_missing_object_fails_permanently():
    store = MemArtworks(art_for(PNG))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})

    def missing(b, p):
        raise StorageNotFound("storage read from artwork failed (not found)")

    with pytest.raises(PermanentJobError, match="missing from storage"):
        h.run_extract(job, ctx, store, missing)
    assert store.persisted == []


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_any_other_storage_answer_retries_with_backoff(status):
    store = MemArtworks(art_for(PNG))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})

    def failing(b, p):
        raise StorageError(f"storage read from artwork failed (HTTP {status})")

    with pytest.raises(StorageError) as err:
        h.run_extract(job, ctx, store, failing)
    assert not isinstance(err.value, PermanentJobError)
    assert store.persisted == []


@pytest.mark.parametrize(("status", "body", "missing"), [
    (404, b"", True),
    (400, b'{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}', True),
    (400, b'{"statusCode":"400","error":"invalid"}', False),
    (429, b"", False),
])
def test_storage_names_a_missing_object_as_supabase_answers_it(status, body, missing):
    class Once:
        def send(self, method, url, headers, body_=None):
            return type("R", (), {"status": status, "body": body})()

    client = StorageClient("http://storage.test", "service", Once())
    with pytest.raises(StorageError) as err:
        client.get("artwork", "ws/p/x.pdf", attempts=1, sleep=lambda s: None)
    assert isinstance(err.value, StorageNotFound) is missing


def test_a_file_that_does_not_match_its_registered_hash_is_never_extracted():
    store = MemArtworks(art_for(b"the registered bytes"))
    job, ctx, _ = ctx_for({"artwork_version_id": "av-1"})
    with pytest.raises(PermanentJobError, match="does not match its registered hash"):
        h.run_extract(job, ctx, store, lambda b, p: b"other bytes")
    assert store.persisted == []


def test_a_storage_outage_retries_with_a_safe_error_through_the_job_loop(monkeypatch):
    store = FakeStore()
    msg = store.add("job-1", "extract", payload={"artwork_version_id": "av-1"})
    reg = Registry()
    reg.register("extract")(lambda job, ctx: h.run_extract(
        job, ctx, MemArtworks(art_for(PNG)),
        lambda b, p: (_ for _ in ()).throw(StorageError("storage read from artwork failed (HTTP 503)"))))
    assert process_message(store, reg, msg, Settings()) == "retry"
    assert store.jobs["job-1"].status == "queued"
    assert store.jobs["job-1"].last_error == "StorageError: storage read from artwork failed (HTTP 503)"
