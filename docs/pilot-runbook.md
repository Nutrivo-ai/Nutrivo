# Pilot onboarding runbook

How a founder brings a pilot customer onto production Nutrivo, from the first call to their first verifiable report.
The customer does every step in the app under their own account. The founder sits alongside, and never uses staff
tools or the service role to do it for them. Each step names the workflow spec it follows (docs/workflows/); what a
screen offers today is that spec's Status line, which this runbook does not repeat.

## 0 · Before the pilot
- **Launch criteria.** Paying pilots start once gate G9 is signed (docs/21-launch-criteria.md, T-1107).
- **Commercial terms.** **Open (#84):** pilot price, discount, length and what happens at the end are not decided.
  Default: pilots pay list prices from `config/pricing.ts` through normal Checkout; anything else waits for a
  founder decision recorded in docs/02-decisions.md.
- **Legal.** The customer accepts the terms, DPA and privacy policy that counsel reviewed (docs/21 §8), published
  under `/legal`. This runbook adds nothing to them.
- **Coverage.** Open the public coverage page (`/coverage`, from `public.coverage_snapshot`) with the customer and go
  through the markets and product types they sell. Anything not fully encoded comes back as Not assessed with a reason,
  never Clear (CLAUDE.md non-negotiable 3). Say so before the first check, not after it.
- **Their artwork.** **Open (#84):** whether a pilot's artwork may become a golden label (docs/19 says golden labels
  are added from pilots). Default: never without the customer's written consent, and only after the label is
  anonymised by a person.

## 1 · Account and workspace (A01, A02)
1. The customer signs up at `/sign-in` with their work email and confirms it. Consumer email domains are refused at
   sign-up (docs/09).
2. `/onboarding` creates the workspace (`app.create_workspace`): plan free, region EU, the customer as its admin, and an
   allowance of three labels.
3. Recommend TOTP for every admin at `/auth/mfa` (docs/09). It is required only for signing, which is not part of the
   launch.

## 2 · The business behind the labels (B01)
In onboarding, or later in Settings → Workspace, the admin enters the default operator: legal name, address, country
and approval or registration number (`app.set_default_operator`). Products inherit it. Without an approval number the
establishment-number rule reports Action; that is correct, not a fault.

## 3 · People (A03, A04, A05)
1. Settings → People → invite each person with a role, a scope and, for consultants, the external flag and an end
   date (`app.invite_member`). Editor-class roles use a seat; viewers never do.
2. The invitee opens the emailed link (`/invite/<token>`), signs in or signs up with the invited address, and joins
   (`app.accept_invitation`). Links are one-time and bound to that email.
3. Wrong role or scope later: Settings → People (`app.change_member`).

## 4 · Plan (M01, M02)
1. Billing → Plans shows the smallest plan that holds the workspace's live counts (`app.live_billable_counts`).
2. Checkout is Stripe-hosted, with tax-ID collection; prices are net and VAT is added on the invoice (docs/08).
3. Stripe's webhook reaches the `stripe-webhook` Edge Function, which stores the event (`app.record_stripe_event`); the
   worker applies the subscription (`app.apply_subscription`). The new plan then shows in Settings → Billing. If it
   does not, see [incident-response.md](runbooks/incident-response.md) §3, "Stripe webhooks failing".

## 5 · First products and the first check (C01, C02, D01–D04, D07)
1. Products → New, or start from a label (`app.create_product`, `app.create_product_from_artwork`). Choose the markets
   (`app.add_product_markets`): each starts not assessed.
2. Upload the artwork (`app.register_artwork`). Extraction runs in the worker; panels are triaged per language (D02).
3. Confirm the classification (`app.confirm_classification`).
4. Run the check (`app.request_check`).
5. Read the results together (D07): per market and per printed language panel, each result with its rule and citation,
   and Not assessed items with their reason. Explain that Not assessed means Nutrivo has no encoded rule for it yet,
   not that the label passed.

## 6 · Report and verification (I01, I02, I04)
1. The report of a check pins the ruleset version and the artwork hash and always carries the Not assessed section
   (`app.request_report`, I01). What the screens offer for generating, downloading and sharing it is in the Status
   lines of docs/workflows/I01.md and docs/workflows/I02.md.
2. Anyone can check a report's reference at `/verify` (`public.verify_reference`, I04). It keeps verifying after the
   subscription ends (non-negotiable 9).

## 7 · During the pilot
- **Watch it.** Sentry events carry the workspace as a hash, never its name (docs/17). Failed jobs show the customer a
  retry; a pattern of them is an incident ([incident-response.md](runbooks/incident-response.md)).
- **Limits.** Requests over the rate limits are refused with "Too many requests" (docs/09); the allowance and plan
  limits are shown on Billing → Plans.
- **Feedback.** Each product question from the pilot becomes an issue; a wrong or missing rule goes to content
  operations (docs/12) and is never fixed by hand in the database.

## 8 · End of the pilot
- **Data.** The customer can export their data from Settings → Data (`app.request_export`).
- **Verification.** Reports keep verifying whatever happens to the subscription (non-negotiable 9).
- **Ending or not renewing.** The subscription ends in Stripe; dunning and plan limits follow docs/08. **Open (#84):**
  what a pilot that does not convert keeps, and for how long. Default: the same as any other cancelled subscription.
