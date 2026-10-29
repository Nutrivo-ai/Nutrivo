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

### The engine (T-403)
`nutrivo_worker.engine` runs the steps above for the `check` job (docs/04 §Worker jobs). The choices below were made
while the questions on #45 are open; each is the conservative option.
- **Applicability** is three-valued (Kleene logic):
  - `all` is false as soon as one part is false, and `any` is true as soon as one part is true;
  - a comparison on a missing field is unknown, and an unknown predicate withholds the rule with `data_missing`;
  - an unconfirmed classification counts as missing;
  - a predicate outside the language withholds the rule with `evaluator_error`.
- **Panels.**
  - Each market is checked on every panel of the latest finished extraction, one `app.checks` row per panel.
  - A panel where nothing applied is not_assessed, never clear.
  - A market's label state is the state of its worst panel.
- **mandatory_particular** reads `detect.term_keys` and `scope`: `each_panel_in_node_language` (the default) or
  `any_panel`.
- **prescribed_wording** reads `term_key`, `alternatives` (a list, or a map of language to list) and `match`:
  `case_folded` (the default) or `exact`. It is judged only on panels printed in one of the node's languages.
- **Matching** compares NFC text with whitespace collapsed.
- **Terms** are the accepted `ref.term_entries` in the panel's language that are pinned to the ruleset; when none
  are pinned to it, the ones pinned to no ruleset.
- **Missing params.** The K02 extraction stores only `particular` and `conditions`, or `wordings` and
  `alternatives`. A rule without the params above, or with no term in the panel's language, is withheld with
  `data_missing`. It is never matched on other wording.
- **Withholds.**
  - A shape with no evaluator yet gives `evaluator_missing`. `claim_judgement` has none until T-503.
  - An evaluator fault gives `evaluator_error` and is reported to Sentry.
  - A model error from `nutrivo_worker.models` keeps its own reason: `model_unavailable`, `model_refused` or
    `model_output_invalid`.
- **Fixtures.**
  - Importing the engine registers both evaluators in `fixtures_runner.EVALUATORS`.
  - A rule fixture's `input` is `{panel, panels?, node: {id, languages, region}, classification, product: {format}}`.
    A panel is `{index, language, status, failure_code, text_objects: [{text}]}`.
  - Params, applicability and terms come from the pinned rule version and the register, never from the input.
  - A rule that does not apply to the input is reported withheld with `not_applicable`.
  - `LABEL_EVALUATOR` stays unset, because synthetic wording is never in the register (#36, #45).

## Claims (BE-22)
Judged on the printed target-language string of that panel, never translated. Each claim rule ships with an
evaluation set per language (docs/07-ai.md). Below `min_confidence`, or when the model abstains, the result is
withheld (`model_abstained`), never passed.

## Fixtures
`ref.rule_fixtures`: input (panel text objects, classification, formula), expected outcome (passed, failed, withheld)
and expected findings. `nutrivo fixtures run --ruleset <id>` must pass for every member before a release (K05).
Golden labels (`fixtures/golden/`) gate releases once there are 30 of them.

### The release gate (T-204)
A release is prepared as a draft (`ref.ruleset_drafts`, with members and coverage). The fixture runner records each
run against a draft in `ref.fixture_runs` (insert-only, service role only; the latest is the last inserted) with
`passed`, `rule_fixtures_ran` and the draft's digest, `private.ruleset_draft_digest(draft)`: every member's version and the content of its fixtures. A run
that judged no fixture cannot be recorded as passed. `app.release_ruleset` refuses (P0039) unless every member has
passed, failed and withheld fixtures and the draft's latest run passed, judged every one of them and still matches the
digest, so a fixture or member changed after the run
needs a new run. Until the runner resolves draft ids (worker follow-up, #34) and labels can be judged (#36), nothing can be
released: that is intended.

### The runner (T-206)
`nutrivo fixtures run --ruleset <id> [--format text|json] [--out report.json] [--junit report.xml]` reads, and never
writes:
- the rule fixtures of every member of a released ruleset (`ref.ruleset_members` × `ref.rule_fixtures`, in a
  read-only transaction);
- the synthetic labels (`fixtures/synth/out/*.truth.json`);
- the golden labels (`fixtures/golden/`).

It reports each item, per language panel for labels, as one of:
- `matched`: an evaluator ran and its outcome equals the expected outcome, including the reason code for a withheld
  fixture and the rule keys of the expected findings;
- `differed`: an evaluator ran and its outcome is not the expected one;
- `withheld`, with a reason:
  - `evaluator_missing`: no evaluator for the shape yet;
  - `engine_unavailable`: labels need extraction and the engine;
  - `no_fixtures`: a member has none;
  - `fixture_invalid`;
  - `evaluator_error:<type>`.

A runner-level withhold never counts as a match, even for a fixture that expects `withheld`. The run passes (exit 0)
only when every item matched and at least one rule fixture was evaluated. Exit 1 means something differed or was
withheld. Exit 2 means an unknown ruleset or missing configuration. With `--format json`, stdout carries the report
alone (logs go to stderr). The report holds `ruleset_version`, `passed`, a summary per kind and every result with
expected and actual.

Evaluators register in `nutrivo_worker.fixtures_runner.EVALUATORS` by shape, and the label path in `LABEL_EVALUATOR`.
T-403 registers mandatory_particular and prescribed_wording (§The engine). Every other shape and every label is
still withheld, so no ruleset passes while synthetic or golden labels are present. Open on #36: how an unreleased
(proposed) ruleset is named before K05 writes its members, and the golden expected-results file format. Until those
are decided, only released ruleset ids resolve, and a golden JSON file with a `panels` list is reported per panel.
