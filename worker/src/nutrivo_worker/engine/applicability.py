"""The applicability predicate language (docs/05 §Applicability), evaluated with three values.

`{"all": [...]}`, `{"any": [...]}`, `{"not": X}`, `{"eq": [field, value]}`, `{"in": [field, [values]]}`,
`{"has": field}` over the fields in FIELDS. A missing field never evaluates to true or false: a comparison on it is
UNKNOWN, and a rule whose predicate is UNKNOWN is withheld with `data_missing`. `all` is false as soon as one part is
false and `any` true as soon as one part is true (Kleene logic), so a rule for dogs is simply not applicable to a cat
food whose life stage is unknown. `has` asks whether a field is present, so it is always true or false."""
from __future__ import annotations

from typing import Any, Literal

from ..errors import SafeError

Truth = Literal[True, False, "unknown"]
UNKNOWN: Truth = "unknown"
FIELDS = ("species", "life_stage", "product_class", "intended_use", "parnut_status", "format", "node_id", "region",
          "panel_language")


class InvalidPredicate(SafeError):
    """The applicability is not the docs/05 language: the rule is withheld, never applied by default."""


def _field(name: Any) -> str:
    if name not in FIELDS:
        raise InvalidPredicate(f"unknown applicability field {name!r}")
    return name


def _present(facts: dict[str, Any], name: str) -> bool:
    value = facts.get(name)
    return value is not None and value != ""


def evaluate(predicate: Any, facts: dict[str, Any]) -> Truth:
    if not isinstance(predicate, dict) or len(predicate) != 1:
        raise InvalidPredicate("a predicate is an object with exactly one operator")
    (op, arg), = predicate.items()
    if op in ("all", "any"):
        if not isinstance(arg, list):
            raise InvalidPredicate(f"{op} takes a list")
        parts = [evaluate(p, facts) for p in arg]
        decisive, other = (False, True) if op == "all" else (True, False)
        if decisive in parts:
            return decisive
        return UNKNOWN if UNKNOWN in parts else other
    if op == "not":
        inner = evaluate(arg, facts)
        return UNKNOWN if inner == UNKNOWN else not inner
    if op == "has":
        return _present(facts, _field(arg))
    if op in ("eq", "in"):
        if not isinstance(arg, list) or len(arg) != 2:
            raise InvalidPredicate(f"{op} takes [field, value]")
        name = _field(arg[0])
        if not _present(facts, name):
            return UNKNOWN
        if op == "eq":
            return facts[name] == arg[1]
        if not isinstance(arg[1], list):
            raise InvalidPredicate("in takes [field, [values]]")
        return facts[name] in arg[1]
    raise InvalidPredicate(f"unknown applicability operator {op!r}")
