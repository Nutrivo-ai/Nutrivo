"""All 71 workflows of the Workflow Register (25 Sep 2026), reconstructed for the build.

'db' and 'dep' are the register's own text (from the PDF). Steps, must-hold and failure cases were reconstructed on
8 Oct 2026 from the Handoff, the Backend Action Register and the design files, because the original HTML's text was
unavailable. Scope: BUILD (in the MVP), MANUAL (run by people with scripts or a third-party dashboard), LATER.
Render with: python scripts/workflows/render.py
"""
W = []


def w(id, name, st, scope, ms, who, steps, db, dep, must=(), fail=(), refs=()):
    W.append(dict(id=id, name=name, st=st, scope=scope, ms=ms, who=who, steps=steps, db=db, dep=dep,
                  must=list(must), fail=list(fail), refs=list(refs)))


# ── A · Access ─────────────────────────────────────────────────────────────────────────────────────
w("A01", "Sign up and create a workspace", "DRAWN", "BUILD", "M1", "New user · signs up and confirms the email",
  ["Supabase Auth creates the user (email and password or magic link, confirmation on).",
   "The first authenticated request calls app.create_workspace(name).",
   "One transaction creates the person, the workspace (plan free, regions EU), the admin membership and the allowance (3 labels).",
   "Audit workspace.created; welcome email through O01."],
  "auth.users insert; workspaces insert (region, plan=free, labels_allowed=3); memberships insert (role=admin, external=false); audit_events insert (workspace.created)",
  "Supabase Auth, email delivery, O01 notifications",
  ["A workspace never exists without exactly one admin membership.", "The allowance starts at 3 allowed, 0 used.",
   "If any step fails, nothing persists."],
  ["Email already registered: sign-in path, never a second user.", "Unconfirmed email: cannot create a workspace."],
  ["BE-02", "BE-03", "pgTAP: create_workspace", "e2e: sign up to workspace"])
w("A02", "Sign in and start a session", "PART", "BUILD", "M1", "Member · signs in",
  ["Supabase Auth session.", "Active memberships loaded (not ended, access_ends_at in the future).",
   "More than one workspace: the switcher (N02).", "A person with a signing grant is asked to enrol TOTP.",
   "Audit session.started."],
  "auth.sessions insert; memberships read (role, scope, external, ends_at); signing_grants read (forces 2FA); audit_events insert (session.started)",
  "A01, A08, A09 for SSO",
  ["An expired or ended membership gives no access (BE-03).", "Signing always requires aal2."],
  ["Membership ended: 'access removed' page (Account Recovery design).", "Signer without TOTP: enrol before signing."],
  ["BE-03", "e2e: sign in"])
w("A03", "Invite a member", "DRAWN", "BUILD", "M1", "Admin · People tab",
  ["Admin sets email, role, scope, external flag and an optional end date.",
   "app.invite_member checks editor seats for editor-class roles.",
   "The 'notify' job generates the token, stores only its hash and sends the email.", "Audit invitation.sent."],
  "invitations insert (role, scope, external, ends_at, expires_at); subscriptions read (editor_seats); audit_events insert (invitation.sent)",
  "A01, M02 allowance metering, O01",
  ["Only admins invite.", "The raw token is never stored.", "Viewers never use a seat; external editors do."],
  ["No seat left: P0033, then the upsell from Plans and Checkout.", "A pending invitation exists: resend, never duplicate."],
  ["BE-03", "BE-33"])
w("A04", "Accept an invitation", "DRAWN", "BUILD", "M1", "Invitee · opens the link",
  ["Sign in or sign up.", "app.accept_invitation(token): hash match, not expired, revoked or used; the email must match.",
   "The membership copies role, scope, external flag and end date.", "Audit membership.created with the external flag stamped."],
  "invitations read, mark accepted; auth.users insert or link; memberships insert; audit_events insert (membership.created, external flag stamped)",
  "A03",
  ["One-time and email-bound.", "The external flag is stamped at write time (BE-06)."],
  ["Expired: P0040 and the expired-invite page.", "Different email: P0041.", "Already a member: P0042."],
  ["BE-06"])
w("A05", "Change a role, scope or end date", "DRAWN", "BUILD", "M1", "Admin",
  ["Edit in People.", "app.change_member (to build) checks seats.", "Update the membership; audit before and after."],
  "memberships update; audit_events insert (before and after values)", "A03, M02",
  ["The last admin can never be removed or demoted.", "A role change grants no signing authority (BE-04).",
   "Becoming external revokes signing grants in the same transaction."],
  ["Last-admin demotion refused.", "Seat limit: upsell."], ["BE-04", "BE-06"])
w("A06", "Remove a member", "DRAWN", "BUILD", "M1", "Admin",
  ["app.remove_member (to build) sets ended_at and the reason.", "Signing grants are revoked by trigger.",
   "A 'session_revoke' job signs the person out.", "Audit."],
  "memberships update ended_at; signing_grants update revoked_at; auth.sessions revoke; audit_events insert", "A05, A08, O01",
  ["Past events read exactly as before (BE-06).", "Access ends on the next request."],
  ["Removing the last admin is refused."], ["BE-06", "e2e: removed user loses access"])
w("A07", "Change or reset a password", "DRAWN", "BUILD", "M1", "User",
  ["Supabase Auth change or reset flow.", "Other sessions are revoked.", "Audit the access event, never the secret."],
  "auth.users update password; auth.sessions revoke others; audit_events insert (access event, never the secret)", "A01, O01",
  ["No secret ever reaches logs or audit."], ["Expired link: the Account Recovery page."])
w("A08", "Grant or revoke signing authority", "DRAWN", "LATER", "after launch", "Admin on Advanced",
  ["Grant a person × market node.", "The database refuses external or inactive memberships.", "Audit; revoking sets revoked_at."],
  "signing_grants insert or revoke (person, node_id, granted_by, granted_at); audit_events insert", "A02, A04, M01 (Advanced only)",
  ["Never implied by role; never to an external person (BE-04 gate, already enforced)."],
  ["External person: P0004."], ["BE-04"])
w("A09", "Single sign-on", "NOT DRAWN", "LATER", "after launch", "Admin on Advanced",
  ["SAML connection through Supabase SSO (Pro plan and above).", "Workspace sso_policy.", "Audit."],
  "sso_connections insert; workspaces update sso_policy; audit_events insert", "A02, Supabase SSO")

# ── B · Workspace ──────────────────────────────────────────────────────────────────────────────────
w("B01", "Set the default operator", "DRAWN", "BUILD", "M1", "Admin",
  ["Legal name, address, country and approval or registration number of the business responsible for labelling.",
   "Saved to workspaces.default_operator; products inherit it unless they override.", "Audit."],
  "workspaces update default_operator; audit_events insert", "A01",
  ["Changing it never alters a past check."],
  ["No approval number: allowed; the establishment-number rule then reports Action."])
w("B02", "Use the free label allowance", "DRAWN", "BUILD", "M4", "System · when an artwork is registered",
  ["app.register_artwork decides whether the artwork is new (a product's first).",
   "private.consume_allowance records it once (keyed by artwork version) and increments the counter.",
   "On the free plan a new artwork is refused when all three are used.", "Audit allowance.consumed."],
  "allowances read and increment labels_used; artwork_versions read (is_new_artwork); audit_events insert (allowance.consumed)",
  "C02, D01, M01",
  ["Re-checks, further markets and revised versions never count (BE-32 gate).", "Enforced per workspace."],
  ["Allowance used: P0032 and the upsell; everything checked stays readable, re-checks stay free."], ["BE-32"])

# ── C · Products ───────────────────────────────────────────────────────────────────────────────────
w("C01", "Create a product and family", "DRAWN", "BUILD", "M4", "Editor",
  ["Create or pick a family (the billing unit).", "Create the product: stage, species, life stage, format, operator.",
   "Choose markets: product_nodes rows start not_assessed / unknown.", "Optional formula lines."],
  "families insert (billing unit); products insert (stage, family_id, operator); product_nodes insert per market; formula_lines insert",
  "B01, M02 (family count)",
  ["Products are never deleted (BE-13).", "Paid plans stop at the overage cap and offer the next plan (BE-34)."],
  ["Over the cap: next-plan offer, never a larger invoice."], ["BE-13", "BE-34"])
w("C02", "Create a product from an artwork", "PART", "BUILD", "M3", "Editor · drops a label file on the board",
  ["Signed upload to artwork/<workspace>/<product>/<sha256>.pdf.", "Product created with a provisional name.",
   "app.register_artwork, then extraction."],
  "products insert; artwork_versions insert; extraction_runs insert", "D01",
  ["As D01 and B02."], ["An unsupported file type is rejected before upload."])
w("C03", "Add a variant to a family", "PART", "BUILD", "M4", "Editor",
  ["New product with the existing family_id (pack size or variant)."],
  "products insert (family_id unchanged)", "C01", ["A variant never creates a new billable family."])
w("C04", "Change a product's stage", "DRAWN", "BUILD", "M4", "Editor",
  ["brief → in_development → active → discontinued.", "Audit."],
  "products update stage; audit_events insert", "C01",
  ["Discontinued products leave counts, freshness and monitoring; their documents stay resolvable (BE-13)."], [], ["BE-13"])

# ── D · Label checks ───────────────────────────────────────────────────────────────────────────────
w("D01", "Upload artwork and extract", "PART", "BUILD", "M3", "Editor",
  ["Upload, then app.register_artwork.",
   "The 'extract' job reads page size and true scale, panels, the language of each panel, and text objects with bounding box, x-height and cap-height.",
   "Typed failures per panel; successful panels persist.", "Progress over Realtime."],
  "storage.objects insert; artwork_versions insert (sha256); artwork_panels insert per language; text_objects insert (bbox, x_height, cap_height)",
  "Supabase Storage, extraction pipeline, Realtime",
  ["One row per printed panel (BE-16).", "Both heights on every text object (BE-17).",
   "Partial results with named failures, never one file-level error (BE-18).", "Idempotent per file hash."],
  ["Raster or photo: not_assessable 'rasterised'; geometry is never guessed.", "Outlined text: 'outlined_text'.",
   "Fonts not embedded: 'missing_font'."], ["BE-16", "BE-17", "BE-18", "worker gates"])
w("D02", "Triage panels", "DRAWN", "BUILD", "M3", "Editor",
  ["Detected panels and languages shown over the artwork.", "A person corrects a language or marks a panel not assessable with a reason."],
  "artwork_panels update status; check_findings insert (not_assessed, reason_code)", "D01",
  ["A panel that cannot be assessed produces Not assessed findings with a reason code, never silence."])
w("D03", "Classify the product", "DRAWN", "BUILD", "M4", "Editor confirms",
  ["The worker suggests species, life stage, product class, intended use and PARNUT status from the label text, with a citation.",
   "A person confirms or edits.", "Stored as an insert-only record with citation and provenance."],
  "classifications insert (basis, provenance, confirmed_by)", "D01, K05 ruleset",
  ["Classification comes before any rule (BE-19).", "A new classification makes the previous check stale (new job key)."],
  ["The model is unsure: fields are left empty for the person, never guessed."], ["BE-19"])
w("D04", "Run a check", "DRAWN", "BUILD", "M4", "Editor or system",
  ["app.request_check enqueues the product × markets.",
   "Per node × language panel: applicable rules, evaluators, then passed, action or withheld.",
   "One app.checks row with its findings in one transaction; product_nodes updated; Realtime."],
  "checks insert (INSERT ONLY); applied_rules insert (applied | passed | withheld); check_findings insert (state, provenance, rule_id, gap_id); product_nodes update state, ruleset_version",
  "K05, K04 coverage, D03",
  ["No rule, no verdict, enforced by the database (BE-21).", "Claims judged on the printed language (BE-22).",
   "Applied, passed and withheld recorded (BE-23).", "Provenance on every finding."],
  ["No released ruleset: P0003.", "Model unavailable: claim rules withheld 'model_unavailable'."],
  ["BE-21", "BE-22", "BE-23", "contract 1"])
w("D05", "Check type size", "PART", "BUILD", "M5", "System",
  ["The character_height evaluator compares the measured height (the definition the rule names) with the minimum.",
   "The finding carries bbox, measured_mm, required_mm and height_definition."],
  "check_findings insert (bbox, measured_mm, required_mm)", "D01, D04",
  ["No true scale: withheld 'no_true_scale', never estimated."], ["Outlined figures: withheld 'outlined_text'."],
  ["BE-17", "contract 2"])
w("D06", "Check registration", "DRAWN", "BUILD", "M5", "System",
  ["Read ref.obligations and app.registrations for each node.", "Set registration_state.", "Findings of kind registration."],
  "obligations read; registrations read; check_findings insert (kind=registration)", "G01, G03",
  ["Unknown never displays as Clear; not registered renders Blocked (BE-14)."], [], ["BE-14", "contract 3"])
w("D07", "View the results", "DRAWN", "BUILD", "M4", "Member",
  ["The label report: a language switcher over per-panel result sets.",
   "Findings pinned on the artwork with measured against required heights.", "A Not assessed section linking to coverage gaps."],
  "checks, check_findings, applied_rules read", "D04",
  ["One result set per language panel (contract 1).", "Every Not assessed links to its gap (contract 4)."])
w("D08", "Re-check a new artwork version", "DRAWN", "BUILD", "M5", "Editor",
  ["Upload a revision (no allowance used).", "Check it; earlier checks stay."],
  "artwork_versions insert; checks insert (INSERT ONLY)", "D04, J05",
  ["Revisions are free (BE-32).", "History is never rewritten (BE-05)."])
w("D09", "View coverage for a product", "DRAWN", "BUILD", "M5", "Member",
  ["Coverage nodes and gaps for the product's markets at the pinned ruleset."],
  "coverage_nodes, coverage_gaps read", "K04", ["The same table as the public page (BE-10)."])

# ── E · Briefs ─────────────────────────────────────────────────────────────────────────────────────
w("E01", "Create a brief", "DRAWN", "BUILD", "M10", "Editor",
  ["Product at stage brief.", "Formula lines.", "Intended claims per language."],
  "products insert (stage=brief); formula_lines insert; intended_claims insert", "C01")
w("E02", "Compute the compliance envelope", "DRAWN", "BUILD", "M10", "System",
  ["Evaluate the formula and claims against accepted rules (additive_condition, threshold, prescribed_wording).",
   "Required particulars, permitted and prohibited wording per language, limits, obligations, withheld items with gaps.",
   "Cached by inputs_hash."],
  "envelopes insert (ruleset_version, inputs_hash); envelope_items insert (kind, rule_id, provenance)", "K05, K03 term register, G01",
  ["The same honesty as D04: anything not encoded is withheld with its gap.",
   "Nutrient adequacy stays out of scope until FEDIAF is licensed."])
w("E03", "Apply a Worker proposal to a formula", "DRAWN", "LATER", "after launch", "Editor",
  ["The Worker proposes; a person applies (applied_by)."],
  "worker_proposals insert; formula_lines update (applied_by = person); audit_events insert", "L02, E02")
w("E04", "Promote a brief to artwork", "PART", "BUILD", "M10", "Editor",
  ["Stage becomes in_development.", "Upload artwork (D01)."],
  "products update stage; artwork_versions insert", "C04, D01")

# ── F · Portfolio ──────────────────────────────────────────────────────────────────────────────────
w("F01", "Portfolio board", "DRAWN", "BUILD", "M5", "Member",
  ["Products × grouped market columns.", "Region cells from app.rollup_state.", "Filters; discontinued hidden."],
  "product_nodes read; jurisdictions read (tree)", "D04",
  ["A parent is never better than its worst child, computed in the database (BE-15)."], [], ["BE-15"])
w("F02", "Search and saved views", "NOT DRAWN", "LATER", "after launch", "Member",
  ["Postgres full-text over recipe, family, market and rule id.", "Saved views shared across the workspace (BE-41)."],
  "Postgres FTS indexes; saved_views insert", "F01")
w("F03", "Bulk re-check", "NOT DRAWN", "LATER", "after launch", "Portfolio manager",
  ["Multi-select excluding discontinued products.", "One append-only event per recipe (BE-42).", "Progress over Realtime."],
  "check_jobs insert; checks insert per pair", "D04, J05")
w("F04", "Portfolio findings", "DRAWN", "BUILD", "M5", "Member",
  ["Open findings across products and markets, filterable."], "checks, check_findings read", "D04")

# ── G · Registrations ──────────────────────────────────────────────────────────────────────────────
w("G01", "Obligations per market", "DRAWN", "BUILD", "M5", "Member",
  ["Render ref.obligations for the product's markets.", "Missing fields read 'not held' (BE-12)."],
  "obligations read (authority, route, fee, deadline, source); registrations read",
  "Obligation data (content operations, not automatable)",
  ["Obligation data is researched, sourced and dated, never generated."], [], ["BE-12"])
w("G02", "Registration pack", "DRAWN", "MANUAL", "M5", "Customer assembles; the product checklists",
  ["A read-only checklist from the obligation's evidence list against the workspace's documents.",
   "The customer files with the authority."],
  "registration_packs insert; documents read", "G01, H01, I03 if a signature is required",
  ["Never build an endpoint that submits to an authority (Handoff §07)."])
w("G03", "Record a registration", "PART", "BUILD", "M5", "Editor",
  ["Number, date, expiry and evidence document.", "registration_state recomputed."],
  "registrations insert (number, date, expires_at, evidence_doc_id, recorded_by)", "G02, H04")

# ── H · Documents ──────────────────────────────────────────────────────────────────────────────────
w("H01", "Document library", "DRAWN", "BUILD", "M8", "Member",
  ["Documents against ref.document_requirements per market and product class.", "Expiry shown."],
  "documents read; document_requirements read", "Supabase Storage")
w("H02", "Request a document from a supplier", "DRAWN", "BUILD", "M8", "Editor",
  ["Supplier upserted; request created.", "The worker generates the token, stores only its hash and emails the link (14-day expiry)."],
  "document_requests insert (token, scope, expires_at); suppliers upsert", "O01", ["The raw token is never stored."])
w("H03", "Supplier uploads through a link", "DRAWN", "BUILD", "M8", "Supplier without an account",
  ["Edge Function 'supplier-upload' checks the token, MIME type, magic bytes and size (25 MB).",
   "The file lands in quarantine; the worker scans it, then promotes it.", "The request is marked fulfilled."],
  "documents insert via edge function (token-scoped); document_requests update fulfilled", "H02",
  ["The token reaches one request and nothing else; single use for upload."],
  ["Expired or used token: a generic error that reveals nothing."])
w("H04", "Expiry reminders", "PART", "BUILD", "M8", "System",
  ["A daily pg_cron job finds documents and registrations expiring in 60, 30 and 7 days.", "Notifications and email."],
  "documents, registrations read; notifications insert", "H01, G03, O01")

# ── I · Reports and verification ───────────────────────────────────────────────────────────────────
w("I01", "Generate a report", "DRAWN", "BUILD", "M4", "Member",
  ["The worker renders the PDF (WeasyPrint) from the check events.",
   "Reference: 128 random bits in base32; ruleset version, artwork hash and timestamp on its face.",
   "The Not assessed section is always present; the report row is insert-only."],
  "reports insert (check_id, ref, ruleset_version, artwork_sha)", "D04",
  ["The same reference re-rendered a year later produces the same document (BE-26)."], [], ["BE-26"])
w("I02", "Share a report", "DRAWN", "BUILD", "M6", "Member",
  ["Share link (token hash, optional expiry) or email.", "Access logged."],
  "shares insert (report_id, channel, recipient); audit_events insert", "I01, M01",
  ["Revoking a link stops the page, never verification of the document (BE-27)."], [], ["BE-27"])
w("I03", "Sign a certificate", "DRAWN", "LATER", "after launch (database ready)", "Signer on Advanced",
  ["app.issue_certificate checks the grant for the node, aal2 and zero open findings.", "Hash chain per workspace."],
  "certificates insert (INSERT ONLY, prev_hash, signer, grant_id)", "A08, D04, M01 Advanced",
  ["Preconditions live in the database and the error names the one that failed (BE-29)."],
  ["No grant: P0291. No two-factor: P0292. Open findings: P0293."], ["BE-29"])
w("I04", "Public verification", "DRAWN", "BUILD", "M4", "Anyone holding a reference",
  ["Edge Function 'verify' calls public.verify_reference only.",
   "Answers current, superseded or unknown, with issue date, ruleset version and whether Not assessed items existed."],
  "edge fn read reports, certificates by ref", "I01, I05",
  ["The anon role reads no table (BE-28).", "Independent of the subscription: a closed workspace still verifies."],
  ["Unknown reference: 'unknown', revealing nothing about similar references."], ["BE-28", "BE-36", "contract 8"])
w("I05", "Supersede documents on a material change", "BACKEND", "MANUAL", "M9", "Staff-run job after a release",
  ["After a material rule diff, mark affected reports and certificates superseded."],
  "supersessions insert (artefact_id, rule_id, ruleset_version)", "J02, J03",
  ["Editorial diffs never supersede; superseded is never 'invalid' (BE-30)."], [], ["BE-30"])

# ── J · Regulatory change ──────────────────────────────────────────────────────────────────────────
w("J01", "Horizon scanning", "BACKEND", "MANUAL", "M2, then weekly", "Founder with scripts",
  ["Scripts poll EUR-Lex and the Official Journal.", "A model triages new items.", "A person records horizon items."],
  "sources read; horizon_items insert (stage, expected_date)", "Crawlers, K01",
  ["A proposal never appears as law or with an effective date (BE-37)."], [], ["BE-37"])
w("J02", "Version rules and type their diffs", "BACKEND", "BUILD", "M2", "Staff in /admin",
  ["A change is a new rule version that supersedes the previous one.",
   "The release writes diffs typed by effect, with effective_from and sell_through_until."],
  "rule_versions insert (supersedes); rule_diffs insert (effect_type, effective_at, sell_through_at)", "K05",
  ["Accepted versions are permanent (BE-08).", "Editorial diffs create no alert (BE-09)."], [], ["BE-08", "BE-09"])
w("J03", "Impact analysis and alerts", "PART", "BUILD", "M9", "System",
  ["The 'diff_fanout' job runs app.affected_objects for each non-editorial diff.",
   "Alerts coming or in force per product × market, with dates."],
  "applied_rules read (join); alerts insert (coming | in_force)", "D04 applied-rule recording, J02",
  ["Alerts name recipes through the applied-rule join (BE-24).", "Read state is per person (BE-39)."],
  [], ["BE-24", "BE-39", "contract 5"])
w("J04", "Horizon and alerts inbox", "DRAWN", "BUILD", "M9", "Member",
  ["Inbox organised as in force, coming and draft, with effective dates and the recipes affected."],
  "horizon_items, alerts read", "J01, J03",
  ["An alert for a region outside the plan names recipes but cannot open the finding (BE-39)."])
w("J05", "Re-check affected products", "BACKEND", "MANUAL", "M9", "Staff-triggered job",
  ["Scoped re-check: only the changed rules, on the affected panels and markets (BE-25).", "One event per recipe (BE-42)."],
  "check_jobs insert; checks insert", "J03, D04",
  ["A one-rule change across N recipes runs only the scoped evaluations."], [], ["BE-25", "BE-42"])

# ── K · Content operations ─────────────────────────────────────────────────────────────────────────
w("K01", "Extract rule candidates", "BACKEND", "MANUAL", "M2", "Staff with scripts",
  ["First extraction from the stored official text into ref.rule_candidates with the article and the verbatim excerpt."],
  "rule_candidates insert (source_ref, article)", "Extraction pipeline",
  ["Never from memory; FEDIAF and AAFCO are never sources."])
w("K02", "Second extraction and agreement", "BACKEND", "MANUAL", "M2", "Staff with scripts",
  ["An independent second extraction (different prompt, and model where possible).", "agree computed field by field.",
   "Disagreements go to a person (BE-38)."],
  "rule_candidates update (second_value, agree)", "K01",
  ["Nothing reaches the rules on extraction alone."], [], ["BE-38"])
w("K03", "Term register", "DRAWN", "BUILD", "M2", "Staff in /admin",
  ["Prescribed designations per language from the official language versions.", "Accept or reject decisions, insert-only."],
  "term_entries insert; term_decisions insert (INSERT ONLY)", "K01, K02",
  ["Never derived from an English row or translated (BE-11)."], [], ["BE-11"])
w("K04", "Coverage management", "PART", "BUILD", "M2", "Staff in /admin",
  ["Set each market × domain state with method and last-checked date.", "Open and close typed gaps."],
  "coverage_nodes update; coverage_gaps insert or close", "K03",
  ["Complete only when every rule the domain needs is accepted and tested (BE-10)."], [], ["BE-10"])
w("K05", "Release a ruleset", "BACKEND", "BUILD", "M2", "Staff in /admin",
  ["A staff RPC checks that every member is accepted and its fixtures pass.",
   "Writes the immutable release with coverage, gaps and typed diffs."],
  "ruleset_versions insert (immutable)", "K03, J02",
  ["No release without passing fixtures."])

# ── L · Compliance Worker (BE-43: deliberately after launch) ───────────────────────────────────────
w("L01", "Ask the Compliance Worker", "DRAWN", "LATER", "after launch", "Member",
  ["Retrieval over ref and coverage; provenance on every answer; glossary returned verbatim."],
  "worker_threads, worker_messages insert (provenance)", "K05, model provider",
  ["Built only after coverage is queryable and real (BE-10, BE-21)."], [], ["BE-43"])
w("L02", "Apply a Worker proposal", "DRAWN", "LATER", "after launch", "Member",
  ["The Worker proposes; a person applies the change to the target table."],
  "worker_proposals insert (status); target table update (by person)", "L01")
w("L03", "Worker refuses outside coverage", "DRAWN", "LATER", "after launch", "System",
  ["Three refusal states: not encoded, data missing, I do not know; each links its coverage node."],
  "worker_messages insert (refusal_code)", "K04")

# ── M · Billing ────────────────────────────────────────────────────────────────────────────────────
w("M01", "Subscribe", "DRAWN", "BUILD", "M7", "Admin",
  ["The plan picker reads live counts (BE-33).", "Stripe Checkout with tax-ID collection and automatic tax.",
   "The webhook updates the subscription mirror and the workspace plan."],
  "subscriptions insert; billing_details upsert; payment_events insert; invoices insert", "Stripe, VIES, M03",
  ["Prices are net; VAT is added on the invoice (BE-35)."], [], ["BE-33", "BE-35"])
w("M02", "Meter the dials", "DRAWN", "BUILD", "M7", "System",
  ["Recipes, regions and editor seats counted live.", "Past 1.5x list the next plan is offered instead (BE-34)."],
  "allowances update; subscriptions read", "C01, A03", ["Counts are read at request time, never nightly."], [], ["BE-33", "BE-34"])
w("M03", "Invoices and VAT", "DRAWN", "BUILD", "M7", "System (Stripe)",
  ["Stripe Tax: Swedish VAT, EU reverse charge on a validated number, one-stop shop otherwise, zero outside the EU."],
  "invoices insert (vat_treatment, lines)", "M01, Stripe",
  ["A German company with a valid VAT number pays zero VAT and the invoice states the reverse charge."], [], ["BE-35"])
w("M04", "Payment events and dunning", "DRAWN", "BUILD", "M7", "System",
  ["Webhook events stored once by id.", "Days 0, 3, 7: notify and retry.", "Day 14: new artworks stop."],
  "payment_events insert; subscriptions update status", "M01, O01",
  ["Nothing is ever deleted; verification never breaks (BE-36 gate)."], [], ["BE-36"])
w("M05", "Cancel, downgrade or suspend", "PART", "BUILD", "M7", "Admin",
  ["Through the Stripe customer portal; the workspace status follows."],
  "subscriptions update; workspaces update status", "M01",
  ["Data stays; export stays free (BE-44)."])
w("M06", "Change regions", "DRAWN", "MANUAL", "M7", "Staff in the Stripe dashboard",
  ["Region items changed in Stripe; the webhook mirrors them."], "subscriptions update regions", "M01")

# ── N · Partners ───────────────────────────────────────────────────────────────────────────────────
w("N01", "Become a partner", "DRAWN", "LATER", "after launch", "Consultant or agency",
  ["Partner record and confirmed links to client workspaces (€1,499 per 10)."],
  "partners insert; partner_workspaces insert (confirmed_at)", "M01, A03")
w("N02", "Switch workspace", "DRAWN", "BUILD", "M1", "Member of several workspaces",
  ["The switcher lists the person's active memberships and changes context."],
  "partner_workspaces read", "N01, A02",
  ["RLS never joins across workspaces; switching changes context only."])
w("N03", "Partner prompt", "DRAWN", "LATER", "after launch", "System",
  ["Suggest the Partner tier to people in several workspaces; remember a dismissal."],
  "memberships count by person; prompts insert (dismissed)", "A04")

# ── O · Operations ─────────────────────────────────────────────────────────────────────────────────
w("O01", "Notifications", "PART", "BUILD", "M6", "System",
  ["In-app notifications with per-person read state.", "Email through SES for the six written templates.", "Preferences."],
  "notifications insert; notification_prefs read", "Email delivery",
  ["Editorial ruleset changes never notify."], [], ["BE-39", "BE-40"])
w("O02", "Audit log", "DRAWN", "BUILD", "M1", "Admin or portfolio manager",
  ["Read app.audit_events with the stamped external flag; filters."],
  "audit_events read (INSERT ONLY)", "Every workflow above",
  ["External work reads as external forever (contract 7)."], [], ["BE-05", "BE-06"])
w("O03", "Export everything", "PART", "BUILD", "M8", "Admin",
  ["An export job writes recipes, checks, findings, reports, certificates and documents with ruleset_version on every row.",
   "A zip in the exports bucket behind a 7-day signed URL."],
  "export_jobs insert; storage signed URL", "O02",
  ["Free on every plan, never gated (BE-44)."], [], ["BE-44"])

# ── P · Public ─────────────────────────────────────────────────────────────────────────────────────
w("P01", "Public coverage page", "DRAWN", "BUILD", "M6", "Anyone",
  ["The page reads public.coverage_snapshot() at request time."],
  "coverage_nodes, coverage_gaps read via public view", "K04",
  ["It shows only released coverage: no invented numbers, no named specialists (D-19)."], [], ["BE-10"])
w("P02", "Pricing page", "DRAWN", "BUILD", "M6", "Anyone",
  ["Static, from config/pricing.ts: the same values as the Stripe catalogue."],
  "static, with prices from config", "M01", ["Plan names and prices match docs/08-billing.md."])
