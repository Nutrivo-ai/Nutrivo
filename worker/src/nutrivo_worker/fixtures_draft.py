"""`nutrivo fixtures draft [--rule <key>] [--dry-run]`: proposed rule fixtures for the accepting person to confirm
(incident #360, docs/05 §Fixtures, docs/12 Thursday, docs/13).

For every accepted rule version without a confirmed fixture for each of passed, failed and withheld, it proposes
one fixture for each outcome that is missing. A person confirms or rejects each one in /admin/rules
(app.decide_rule_fixture). Only confirmed fixtures count for the release gate and for `nutrivo fixtures run`.

Nothing here comes from memory, and no regulatory value is invented (CLAUDE.md 7). A fixture's input is built only
from:
- the version's own stored params and applicability;
- its node's official labelling languages (ref.jurisdictions);
- the accepted term register entries its params link to, pinned to no ruleset, as a draft run reads them.

  passed    a panel in one of the node's languages printing the linked term (character_height: measured exactly at
            the band minimum; threshold: a quantity meeting the condition, taken from the rule's own value)
  failed    the same panel with nothing printed (character_height: the term at half the band minimum)
  withheld  the passed panel whose language the extraction could not tell ('und'): data_missing
Classification facts are only values the applicability predicate itself names. The fixture's node is the rule's
own node when it has languages, otherwise its child nodes in id order.

Every proposed fixture is first run through the engine, as `nutrivo fixtures run` would run it
(fixtures_runner.run_rule_fixtures). It is stored only when the engine's outcome equals its expected_outcome. A
shape the runner cannot judge without a model or the additive register (claim_judgement, additive_condition) is
skipped with a reason, never guessed.

Idempotent: under an advisory lock per rule version, an outcome that already has a proposed or confirmed fixture
is `unchanged`, and a fixture identical to one a person rejected is not proposed again (`skipped`, `rejected`).
One JSON line per fixture, then a summary. Exit 1 when any version failed (reported to Sentry with ids only)."""
from __future__ import annotations

import itertools
import json
from dataclasses import asdict, dataclass
from importlib import metadata
from typing import Any, Protocol

import sentry_sdk

from . import fixtures_runner as fr
from .engine import applicability, quantitative
from .engine.core import Node, Panel, facts_for
from .logs import get_logger, kv

log = get_logger(__name__)

OUTCOMES: tuple[fr.Outcome, ...] = ("passed", "failed", "withheld")
UNDETERMINED = "und"                           # the extraction's code for a language it could not tell
CLASSIFICATION_FIELDS = ("species", "life_stage", "product_class", "intended_use", "parnut_status", "format")
MAX_FACT_COMBINATIONS = 4096

# Reasons a fixture is not proposed.
SHAPE_NOT_DRAFTED = "shape_not_drafted"         # judging it needs a model or the additive register
PARAMS_INCOMPLETE = "params_incomplete"         # the params give nothing to build the input from
NO_LINKED_TERM = "no_linked_term"               # no accepted register entry in a language of the node
APPLICABILITY_UNSATISFIED = "applicability_unsatisfied"   # no facts named by the predicate make the rule apply
ENGINE_DISAGREED = "engine_disagreed"           # the engine's outcome is not the one the fixture expects
REJECTED = "rejected"                           # a person rejected this same fixture


@dataclass(frozen=True)
class Version:
    rule_key: str
    version: int
    shape: str
    node_id: str
    params: dict[str, Any]
    applicability: dict[str, Any]


@dataclass(frozen=True)
class Existing:
    status: str
    expected_outcome: str
    input: dict[str, Any]
    expected: dict[str, Any] | None


@dataclass(frozen=True)
class Proposal:
    name: str
    input: dict[str, Any]
    expected_outcome: fr.Outcome
    expected: dict[str, Any] | None


@dataclass
class Result:
    rule_key: str
    version: int
    outcome: str | None
    status: str                     # stored · drafted (dry run) · unchanged · skipped · failed
    reason: str | None = None
    fixture_id: str | None = None
    node: str | None = None
    language: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


class DraftStore(Protocol):
    def versions(self, rule_key: str | None) -> list[Version]: ...
    def nodes(self, node_id: str) -> list[Node]: ...
    def terms(self) -> dict[tuple[str, str], list[str]]: ...
    def lock(self, v: Version) -> None: ...
    def existing(self, v: Version) -> list[Existing]: ...
    def insert(self, v: Version, p: Proposal, runner: str) -> str: ...


def runner_name() -> str:
    try:
        version = metadata.version("nutrivo-worker")
    except metadata.PackageNotFoundError:
        version = "unknown"
    return f"nutrivo-worker {version} fixtures_draft"


# ─── Building inputs from the version's own params ───────────────────────────────────────────────
def _keys(params: dict[str, Any], shape: str) -> list[str]:
    if shape == "prescribed_wording":
        k = params.get("term_key")
        return [k] if isinstance(k, str) and k else []
    detect = params.get("detect")
    keys = detect.get("term_keys") if isinstance(detect, dict) else None
    return [k for k in keys if isinstance(k, str) and k] if isinstance(keys, list) else []


def _wording(terms: dict[tuple[str, str], list[str]], keys: list[str], language: str) -> str | None:
    for k in keys:
        for t in terms.get((k, language), ()):
            if t and t.strip():
                return t
    return None


def _predicate_values(predicate: Any, out: dict[str, list[Any]]) -> None:
    """Every value the predicate compares a classification field with, in the order it names them."""
    if not isinstance(predicate, dict) or len(predicate) != 1:
        return
    (op, arg), = predicate.items()
    if op in ("all", "any") and isinstance(arg, list):
        for p in arg:
            _predicate_values(p, out)
    elif op == "not":
        _predicate_values(arg, out)
    elif op in ("eq", "in") and isinstance(arg, list) and len(arg) == 2 and arg[0] in CLASSIFICATION_FIELDS:
        values = [arg[1]] if op == "eq" else (arg[1] if isinstance(arg[1], list) else [])
        seen = out.setdefault(arg[0], [])
        seen.extend(v for v in values if v not in seen and isinstance(v, str | int | float | bool))


def applicable_facts(predicate: dict[str, Any], node: Node, language: str) -> dict[str, Any] | None:
    """The fewest classification facts, each a value the predicate names, under which the rule applies on this node
    and panel language; None when there are none (a field with no named value is never filled in)."""
    named: dict[str, list[Any]] = {}
    _predicate_values(predicate, named)
    fields = sorted(named)
    options = [[None, *named[f]] for f in fields]
    combos = sorted(itertools.islice(itertools.product(*options), MAX_FACT_COMBINATIONS),
                    key=lambda c: sum(v is not None for v in c))
    for combo in combos:
        facts = {f: v for f, v in zip(fields, combo, strict=True) if v is not None}
        try:
            if applicability.evaluate(predicate, facts_for(facts, node, Panel(0, language, "extracted"))) is True:
                return facts
        except applicability.InvalidPredicate:
            return None
    return None


def _panel(language: str, text_objects: list[dict[str, Any]]) -> dict[str, Any]:
    return {"index": 0, "language": language, "status": "extracted", "text_objects": text_objects}


def _base(node: Node, facts: dict[str, Any]) -> dict[str, Any]:
    classification = {k: v for k, v in facts.items() if k != "format"}
    return {"node": {"id": node.id, "languages": list(node.languages), "region": node.region},
            "classification": classification, "product": {"format": facts.get("format")}}


def _quantity_in_band(bands: list[dict[str, Any]], band: dict[str, Any]) -> dict[str, Any] | None:
    """A quantity, from the band's own bounds, that selects exactly this band; None when no bound does."""
    unit = band.get("quantity_unit")
    for bound in (band.get("quantity_from"), band.get("quantity_to")):
        if isinstance(bound, int | float) and not isinstance(bound, bool) and isinstance(unit, str) and unit:
            q = {"value": float(bound), "unit": unit}
            try:
                if quantitative._band(bands, q) is band:
                    return q
            except quantitative.InvalidParams:
                return None                     # bands the engine cannot read: params_incomplete
    return None


def _condition_value(operator: str, value: float) -> float | None:
    """A quantity that meets the rule's own condition, derived from the rule's own value only."""
    if operator in ("eq", "ge", "le"):
        return value
    if operator == "gt":
        return value * 2 if value > 0 else value + 1
    if operator == "lt":
        return value / 2 if value > 0 else value - 1
    return None


def _shape_inputs(v: Version, wording: str, language: str) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """(passed panel and product additions, failed panel and product additions) for the shape, or a skip reason."""
    p = v.params
    if v.shape in ("mandatory_particular", "prescribed_wording"):
        return ({"panel": _panel(language, [{"text": wording}])}, {"panel": _panel(language, [])})
    if v.shape == "threshold":
        op, value, unit, quantity = p.get("operator"), p.get("value"), p.get("unit"), p.get("quantity")
        if (not isinstance(value, int | float) or isinstance(value, bool) or not isinstance(unit, str)
                or not isinstance(quantity, str) or not quantity):
            return PARAMS_INCOMPLETE
        at = _condition_value(op, float(value)) if isinstance(op, str) else None
        if at is None:
            return PARAMS_INCOMPLETE
        product = {"quantities": {quantity: {"value": at, "unit": unit}}}
        return ({"panel": _panel(language, [{"text": wording}]), "product": product},
                {"panel": _panel(language, []), "product": product})
    if v.shape == "character_height":
        column = {"x_height": "x_height_mm", "cap_height": "cap_height_mm"}.get(p.get("height_definition"))
        bands = p.get("bands")
        if column is None or not isinstance(bands, list) or not bands or not isinstance(bands[0], dict):
            return PARAMS_INCOMPLETE
        band = bands[0]
        minimum = band.get("min_height_mm")
        if not isinstance(minimum, int | float) or isinstance(minimum, bool) or minimum <= 0:
            return PARAMS_INCOMPLETE
        open_single = len(bands) == 1 and band.get("quantity_from") is None and band.get("quantity_to") is None
        quantity = None if open_single else _quantity_in_band(bands, band)
        if not open_single and quantity is None:
            return PARAMS_INCOMPLETE
        product = {"quantity": quantity} if quantity else {}
        return ({"panel": _panel(language, [{"text": wording, column: float(minimum)}]), "product": product},
                {"panel": _panel(language, [{"text": wording, column: float(minimum) / 2}]), "product": product})
    return SHAPE_NOT_DRAFTED


def proposals(v: Version, nodes: list[Node], terms: dict[tuple[str, str], list[str]]) \
        -> tuple[list[Proposal], Node | None, str | None] | str:
    """Passed, failed and withheld proposals for the first node and language the version can be drafted in, or the
    reason it cannot be."""
    if v.shape not in ("mandatory_particular", "prescribed_wording", "threshold", "character_height"):
        return SHAPE_NOT_DRAFTED
    keys = _keys(v.params, v.shape)
    if not keys:
        return PARAMS_INCOMPLETE
    reason = NO_LINKED_TERM
    for node in nodes:
        for language in node.languages:
            wording = _wording(terms, keys, language)
            if wording is None:
                continue
            facts = applicable_facts(v.applicability or {"all": []}, node, language)
            if facts is None:
                reason = APPLICABILITY_UNSATISFIED
                continue
            built = _shape_inputs(v, wording, language)
            if isinstance(built, str):
                return built
            passed, failed = built
            base = _base(node, facts)

            def merged(extra: dict[str, Any], base: dict[str, Any] = base) -> dict[str, Any]:
                return {**base, **extra, "product": {**base["product"], **extra.get("product", {})}}

            withheld = merged({**passed, "panel": {**passed["panel"], "language": UNDETERMINED}})
            where = f"{language}, {node.id}"
            return ([Proposal(f"drafted passed ({where})", merged(passed), "passed", None),
                     Proposal(f"drafted failed ({where})", merged(failed), "failed",
                              {"findings": [{"rule_key": v.rule_key}]}),
                     Proposal(f"drafted withheld, language undetermined ({where})", withheld, "withheld",
                              {"reason": "data_missing"})], node, language)
    return reason


# ─── The engine decides whether a proposal is stored ─────────────────────────────────────────────
@dataclass
class _One:
    """A FixtureStore holding one fixture, so it is judged exactly as `nutrivo fixtures run` judges it."""

    fixture: fr.RuleFixture

    def members(self, ruleset_version: str) -> list[fr.Member]:
        return [fr.Member(self.fixture.rule_key, self.fixture.version, self.fixture.shape)]

    def fixtures(self, ruleset_version: str) -> list[fr.RuleFixture]:
        return [self.fixture]


def engine_agrees(v: Version, p: Proposal, terms: dict[tuple[str, str], list[str]]) -> tuple[bool, str | None]:
    """Whether the engine's outcome for the proposal is its expected outcome, and what the engine said when not."""
    fixture = fr.RuleFixture("proposed", v.rule_key, v.version, v.shape, p.name, p.input, p.expected_outcome,
                             p.expected, v.params, v.applicability or {"all": []}, terms)
    (result,) = fr.run_rule_fixtures(_One(fixture), "fixtures-draft")
    if result.result == "matched":
        return True, None
    actual = result.actual or {}
    return False, f"{actual.get('outcome', result.result)}:{actual.get('reason') or result.reason or ''}".rstrip(":")


# ─── The run ─────────────────────────────────────────────────────────────────────────────────────
def _same(e: Existing, p: Proposal) -> bool:
    return (e.expected_outcome == p.expected_outcome and e.input == p.input
            and (e.expected or None) == (p.expected or None))


def draft_version(store: DraftStore, v: Version, terms: dict[tuple[str, str], list[str]], *, dry_run: bool,
                  runner: str) -> list[Result]:
    built = proposals(v, store.nodes(v.node_id), terms)
    if isinstance(built, str):
        return [Result(v.rule_key, v.version, None, "skipped", built)]
    props, node, language = built
    where = {"node": node.id if node else None, "language": language}
    if not dry_run:
        store.lock(v)                   # held until the caller's transaction ends
    existing = store.existing(v)
    out: list[Result] = []
    for p in props:
        held = {e.status for e in existing if e.expected_outcome == p.expected_outcome}
        if "confirmed" in held or "proposed" in held:
            out.append(Result(v.rule_key, v.version, p.expected_outcome, "unchanged",
                              "confirmed" if "confirmed" in held else "proposed", **where))
            continue
        if any(e.status == "rejected" and _same(e, p) for e in existing):
            out.append(Result(v.rule_key, v.version, p.expected_outcome, "skipped", REJECTED, **where))
            continue
        agrees, said = engine_agrees(v, p, terms)
        if not agrees:
            out.append(Result(v.rule_key, v.version, p.expected_outcome, "skipped", f"{ENGINE_DISAGREED}:{said}",
                              **where))
            continue
        if dry_run:
            out.append(Result(v.rule_key, v.version, p.expected_outcome, "drafted", **where))
            continue
        fixture_id = store.insert(v, p, runner)
        out.append(Result(v.rule_key, v.version, p.expected_outcome, "stored", fixture_id=fixture_id, **where))
    return out


def run(store: DraftStore, rule_key: str | None = None, *, dry_run: bool = False,
        transaction: Any = None) -> list[Result]:
    """Every accepted version still missing a confirmed outcome. `transaction()` (a context manager) wraps each
    version, so its lock, reads and inserts commit together; a failed version is reported and the run goes on."""
    terms = store.terms()
    runner = runner_name()
    results: list[Result] = []
    for v in store.versions(rule_key):
        try:
            if transaction is None:
                results += draft_version(store, v, terms, dry_run=dry_run, runner=runner)
            else:
                with transaction():
                    results += draft_version(store, v, terms, dry_run=dry_run, runner=runner)
        except Exception as exc:  # noqa: BLE001  one version's fault is a visible failure, never a silent skip
            sentry_sdk.capture_exception(exc)
            log.warning("fixture draft failed", extra=kv(rule_key=v.rule_key, version=v.version,
                                                         error=type(exc).__name__))
            results.append(Result(v.rule_key, v.version, None, "failed", type(exc).__name__))
    return results


class PgDraftStore:
    """Accepted rule versions, nodes and the unpinned accepted register; proposed fixtures are inserted as the
    worker's role (the service role), never confirmed here."""

    def __init__(self, conn: Any):
        self.conn = conn

    def versions(self, rule_key: str | None) -> list[Version]:
        rows = self.conn.execute(
            """select rv.rule_key, rv.version, r.shape, r.node_id, rv.params, rv.applicability
                 from ref.rule_versions rv join ref.rules r on r.rule_key = rv.rule_key
                where rv.status = 'accepted' and (%(key)s::text is null or rv.rule_key = %(key)s)
                  and (select count(distinct f.expected_outcome) from ref.rule_fixtures f
                        where f.rule_key = rv.rule_key and f.version = rv.version and f.status = 'confirmed') < 3
                order by rv.rule_key, rv.version""", {"key": rule_key}).fetchall()
        return [Version(r["rule_key"], r["version"], r["shape"], r["node_id"], r["params"] or {},
                        r["applicability"] or {"all": []}) for r in rows]

    def nodes(self, node_id: str) -> list[Node]:
        rows = self.conn.execute(
            """select j.id, j.node_type, j.parent_id, j.languages, j.id = %(n)s as own
                 from ref.jurisdictions j where j.id = %(n)s or j.parent_id = %(n)s
                order by (j.id = %(n)s) desc, j.id""", {"n": node_id}).fetchall()
        out = [Node(r["id"], tuple(r["languages"] or ()), r["id"] if r["node_type"] == "region" else r["parent_id"])
               for r in rows]
        own = [n for n in out if n.id == node_id and n.languages]
        return own or [n for n in out if n.id != node_id]

    def terms(self) -> dict[tuple[str, str], list[str]]:
        rows = self.conn.execute(
            """select term_key, language, term from ref.term_entries
                where status = 'accepted' and ruleset_version is null
                order by term_key, language, created_at, id""").fetchall()
        out: dict[tuple[str, str], list[str]] = {}
        for r in rows:
            out.setdefault((r["term_key"], r["language"]), []).append(r["term"])
        return out

    def lock(self, v: Version) -> None:
        self.conn.execute("select pg_advisory_xact_lock(hashtext(%s))",
                          (f"ref.rule_fixtures:{v.rule_key}:{v.version}",))

    def existing(self, v: Version) -> list[Existing]:
        rows = self.conn.execute(
            """select status, expected_outcome, input, expected from ref.rule_fixtures
                where rule_key = %s and version = %s""", (v.rule_key, v.version)).fetchall()
        return [Existing(r["status"], r["expected_outcome"], r["input"] or {}, r["expected"]) for r in rows]

    def insert(self, v: Version, p: Proposal, runner: str) -> str:
        row = self.conn.execute(
            """insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome, expected, status,
                                              proposed_by, proposed_at)
               values (%s, %s, %s, %s::jsonb, %s, %s::jsonb, 'proposed', %s, now()) returning id""",
            (v.rule_key, v.version, p.name, json.dumps(p.input), p.expected_outcome,
             json.dumps(p.expected) if p.expected is not None else None, runner)).fetchone()
        return str(row["id"])


def summary(results: list[Result]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    return counts
