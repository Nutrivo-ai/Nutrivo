# 05 · Rules engine

Classification first, then deterministic evaluation with citations, model judgement marked as such, and the
applied-rule set written onto every check event. The refusal is structural: no rule, no verdict.

## Rules are data
A rule is `ref.rules` (stable `rule_key`, `shape`, `domain`, `node_id`) plus accepted `ref.rule_versions` (`params`,
`applicability`, `article_ref`, verbatim `source_excerpt`, dates). A released `ref.ruleset_versions` row pins exactly
one version of each member rule. **A rule of an existing shape needs no code. A new shape is a new evaluator**
(BE-20; skill `new-rule-shape`).

## Shapes and their params (validated by JSON Schema at acceptance)
| Shape | Params (values always come from an extraction of a stored source) | Fails when |
|---|---|---|
| mandatory_particular | `particular`, `detect.term_keys` (from the term register), `scope` (each panel in a node language, or any panel) | The particular is absent from the panel |
| prescribed_wording | `term_key`, `alternatives`, `match` (exact, case-folded) | The printed wording differs from the term register entry for that language |
| threshold | `quantity`, `operator`, `value`, `unit`, `then` (what becomes required) | The condition holds and the consequence is missing |
| character_height | `target`, `height_definition` (x_height, cap_height or figure_height), `bands` (quantity range to minimum mm) | Measured height below the band minimum |
| additive_condition | `check` (authorised_for_species, within_max_content, declaration_required), register fields | The additive breaks its register conditions |
| claim_judgement | `question`, `criteria`, labelled `examples`, `min_confidence` | The model judges the claim not permitted with confidence ≥ min_confidence |

## Applicability
A small predicate language: `{"all": [...]}`, `{"any": [...]}`, `{"not": X}`, `{"eq": [field, value]}`,
`{"in": [field, [values]]}`, `{"has": field}`. Fields: species, life_stage, product_class, intended_use,
parnut_status, format, node_id, region, panel_language. **A missing field never evaluates to true or false: the
rule is withheld with `data_missing`.**

## Evaluating one check (node × panel)
1. Load the ruleset pinned on the job and the node's coverage rows at that ruleset.
2. For each domain whose coverage is not complete, emit a not_assessed finding with the domain's gap_id.
3. Select member rules held on the node or its region whose applicability is true for the confirmed classification,
   the product and this panel.
4. If the panel is not assessable, withhold every rule that reads panel text, using the panel's failure code.
5. Run each remaining rule's evaluator: passed (no finding), failed (finding `action`, provenance deterministic_rule
   or model_judgement), or withheld (finding `not_assessed` with a reason code).
6. label_state = action if anything failed; otherwise not_assessed if anything was withheld or any domain is
   incomplete; otherwise clear. The database refuses clear where coverage is incomplete (P0021).
7. Insert the `app.checks` row (applied, passed and withheld rule keys) and all findings in one transaction; then
   update `app.product_nodes` (label state, ruleset version, open actions).

## Claims (BE-22)
Judged on the printed target-language string of that panel, never translated. Each claim rule ships with an
evaluation set per language (docs/07-ai.md). Below `min_confidence`, or when the model abstains, the result is
withheld (`model_abstained`), never passed.

## Fixtures
`ref.rule_fixtures`: input (panel text objects, classification, formula), expected outcome (passed, failed, withheld)
and expected findings. `nutrivo fixtures run --ruleset <id>` must pass for every member before a release (K05).
Golden labels (`fixtures/golden/`) gate releases once there are 30 of them.
