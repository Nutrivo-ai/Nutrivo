"""`nutrivo fixtures run --ruleset <id>`: the rule fixtures of a ruleset's members, the synthetic labels and the golden
labels, each compared with its ground truth per language panel (docs/05 §Fixtures, K05).

Every item ends in one of three results:
  matched   an evaluator ran and its outcome is the expected one
  differed  an evaluator ran and its outcome is not the expected one
  withheld  nothing judged it, with a reason code (no rule, no verdict)

Evaluators come from EVALUATORS, keyed by rule shape; the rules engine registers them when nutrivo_worker.engine is
imported (T-403: mandatory_particular and prescribed_wording). A shape without one is
withheld with `evaluator_missing`, never passed, and a runner-level withhold never counts as a match even when the
fixture expects `withheld`. Labels need extraction and the engine, so until LABEL_EVALUATOR is set they are withheld
with `engine_unavailable`. The run passes only when every item matched and at least one rule fixture ran.

The runner only reads: the database over a read-only transaction, fixtures/synth/out and fixtures/golden from disk."""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol
from xml.etree import ElementTree as ET

import sentry_sdk

from .errors import SafeError

REPO_ROOT = Path(__file__).resolve().parents[3]
SYNTH_DIR = REPO_ROOT / "fixtures" / "synth" / "out"
GOLDEN_DIR = REPO_ROOT / "fixtures" / "golden"

Outcome = Literal["passed", "failed", "withheld"]
Result = Literal["matched", "differed", "withheld"]
Kind = Literal["rule_fixture", "synthetic", "golden"]

# Reason codes for runner-level withholds.
EVALUATOR_MISSING = "evaluator_missing"     # no evaluator for the rule's shape yet (T-403, BE-20)
ENGINE_UNAVAILABLE = "engine_unavailable"   # labels need extraction and the rules engine
NO_FIXTURES = "no_fixtures"                 # a member rule version has no fixture at all
FIXTURE_INVALID = "fixture_invalid"         # a fixture file or row the runner cannot read
EVALUATOR_ERROR = "evaluator_error"         # an evaluator raised: withheld, never passed


class UnknownRuleset(SafeError):
    """The ruleset id names no released ruleset."""


@dataclass(frozen=True)
class RuleFixture:
    id: str
    rule_key: str
    version: int
    shape: str
    name: str
    input: dict[str, Any]
    expected_outcome: Outcome
    expected: dict[str, Any] | None = None
    params: dict[str, Any] = field(default_factory=dict)             # the pinned rule version's
    applicability: dict[str, Any] = field(default_factory=lambda: {"all": []})
    terms: dict[tuple[str, str], list[str]] = field(default_factory=dict)  # accepted register, (term_key, language)


@dataclass(frozen=True)
class Member:
    rule_key: str
    version: int
    shape: str


@dataclass(frozen=True)
class Evaluation:
    """What an evaluator returns for one fixture input."""

    outcome: Outcome
    reason: str | None = None                       # the reason code when withheld
    findings: list[dict[str, Any]] = field(default_factory=list)


Evaluator = Callable[[RuleFixture], Evaluation]
LabelEvaluator = Callable[[Kind, str, dict[str, Any]], Evaluation]

EVALUATORS: dict[str, Evaluator] = {}
LABEL_EVALUATOR: LabelEvaluator | None = None


@dataclass
class ItemResult:
    kind: Kind
    item: str                       # fixture name, or label name
    panel: int | None               # panel index for labels; None for a rule fixture without one
    language: str | None
    result: Result
    expected: Any
    actual: Any
    reason: str | None = None
    rule_key: str | None = None
    rule_version: int | None = None


@dataclass
class Report:
    ruleset_version: str
    results: list[ItemResult]

    @property
    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {"total": len(self.results), "matched": 0, "differed": 0, "withheld": 0}
        by_kind: dict[str, dict[str, int]] = {}
        for r in self.results:
            out[r.result] += 1
            k = by_kind.setdefault(r.kind, {"matched": 0, "differed": 0, "withheld": 0})
            k[r.result] += 1
        out["by_kind"] = by_kind
        return out

    @property
    def rule_fixtures_ran(self) -> int:
        return sum(1 for r in self.results if r.kind == "rule_fixture" and r.result != "withheld")

    @property
    def passed(self) -> bool:
        return self.rule_fixtures_ran > 0 and all(r.result == "matched" for r in self.results)

    def to_dict(self) -> dict[str, Any]:
        return {"ruleset_version": self.ruleset_version, "passed": self.passed, "summary": self.summary,
                "results": [asdict(r) for r in self.results]}


class FixtureStore(Protocol):
    def members(self, ruleset_version: str) -> list[Member]: ...
    def fixtures(self, ruleset_version: str) -> list[RuleFixture]: ...


class PgFixtureStore:
    """Reads ref.ruleset_members, ref.rules and ref.rule_fixtures in one read-only transaction."""

    def __init__(self, conn: Any):
        self.conn = conn

    def _known(self, ruleset_version: str) -> None:
        row = self.conn.execute("select 1 from ref.ruleset_versions where id = %s", (ruleset_version,)).fetchone()
        if row is None:
            raise UnknownRuleset(f"no released ruleset {ruleset_version}")

    def members(self, ruleset_version: str) -> list[Member]:
        self._known(ruleset_version)
        rows = self.conn.execute(
            """select m.rule_key, m.version, r.shape
                 from ref.ruleset_members m join ref.rules r using (rule_key)
                where m.ruleset_version = %s order by m.rule_key""", (ruleset_version,)).fetchall()
        return [Member(r["rule_key"], r["version"], r["shape"]) for r in rows]

    def fixtures(self, ruleset_version: str) -> list[RuleFixture]:
        rows = self.conn.execute(
            """select f.id, f.rule_key, f.version, r.shape, f.name, f.input, f.expected_outcome, f.expected,
                      rv.params, rv.applicability
                 from ref.ruleset_members m
                 join ref.rule_fixtures f on f.rule_key = m.rule_key and f.version = m.version
                 join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
                 join ref.rules r on r.rule_key = m.rule_key
                where m.ruleset_version = %s order by f.rule_key, f.name, f.id""", (ruleset_version,)).fetchall()
        terms = accepted_terms(self.conn, ruleset_version) if rows else {}
        return [RuleFixture(str(r["id"]), r["rule_key"], r["version"], r["shape"], r["name"], r["input"] or {},
                            r["expected_outcome"], r["expected"], r["params"] or {},
                            r["applicability"] or {"all": []}, terms) for r in rows]


def accepted_terms(conn: Any, ruleset_version: str) -> dict[tuple[str, str], list[str]]:
    """The accepted term register for a ruleset: entries pinned to it, else those pinned to none (#45)."""
    rows = conn.execute(
        """select distinct on (term_key, language, term) term_key, language, term
             from ref.term_entries
            where status = 'accepted' and (ruleset_version = %s or ruleset_version is null)
              and not (ruleset_version is null and exists (
                    select 1 from ref.term_entries p where p.status = 'accepted' and p.ruleset_version = %s
                       and p.term_key = term_entries.term_key and p.language = term_entries.language))
            order by term_key, language, term""", (ruleset_version, ruleset_version)).fetchall()
    out: dict[tuple[str, str], list[str]] = {}
    for r in rows:
        out.setdefault((r["term_key"], r["language"]), []).append(r["term"])
    return out


def _panel_language(data: dict[str, Any]) -> str | None:
    panel = data.get("panel")
    if isinstance(panel, dict) and isinstance(panel.get("language"), str):
        return panel["language"]
    lang = data.get("panel_language")
    return lang if isinstance(lang, str) else None


def _compare(expected_outcome: Outcome, expected: dict[str, Any] | None, actual: Evaluation) -> Result:
    if actual.outcome != expected_outcome:
        return "differed"
    expected = expected or {}
    if actual.outcome == "withheld" and expected.get("reason") and expected["reason"] != actual.reason:
        return "differed"
    want = expected.get("findings")
    if want is not None:
        keys = sorted(f.get("rule_key", "") for f in want)
        if keys != sorted(f.get("rule_key", "") for f in actual.findings):
            return "differed"
    return "matched"


def run_rule_fixtures(store: FixtureStore, ruleset_version: str,
                      evaluators: dict[str, Evaluator] | None = None) -> list[ItemResult]:
    evaluators = EVALUATORS if evaluators is None else evaluators
    members = store.members(ruleset_version)
    fixtures = store.fixtures(ruleset_version)
    results: list[ItemResult] = []
    covered = {(f.rule_key, f.version) for f in fixtures}
    for m in members:
        if (m.rule_key, m.version) not in covered:
            results.append(ItemResult("rule_fixture", m.rule_key, None, None, "withheld", None, None, NO_FIXTURES,
                                      m.rule_key, m.version))
    for f in fixtures:
        lang = _panel_language(f.input)
        expected = {"outcome": f.expected_outcome, **({"expected": f.expected} if f.expected else {})}
        evaluator = evaluators.get(f.shape)
        if evaluator is None:
            results.append(ItemResult("rule_fixture", f.name, None, lang, "withheld", expected, None,
                                      EVALUATOR_MISSING, f.rule_key, f.version))
            continue
        try:
            actual = evaluator(f)
        except Exception as exc:  # noqa: BLE001  an evaluator fault is a withhold with a reason, never a pass
            sentry_sdk.capture_exception(exc)
            results.append(ItemResult("rule_fixture", f.name, None, lang, "withheld", expected, None,
                                      f"{EVALUATOR_ERROR}:{type(exc).__name__}", f.rule_key, f.version))
            continue
        results.append(ItemResult("rule_fixture", f.name, None, lang, _compare(f.expected_outcome, f.expected, actual),
                                  expected, asdict(actual), actual.reason, f.rule_key, f.version))
    return results


def _synth_truth(panel: dict[str, Any]) -> dict[str, Any]:
    return {k: panel.get(k) for k in ("expected_status", "expected_failure", "missing")}


def _label_results(kind: Kind, name: str, data: dict[str, Any], panels: list[dict[str, Any]],
                   truth: Callable[[dict[str, Any]], Any], label_evaluator: LabelEvaluator | None) -> list[ItemResult]:
    if label_evaluator is None:
        return [ItemResult(kind, name, p.get("index", i), p.get("language"), "withheld", truth(p), None,
                           ENGINE_UNAVAILABLE) for i, p in enumerate(panels)]
    try:
        actual = label_evaluator(kind, name, data)
    except Exception as exc:  # noqa: BLE001  withheld, never passed
        sentry_sdk.capture_exception(exc)
        return [ItemResult(kind, name, p.get("index", i), p.get("language"), "withheld", truth(p), None,
                           f"{EVALUATOR_ERROR}:{type(exc).__name__}") for i, p in enumerate(panels)]
    # A label evaluator reports per panel in findings: [{"panel": i, "result": ..., "actual": ...}].
    by_panel = {f.get("panel"): f for f in actual.findings}
    out = []
    for i, p in enumerate(panels):
        idx = p.get("index", i)
        got = by_panel.get(idx)
        if got is None or got.get("result") not in ("matched", "differed"):
            out.append(ItemResult(kind, name, idx, p.get("language"), "withheld", truth(p),
                                  got.get("actual") if got else None,
                                  (got or {}).get("reason") or actual.reason or ENGINE_UNAVAILABLE))
        else:
            out.append(ItemResult(kind, name, idx, p.get("language"), got["result"], truth(p), got.get("actual")))
    return out


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def run_synthetic(synth_dir: Path, label_evaluator: LabelEvaluator | None = None) -> list[ItemResult]:
    results: list[ItemResult] = []
    for path in sorted(synth_dir.glob("*.truth.json")) if synth_dir.is_dir() else []:
        name = path.name.removesuffix(".truth.json")
        data = _read_json(path)
        panels = data.get("panels") if data else None
        if not isinstance(panels, list) or not panels:
            results.append(ItemResult("synthetic", name, None, None, "withheld", None, None, FIXTURE_INVALID))
            continue
        results += _label_results("synthetic", data.get("fixture", name), data, panels, _synth_truth,
                                  label_evaluator)
    return results


def _golden_truth(panel: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in panel.items() if k not in ("index", "language")}


def run_golden(golden_dir: Path, label_evaluator: LabelEvaluator | None = None) -> list[ItemResult]:
    """Every file under golden_dir except README.md is a label or part of one. A JSON file with a `panels` list is an
    expected-results file and is reported per panel; any other file is reported once, per label."""
    results: list[ItemResult] = []
    files = sorted(p for p in golden_dir.rglob("*") if p.is_file()) if golden_dir.is_dir() else []
    for path in files:
        if path.name.lower() == "readme.md" or path.name.startswith("."):
            continue
        name = str(path.relative_to(golden_dir))
        data = _read_json(path) if path.suffix == ".json" else None
        panels = data.get("panels") if data else None
        if isinstance(panels, list) and panels and all(isinstance(p, dict) for p in panels):
            results += _label_results("golden", name, data or {}, panels, _golden_truth, label_evaluator)
        elif path.suffix == ".json":
            results.append(ItemResult("golden", name, None, None, "withheld", None, None, FIXTURE_INVALID))
        else:
            results.append(ItemResult("golden", name, None, None, "withheld", None, None, ENGINE_UNAVAILABLE))
    return results


def run(store: FixtureStore, ruleset_version: str, synth_dir: Path = SYNTH_DIR, golden_dir: Path = GOLDEN_DIR,
        evaluators: dict[str, Evaluator] | None = None,
        label_evaluator: LabelEvaluator | None = None) -> Report:
    label_evaluator = LABEL_EVALUATOR if label_evaluator is None else label_evaluator
    results = run_rule_fixtures(store, ruleset_version, evaluators)
    results += run_synthetic(synth_dir, label_evaluator)
    results += run_golden(golden_dir, label_evaluator)
    return Report(ruleset_version, results)


def format_text(report: Report) -> str:
    s = report.summary
    head = (f"ruleset {report.ruleset_version}: {'PASSED' if report.passed else 'NOT PASSED'} "
            f"({s['matched']} matched, {s['differed']} differed, {s['withheld']} withheld of {s['total']})")
    lines = [head]
    for r in report.results:
        where = r.item if r.panel is None else f"{r.item} panel {r.panel}"
        lang = f" [{r.language}]" if r.language else ""
        rule = f" {r.rule_key} v{r.rule_version}" if r.rule_key else ""
        why = f": {r.reason}" if r.reason and r.result != "matched" else ""
        lines.append(f"  {r.result:<8} {r.kind:<12} {where}{lang}{rule}{why}")
    if report.rule_fixtures_ran == 0:
        lines.append("  no rule fixture was evaluated, so the ruleset cannot pass (no rule, no verdict)")
    return "\n".join(lines)


def to_junit(report: Report) -> str:
    """One testcase per item and panel: differed is a failure, withheld is a skip with its reason."""
    s = report.summary
    suite = ET.Element("testsuite", name=f"fixtures.{report.ruleset_version}", tests=str(s["total"]),
                       failures=str(s["differed"]), skipped=str(s["withheld"]), errors="0")
    for r in report.results:
        name = r.item if r.panel is None else f"{r.item}[panel {r.panel}{' ' + r.language if r.language else ''}]"
        case = ET.SubElement(suite, "testcase", classname=f"fixtures.{r.kind}", name=name)
        if r.result == "differed":
            ET.SubElement(case, "failure", message="differed").text = json.dumps(
                {"expected": r.expected, "actual": r.actual}, sort_keys=True, default=str)
        elif r.result == "withheld":
            ET.SubElement(case, "skipped", message=r.reason or "withheld")
    return ET.tostring(suite, encoding="unicode")
