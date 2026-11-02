"""I01 without a database: the document model, the v1 template and byte-for-byte reproducible rendering (BE-26).

Rules, findings and names are synthetic (TEST.T405.*), never law."""
import base64
import io
import json
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from pypdf import PdfReader

from nutrivo_worker.reporting import model as m
from nutrivo_worker.reporting import render as r

ISSUED = datetime(2026, 10, 29, 10, 44, 7, tzinfo=UTC)
SHA = "4f19" + "0" * 56 + "c02a"


def fixture_events(*, withheld=True, extra_findings=()):
    check_id, panel, text = uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3)
    findings = [{
        "id": uuid.UUID(int=10), "rule_key": "TEST.T405.HEIGHT", "rule_version": 2, "gap_id": None,
        "state": "action", "kind": "geometry", "provenance": "deterministic_rule", "citation": "TEST Annex II 1(b)",
        "message": "The heading is below the minimum character height.",
        "recommended_action": "Increase the heading to at least 2.00 mm x-height.", "text_object_id": text,
        "bbox_mm": [Decimal("1.5"), Decimal(2), Decimal("40.25"), Decimal(6)], "measured_mm": Decimal("1.912"),
        "required_mm": Decimal("2.0"), "height_definition": "x_height", "reason_code": None, "confidence": None,
    }]
    if withheld:
        findings.append({
            "id": uuid.UUID(int=11), "rule_key": None, "rule_version": None, "gap_id": "GAP-T405-CLAIMS",
            "state": "not_assessed", "kind": "label", "provenance": "not_assessed", "citation": None,
            "message": "Claims wording is not fully encoded for this market.", "recommended_action": None,
            "text_object_id": None, "bbox_mm": None, "measured_mm": None, "required_mm": None,
            "height_definition": None, "reason_code": "partially_encoded", "confidence": None,
        })
    findings.extend(extra_findings)
    check = {"id": check_id, "job_id": uuid.UUID(int=4), "product_id": uuid.UUID(int=5), "node_id": "EU-DE",
             "language": "de", "panel_id": panel, "artwork_version_id": uuid.UUID(int=6), "artwork_sha": SHA,
             "ruleset_version": "T405-TEST", "label_state": "not_assessed" if withheld else "action",
             "applied_rule_keys": ["TEST.T405.HEIGHT", "TEST.T405.BATCH"], "passed_rule_keys": ["TEST.T405.BATCH"],
             "withheld_rule_keys": [], "at": datetime(2026, 10, 29, 10, 40, tzinfo=UTC)}
    ev = m.Events(
        check=check, findings=findings,
        rule_versions={"TEST.T405.HEIGHT": {"version": 2, "article_ref": "TEST Annex II 1(b)"},
                       "TEST.T405.BATCH": {"version": 1, "article_ref": "TEST Art. 17(1)(f)"}},
        classification={"id": uuid.UUID(int=7), "species": "dog", "life_stage": "adult", "product_class": "complete",
                         "intended_use": None, "parnut_status": None, "citation": "TEST classification",
                         "provenance": "person"},
        siblings=[{"id": uuid.UUID(int=8), "node_id": "EU-SE", "language": "sv", "label_state": "clear",
                   "open_findings": 0}])
    sn = m.Snapshot(
        product_name="Lachs & Reis Adult 12 kg", artwork_version=7, node_name="Germany",
        node_names={"EU-DE": "Germany", "EU-SE": "Sweden"},
        rule_titles={"TEST.T405.HEIGHT": "Synthetic minimum character height",
                     "TEST.T405.BATCH": "Synthetic batch particular"},
        gaps={"GAP-T405-CLAIMS": {"reason_code": "partially_encoded", "description": "Synthetic claims gap."}},
        text_objects={str(text): {"text": "Analytische Bestandteile: Rohprotein 26,0 % · ℮ 12 kg · αDE0114",
                                  "bbox_mm": [Decimal("1.5"), Decimal(2), Decimal("40.25"), Decimal(6)]}},
        text_object_count=9, registration_state="unknown", requested_by="T-405 Editor")
    return ev, sn


def fixture_model(ref="ABCDEFGHIJKLMNOPQRSTUVWXYZ", **kw):
    ev, sn = fixture_events(**kw)
    return m.build(ev, sn, ref=ref, issued_at=ISSUED, workspace_id=str(uuid.UUID(int=9)))


def text_of(pdf: bytes) -> str:
    return " ".join(" ".join((p.extract_text() or "").split()) for p in PdfReader(io.BytesIO(pdf)).pages)


def fonts_of(pdf: bytes) -> set[str]:
    names = set()
    for page in PdfReader(io.BytesIO(pdf)).pages:
        for font in (page.get("/Resources", {}).get("/Font", {}) or {}).values():
            names.add(str(font.get_object()["/BaseFont"]).split("+", 1)[-1])
    return names


def test_I01_main_reference_is_128_random_bits_in_base32():
    """[I01.main] Step 2: 128 random bits in base32, 26 characters, within app.reports.ref's 20 to 64."""
    refs = {m.new_reference() for _ in range(200)}
    assert len(refs) == 200
    for ref in refs:
        assert len(ref) == 26 and ref.isupper() and ref.isalnum()
        assert len(base64.b32decode(ref + "=" * 6)) == 16


def test_I01_main_model_is_canonical_and_pins_ruleset_and_artwork():
    """[I01.main] The model pins the ruleset version, the artwork hash and the check; numbers are strings."""
    doc = fixture_model()
    assert (doc["ruleset_version"], doc["artwork_sha"], doc["node_id"]) == ("T405-TEST", SHA, "EU-DE")
    assert doc["check_ids"] == [str(uuid.UUID(int=1))] and doc["issued_at"] == "2026-10-29T10:44:07Z"
    assert doc["has_not_assessed"] is True and doc["template"] == "label_report.v1"
    f = doc["pinned"]["findings"][0]
    assert (f["measured"], f["required"], f["bbox_mm"]) == ("1.91 mm", "2.00 mm", ["1.50", "2.00", "40.25", "6.00"])
    assert m.dumps(doc) == m.dumps(json.loads(m.dumps(doc)))          # round-trips through its stored form
    assert "float" not in m.dumps(doc).decode() and isinstance(json.loads(m.dumps(doc)), dict)


def test_I01_main_rendered_face_carries_reference_ruleset_artwork_hash_and_time():
    """[I01.main] Steps 2 and 3: reference, ruleset version, artwork hash and timestamp on the face; every section of
    the design; the withheld domain listed as not assessed with its gap, never as a pass."""
    pdf = r.render(fixture_model())
    assert pdf.startswith(b"%PDF-")
    text = text_of(pdf)
    assert SHA in text.replace(" ", "")                  # printed in full; it wraps
    for needle in ("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "T405-TEST", "2026-10-29T10:44:07Z", "29 Oct 2026, 10:44 UTC",
                   "Scope and classification", "The sheet, with findings pinned", "Findings, each with its fix",
                   "Measurements", "What was not assessed", "The other language panels", "Registration in this market",
                   "GAP-T405-CLAIMS", "partially_encoded", "Synthetic claims gap.", "1.91 mm", "2.00 mm",
                   "Lachs & Reis Adult 12 kg", "T-405 Editor", "Germany", "German"):
        assert needle.lower() in text.lower(), needle      # running heads print in capitals
    assert "UNKNOWN" in text            # an unknown registration is shown as unknown, never clear
    meta = PdfReader(io.BytesIO(pdf)).metadata
    assert meta.get("/CreationDate", "").startswith("D:20261029104407")


def test_I01_main_not_assessed_section_is_always_present():
    """[I01.main] Step 3: section 05 is present even when nothing was withheld."""
    doc = fixture_model(withheld=False)
    assert doc["has_not_assessed"] is False
    text = text_of(r.render(doc))
    assert "What was not assessed" in text and "Nothing was withheld" in text


def test_I01_main_only_bundled_fonts_are_embedded():
    """[I01.main] Glyphs the Cobalt fonts lack (℮, Greek) come from the bundled fallback, never the system's."""
    embedded = fonts_of(r.render(fixture_model()))
    assert embedded and embedded <= {"Instrument-Sans", "Instrument-Sans-Medium", "Instrument-Sans-Semi-Bold",
                                      "IBM-Plex-Mono", "IBM-Plex-Mono-Medium", "Nutrivo-Fallback",
                                      "Nutrivo-Fallback-Bold"}, embedded
    for face in r.FONT_FILES:
        assert (r.FONTS / face).is_file()


def test_I01_main_unknown_template_is_refused():
    doc = fixture_model()
    doc["template"] = "label_report.v0"
    with pytest.raises(r.UnknownTemplate):
        r.render(doc)


RENDER = """
import hashlib, json, sys, time
time.time = lambda: 1_830_000_000.0            # a year and more after issue: the clock must not reach the bytes
from nutrivo_worker.reporting.render import render
pdf = render(json.loads(open(sys.argv[1], encoding="utf-8").read()))
open(sys.argv[2], "wb").write(pdf)
print(hashlib.sha256(pdf).hexdigest())
"""


def test_I01_must_1_same_model_renders_to_the_same_bytes_in_a_fresh_process(tmp_path: Path):
    """[I01.must.1] The stored model re-rendered later, in another process, gives the same bytes (BE-26)."""
    doc = fixture_model()
    first = r.render(doc)
    model_file = tmp_path / "model.json"
    model_file.write_bytes(m.dumps(doc))
    out = tmp_path / "again.pdf"
    proc = subprocess.run([sys.executable, "-c", RENDER, str(model_file), str(out)], capture_output=True, text=True,
                          timeout=120, check=True)
    assert out.read_bytes() == first
    assert proc.stdout.strip() == __import__("hashlib").sha256(first).hexdigest()


def test_I01_must_1_a_different_reference_gives_a_different_document():
    """[I01.must.1] The reference is on the face and in the /ID: two references never share bytes."""
    assert r.render(fixture_model(ref="A" * 26)) != r.render(fixture_model(ref="B" * 26))
