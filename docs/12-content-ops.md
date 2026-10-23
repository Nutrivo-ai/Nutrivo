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

Source watch (J01, T-207):
- `nutrivo sources watch --out watch.json` asks CELLAR, for each act in content/sources.yaml, which documents
  amend, are based on, correct or cite it. It looks back 14 days by default. It also lists consolidated versions
  dated after the run date.
- The document kind (proposal, preparatory, legal act, corrigendum, other) comes from the CELEX id.
- The model (`triage.v1`) only ranks the items high, medium or low and summarises their titles.
- A summary that gives a date is withheld (BE-37). For a document that is not a legal act, any year that is not
  part of an act number counts as a date, and so does wording such as a deadline or "next year". A summary that
  calls such a document law is withheld too, and so is an abstention or a model failure. Withheld items rank just below high, never with the low ones.
- The person reads the report and records what matters with
  `nutrivo horizon record --report watch.json --celex <id> --stage <stage> [--expected-date] [--effective-from]`.
  An effective date is refused unless the stage is adopted, published or in force. A document that is not a legal
  act is never recorded at a law stage; its kind is worked out again from the CELEX id. Recording the same item and
  stage again with other values is refused (`conflicts_with_existing`) rather than ignored.
- Items already in ref.horizon_items are skipped on the next run.

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

## Candidate targets
`content/candidates/eu-core.yaml` lists the first targets. **Every citation there is a candidate written from
general knowledge: paragraph letters especially must be confirmed against the consolidated text before any
extraction is accepted.** The sources to store first are in `content/sources.yaml`.
