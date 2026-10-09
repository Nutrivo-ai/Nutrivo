---
name: new-rule-shape
description: Adding an evaluator for a new rule shape (BE-20). Use only when a rule cannot be expressed with an existing shape.
---
A rule of an existing shape needs no code: it is params, applicability and fixtures (docs/05-rules-engine.md).
A new shape is an explicit decision:
1. Write the case in docs/05-rules-engine.md (why no existing shape can express it) and ask before continuing.
2. Migration: extend the shape check constraint on ref.rules.
3. Evaluator: worker/src/nutrivo_worker/engine/shapes/<shape>.py, evaluate(rule, context) -> Outcome
   (passed | failed | withheld, findings, reason_code).
4. JSON Schema for its params: worker/src/nutrivo_worker/engine/schemas/<shape>.json, validated at acceptance.
5. Unit tests and at least three fixtures (passed, failed, withheld) in ref.rule_fixtures format.
