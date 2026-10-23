# 12 · Content operations

The product can only be as right as its ruleset. The design files rank a regulatory content owner as the first hire;
until that person exists, this is the operating model. It is the method the design already publishes: machine
extraction plus acceptance by a person, with thresholds and prescribed terms extracted twice (D-10).

## Roles
| Role | Who | Time |
|---|---|---|
| Extraction engine | Claude Code, using the M2 tools | Batch runs |
| Accepting person | A founder until the content owner is hired | 3–5 hours a week |
| Second key | The content-verifier subagent and the K02 extraction | Every candidate |
| Independent review | A feed-law expert on contract | 3–5 days before the first paid contract, then per release with material changes |

## Weekly rhythm
Monday: source watch (J01) and the extraction batch for the week's targets. Tuesday–Wednesday: the accepting person
works the review queue in /admin. Thursday: fixtures drafted for what was accepted, confirmed by the accepting
person. Friday: release if every fixture passes; the coverage page updates itself.

## Accepting a rule: the checklist
- The excerpt shown is from the stored official text (the sha256 matches `ref.sources`).
- Both extractions agree, or the accepting person resolved the difference against the text.
- Parameters and units are exactly what the text says; the article reference is exact to the paragraph.
- Applicability (species, product class, life stage, market) matches the text, no wider and no narrower.
- Dates: effective_from and any sell-through period are set where the act gives them.
- Fixtures exist for passed, failed and withheld, and pass.

## Coverage honesty
A node × domain becomes `complete` only when every rule the domain needs at launch scope is accepted and tested.
Otherwise it stays `partial` or `not_encoded` with a gap that says plainly what is missing. The public page shows
exactly this table, nothing more.

## Never
- Fetch, store or quote FEDIAF or AAFCO texts (copyrighted). If a rule needs them, record a gap.
- Translate a prescribed term. Every language's term comes from that language's official version of the act.
- Use secondary sources (blogs, consultants' summaries, competitor sites) as a rule source.
- Let anything reach `ref.rule_versions` with status accepted without a person's click.

## Launch scope (D-01)
EU core plus the language layers for Sweden, Denmark, Finland and Germany. Domains: mandatory particulars;
composition and additives (the additive register); prescribed wording and general claims; language; net-quantity
figure height; registration and establishment obligations for the four launch nodes (researched, dated, sourced).

## Fetching the official texts (T-201)
`nutrivo sources fetch` (worker) reads `content/sources.yaml`, finds each act's latest consolidated version dated on or
before today, and fetches it in every listed language. Consolidated versions dated later are listed in the output
but not fetched. The tool goes through CELLAR, the Publications Office repository that EUR-Lex is published from: the
EUR-Lex site answers automated clients with a bot challenge (docs/14). It sends one request every 2 seconds, retries
429, 5xx and network errors up to 4 times with backoff, and fails a challenge at once.
- **Stored exactly as served.** The XHTML body goes byte for byte to the private `sources` bucket at
  `eurlex/{celex}/{lang}/{sha256}.xhtml`, with one `ref.sources` row: kind `eurlex`, `celex` the consolidated CELEX id
  (`02009R0767-20181226`: the suffix is the consolidation date; `eurlex.consolidation_date()` reads it), language,
  url of the manifestation fetched, licence from the file, `retrieved_at`, sha256 and storage_path. An act with no
  consolidated version is stored as published under its own CELEX id, and the output says so.
- **Checked.** A body that does not read as the requested language fails as `language_mismatch` and is not stored.
- **Idempotent.** The same celex, language and sha256 again gives `unchanged` and no new row. A body that changed
  gives a new row; the old one stays, so an excerpt keeps matching the text it was taken from.
- **Visible.** One JSON line per document: `stored`, `unchanged`, `fetched` (dry run) or `failed` with a reason
  (`source_blocked`, `retries_exhausted`, `not_available`, `language_mismatch`, `storage_error`, ...), then a
  summary. Any failure exits 1 and goes to Sentry with ids and the reason only.
- **Running it.** `scripts/env/run.sh dev -- uv run nutrivo sources fetch` needs `DATABASE_URL`, `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`. `--dry-run` fetches and hashes only. `--celex` and `--lang` narrow the run.
  `--record DIR` and `--replay DIR` write and serve recorded exchanges (tests use `worker/tests/recordings/eurlex`).
  Nothing in it writes rule content or sets any status.

## Extracting candidates (K01/K02, T-203)
`nutrivo content extract` (worker) takes each target in `content/candidates/eu-core.yaml` and its latest stored text in
every language (`ref.sources`, from T-201). It extracts the target twice and writes one `ref.rule_candidates` row per
target × source. It never writes a rule.
- **Sources.** The target's act is the first act its `candidate_source` names, and it must be listed in
  `content/sources.yaml`. A row is used only when it is kind `eurlex` with a sha256 and a storage path, names neither
  FEDIAF nor AAFCO, and its body read back from the `sources` bucket has that sha256. Anything else fails with a
  reason (`source_refused`, `source_kind_refused`, `source_not_stored`, `source_act_mismatch`,
  `source_hash_mismatch`) before any model is called.
- **Units.** The body is split into articles and annexes on the headings every language version shares
  (`title-article-norm`, `title-annex-1`). The model sees only the units the target names (for example `Art. 15`
  and `Annex I`), never the whole act and never anything from memory.
- **First key (K01).** `extraction_primary.v1` runs on the extraction model class. The answer is the shape's params,
  the article reference to the paragraph and a verbatim excerpt. The excerpt and every field the schema calls verbatim
  (`content/schemas.py`) must be printed in the units, up to whitespace. If one is not, the result is withheld as
  `excerpt_not_in_source` and nothing is written. This is also what keeps a term from being translated. When the
  model abstains, the result is withheld as `not_found`.
- **Second key (K02).** `extraction_secondary.v1` runs on the judgement model class with its own prompt and the same
  inputs. It never sees the first answer. `agree` is computed field by field: `found`, the article reference and
  every param, with case, whitespace and list order ignored. Excerpts are not compared. The per-field map is in
  `second_value.fields`.
- **Decision.** A candidate stays `pending`. It becomes `needs_review` when the keys disagree, when the second key is
  not verbatim, and always for `threshold` and `prescribed_wording`. Nothing here sets `accepted`, writes
  `decided_by`, or touches `ref.rules`, `ref.rule_versions` or a ruleset. Acceptance is a person's click (K03, T-204).
  Until the second key has run, the candidate has `agree` null. The accept RPC must refuse such a candidate.
- **Not extracted yet.** `claim_judgement` targets are skipped (`needs_claims_harness`, T-501), and so are
  `additive_condition` targets (`needs_additive_register`, T-202). Drafting fixtures for the reviewer comes with
  acceptance.
- **Idempotent.** There is one candidate per (source_id, rule key), under an advisory lock.
  - A candidate with both values gives `unchanged`, with no model call.
  - The first value is stored before the second key runs. A failed second key (for example `model_unavailable`) is
    therefore resumed by the next run, which gives `updated`.
  - A decided candidate is never touched.
- **Visible.** The run prints one JSON line per target × source, then a summary. The states are `stored`,
  `updated`, `unchanged`, `extracted` (dry run), `skipped`, `withheld` and `failed`, each with a reason where there
  is one. Any `failed` exits 1 and goes to Sentry with ids and the reason only.
- **Traced.** Each target × source is one Langfuse trace, `content:extract:<rule_key>:<source_id>`, with an id derived
  from that name so reruns join it. Each model call is one generation in that trace and one `app.model_calls` row
  (docs/07). The first and second values also carry the prompt version, model id, input hash and source sha256.
- **Running it.** Use `scripts/env/run.sh dev -- uv run nutrivo content extract`. It needs `DATABASE_URL`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and model configuration. `--target KEY` and `--lang xx` narrow the run.
  `--dry-run` extracts and compares, but writes nothing to the database. Langfuse still traces the calls.

## Candidate targets
`content/candidates/eu-core.yaml` lists the first targets. **Every citation there is a candidate written from
general knowledge: paragraph letters especially must be confirmed against the consolidated text before any
extraction is accepted.** The sources to store first are in `content/sources.yaml`.
