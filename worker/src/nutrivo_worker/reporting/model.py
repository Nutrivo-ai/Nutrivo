"""The label report's document model (I01): everything the PDF prints, as canonical JSON.

The model has two parts:
- `pinned` comes only from insert-only rows: the check event, its findings, the rule versions the ruleset pins and the
  classification the check used. A re-render rebuilds it from the database and refuses a document whose pinned part
  no longer matches (BE-26).
- `snapshot` holds what can change after issue (the product's name, the requester's name, the market's registration
  state, rule titles, gap descriptions, the panel's text objects). It is frozen at issue time, stored beside the PDF
  and never re-read, so the document a reference names shows what was true when it was issued.

Every value is a string, an int, a bool, a list or a dict, never a float: numbers are formatted here, once, so the
JSON and the PDF it renders to are the same bytes on every machine."""
from __future__ import annotations

import base64
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

FORMAT = "nutrivo-label-report/1"
TEMPLATE = "label_report.v1"
STATE_ORDER = {"action": 0, "not_assessed": 1, "info": 2}

# Labelling languages of the EU nodes (ISO 639-1), for the document's own wording. A code not listed prints as itself.
LANGUAGES = {
    "bg": "Bulgarian", "cs": "Czech", "da": "Danish", "de": "German", "el": "Greek", "en": "English",
    "es": "Spanish", "et": "Estonian", "fi": "Finnish", "fr": "French", "ga": "Irish", "hr": "Croatian",
    "hu": "Hungarian", "it": "Italian", "lt": "Lithuanian", "lv": "Latvian", "mt": "Maltese", "nl": "Dutch",
    "pl": "Polish", "pt": "Portuguese", "ro": "Romanian", "sk": "Slovak", "sl": "Slovenian", "sv": "Swedish",
}


def new_reference() -> str:
    """128 random bits in base32, without padding: 26 characters (I01 step 2; app.reports.ref is 20 to 64)."""
    return base64.b32encode(secrets.token_bytes(16)).decode("ascii").rstrip("=")


def issue_time(now: datetime | None = None) -> datetime:
    """The issue timestamp, whole seconds in UTC, so it reads back from timestamptz unchanged."""
    return (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)


def iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def mm(value: Any) -> str | None:
    """A measurement in millimetres, two decimals, as printed (1.91 mm)."""
    if value is None:
        return None
    return f"{Decimal(str(value)).quantize(Decimal('0.01'))} mm"


def bbox(value: Any) -> list[str] | None:
    return None if value is None else [str(Decimal(str(v)).quantize(Decimal("0.01"))) for v in value]


def language_name(code: str | None) -> str:
    if not code:
        return "Unknown language"
    return LANGUAGES.get(code.lower(), code)


@dataclass(frozen=True)
class Events:
    """The insert-only rows a report is built from (see store.PgReportStore.events)."""

    check: dict[str, Any]
    findings: list[dict[str, Any]]
    rule_versions: dict[str, dict[str, Any]]      # rule_key -> {version, article_ref}, as the ruleset pins them
    classification: dict[str, Any] | None
    siblings: list[dict[str, Any]]                # the job's other checks, each with its open finding count


@dataclass(frozen=True)
class Snapshot:
    """What can change after issue, read once when the report is generated."""

    product_name: str
    artwork_version: int | None
    node_name: str
    node_names: dict[str, str]
    rule_titles: dict[str, str]
    gaps: dict[str, dict[str, Any]]               # gap_id -> {reason_code, description}
    text_objects: dict[str, dict[str, Any]]       # text_object_id -> {text, bbox_mm}
    text_object_count: int
    registration_state: str
    requested_by: str | None


def _s(value: Any) -> str | None:
    return None if value is None else str(value)


def pinned_part(ev: Events) -> dict[str, Any]:
    """The part a re-render must find unchanged in the database."""
    c = ev.check
    findings = sorted(ev.findings, key=lambda f: (STATE_ORDER.get(f["state"], 9), f.get("rule_key") or "",
                                                   f.get("gap_id") or "", str(f["id"])))
    rules = {k: {"version": v["version"], "article_ref": v["article_ref"]} for k, v in sorted(ev.rule_versions.items())}
    cl = ev.classification
    return {
        "check": {
            "id": str(c["id"]), "job_id": _s(c.get("job_id")), "product_id": str(c["product_id"]),
            "node_id": c["node_id"], "language": c.get("language"), "panel_id": _s(c.get("panel_id")),
            "artwork_version_id": _s(c.get("artwork_version_id")), "artwork_sha": c.get("artwork_sha"),
            "ruleset_version": c["ruleset_version"], "label_state": c["label_state"],
            "applied_rule_keys": sorted(c.get("applied_rule_keys") or []),
            "passed_rule_keys": sorted(c.get("passed_rule_keys") or []),
            "withheld_rule_keys": sorted(c.get("withheld_rule_keys") or []),
            "at": iso(c["at"]),
        },
        "findings": [{
            "id": str(f["id"]), "rule_key": f.get("rule_key"), "rule_version": f.get("rule_version"),
            "gap_id": f.get("gap_id"), "state": f["state"], "kind": f["kind"], "provenance": f["provenance"],
            "citation": f.get("citation"), "message": f["message"], "recommended_action": f.get("recommended_action"),
            "text_object_id": _s(f.get("text_object_id")), "bbox_mm": bbox(f.get("bbox_mm")),
            "measured": mm(f.get("measured_mm")), "required": mm(f.get("required_mm")),
            "height_definition": f.get("height_definition"), "reason_code": f.get("reason_code"),
            "confidence": None if f.get("confidence") is None else str(Decimal(str(f["confidence"])).quantize(
                Decimal("0.01"))),
        } for f in findings],
        "rules": rules,
        "classification": None if cl is None else {
            "id": str(cl["id"]), "species": cl.get("species"), "life_stage": cl.get("life_stage"),
            "product_class": cl.get("product_class"), "intended_use": cl.get("intended_use"),
            "parnut_status": cl.get("parnut_status"), "citation": cl["citation"], "provenance": cl["provenance"],
        },
        "other_checks": [{
            "id": str(s["id"]), "node_id": s["node_id"], "language": s.get("language"),
            "label_state": s["label_state"], "open_findings": int(s["open_findings"]),
        } for s in sorted(ev.siblings, key=lambda s: (s["node_id"], s.get("language") or "", str(s["id"])))],
    }


def snapshot_part(sn: Snapshot) -> dict[str, Any]:
    return {
        "product_name": sn.product_name, "artwork_version": sn.artwork_version, "node_name": sn.node_name,
        "node_names": dict(sorted(sn.node_names.items())), "rule_titles": dict(sorted(sn.rule_titles.items())),
        "gaps": {k: {"reason_code": v["reason_code"], "description": v["description"]}
                 for k, v in sorted(sn.gaps.items())},
        "text_objects": {k: {"text": v["text"], "bbox_mm": bbox(v.get("bbox_mm"))}
                         for k, v in sorted(sn.text_objects.items())},
        "text_object_count": sn.text_object_count,
        "registration_state": sn.registration_state, "requested_by": sn.requested_by,
    }


def has_not_assessed(pinned: dict[str, Any]) -> bool:
    c = pinned["check"]
    return (c["label_state"] == "not_assessed" or bool(c["withheld_rule_keys"])
            or any(f["state"] == "not_assessed" for f in pinned["findings"]))


def build(ev: Events, sn: Snapshot, *, ref: str, issued_at: datetime, workspace_id: str) -> dict[str, Any]:
    pinned = pinned_part(ev)
    return {
        "format": FORMAT, "template": TEMPLATE, "ref": ref, "issued_at": iso(issued_at),
        "workspace_id": workspace_id, "ruleset_version": pinned["check"]["ruleset_version"],
        "artwork_sha": pinned["check"]["artwork_sha"], "check_ids": [pinned["check"]["id"]],
        "node_id": pinned["check"]["node_id"], "has_not_assessed": has_not_assessed(pinned),
        "pinned": pinned, "snapshot": snapshot_part(sn),
    }


def dumps(model: dict[str, Any]) -> bytes:
    """Canonical JSON: the stored form of the model."""
    return json.dumps(model, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
