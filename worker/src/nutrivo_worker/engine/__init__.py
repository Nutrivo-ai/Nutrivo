"""The rules engine (docs/05, D04): classification first, then deterministic evaluation with citations, model
judgement marked as such, and the applied, passed and withheld rule keys on every check. No rule, no verdict.

Importing this package registers the evaluators (engine.core.EVALUATORS, and fixtures_runner.EVALUATORS for the
fixture runner)."""
from . import evaluators  # noqa: F401  registers mandatory_particular and prescribed_wording
from .core import EVALUATORS, CheckResult, evaluate_check

__all__ = ["EVALUATORS", "CheckResult", "evaluate_check"]
