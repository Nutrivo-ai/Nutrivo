"""The claims evaluation harness (T-501, docs/07-ai.md "Evaluation before use").

A claim rule may join a ruleset only when, for every language it covers, the model's judgements agree with the human
labels at Cohen's kappa >= 0.8 on at least 50 cases and no prohibited case is judged permitted.

- Cases are versioned JSONL files, one per language: `worker/evals/claims/<lang>.jsonl` for human-labelled sets and
  `worker/evals/claims/synthetic/<lang>.jsonl` for the harness's own cases. A human-labelled case names a person
  (`labelled_by`) and where it comes from (`source`: a stored official source or accepted content); one without is
  refused. Synthetic cases test the harness, are not law, and never make a set eligible for the threshold.
- The rule's question, criteria, examples and min_confidence come from its rule version (`ref.rule_versions`, read
  only), or from the synthetic harness rule, never from this module or the prompt.
- Each case is judged on its printed string in its own language (CLAUDE.md 4) through `nutrivo_worker.models`. An
  abstention, a confidence below min_confidence or a model error is `withheld` (model_abstained or the error's reason
  code): its own category, which never agrees with a human label and is never counted as passed.
- Each run is a Langfuse dataset run (docs/17): one dataset per rule and language, one item per case, one trace per
  case holding the model's generation, a score per case and scores for the run. Without Langfuse keys nothing is
  sent; the report is the same."""
from __future__ import annotations

import contextlib
import hashlib
import json
import re
import urllib.parse
import uuid
from collections import Counter
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

import sentry_sdk
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import WORKER_ROOT
from ..errors import ModelError, SafeError
from ..logs import get_logger, kv

log = get_logger(__name__)

EVALS_DIR = WORKER_ROOT / "evals" / "claims"
SYNTHETIC_DIR = EVALS_DIR / "synthetic"
PURPOSE = "claim_judgement"
PROMPT_VERSION = "v1"
LABELS = ("permitted", "prohibited", "needs_evidence")
WITHHELD = "withheld"
MIN_CASES = 50
MIN_KAPPA = 0.8
_LANG = re.compile(r"^[a-z]{2}$")
# Langfuse ids derived from names, so a rerun of the same case upserts instead of duplicating.
_NAMESPACE = uuid.UUID("6f1c2a3e-5b0d-4e8a-9c71-2d5e0b9a4f10")

Label = Literal["permitted", "prohibited", "needs_evidence"]


class EvalSetInvalid(SafeError):
    reason = "eval_set_invalid"


class RuleSpecInvalid(SafeError):
    reason = "rule_spec_invalid"


# ── The model's answer ───────────────────────────────────────────────────────────────────────────────
class ClaimJudgement(BaseModel):
    """What the model may say about one printed claim: a judgement with confidence, or an abstention. No coverage,
    no rule, no verdict of its own (CLAUDE.md 6): the verdict is the rule's, under its rule_key."""

    model_config = ConfigDict(extra="forbid")
    abstain: bool
    judgement: Label | None
    confidence: float
    reason: str = Field(max_length=400)

    @field_validator("confidence")
    @classmethod
    def _unit_interval(cls, v: float) -> float:
        # Checked here rather than as minimum/maximum in the schema sent for structured outputs.
        if not 0.0 <= v <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        return v


# ── Cases ────────────────────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Case:
    id: str
    lang: str
    text: str             # the claim exactly as printed on the panel, never a translation
    label: str
    rule_key: str
    labelled_by: str | None
    source: str | None
    synthetic: bool

    @property
    def sha256(self) -> str:
        return hashlib.sha256(json.dumps([self.text, self.label], ensure_ascii=False).encode()).hexdigest()


def _norm(text: str) -> str:
    return " ".join(text.split()).casefold()


def load_cases(path: Path, *, synthetic: bool) -> list[Case]:
    """Every line validated; anything malformed refuses the whole file, so a set is never half-read."""
    lang = path.stem
    if not _LANG.match(lang):
        raise EvalSetInvalid(f"{path.name}: the file name must be a two-letter language code")
    cases: list[Case] = []
    seen_ids: set[str] = set()
    seen_texts: set[tuple[str, str]] = set()
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        where = f"{path.name}:{n}"
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            raise EvalSetInvalid(f"{where}: not JSON") from None
        if not isinstance(row, dict):
            raise EvalSetInvalid(f"{where}: not an object")
        unknown = set(row) - {"id", "text", "label", "rule_key", "labelled_by", "source", "synthetic", "lang",
                              "note"}
        if unknown:
            raise EvalSetInvalid(f"{where}: unknown fields {sorted(unknown)}")
        for key in ("id", "text", "label", "rule_key"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise EvalSetInvalid(f"{where}: {key} is required")
        if row["label"] not in LABELS:
            raise EvalSetInvalid(f"{where}: label must be one of {', '.join(LABELS)}")
        if row.get("lang", lang) != lang:
            raise EvalSetInvalid(f"{where}: lang differs from the file's language {lang}")
        if bool(row.get("synthetic", False)) != synthetic:
            raise EvalSetInvalid(f"{where}: synthetic and human-labelled cases are kept in separate files")
        if not synthetic:
            # Labels by people, from stored official sources or accepted content (CLAUDE.md 7, docs/07).
            for key in ("labelled_by", "source"):
                if not isinstance(row.get(key), str) or not row[key].strip():
                    raise EvalSetInvalid(f"{where}: a human-labelled case needs {key}")
        if row["id"] in seen_ids:
            raise EvalSetInvalid(f"{where}: duplicate id {row['id']}")
        if (row["rule_key"], _norm(row["text"])) in seen_texts:
            raise EvalSetInvalid(f"{where}: the same text is already a case for {row['rule_key']}")
        seen_ids.add(row["id"])
        seen_texts.add((row["rule_key"], _norm(row["text"])))
        cases.append(Case(row["id"], lang, row["text"], row["label"], row["rule_key"], row.get("labelled_by"),
                          row.get("source"), synthetic))
    return cases


# ── The rule under evaluation ────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class RuleSpec:
    rule_key: str
    version: int
    status: str            # the rule version's status; the harness never changes it
    question: str
    criteria: Any
    examples: tuple[dict[str, Any], ...]
    min_confidence: float
    synthetic: bool = False

    @classmethod
    def from_params(cls, rule_key: str, version: int, status: str, params: dict[str, Any], *,
                    synthetic: bool = False) -> RuleSpec:
        """The claim_judgement params (docs/05): question, criteria, labelled examples, min_confidence."""
        question, criteria = params.get("question"), params.get("criteria")
        if not isinstance(question, str) or not question.strip():
            raise RuleSpecInvalid(f"{rule_key} v{version}: params.question is missing")
        if not criteria or not isinstance(criteria, str | list):
            raise RuleSpecInvalid(f"{rule_key} v{version}: params.criteria is missing")
        mc = params.get("min_confidence")
        if isinstance(mc, bool) or not isinstance(mc, int | float) or not 0.0 < mc <= 1.0:
            raise RuleSpecInvalid(f"{rule_key} v{version}: params.min_confidence must be in (0, 1]")
        examples = params.get("examples") or []
        if not isinstance(examples, list) or not all(
                isinstance(e, dict) and isinstance(e.get("text"), str) and e.get("label") in LABELS
                for e in examples):
            raise RuleSpecInvalid(f"{rule_key} v{version}: params.examples must be labelled texts")
        return cls(rule_key, version, status, question, criteria, tuple(examples), float(mc), synthetic)

    def examples_for(self, lang: str) -> list[dict[str, Any]]:
        """Examples printed in this language, or with no language given: the model is shown the target language,
        never a translation."""
        return [e for e in self.examples if e.get("lang", lang) == lang]


def load_synthetic_rule(directory: Path = SYNTHETIC_DIR) -> RuleSpec:
    data = json.loads((directory / "rule.json").read_text(encoding="utf-8"))
    if data.get("synthetic") is not True:
        raise RuleSpecInvalid("the synthetic harness rule must say synthetic: true")
    return RuleSpec.from_params(data["rule_key"], int(data["version"]), "synthetic", data["params"], synthetic=True)


class RuleReader(Protocol):
    def claim_rule(self, rule_key: str, version: int | None) -> RuleSpec | None: ...


class PgRuleReader:
    """Reads a claim_judgement rule version, never writes. A rejected version is never evaluated."""

    def __init__(self, conn: Any):
        self.conn = conn

    def claim_rule(self, rule_key: str, version: int | None) -> RuleSpec | None:
        row = self.conn.execute(
            """select v.rule_key, v.version, v.status, v.params
                 from ref.rule_versions v join ref.rules r on r.rule_key = v.rule_key
                where v.rule_key = %(key)s and r.shape = 'claim_judgement' and v.status <> 'rejected'
                  and (%(version)s::int is null or v.version = %(version)s::int)
                order by v.version desc limit 1""", {"key": rule_key, "version": version}).fetchone()
        if row is None:
            return None
        return RuleSpec.from_params(row["rule_key"], row["version"], row["status"], row["params"] or {})


# ── Judging one case ─────────────────────────────────────────────────────────────────────────────────
@dataclass
class CaseResult:
    id: str
    label: str
    predicted: str                 # a label, or "withheld"
    reason: str | None = None      # the withheld reason code
    confidence: float | None = None
    input_hash: str | None = None
    model_id: str | None = None

    @property
    def agrees(self) -> bool:
        return self.predicted == self.label


def judge(models: Any, spec: RuleSpec, case: Case, *, prompt_version: str = PROMPT_VERSION) -> CaseResult:
    """One call through nutrivo_worker.models on the printed string. Abstaining, falling short of min_confidence or
    failing is withheld; withheld is never passed."""
    inputs = {"claim_text": case.text, "panel_language": case.lang, "question": spec.question,
              "criteria": spec.criteria, "examples": spec.examples_for(case.lang)}
    try:
        r = models.call_full(PURPOSE, prompt_version, inputs, ClaimJudgement)
    except ModelError as exc:
        return CaseResult(case.id, case.label, WITHHELD, exc.reason)
    out: ClaimJudgement = r.output
    if out.abstain or out.judgement is None or out.confidence < spec.min_confidence:
        return CaseResult(case.id, case.label, WITHHELD, "model_abstained", out.confidence, r.input_hash, r.model_id)
    return CaseResult(case.id, case.label, out.judgement, None, out.confidence, r.input_hash, r.model_id)


# ── Agreement ────────────────────────────────────────────────────────────────────────────────────────
def cohen_kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Cohen's kappa of (human, model) pairs over the labels plus withheld. None when undefined: no pairs, or chance
    agreement of 1 (both raters always gave one and the same category), which is never read as agreement."""
    n = len(pairs)
    if n == 0:
        return None
    observed = sum(h == m for h, m in pairs) / n
    human, model = Counter(h for h, _ in pairs), Counter(m for _, m in pairs)
    expected = sum(human[c] * model[c] for c in (*LABELS, WITHHELD)) / (n * n)
    if expected >= 1.0:
        return None
    return (observed - expected) / (1.0 - expected)


@dataclass
class LanguageResult:
    rule_key: str
    rule_version: int
    lang: str
    synthetic: bool
    dataset: str
    n: int
    agreement: float | None
    kappa: float | None
    withheld: int
    prohibited_judged_permitted: int
    passed: bool
    reasons: list[str]
    excluded: list[dict[str, str]] = field(default_factory=list)
    cases: list[CaseResult] = field(default_factory=list)
    dataset_run_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["note"] = "synthetic harness cases, not law" if self.synthetic else None
        return d


def gate(results: list[CaseResult], *, synthetic: bool) -> tuple[float | None, float | None, int, int, bool,
                                                                  list[str]]:
    pairs = [(r.label, r.predicted) for r in results]
    kappa = cohen_kappa(pairs)
    agreement = sum(r.agrees for r in results) / len(results) if results else None
    withheld = sum(r.predicted == WITHHELD for r in results)
    pjp = sum(r.label == "prohibited" and r.predicted == "permitted" for r in results)
    reasons = []
    if synthetic:
        reasons.append("synthetic_set")
    if len(results) < MIN_CASES:
        reasons.append("too_few_cases")
    if kappa is None:
        reasons.append("kappa_undefined")
    elif kappa < MIN_KAPPA:
        reasons.append("kappa_below_threshold")
    if pjp:
        reasons.append("prohibited_judged_permitted")
    return agreement, kappa, withheld, pjp, not reasons, reasons


# ── Langfuse dataset runs ────────────────────────────────────────────────────────────────────────────
class Recorder(Protocol):
    def ensure_dataset(self, name: str, metadata: dict[str, Any]) -> None: ...
    def upsert_item(self, dataset: str, item_id: str, case: Case, metadata: dict[str, Any]) -> None: ...
    def case_trace(self, name: str, metadata: dict[str, Any]) -> contextlib.AbstractContextManager[
        tuple[str, str | None]]: ...
    def link(self, run_name: str, item_id: str, trace_id: str, observation_id: str | None,
             metadata: dict[str, Any]) -> str | None: ...
    def score(self, score_id: str, name: str, value: float | str, data_type: str, *, trace_id: str | None = None,
              dataset_run_id: str | None = None, comment: str | None = None) -> None: ...


class LangfuseRecorder:
    """Through the Langfuse Python SDK v4 client that `observability` configures (docs/17): case traces are OTel
    spans like every job trace, and datasets, run items and scores go to the REST endpoints (/api/public/v2/datasets,
    /api/public/dataset-items, /api/public/dataset-run-items, /api/public/scores), never the retiring v3 ingestion
    API. With `send` off (no keys: CI, local runs) nothing leaves the process. A failed request is counted, reported
    to Sentry by type, and makes the run's recording incomplete; it never changes a judgement."""

    def __init__(self, client: Any, *, send: bool):
        self.client, self.send, self.failures = client, send, 0

    def _failed(self, what: str, exc: Exception) -> None:
        self.failures += 1
        sentry_sdk.capture_message(f"langfuse {what} failed ({type(exc).__name__})", level="error")
        log.warning("langfuse request failed", extra=kv(what=what, error=type(exc).__name__))

    def _api(self, what: str, fn: Any, **kwargs: Any) -> Any:
        if not self.send:
            return None
        try:
            return fn(**kwargs)
        except Exception as exc:  # noqa: BLE001  a recording failure is visible in the report, never silent
            self._failed(what, exc)
            return None

    def ensure_dataset(self, name: str, metadata: dict[str, Any]) -> None:
        """Read first, create on 404: creating is not documented as an upsert. Names hold slashes (Langfuse shows
        them as folders), so the path segment is quoted as the SDK's own get_dataset does."""
        if not self.send:
            return
        try:
            self.client.api.datasets.get(dataset_name=urllib.parse.quote(name, safe=""))
            return
        except Exception as exc:  # noqa: BLE001  anything but 404 is a recording failure
            if getattr(exc, "status_code", None) != 404:
                self._failed("dataset", exc)
                return
        self._api("dataset", lambda **kw: self.client.api.datasets.create(**kw), name=name, metadata=metadata,
                  description="Claim judgement evaluation set (docs/07-ai.md)")

    def upsert_item(self, dataset: str, item_id: str, case: Case, metadata: dict[str, Any]) -> None:
        self._api("dataset item", lambda **kw: self.client.api.dataset_items.create(**kw), dataset_name=dataset,
                  id=item_id, input={"claim_text": case.text, "panel_language": case.lang},
                  expected_output={"label": case.label}, metadata=metadata)

    @contextlib.contextmanager
    def case_trace(self, name: str, metadata: dict[str, Any]) -> Iterator[tuple[str, str | None]]:
        from langfuse import Langfuse, propagate_attributes

        trace_id = Langfuse.create_trace_id(seed=name)
        with self.client.start_as_current_observation(trace_context={"trace_id": trace_id}, name=name,
                                                      as_type="span", metadata=metadata) as span, \
                propagate_attributes(trace_name=name, metadata=metadata):
            yield trace_id, getattr(span, "id", None)

    def link(self, run_name: str, item_id: str, trace_id: str, observation_id: str | None,
             metadata: dict[str, Any]) -> str | None:
        kwargs: dict[str, Any] = {"run_name": run_name, "dataset_item_id": item_id, "trace_id": trace_id,
                                  "metadata": metadata,
                                  "run_description": "claims evaluation harness (T-501), docs/07-ai.md"}
        if observation_id:
            kwargs["observation_id"] = observation_id
        item = self._api("dataset run item", lambda **kw: self.client.api.dataset_run_items.create(**kw), **kwargs)
        return getattr(item, "dataset_run_id", None)

    def score(self, score_id: str, name: str, value: float | str, data_type: str, *, trace_id: str | None = None,
              dataset_run_id: str | None = None, comment: str | None = None) -> None:
        kwargs: dict[str, Any] = {"id": score_id, "name": name, "value": value, "data_type": data_type}
        if trace_id:
            kwargs["trace_id"] = trace_id
        if dataset_run_id:
            kwargs["dataset_run_id"] = dataset_run_id
        if comment:
            kwargs["comment"] = comment
        self._api("score", lambda **kw: self.client.api.scores.create(**kw), **kwargs)


def _id(*parts: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, ":".join(parts)))


def dataset_name(spec: RuleSpec, lang: str) -> str:
    return f"claims/{spec.rule_key}/{lang}"


def run_language(models: Any, spec: RuleSpec, cases: list[Case], lang: str, recorder: Recorder, run_name: str, *,
                 prompt_version: str = PROMPT_VERSION) -> LanguageResult:
    dataset = dataset_name(spec, lang)
    mine = [c for c in cases if c.rule_key == spec.rule_key and c.lang == lang]
    # A case that is also one of the rule's own examples would be graded on what the model was shown.
    shown = {_norm(e["text"]) for e in spec.examples_for(lang)}
    excluded = [{"id": c.id, "reason": "example_overlap"} for c in mine if _norm(c.text) in shown]
    scored = [c for c in mine if _norm(c.text) not in shown]
    recorder.ensure_dataset(dataset, {"rule_key": spec.rule_key, "lang": lang, "synthetic": spec.synthetic})
    run_meta = {"rule_key": spec.rule_key, "rule_version": spec.version, "rule_status": spec.status, "lang": lang,
                "prompt_version": f"{PURPOSE}.{prompt_version}", "min_confidence": spec.min_confidence,
                "synthetic": spec.synthetic}
    results: list[CaseResult] = []
    run_id: str | None = None
    for case in scored:
        item_id = _id(dataset, case.id, case.sha256)
        # Never the labeller's name: names and emails do not go to Langfuse (docs/17), and item metadata cannot be
        # withdrawn once upserted.
        recorder.upsert_item(dataset, item_id, case, {"case_id": case.id, "synthetic": case.synthetic,
                                                      "source": case.source})
        trace_name = f"eval:claims:{spec.rule_key}:{lang}:{case.id}:{run_name}"
        with recorder.case_trace(trace_name, {"case_id": case.id, "rule_key": spec.rule_key, "lang": lang,
                                              "run_name": run_name}) as (trace_id, observation_id):
            result = judge(models, spec, case, prompt_version=prompt_version)
        results.append(result)
        run_id = recorder.link(run_name, item_id, trace_id, observation_id, run_meta) or run_id
        recorder.score(_id(run_name, dataset, case.id, "agreement"), "agreement", 1.0 if result.agrees else 0.0,
                       "BOOLEAN", trace_id=trace_id)
        recorder.score(_id(run_name, dataset, case.id, "outcome"), "outcome", result.predicted, "CATEGORICAL",
                       trace_id=trace_id, comment=result.reason)
        log.info("claim case judged", extra=kv(rule_key=spec.rule_key, lang=lang, case_id=case.id,
                                               predicted=result.predicted, agrees=result.agrees,
                                               input_hash=result.input_hash))
    agreement, kappa, withheld, pjp, passed, reasons = gate(results, synthetic=spec.synthetic)
    if run_id:
        run_scores: list[tuple[str, float, str]] = [
            ("n", float(len(results)), "NUMERIC"), ("withheld", float(withheld), "NUMERIC"),
            ("prohibited_judged_permitted", float(pjp), "NUMERIC"),
            ("threshold_passed", 1.0 if passed else 0.0, "BOOLEAN")]
        if kappa is not None:
            run_scores.append(("kappa", kappa, "NUMERIC"))
        if agreement is not None:
            run_scores.append(("agreement", agreement, "NUMERIC"))
        for name, value, data_type in run_scores:
            recorder.score(_id(run_name, dataset, "run", name), name, value, data_type, dataset_run_id=run_id,
                           comment=(",".join(reasons) or None) if name == "threshold_passed" else None)
    return LanguageResult(spec.rule_key, spec.version, lang, spec.synthetic, dataset, len(results), agreement, kappa,
                          withheld, pjp, passed, reasons, excluded, results, run_id)


@dataclass
class Report:
    rule_key: str
    rule_version: int
    rule_status: str
    synthetic: bool
    prompt_version: str
    run_name: str
    languages: list[LanguageResult]
    langfuse_sent: bool
    langfuse_failures: int

    @property
    def passed(self) -> bool:
        """Every language meets the threshold. A synthetic run never passes: it is not a human-labelled set."""
        return bool(self.languages) and all(r.passed for r in self.languages)

    @property
    def complete(self) -> bool:
        """Every case was judged or withheld with a reason, and the Langfuse record (when sent) is whole."""
        return bool(self.languages) and all(r.n for r in self.languages) and self.langfuse_failures == 0

    def to_dict(self) -> dict[str, Any]:
        models_seen = sorted({c.model_id for r in self.languages for c in r.cases if c.model_id})
        return {"rule_key": self.rule_key, "rule_version": self.rule_version, "rule_status": self.rule_status,
                "synthetic": self.synthetic, "prompt_version": self.prompt_version, "run_name": self.run_name,
                "models": models_seen, "threshold": {"min_cases": MIN_CASES, "min_kappa": MIN_KAPPA,
                                                     "prohibited_judged_permitted": 0},
                "passed": self.passed, "complete": self.complete,
                "langfuse": {"sent": self.langfuse_sent, "failures": self.langfuse_failures},
                "languages": [r.as_dict() for r in self.languages]}


def run(models: Any, spec: RuleSpec, cases_by_lang: dict[str, list[Case]], recorder: Recorder, *,
        prompt_version: str = PROMPT_VERSION, now: datetime | None = None) -> Report:
    started = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    run_name = f"{spec.rule_key}@v{spec.version} {PURPOSE}.{prompt_version} {started}"
    if any(c.synthetic != spec.synthetic for cs in cases_by_lang.values() for c in cs):
        raise EvalSetInvalid("synthetic cases run only against the synthetic harness rule, and the reverse")
    results = [run_language(models, spec, cases_by_lang[lang], lang, recorder, run_name,
                            prompt_version=prompt_version) for lang in sorted(cases_by_lang)]
    sent = bool(getattr(recorder, "send", False))
    return Report(spec.rule_key, spec.version, spec.status, spec.synthetic, f"{PURPOSE}.{prompt_version}", run_name,
                  results, sent, int(getattr(recorder, "failures", 0)))


def load_sets(directory: Path, languages: list[str], *, synthetic: bool) -> dict[str, list[Case]]:
    out: dict[str, list[Case]] = {}
    for lang in languages:
        path = directory / f"{lang}.jsonl"
        if not path.is_file():
            raise EvalSetInvalid(f"no evaluation set {path.name} in {directory.name}/")
        out[lang] = load_cases(path, synthetic=synthetic)
    return out
