# 14 · Research log

## Verified on 8 Oct 2026
| Fact | Source |
|---|---|
| Edge Functions: 256 MB memory, 2 s CPU per request, wall clock 150 s (Free) / 400 s (paid), idle timeout 150 s, so PDF work cannot run there | Supabase docs source, apps/docs/content/guides/functions/limits.mdx (github.com/supabase/supabase) |
| Regions include eu-central-1 Frankfurt, eu-north-1 Stockholm, eu-west-1 Ireland, eu-west-3 Paris, eu-central-2 Zurich, eu-west-2 London | packages/shared-data/regions.ts |
| Pro from $25/month (100k MAU, 8 GB disk, 250 GB egress, 100 GB storage included); Team from $599/month | packages/shared-data/plans.ts |
| SAML 2.0 SSO on Pro and above | guides/auth/enterprise-sso/auth-sso-saml.mdx |
| MFA with TOTP or phone; the JWT carries `aal` (aal1 / aal2) for database rules | guides/auth/auth-mfa.mdx |
| Queues are built on pgmq: guaranteed delivery, exactly once within a visibility window, RLS-controlled | guides/queues.mdx |
| PyMuPDF 1.28.2: AGPL-3.0 or Artifex commercial · pypdfium2 5.14.0: BSD-3 / Apache-2.0 · fontTools 4.66.1: MIT · pdfplumber 0.11.10: MIT · WeasyPrint 70.0: BSD · ReportLab 5.0.1: BSD · lingua 2.2.0: Apache-2.0, Python 3.12+ · anthropic 1.12.1: MIT · pgmq 1.1.4: Apache-2.0 · psycopg 3.3.6: LGPL-3.0 · stripe 16.0.0: MIT · langfuse 4.17.0: MIT | PyPI |
| next 16.4.0 (Node 20.9+) · @supabase/supabase-js 2.117.3 (Node 22+) · @supabase/ssr 0.12.7 · supabase CLI 2.120.0 · @anthropic-ai/claude-code 2.1.295 (Node 22+) · tailwindcss 4.3.3 · @playwright/test 1.64.0 · stripe 23.0.0 | npm registry |
| Claude Code: CLAUDE.md and path-scoped `.claude/rules`; skills; subagents with tools frontmatter; Stop hooks block with exit code 2 and the turn ends after 8 consecutive blocks; `Edit(path)` and `Read(path)` permission rules; native installer `curl -fsSL https://claude.ai/install.sh \| bash` | CHANGELOG.md, github.com/anthropics/claude-code |
| cloud.langfuse.com is Langfuse's EU region | Langfuse README |
| The migrations apply on PostgreSQL 16; 44 gate tests pass; removing two guards fails exactly the matching tests | Own run |
| Synthetic fixtures behave as labelled; pypdfium2 measures the clean label's net-quantity digits at 6.09–6.20 mm against 6.2 mm | Own run (pdfplumber, pypdfium2) |

## Found in the design files
- The Backend Action Register's text says seven GATE rows; its data tags thirteen. All thirteen are gates (D-08).
- BE-43 (the Compliance Worker) is deliberately after launch, after coverage (D-09).
- The Priced Ladder's Free row is stale; the three-label allowance supersedes it (Handoff §06).
- Standard with two regions is €698; a third region exists only on Advanced at €999; Basic €249; caps €374 / €749.
- The DPA draft names "Supabase on AWS Ireland"; D-02 moves hosting to Frankfurt, so the DPA must change.
- The Handoff says it "supersedes the earlier Claude Code handoff": this repository supersedes both.
- Company details for Stripe and legal pages: Sunny Ventures AB, trading as Nutrivo.ai, Karlbergsvägen 48,
  113 37 Stockholm; company number 5594297151; VAT SE559429715101.

## Verified on 21 Oct 2026 (milestone 0, T-011)
Web search and the primary pages below, read on 21 Oct 2026. "Unconfirmed" means the page did not show the fact; nothing
here is filled in from memory. Prices are list prices excluding VAT.

### 1. AWS Bedrock (Claude models, prices, data handling)
| Finding | Source |
|---|---|
| Sonnet 5.5, Opus 5.5 and Haiku 4.5 are **not** offered in-Region in eu-central-1; from Frankfurt they run only through the EU geo profile (`eu.anthropic.claude-sonnet-5-5`, `eu.anthropic.claude-opus-5-5`, `eu.anthropic.claude-haiku-4-5-20251001-v1:0`) or the global profile (`global.…`) | docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html, …-opus-5-5.html, …-haiku-4-5.html |
| From eu-central-1 the EU profile routes to eu-central-1, eu-north-1, eu-south-1, eu-south-2, eu-west-1 and eu-west-3; AWS says to confirm with GetInferenceProfile. Geo and global profiles "don't provide single-Region data residency" | docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html |
| Opus 5.5 is in-Region only in eu-west-2 (London) among European Regions | model card above |
| Haiku 4.5's card gives EOL "no sooner than" 16 Oct 2026 (status still Active). Haiku 5.5 is available from Frankfurt through the EU and global profiles | model-card-anthropic-claude-haiku-4-5.html; docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html |
| Fable 5 and 5.1 require the `aws_review` retention mode (stored up to 30 days, possible human review), so they cannot run with retention `none` | model-cards.html |
| Bedrock data handling: model providers have no access to prompts, completions or logs. A per-Region retention setting `none` means no request or response data is written to durable storage by AWS or shared with the provider; it is set through the API per Region (no console option). With cross-Region inference, retained data stays in the Region that processed it | docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html, …/data-retention.html |
| Bedrock per-token prices: **unconfirmed** (the AWS pricing page did not render its Anthropic tables). Anthropic states Bedrock regional and multi-region endpoints carry a 10% premium over global endpoints for Haiku 4.5, Opus 4.5 and all later models | aws.amazon.com/bedrock/pricing; platform.claude.com/docs/en/about-claude/pricing |
| Anthropic list prices per million tokens (input / output): Sonnet 5.5 $2 / $10; Opus 5.5 $4 / $20; Haiku 4.5 $1 / $5; Haiku 5.5 $0.10 / $0.50 (prompts up to 100k tokens; $0.50 / $2.50 above). Batch is half price | platform.claude.com/docs/en/about-claude/pricing |
| An explicit "not used for training" sentence on a Bedrock page: **unconfirmed** | — |

### 2. Anthropic API (fallback route)
| Finding | Source |
|---|---|
| Zero data retention is arranged per organisation through Anthropic sales, not self-serve; the Batch and Files APIs are not covered. Without ZDR, API data is deleted within 30 days and is not used for training without express permission | platform.claude.com/docs/en/manage-claude/api-and-data-retention; privacy.claude.com/en/articles/7996866 |
| No EU data residency: `inference_geo` accepts only `global` or `us` (`us` at 1.1×) and is rejected with a 400 on Haiku 4.5; workspace geo (storage at rest) is `us` only and cannot be changed after creation | platform.claude.com/docs/en/manage-claude/data-residency |

### 3. Prices
| Service | Finding | Source |
|---|---|---|
| Supabase | Pro from $25/month including $10 of compute credit (one Micro). Compute per month: Micro ~$10, Small ~$15, Medium ~$60, Large ~$110, XL ~$210, 2XL ~$410, 4XL ~$960, billed hourly. PITR: 7 days ~$100, 14 days ~$200, 28 days ~$400 per month, outside the spend cap | supabase.com/pricing; supabase.com/docs/guides/platform/compute-and-disk; …/manage-your-usage/point-in-time-recovery |
| Vercel Pro | $20/month platform fee with $20 included credit; developer seat $20/month; 10M edge requests and 1 TB fast data transfer included (then from $0.15/GB); function invocations from $0.60 per million | vercel.com/pricing |
| Render | Instance prices per month: Starter $7, Standard $25, Pro $85, Pro Plus $175, Pro Max $225, Pro Ultra $450. That background workers use this table and that Frankfurt costs the same: **unconfirmed** (no regional pricing stated) | render.com/pricing; render.com/docs/regions |
| AWS SES | $0.10 per 1,000 emails plus $0.12 per GB of attachments; the eu-central-1 rate specifically: **unconfirmed** | aws.amazon.com/ses/pricing |
| Stripe (Sweden) | Billing 0.7% of billing volume (pay as you go). Tax Basic 0.5% per transaction (no-code) or SEK 5.00 per transaction via API (10 calculations included, then SEK 0.50); Tax Complete from SEK 960/month. EEA cards 1.5% + SEK 1.80 (premium 2.8% + SEK 1.80). Which Tax tier applies through Billing: **unconfirmed** | stripe.com/se/pricing |
| Sentry | Team $29/month ($26 annual); Business $89/month ($80 annual); both include 50k errors, 5M spans, 50 replays | sentry.io/pricing |
| PostHog | Free monthly: 1M analytics events, 5k recordings, 1M flag requests, 100k exceptions, 100k AI events. Usage prices above that: **unconfirmed** | posthog.com/pricing |
| Langfuse Cloud | Hobby free (50k units, 30 days, 2 users); Core $29/month (100k units, $8 per extra 100k, 90 days); Pro $199/month (3 years); Teams add-on $300/month | langfuse.com/pricing |

### 4. Data regions
| Finding | Source |
|---|---|
| Sentry EU region is Frankfurt (`de.sentry.io`); the region is chosen when the organisation is created and cannot be changed | docs.sentry.io/organization/data-storage-location |
| PostHog EU: app `https://eu.posthog.com`, ingestion `https://eu.i.posthog.com`, hosted in Frankfurt | posthog.com/docs/libraries/js; posthog.com/pricing |
| Vercel `fra1` (Frankfurt) exists; new projects default to `iad1`, so the region must be set in `vercel.json` or project settings; Pro allows several function regions; automatic failover regions are Enterprise only | vercel.com/docs/regions; vercel.com/docs/functions/configuring-functions/region |
| Render offers Frankfurt, Germany | render.com/docs/regions |
| Langfuse EU (`cloud.langfuse.com`) runs in AWS eu-west-1 (Ireland), not Frankfurt | langfuse.com/security/data-regions |

### 5. Hosted Supabase
| Finding | Source |
|---|---|
| Queues (pgmq): enabled under Integrations → Queues; needs Postgres 15.6.1.143 or later. Not exposed through the Data API unless "Expose Queues via PostgREST" is switched on, which creates `pgmq_public` and grants `authenticated` full queue access by default. No plan restriction stated (Pro restriction: **unconfirmed**, none found) | supabase.com/docs/guides/queues/quickstart; …/database/extensions/pgmq |
| pg_cron: enabled under Integrations → Cron or `create extension pg_cron with schema pg_catalog`; recommended at most 8 concurrent jobs, each under 10 minutes. No plan restriction stated | supabase.com/docs/guides/cron/install; supabase.com/docs/guides/cron |
| Custom schemas: add `app` and `ref` under API settings → Exposed schemas, then grant. The guide's sample grants `ALL` to anon and authenticated; the securing-your-API guide says grant only what each role needs and allows switching off automatic exposure of new tables. Revoking EXECUTE from PUBLIC also needs explicit grants for helpers that RLS policies call | supabase.com/docs/guides/api/using-custom-schemas; supabase.com/docs/guides/api/securing-your-api |

### 6. Legal sources (content/sources.yaml)
EUR-Lex returned a bot challenge to every automated request, so identifiers, titles and consolidated versions come
from the Publications Office (the EUR-Lex back end): its SPARQL endpoint publications.europa.eu/webapi/rdf/sparql and
the consolidated texts at publications.europa.eu/resource/celex/{id}. Reader links:
eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:{celex}. A cross-check on the EUR-Lex pages themselves is still to do.

T-201 (23 Oct 2026, own run of `nutrivo sources fetch --dry-run`) confirms every row below and fetched all 40 texts.
The run covered 8 acts × EN, SV, DA, FI and DE, and each text passed the language check. The challenge is AWS WAF:
HTTP 202 with an empty body and `x-amzn-waf-action: challenge`. The fetcher fails it as `source_blocked` and does not
try to pass it. CELLAR needs no key. The text is negotiated with `Accept: application/xhtml+xml` and an ISO 639-2
`Accept-Language` (eng, swe, dan, fin, deu), and the request is redirected (303, on plain http) to the language
manifestation. A version that does not exist answers 404. Recorded responses: worker/tests/recordings/eurlex.

| CELEX | Exists, title matches | Latest consolidated version |
|---|---|---|
| 32009R0767 | Yes (amended by 568/2010, 939/2010, 2017/2279, 2018/1903) | 02009R0767-20181226 |
| 32017R2279 | Yes (amending act, OJ L 328, 12.12.2017) | none (amending act) |
| 32003R1831 | Yes; official wording "additives for use in animal nutrition" | 02003R1831-20210327 |
| 32013R0068 | Yes; amended by 2017/1017, 2019/145, 2020/764 and 2022/1104 (32022R1104 confirmed) | 02013R0068-20220724 |
| 32002L0032 | Yes | 02002L0032-20191128 |
| 31976L0211 | Yes; official wording "certain prepackaged products" | 01976L0211-20190726 |
| 32020R0354 | Yes (amended by 2024/2899 and 2025/639) | 02020R0354-20250422 |
| 32005R0183 | Yes | 02005R0183-20220128 |

EU Register of Feed Additives: since 5 April 2023 the PDF register has been replaced by an online database in the
Food and Feed Information Portal (ec.europa.eu/food/food-feed-portal/screen/feed-additives/search, with a "latest
updates" page). There are no numbered editions any more. Whether it offers a bulk download (CSV or Excel):
**unconfirmed** (the portal is a JavaScript application). Source: food.ec.europa.eu/food-safety/animal-feed/feed-additives_en

### 7. References in content/candidates/eu-core.yaml
Checked only whether each cited provision covers the named subject, against 02009R0767-20181226 and
01976L0211-20190726. No values or wording are recorded here; the candidates file is unchanged (content lane).
| Target | Finding |
|---|---|
| EU.767.TYPE_OF_FEED | Type of feed is Art. 15(a), not Art. 17 (re-read in the consolidated text) |
| EU.767.OPERATOR, BATCH, NET_QUANTITY | Confirmed: Art. 15(b), 15(d), 15(e) |
| EU.767.ESTABLISHMENT_NUMBER | Art. 15(c) covers the establishment approval number "if available" (with Reg. 183/2005 Art. 10); "registration number" is not used there. Art. 17(1)(c) adds the producer's number where the producer is not the labeller |
| EU.767.ADDITIVES_DECLARATION | Art. 15(f) refers to Chapter I of Annex VI or VII "as applicable"; Annex VII covers non-food producing animals (not only pet food); Ch. I is largely as amended by 2017/2279 and 2018/1903 |
| EU.767.MOISTURE | Art. 15(g) refers to point 6 of Annex I only; Annex II is not cited for moisture (re-read in the consolidated text) |
| EU.767.SPECIES_AND_USE, COMPOSITION, MINIMUM_STORAGE_LIFE | Confirmed: Art. 17(1)(a) and (b), 17(1)(e), 17(1)(d) |
| EU.767.ANALYTICAL_CONSTITUENTS | Annex VII Ch. II (as amended by 2017/2279) is referred to from Art. 17(1)(f) and 22(1), not Art. 15 |
| EU.767.EMPHASIS_PERCENTAGE | Art. 17(2)(a), not 17(1) |
| EU.767.PET_FOOD_CONTACT | Confirmed Art. 19; it allows a free telephone number or other appropriate means of communication |
| EU.767.LANGUAGE | Confirmed Art. 14(1) |
| EU.767.CLAIMS_GENERAL | Confirmed: Art. 11(1) and Art. 13(3)(a) (with exceptions in the text) |
| EU.76-211.FIGURE_HEIGHT | The provision is Annex I point 3.1 (as amended). Art. 1 limits the Directive to prepackages in constant nominal quantities within set ranges, and Art. 3 ties compliance to the EEC sign: it is not a general rule for every prepackage |

### 8. Event dates
| Event | Finding | Source |
|---|---|---|
| Breakit | No single main event; Breakit runs themed one-day events. October's is the AI x SaaS Summit, 22 Oct 2026 at SPACE, Stockholm (tomorrow). Still ahead: Funding Day Göteborg 3 Nov 2026; Fintech Day 26 Nov 2026 (Epicenter) | event.breakit.se/ai-saas-summit-2026; event.breakit.se/funding-day-goteborg-2026; event.breakit.se/fintech-day-2026 |
| Slush 2026 | 18–19 Nov 2026, Helsinki (venue not named on slush.org) | slush.org |
| TechArena 2027 | 3–4 Feb 2027, Strawberry Arena, Stockholm | techarena.se/events/techarena-2027 |

### 9. EU AI Act (not legal advice; counsel must confirm)
| Finding | Source |
|---|---|
| Annex III's eight high-risk areas: biometrics; critical infrastructure; education; employment; access to essential private and public services; law enforcement; migration, asylum and border control; administration of justice and democratic processes. None names product-label or feed-compliance checking. Annex I (product-safety legislation) was not checked | ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3 |
| After the AI Act omnibus amendment (in force 27 July 2026) Annex III high-risk obligations apply from 2 Dec 2027 and Annex I ones from 2 Aug 2028 | digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai |
| Counsel's confirmation: **still open** | — |

## Still to verify
1. Counsel's confirmation that label checking is not a high-risk use (Annex III and Annex I).
2. Bedrock per-token prices for the EU profiles; whether the retention setting `none` applies in every Region the EU
   profile routes to; a Bedrock "not used for training" statement.
3. Render background-worker pricing and any Frankfurt difference; the SES eu-central-1 rate; PostHog usage prices;
   which Stripe Tax tier applies through Billing.
4. The consolidated versions in §6 on the EUR-Lex pages themselves; the Feed Additives Register's download format.
5. Haiku 4.5's retirement date on Bedrock (its earliest end-of-life date has passed).

## Conflicts for the founders
Found on 21 Oct 2026. No decision has been changed.
1. **D-02 and D-11 (Bedrock in eu-central-1).** None of the three planned models runs in-Region in Frankfurt. From
   eu-central-1 they are reachable only through the `eu.` cross-Region profile, which may process requests in
   Stockholm, Milan, Spain, Ireland or Paris (all EU). Decide whether the EU profile is acceptable and say so in D-02,
   D-11 and the DPA; never use `global.` profiles (an AWS organisation policy can block them). Set Bedrock retention
   to `none` per Region.
2. **D-11 fallback and non-negotiable 10 (Anthropic API under ZDR).** ZDR requires a contract with Anthropic sales,
   and the API offers no EU processing or storage (inference `global` or `us`; storage `us`). As written, the fallback
   would send customer data outside the EU. Decide: drop the fallback, restrict it to non-customer data, or accept
   it with a DPA change.
3. **D-11 (Haiku 4.5 for triage).** Its earliest Bedrock end-of-life date (16 Oct 2026) has passed; Haiku 5.5 is
   available through the EU profile and lists at a tenth of Haiku 4.5's price. Model ids live in config, so this is a
   choice, not a migration.
4. **D-17 / D-02 (co-located EU services).** Langfuse EU (`cloud.langfuse.com`) is in Ireland, not Frankfurt. Still
   EU; the DPA should name the right region.
5. **docs/11 event dates (a plan, not a decision).** Slush is 18–19 Nov 2026 (not December); TechArena is 3–4 Feb
   2027 (not January); Breakit's October event is 22 Oct 2026, the day after this check.
6. **content/sources.yaml (T-202 input).** The Feed Additives Register has no "current edition" any more; it is an
   online database since 5 April 2023, so the importer needs a different source shape.
7. **content/candidates/eu-core.yaml.** Seven article references are wrong or incomplete (§7). They are candidates,
   not accepted content; the correction belongs to a content-lane task and to K01/K02 acceptance by a person.
8. **Supabase grants (non-negotiable 1, D-05).** Supabase's custom-schema guide grants `ALL` on exposed schemas to
   anon and authenticated, and "Expose Queues via PostgREST" grants authenticated full queue access. Neither may be
   followed; the hosted project needs a minimal-grant setup for `app` and `ref` and Queues left unexposed.
