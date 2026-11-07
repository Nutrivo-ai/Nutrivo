# The demo: upload → report → verify

The five-minute demo for Slush (18–19 Nov 2026, docs/11 M4). It shows one label going through the whole product:
a person signs in, uploads print artwork, Nutrivo reads every printed language panel, checks each panel for each
market, issues a report PDF with a reference, and anyone verifies that reference without an account.

The same path is a test. `apps/web/tests/e2e/demo.spec.ts` (tagged `@demo`) runs it end to end on every pull request
in CI's e2e job. If the path breaks, the build goes red before the stage does.

## What it honestly shows

**Every result is Not assessed, and that is correct.** No ruleset has been released yet: the local stack and staging
carry only the empty baseline `0000.00-empty`, and the first real ruleset waits for the founders to accept the
first EU core rules (T-208, gate G6). Until then:
- every market tile, every finding and every check reads **Not assessed**;
- each finding names its coverage gap (for example `GAP-EU-DE-MANDATORY_PARTICULARS`) and links to it;
- the PDF's section 05, "What was not assessed", lists every gap and says "They are not a pass";
- registration state reads **unknown**, never clear;
- the verification page says the report is genuine, pinned to `0000.00-empty`, and that it has items not assessed.

**Nothing reads Clear.** The database refuses Clear wherever coverage is incomplete (`private.verdict_guard`). The
@demo test also asserts it, from the database rows through the report screen to the PDF. Never edit data, seed
rows or screens to make the demo look greener. The point to make on stage is this one: *no rule, no verdict.*

## Where each step stands on main (2 Nov 2026)

| Step | In the web today | Gap |
|---|---|---|
| Sign in | Magic link. Locally it arrives in Mailpit, http://127.0.0.1:54324 | — |
| Product and its markets | No screen yet | T-401 (#164) adds products. A product's markets are set by the demo seed or the test. |
| Upload → extraction | Upload & scope, then "What ran, per panel" (T-303) | — |
| Classification | — | T-402 (#162). Checks run without it today. |
| Run the check | Upload & scope's closing bar, "Run the check" (T-505), then "Open the report" | — |
| Label report | The label report screen (T-404) | — |
| Report PDF | **No download button** | The worker job (T-405) and its producer `app.request_report` (T-408) exist; the download button (web) is proposed on #49. |
| Public verification | `/verify/<ref>` through the `verify` function (T-406) | — |

Until the bold gap closes, use **Option A** on stage. Option B needs an operator at a second terminal.

## Running it

### Once, on the demo laptop
```sh
make bootstrap        # worker and web dependencies
make db-start         # local Supabase (Docker); a free Docker Hub token avoids pull rate limits (docs/22 §5)
make fixtures         # the synthetic labels, including clean_3lang (English, Swedish, German panels)
```

### Option A · the driven demo (recommended until the gaps close)
The @demo journey runs in a visible browser, slowed down, while you narrate. It makes a fresh workspace,
"Halden Pet Nutrition", and a product, "Salmon & Rice Adult 12 kg", for Germany and Sweden.

In one terminal, start the worker and the web app as `scripts/ci/e2e.sh` does:
```sh
make db-reset
eval "$(supabase status -o env | sed -e 's/^/export /')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
       SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" DATABASE_URL="$DB_URL" \
       MODELS_MODE=replay EMAIL_MODE=mailpit NUTRIVO_ENV=ci
(cd worker && uv run nutrivo work) &
pnpm --dir apps/web build && pnpm --dir apps/web start &
```
In the same shell, once http://localhost:3000 answers:
```sh
DEMO_SLOWMO=800 pnpm --dir apps/web e2e --grep @demo --headed --trace on
```
- `DEMO_SLOWMO` is the pause in milliseconds before each browser action. 800 gives you time to talk.
- `--trace on` keeps a full replay in `apps/web/test-results/`. Open it with `pnpm --dir apps/web exec playwright
  show-trace <trace.zip>`. It is the backup if the live run fails on stage, so record one before you go on.
- The issued PDF is attached to the run in the same folder.
- Without `--headed` and `DEMO_SLOWMO`, the same command is the rehearsal check. It takes about 20 seconds.

The journey waits on the worker at three points: extraction, the check and the PDF. Each wait takes a few seconds
locally. Narrate over them; nothing on screen moves.

### Option B · by hand, on the demo workspace
This uses the Halden demo seed (supabase/seed/demo/README.md). Run `make db-reset` before `make gates` or
`make verify-fast` again: the seed breaks gates that assume no other tenant.
```sh
make db-reset && supabase/seed/demo/load.sh
```
Start the worker and the web app as in Option A. Then sign in at http://localhost:3000 as Johanna Holm
(`j.holm@haldenpet.example`), with the magic link from Mailpit.

The operator's command stands in for the missing control (the check itself now runs from "Run the check"). They act as Johanna Holm, so the permission checks
and the audit log see her.
```sh
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
HOLM='{"sub":"da7a0002-0000-4000-8000-000000000001","role":"authenticated"}'
# Issue the report PDF for Germany's German panel of the latest check (the stand-in for the download button):
CHECK=$(psql "$DB" -Atc "select id from app.checks where product_id = 'da7a0004-0000-4000-8000-000000004471'
  and node_id = 'EU-DE' and language = 'de' order by at desc limit 1")
psql "$DB" -Atq -c "begin; select set_config('request.jwt.claims', '$HOLM', true);
  set local role authenticated; select app.request_report('$CHECK'); commit;"
# A few seconds later, the reference and where the PDF is stored:
psql "$DB" -Atc "select progress->>'ref', progress->>'path' from app.jobs where kind = 'report' order by created_at desc limit 1"
```
The PDF is in Storage's `reports` bucket at that path. Open it from Studio at http://127.0.0.1:54323.

## The stage script (five minutes)

| Time | On screen | Say |
|---|---|---|
| 0:00 | Upload & scope for Salmon & Rice, "Not uploaded" | "This is a dry dog food sold in Germany and Sweden. Its print artwork has three language panels." |
| 0:30 | Choose the print PDF; the card runs to **Complete** | "Nutrivo reads the print-ready file itself, panel by panel, from the vector text. Nobody retypes the label." |
| 1:00 | "What ran, per panel": three panels, English, Swedish and German, each extracted | "Every language panel is its own thing. A claim is judged on the words printed in that language, never on English translated afterwards." |
| 1:30 | The check runs ("Run the check" on Upload & scope) | "Now we check each panel against each market's rules." |
| 1:45 | The label report: one tab per market × panel, every tile **Not assessed** | "And here is the honest part. We have not released a ruleset yet, so Nutrivo says *not assessed* for every domain, not *clear*. No rule, no verdict." |
| 2:30 | Open a Not assessed finding, then its gap link | "Every item it could not assess names the exact gap: this market, this domain, not encoded yet. That gap list is our content roadmap." |
| 3:15 | The report PDF (Option B: the operator's command) | "The report is a document a buyer or an authority can keep. It is pinned to a ruleset version and to the artwork's hash, with a reference." |
| 3:45 | The PDF's section 05, "What was not assessed" | "This section is always there, even when it is empty. Silence is never a pass." |
| 4:15 | A private window, `/verify/<reference>`: **current** | "Anyone with the reference can check that Nutrivo issued it, with no account. That keeps working even if the customer stops paying." |
| 4:45 | — | "When the founders accept the first EU rules, the same path turns those gaps into findings, with the rule and its legal basis behind every one." |

**Do not**
- say or imply a label is compliant;
- show the design files' Clear, Action or Blocked states as if they were the product's output;
- demo against staging data that is not the demo workspace.

## Before going on stage
1. On the demo laptop, run the rehearsal check (`pnpm --dir apps/web e2e --grep @demo`) against a fresh `make db-reset`. It must pass.
2. Record a trace with Option A as the backup.
3. Confirm, on screen, that nothing reads Clear (docs/11 M4 review).
