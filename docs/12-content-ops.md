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

## Importing the additive register and the feed-material catalogue (T-202)
`nutrivo sources import additives` and `nutrivo sources import materials` (worker) take the same options as the
fetcher (`--dry-run`, `--record DIR`, `--replay DIR`, `--min-interval`) and need the same three settings. Both write
reference data only: no rule, term, coverage or status. One JSON line per pull and per entry, then a summary; a failed
pull or an answer of an unexpected shape exits 1 and **writes nothing**, so a partial register or catalogue is never
imported. Tests replay `worker/tests/recordings/register` and `worker/tests/recordings/catalogue`.
- **The register.** The EU Register of Feed Additives has no editions and no download (docs/14 §6). The importer
  pulls the JSON the portal's own screen reads (`ec.europa.eu/food/food-feed-portal/backend/api`): every register
  entry, the legislation they cite and the reference labels. Each body is stored byte for byte in the `sources`
  bucket at `register/feed-additives/{endpoint}/{sha256}.json` with a `ref.sources` row (kind `register`, url,
  `retrieved_at`, sha256, licence `eu_reuse`); the same body again is `unchanged`.
- **What becomes a row of `ref.feed_additives`.** Only an entry the register lets us write without guessing: its
  identification number is present and on no other entry (compared without spaces, dots or case: the register
  prints `4d3` and `4d 3`, `E 160a` and `E 160 a`), no authorisation has a deletion date, no linked act withdraws,
  repeals, denies or suspends it (a link type the importer does not know also skips the entry), every authorisation
  ends on the same date (a null expiry would read as unlimited for a species whose authorisation has ended), and the
  functional group is one the register labels. Every other entry is reported `skipped` with its reason
  (`no_identification_number`, `ambiguous_identification_number`, `deleted`, `withdrawn`, `unknown_legislation_type`,
  `unknown_legislation`, `differing_expiry`, `unknown_functional_group`, `no_name`) and stays in the stored pull.
  A row holds the name and functional group as served, each authorisation's species string unsplit, the "Primary"
  act's title as `authorising_act`, the expiry all its authorisations share, and `source_id` of the entries pull. **`max_content`, `conditions` and `category` are never written**: the register does not serve the
  first two (they are in each authorising act). A row an earlier import wrote that the current pull does not support
  is reported `stale` and left in place. On 23 Oct 2026: 2,026 entries, 1,028 rows.
- **The catalogue.** The latest consolidated text of Regulation (EU) No 68/2013 dated on or before today, fetched and
  stored in every launch language exactly as `nutrivo sources fetch` does. Without a consolidated version the import
  fails (`no_consolidation`): it never falls back to the 2013 act, whose annex the amendments replaced. Annex Part C
  is read from each language: `names` holds each language's name from its own text and leaves a language out where
  that text has no readable entry (reported `language_missing`). A row with a name but no readable number is
  reported `unreadable_number`, never matched by position: in 02013R0068-20220724 the Danish 5.41.1 is printed with
  `(` in its number cell, so its Danish name is withheld. Footnote references and the consolidation markers (`►M1`,
  `◄`) are dropped by their markup; `description` and `compulsory_declarations` (one item per printed line) come from
  the English text, null where the English text has no such entry, and `source_id` is the English text's row.
- **Open (issue #32, needs-human).** Holding the register per authorisation with a status, removing stale rows,
  per-language provenance for `ref.feed_materials`, and where maximum contents and conditions come from.

## Candidate targets
`content/candidates/eu-core.yaml` lists the first targets. **Every citation there is a candidate written from
general knowledge: paragraph letters especially must be confirmed against the consolidated text before any
extraction is accepted.** The sources to store first are in `content/sources.yaml`.
