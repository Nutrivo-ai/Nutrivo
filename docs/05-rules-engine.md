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
| mandatory_particular | `particular`, `conditions` (extraction); `detect.term_keys`, `scope` (each panel in a node language, or any panel) (links) | The particular is absent from the panel |
| prescribed_wording | `wordings`, `alternatives` (extraction, source text only); `term_key`, `alternative_term_keys`, `match` (exact, case-folded) (links) | The printed wording differs from the term register entry for that language |
| threshold | `quantity`, `operator`, `value`, `unit`, `then` (what becomes required) | The condition holds and the consequence is missing |
| character_height | `target`, `height_definition` (x_height, cap_height or figure_height), `bands` (quantity range to minimum mm) | Measured height below the band minimum |
| additive_condition | `check` (authorised_for_species, within_max_content, declaration_required), register fields | The additive breaks its register conditions |
| claim_judgement | `question`, `criteria`, labelled `examples`, `min_confidence` | The model judges the claim not permitted with confidence ≥ min_confidence |

### Extraction params and term links (D-31)
A rule's params come from two places:
- **The extraction.** What the official text says, verbatim and in the source's language. It is kept as the rule's
  source text and is never matched against a panel.
- **The links.** Keys of accepted `ref.term_entries` (`detect.term_keys`, `term_key`, `alternative_term_keys`) and the
  `scope` and `match` modes. The accepting person adds them when accepting a candidate, or later as a new `editorial`
  version. Neither an extraction nor a model ever supplies a link.

Printed text is judged only through the linked register entries for the panel's own language. The engine does not
read a flat `alternatives` list. A rule without its links is withheld `data_missing`. A node × domain cannot be
Complete while a member's linked key has no accepted entry in one of the node's languages (P0048). The engine (T-210)
and the database (T-209: `app.accept_candidate` with `p_links`, `app.relink_rule`) are built; the console (T-211)
follows. The draft digest also covers the accepted entries of every linked key, so a term changed after a fixture run
makes the run stale.

## Applicability
A small predicate language: `{"all": [...]}`, `{"any": [...]}`, `{"not": X}`, `{"eq": [field, value]}`,
`{"in": [field, [values]]}`, `{"has": field}`. Fields: species, life_stage, product_class, intended_use,
parnut_status, format, node_id, region, panel_language. **A missing field never evaluates to true or false: the
rule is withheld with `data_missing`.**

## Evaluating one check (node × panel)
1. Load the ruleset pinned on the job and the node's coverage rows at that ruleset.
2. For each domain whose coverage is not complete, emit a not_assessed finding with the domain's gap_id. A node has six
   domains (mandatory_particulars, composition, claims_wording, type_geometry, language, registration); a domain with no
   coverage row is not encoded: it makes the check not_assessed but gets no finding, since there is no gap_id to name
   and none is invented (#179 DB-1).
3. Select member rules held on the node or its region whose applicability is true for the confirmed classification,
   the product and this panel.
4. If the panel is not assessable, withhold every rule that reads panel text, using the panel's failure code.
5. Run each remaining rule's evaluator: passed (no finding), failed (finding `action`, provenance deterministic_rule
   or model_judgement), or withheld (finding `not_assessed` with a reason code).
6. label_state = action if anything failed; otherwise not_assessed if anything was withheld or any of the six domains
   is incomplete or missing; otherwise clear. The database refuses clear unless all six are complete
   (`private.node_fully_encoded` in `private.verdict_guard`, P0021).
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
- **prescribed_wording** reads `term_key`, `alternative_term_keys` (register keys of wordings also permitted) and
  `match`: `case_folded` (the default) or `exact`. It is judged only on panels printed in one of the node's languages,
  against the register entries of both kinds of key in the panel's language (D-31, T-210). The extraction's
  `alternatives`, a list or a map, is never read, so a wording in another language cannot pass a panel.
- **Matching** compares NFC text with whitespace collapsed.
- **Terms** are the accepted `ref.term_entries` in the panel's language that are pinned to the ruleset; when none
  are pinned to it, the ones pinned to no ruleset.
- **Missing params.** The K02 extraction stores only `particular` and `conditions`, or `wordings` and
  `alternatives`. A rule without the params above, or with no term in the panel's language, is withheld with
  `data_missing`. It is never matched on other wording.
- **character_height, threshold, additive_condition (T-502, D05).** Asked on #52; each choice below is the
  conservative option.
  - **character_height** reads `height_definition`, `bands` and `detect.term_keys`. `detect.term_keys` are the
    register terms whose printed text is the target, in the panel's language.
    - The rule is judged on panels in one of the node's languages, and every target text object is measured.
    - The band is the one whose range `[quantity_from, quantity_to)` holds the product's quantity, in the same unit.
      A single band open at both ends needs no quantity.
    - It fails when a target is below the band minimum. The finding carries `text_object_id`, `bbox_mm`,
      `measured_mm` (the lowest), `required_mm` and `height_definition`.
    - A `no_true_scale` or `outlined_text` panel is withheld with that code, by step 4.
    - A target read by OCR has no physical scale and is withheld `no_true_scale`.
    - `figure_height` has no stored measurement (`app.text_objects` holds x-height and cap height only), so it is
      withheld `data_missing`; it is never taken from cap height.
    - Each of these is withheld `data_missing`, never guessed: a K02 rule without `height_definition` or
      `detect`, a target not printed, a missing measurement, a missing quantity, a unit that differs, or no single
      band.
  - **threshold** reads `quantity`, `operator`, `value`, `unit` and `detect.term_keys` (what the consequence prints
    as).
    - The quantity is the product's `{value, unit}` under that name. A unit is never converted.
    - A condition that does not hold makes the rule not applicable.
    - When it holds, the rule passes if the consequence is printed on the panel and fails if not.
  - **additive_condition** reads `check`, `additives` (identification numbers; absent means every additive of the
    formula) and `species_wordings`. It judges the formula lines whose `additive_ref` it names; with none, it is not
    applicable. A product with no formula lines at all has no formula yet, which is missing data: every additive rule
    is withheld `data_missing`, never not applicable (#172). So is a formula with any line matched to neither a feed
    material nor an additive of the register: that line may be an additive, so the formula cannot be read as
    additive-free (#76, T-1001). The formula is pinned like the artwork: a check job carries the formula digest it was
    requested for, and when the formula has changed since, its additive rules are withheld `data_missing`. Each check:
    - `authorised_for_species` fails on an expired register row. It passes only when a register species string equals
      one of `species_wordings[species]`; the register's strings are unsplit, so a miss proves nothing.
    - `within_max_content` compares the line's amount with `max_content` in the same unit.
    - `declaration_required` has no per-language declaration source yet.
    - Anything else, including a `max_content` never imported (docs/12), is withheld `data_missing`.
  - **Not stored yet.** No source gives the product's quantity or declared quantities, so in a real check
    character_height rules with several bands, and every threshold rule, are withheld `data_missing` until one does.
- **claim_judgement (T-503, BE-22).** Asked on #53; the open decisions (Q1–Q6) are carried on #209. Each choice below is the conservative option.
  - **The harness threshold comes first.** The rule is judged only for a (rule_key, version, panel language) with a
    harness threshold record (docs/07 §The harness). Without one it is withheld `claim_not_evaluated` and no model is
    called. Where records come from is open (#209 Q1). The check job has no source yet, so in a real check every claim
    rule is withheld `claim_not_evaluated`.
  - It is judged on panels in one of the node's languages; other panels are not applicable. A panel whose language
    is unknown, or with no printed text, is withheld `data_missing`.
  - Each text object is judged as printed, in the panel's language and never translated. The call goes through
    `nutrivo_worker.models` with `claim_judgement.v1` and the rule version's `question`, `criteria`, `examples` (in
    that language) and `min_confidence`: exactly what the harness measured. A string printed twice is judged once.
  - `prohibited` or `needs_evidence` at confidence ≥ `min_confidence` fails the rule. The `action` finding has
    provenance `model_judgement`, its `confidence` and `model_call_id`, and is pinned to the text object.
  - An abstention or a lower confidence withholds `model_abstained`, and a model error keeps its own reason. Withheld
    is never passed, but a failure on another text object still fails the rule.
  - It passes only when every text object is judged `permitted` at ≥ `min_confidence`.
  - Judgements are shared across the job: the same (rule version, language, printed string) is one model call for
    every panel and market. The check job heartbeats after each panel. A withheld abstention keeps its `confidence`
    and `model_call_id`.
  - Invalid params, or a failure without an `app.model_calls` id, give `evaluator_error`.
  - The fixtures runner still withholds claim_judgement fixtures `evaluator_missing`, because it calls no model
    (#209 Q4).
- **Withholds.**
  - A shape with no evaluator yet gives `evaluator_missing`.
  - An evaluator fault gives `evaluator_error` and is reported to Sentry.
  - A model error from `nutrivo_worker.models` keeps its own reason: `model_unavailable`, `model_refused` or
    `model_output_invalid`.
- **Fixtures.**
  - Importing the engine registers every evaluator in `fixtures_runner.EVALUATORS`.
  - A rule fixture's `input` is `{panel, panels?, node: {id, languages, region}, classification, product: {format}}`.
    A panel is `{index, language, status, failure_code, text_objects: [{text, x_height_mm?, cap_height_mm?, is_ocr?}]}`.
    `product` may also carry `quantity`, `quantities` and `additives` (T-502).
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
needs a new run. What a release run judges is D-32:
- `nutrivo fixtures run --draft <id>` runs a draft's member fixtures and records the run;
- synthetic labels are never part of a release run;
- golden labels count from 30.

T-210 built it (§The runner). A real rule still needs its term links (T-209; in the console from T-211) before its
fixtures can pass.

### The runner (T-206, T-210)
`nutrivo fixtures run --ruleset <id> | --draft <id> [--format text|json] [--out report.json] [--junit report.xml]
[--golden DIR]` reads, in one repeatable-read, read-only transaction:
- the rule fixtures of every member, with each member's params, applicability and the accepted term register:
  - `--ruleset`: a released ruleset (`ref.ruleset_members`);
  - `--draft`: a draft (`ref.ruleset_draft_members`), with the register its release would carry (entries pinned to
    no ruleset), plus `private.ruleset_draft_digest` in the same snapshot;
- the golden labels (`fixtures/golden/`), once there are 30 of them (D-32).

Synthetic labels are never part of a run (D-32): their wording is invented and never in the register. They are
tested by the worker's own tests. Golden labels are counted as the top-level entries of `fixtures/golden/` other than
README and hidden files, because their file format is OPEN until the 30th. Below 30 the report gives the count and
leaves them out (`labels.golden`).

A `--ruleset` run writes nothing. A `--draft` run writes one row to `ref.fixture_runs` in its own short transaction,
whether it passed or not, because the latest run is the one the release gate reads. The row holds the snapshot's
digest, `passed`, `rule_fixtures_ran` and the summary. A draft that does not exist, or one that is already released
(frozen), exits 2 and records nothing.

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
withheld. Exit 2 means an unknown ruleset or draft, a released draft, or missing configuration. With `--format json`, stdout carries the report
alone (logs go to stderr). The report holds `ruleset_version`, `passed`, a summary per kind and every result with
expected and actual.

Evaluators register in `nutrivo_worker.fixtures_runner.EVALUATORS` by shape, and the label path in `LABEL_EVALUATOR`.
T-403 registers mandatory_particular and prescribed_wording, and T-502 registers character_height, threshold and
additive_condition (§The engine). claim_judgement (it would need a model, #209 Q4) and every label are still
withheld; `LABEL_EVALUATOR` is unset, so from the 30th golden label no run passes until it is. The golden
expected-results file format stays OPEN until then; meanwhile a golden JSON file with a `panels` list is reported per
panel.
