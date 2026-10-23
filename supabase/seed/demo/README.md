# Demo seed: Halden Pet Nutrition (T-013)

The mock data inside the design files (docs/20 §3), loaded as one synthetic workspace so that screens can be built and
compared against it. It holds no real customer data and nothing secret-shaped.

| What | Where |
|---|---|
| The seed (one idempotent transaction) | `supabase/tests/app/fixtures/demo_halden.psql` |
| Loader | `supabase/seed/demo/load.sh [DATABASE_URL]` (default: the local stack) |
| Tests | `supabase/tests/app/10_demo_seed.test.sql` (`[T-013]`, run by `make gates` and CI's database job) |

**Why the SQL is under `supabase/tests`.** `supabase test db` runs pgTAP in a container that mounts only
`supabase/tests`. The test loads the seed with `\ir` inside its own transaction, loads it twice to prove it idempotent,
checks it, and rolls it back. The `.psql` extension keeps pg_prove and the per-file TAP loop from running the seed as a
test.

**Why `supabase db reset` does not load it.** `[db.seed]` stays off in `supabase/config.toml`, because the
human-owned gate tests (`supabase/tests/gates/`) assume no other tenant data exists. For example, `04_billing` reads
`app.allowances` without a filter. Load the demo into a database you are building screens against. Before you run
`make gates` or `make verify-fast`, run `make db-reset`, which drops it again.

## Loading it
- **Locally:** run `supabase/seed/demo/load.sh` after `make db-reset`.
- **CI:** the end-to-end job loads it with the same script once the web suite needs it. That is wiring in
  `scripts/ci/e2e.sh` (infra lane).
- **Staging demo workspace:** the staging pipeline (T-010) runs `supabase/seed/demo/load.sh "$STAGING_DB_URL"`.
  `supabase db push` never seeds.
- **Never production.**

**Signing in as a demo person.** Each demo person has an auth user with a random password, generated when the seed
loads and never stored. To sign in, request a magic link: locally it arrives in Mailpit (http://127.0.0.1:54324), or a
test can use the admin API's `generateLink`.

## What it holds
The data is a snapshot as of the design's "now", early September 2026. Dates are fixed, so documents that were current
in the design have since expired.

| Design surface | Seeded as |
|---|---|
| Workspace Settings, Billing Settings | Workspace `da7a0000-0000-4000-8000-000000000001` "Halden Pet Nutrition". Operator: Halden Pet Nutrition AB, Göteborg. Plan: Standard, annual, regions EU and US, 5 editor seats, 30 recipes. Billing mirror has no Stripe ids. Free allowance 3 of 3 used. |
| People and roles | Johanna Holm (admin), Marit Feldt (portfolio manager), Erik Lindqvist (editor, the adult dog dry recipe), Katrin Reuter (external editor: seven recipes, EU markets only, until 31 Dec 2026), Petra Salo (viewer), Anders Kvist (external viewer, adult range). Person ids are `da7a0001-…-00000000000N` and auth user ids are `da7a0002-…-00000000000N`. |
| Signing authority | Feldt holds DE, AT, NL and BE (granted 6 Aug 2026 by Holm). Holm holds GB and NI. Texas has no holder. |
| Portfolio board | Eight live products on the board's six nodes (DE, AT, US-TX, NL, BE, FR). Product ids end in the design's SKU (`da7a0004-…-000000004471`). Also the discontinued Senior Salmon recipe. |
| Brief & formula | Senior Joint Support Wet (in development, no artwork). The draft formula, with register references left unmatched, and its intended claims in EN and DE. |
| Upload & scope, Label report | Artwork v6 and v7 of Salmon & Rice 12 kg, and the latest artwork of each other checked product. Each has four language panels (DE, NL, FR, EN). The German panel of 4471 v7 carries the printed strings of the report's pins as text objects, with both heights. |
| Checks | One job per checked product, keyed as `app.request_check` keys it. One check per node × printed language panel: DE and AT read German, NL Dutch, BE both Dutch and French, FR French, TX English. Each check has one withheld finding per domain. |
| Suppliers, Documents | The six suppliers and the documents the design names: PMX-118 spec expired 3 Jun 2026, CERT-0311 expiring 14 Sep 2026, SPEC-0518, αBE0092, QA-2024-07, SPEC-4471 rev C, the L2608 certificate. Three draft document requests: Aldrich premix spec, Botanica component list, Peptico designation. |
| Audit log | The events the seed's own history implies, with actors stamped. |

## No rule, no verdict
The design draws Clear, Action and Blocked cells, cited findings and certificates against ruleset `2026.08-b`. None of
that is encoded. The only ruleset is the baseline `0000.00-empty`, and nothing is accepted. A seed that wrote those
states would be a verdict without a rule (CLAUDE.md 3, 6 and 7). So:
- every check pins `0000.00-empty` and its artwork hash, and reads `not_assessed`, with no applied rule keys;
- every finding is `not_assessed`, with provenance `not_assessed`, the node × domain `gap_id` and reason `not_encoded`;
- every product node displays Not assessed, and registration state stays `unknown`.

Left out on purpose, until the workflows that produce them run against accepted rules:
- reports, certificates and shares, which need a real reference and, for a certificate, a clear check;
- classifications, which need a real citation;
- alerts, which need `ref.rule_diffs`;
- registrations;
- all `ref` content: terms, coverage, obligations and rules.

Whether the demo should later reproduce the design's states through real checks is a founder question on issue #22.

## Known differences from the design
- **Email domains.** Addresses keep the design's names on reserved domains (`haldenpet.example`, `reglar.example`),
  because staging sends real email.
- **People.** Nutrivo 2.0 also shows people at `nutrivo.de`. The seed follows Workspace Settings, where Halden is the
  workspace.
- **Business operator.** The printed operator on the 4471 German panel is kept verbatim ("Nutrivo GmbH, …") because it
  is artwork text.
- **SKUs.** The schema has no SKU column (docs/03), so SKUs appear only in product ids.
- **Product count.** The design's counts (34 products, 306 answers, 14 suppliers) are larger than what it draws. The
  seed holds what it draws.
