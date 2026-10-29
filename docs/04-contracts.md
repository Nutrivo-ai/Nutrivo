# 04 · Contracts the screens assume

The Handoff's eight response shapes. If an endpoint cannot return one of these, stop: the screen would need a
redesign rather than wiring.

| # | The screen shows | Satisfied by |
|---|---|---|
| 1 | Per-language result sets, each with its own findings (label report switcher) | One `app.checks` row per node × panel with `language`, its `app.check_findings` |
| 2 | Coordinates and both height measurements (artwork pins) | `app.text_objects` (bbox_mm, x_height_mm, cap_height_mm); findings carry bbox_mm, measured_mm, required_mm, height_definition |
| 3 | Registration state on the product-market row (board, registration pack) | `app.product_nodes.registration_state` and `display_state`; `app.rollup_state(product, node)` |
| 4 | Typed withheld reason codes resolving to gap ids (every Not assessed) | `check_findings.reason_code` + `gap_id` → `ref.coverage_gaps` (enforced by a check constraint) |
| 5 | Affected-object query (alerts, bulk re-check) | `app.affected_objects(rule_diff_id)`: a join over the applied-rule arrays |
| 6 | Live billable counts (plan picker) | `app.live_billable_counts(workspace_id)`, read at request time |
| 7 | External flag stamped at write time (audit log) | `app.audit_events.actor_is_external`, `app.checks.actor_is_external` |
| 8 | Verification by unguessable reference, no table access | Edge Function `verify` → `public.verify_reference(ref)` only |

## RPCs (writes go through these; more are added per milestone in the same pattern)
| Function | Workflow | Notes |
|---|---|---|
| `app.create_workspace(p_name)` | A01 | person, workspace, admin membership, allowance, audit |
| `app.invite_member(p_ws, p_email, p_role, p_is_external, p_scope_family_ids, p_scope_node_ids, p_access_ends_at)` | A03 | seat check (P0033); the worker generates and emails the token. An address with a pending invitation in the workspace gets it resent: same id returned, no new row, expiry renewed to 7 days, audited `invitation.resent`; role and scope stay (revoke to change them). Renewing a lapsed editor-class invitation is seat-checked like a new one (P0033, row unchanged); one within its expiry claims nothing new. A new `notify` job (`invite:<id>:resend:<n>`) is queued unless one for the invitation is still queued or running (`after.email_queued`) |
| `app.accept_invitation(p_token)` | A04 | one-time, email-bound; locks the invitation, so a concurrent revoke wins |
| `app.register_artwork(p_product, p_storage_path, p_sha256, p_file_name, p_mime)` | D01, B02 | idempotent per file hash; allowance; dunning; enqueues extraction |
| `app.request_check(p_product, p_nodes)` | D04 | job key = artwork, ruleset, classification, nodes |
| `app.issue_certificate(p_report, p_node)` | I03 (after launch) | grant, two-factor, zero open findings; hash chain |
| `app.rollup_state`, `app.affected_objects`, `app.live_billable_counts` | F01, J03, M01 | read functions |
| `app.change_member(p_membership, p_role, p_is_external, p_scope_family_ids, p_scope_node_ids, p_access_ends_at)` | A05 | the whole editable state (null scope = all, null end = none); seat check only when it starts using a seat (P0033); last admin (P0043); becoming external revokes signing grants; never grants any |
| `app.remove_member(p_membership, p_reason)` | A06 | ends the membership, revokes signing grants, enqueues `session_revoke`; last admin (P0043); idempotent |
| `app.revoke_invitation(p_invitation)` | A03 | cancels the queued invitation email; accepted ones refused (P0040); idempotent |
| `app.set_default_operator(p_ws, p_operator)` | B01 | `{name, address, country, approval_number?}`; approval number optional; audited before and after |
| `app.accept_candidate(p_candidate, p_use, p_title, p_shape, p_domain, p_node, p_applicability, p_effect_type, p_effective_from, p_sell_through_until)` | K03, J02 | staff only (42501); refuses a decided candidate, one whose second key has not run, or a chosen key (`first`/`second`) that is not verified and found (22023). params, article_ref, source_excerpt and source_id come only from that stored extraction; both extractions are kept. Refuses a candidate whose source is not a stored eurlex text. Writes the rule's next version as accepted by the caller, superseding its latest accepted version; effect_type is required (never editorial for a rule's first version), applicability must be the docs/05 predicate language. A new rule key needs title, shape, domain and node; an existing one keeps them. Returns `{rule_key, version, supersedes_version}` |
| `app.reject_candidate(p_candidate, p_note)` | K03 | staff only; audited with the note |
| `app.decide_term(p_term_entry, p_decision, p_note)` | K03 | staff only; `accept` or `reject` (`amend` refused until defined, #34); inserts `ref.term_decisions`; accepting needs a stored eurlex source in the entry's own language (BE-11) and no other accepted entry for the key and language |
| `app.open_coverage_gap(p_gap_id, p_node, p_domain, p_reason_code, p_description)` | K04 | staff only; `opened_in` is stamped by the release that first refers to it |
| `app.create_ruleset_draft(p_id, p_notes)`, `app.set_draft_member(p_draft, p_rule_key, p_version)`, `app.set_draft_coverage(p_draft, p_node, p_domain, p_state, p_method, p_last_checked_at, p_gap_id)` | K04, K05 | staff only; a draft starts as the latest release's members and coverage and changes until released; members are accepted versions only (P0038), never older than the previous release's pin (22023, #34), a null version removes one; coverage rows are only changed, never added (22023); complete needs a member held on the node or its region in that domain, every such member tested with passed, failed and withheld fixtures (P0010); other states need an open gap of that node and domain |
| `app.release_ruleset(p_draft, p_notes)` | K05, J02 | staff only; refuses (P0039) a draft with no members, a member without passed, failed and withheld fixtures, or whose latest `ref.fixture_runs` row (by insertion order) did not pass, did not judge every fixture (`private.ruleset_draft_fixture_count`) or no longer matches `private.ruleset_draft_digest`; refuses a node without all six domains (P0010); refuses a draft started before the latest release, one that drops or downgrades a previous member (#34), or a stepped-over version without effect_type (22023). Writes ruleset_versions, members, coverage (rules_encoded counted), gap opened_in/closed_in, the previous glossary, one rule_diff per accepted version a member steps over since the previous release (each typed by its own effect and dates), one `diff_fanout` job per non-editorial diff; audited `ruleset.released`. Returns `{ruleset_version, previous, diffs, fanout_jobs}` |
| `app.request_export(p_ws, p_request_id)` | O03 | internal, unscoped admins only (`private.can_export`; 42501 for anyone else, external or scoped admins included); free on every plan, never gated by plan, allowance, subscription, dunning or workspace status (BE-44); returns the open `export` job while one is queued or running, else enqueues a new one (`export:<ws>:<uuid>`) with `{request_id}` only (dropped unless a plain token) and audits `export.requested`. The worker writes `exports/<ws>/<job_id>.zip` and puts `{stage, bucket, path, bytes, sha256}` in `progress`, never a URL; over 50 MB the job fails as `export_too_large`, never truncated. The web signs a link under the admin's session for the rest of the 7 days |
| `app.my_ended_access(p_ws)` | A02 | read for S-REC-004: `{workspace_name, ended_on, admin_name, admin_email}` only to a person whose own membership there ended or expired and who has no active one; null for anybody else, so it discloses nothing NoAccess does not; the admin named is one who was already in the workspace before access ended (null when none is still active); never says why access ended |

## Edge Functions
`verify` (GET `/verify/{ref}`, anon) · `supplier-upload` (POST with a request token; validates token, MIME, magic
bytes, size ≤ 25 MB; writes to the quarantine bucket) · `stripe-webhook` (POST; verifies the signature; writes
`app.payment_events` idempotently by event id).

## Worker jobs
Payloads hold ids only; outcomes land in `app.jobs.progress` (ids, counts and an `outcome` code, never names, emails
or tokens).
| Kind | Payload | Does | `progress.outcome` |
|---|---|---|---|
| `notify` (template `invitation`) | `{template, invitation_id}`; key `invite:<id>`, a resend `invite:<id>:resend:<n>` | A03: mints a 32-byte token, stores its SHA-256 in `app.invitations.token_hash` while the invitation is pending, emails `${APP_BASE_URL}/invite/<token>` (Template 02). Never sends twice once `progress.email = sent`; a retry after a failed send mints a new token that replaces the undelivered one | `sent` · `already_sent` · `skipped_revoked` · `skipped_accepted` · `skipped_expired` · `skipped_not_pending` |
| `diff_fanout` | `{rule_diff_id}`; key `diff_fanout:<rule_diff_id>`; no workspace | J03 (T-901): queued by `app.release_ruleset` for each non-editorial diff, never for an editorial one (BE-09) | (T-901) |
| `notify` (template `report`) | `{template, share_id}`; key `share:<id>` (T-601) | I02, Template 01 to `app.shares.recipient` (channel `email`), email only, no row. Mints the share's token like the invitation and stores its SHA-256 in `app.shares.token_hash` while the share is live (the RPC inserts a placeholder hash); emails `${APP_BASE_URL}/share/<token>`. Counts over `reports.check_ids`: Clear = passed rules, Action needed and Not assessed = findings in that state, Blocked = the report's markets whose `product_nodes.display_state` is blocked | `sent` · `already_sent` · `skipped_revoked` · `skipped_expired` · `skipped_not_pending` |
| `notify` (template `rule_changed`) | `{template, rule_diff_id}`, job workspace = the affected workspace; key and timing (the design's daily batch) are J03's (T-901) | Template 03 and kind `rule_changed` (severity `warning`, `object_ref` `{rule_diff_id, product_ids}`) to each active member whose scope holds an affected product (contract 5), naming their recipes. Gated per person and channel | `sent` · `partly_sent` · `already_sent` · `skipped_editorial` (O01.must.1) · `skipped_no_impact` |
| `notify` (template `document_expiring`) | `{template, document_id, notice_days, person_ids}`: 60, 30 or 7; `person_ids` are the pack owners the producer names (H04, T-803); key `doc:<id>:<days>` | Template 04 and kind `document_expiring` (`warning`, `{document_id, notice_days}`) to those people, plus the admins on the 7-day notice only (no owner footer for them), while they are active members. Gated per person and channel. It never prints the `doc_type` key: until a document's display name is stored the job fails with `document <id> has no display name` | `sent` · `partly_sent` · `already_sent` · `skipped_not_expiring` · `skipped_no_recipient` |
| `notify` (template `allowance_used`) | `{template}`, job workspace; key `allowance:<workspace_id>` (B02, T-401) | Template 05 and kind `allowance_used` (`info`, `{workspace_id}`) once, to the workspace's creator while an active member, after the last free label is used. Always sent | `sent` · `already_sent` · `skipped_not_used_up` · `skipped_no_recipient` |
| `notify` (template `receipt`) | `{template, payment_event_id}` (the Stripe event id); key `receipt:<event id>` (M03's producer) | Template 06 with its PDF to the invoice's `customer_email` (provisional: the payer and finance addresses are a founder item), email only, no row; read from the stored `invoice.paid` event and `app.subscriptions`, never from Stripe. VAT is the sum of `total_taxes` (Stripe API 2025-03-31.basil), else `tax`; neither fails the job. No PDF, no send: the job fails with `the invoice PDF is not available` | `sent` · `already_sent` |
| `check` | `{product_id, artwork_version_id, ruleset_version, classification_id, node_ids}`; key from `app.request_check` | D04 (T-403): per market × panel of the latest finished extraction, the engine evaluates the pinned ruleset (docs/05); every `app.checks` row and its findings, the `app.product_nodes` update (worst panel state, open actions, ruleset, job) and the audit event `check.completed` are one transaction. A ruleset never released fails the job (`NoReleasedRuleset: P0003`); an extraction still queued or running retries, then fails; `progress` carries `checks` and counts per label state | `checked` · `already_checked` |
| `session_revoke` | `{membership_id, person_id}` | A06: deletes the person's `auth.sessions` created before the membership ended (refresh tokens cascade); `progress.sessions_revoked` counts them | `revoked` · `skipped_active` · `skipped_no_user` |

Every `notify` job names its workspace, which must be the object's (the dispatcher refuses a job without one before
any template runs); a job a web request starts also carries its `request_id` (docs/17). Every delivery writes its
`app.notifications` rows and `progress.in_app` in one transaction and records each person emailed in
`progress.emailed` (person ids), so a retry never adds a row or a second email. An address the provider rejects for
good (SES `MessageRejected`, or `BadRequestException` about the address) is recorded in `progress.rejected` and the
others still get theirs: outcome `partly_sent`, also reported to Sentry as a warning. When nobody could be emailed the
job fails with `no recipient could be emailed`. Account and sender errors (sending paused, account suspended, sender
not verified, throttling) retry and then fail the job; they never mark a recipient rejected. Notification and
preference kinds: `rule_changed` and `document_expiring` honour `app.notification_prefs` per person and channel
(`in_app`, `email`; no row means enabled); `allowance_used` is always sent; `report`, `invitation` and `receipt` go to
addresses, never to rows. Editorial ruleset changes never notify, on any setting.

## Realtime and storage
Progress: subscribe to Postgres changes on `app.jobs` filtered by id (RLS applies). `app.jobs` is not in the `supabase_realtime` publication yet (a db change, asked on #41), so the web also re-reads the job row every 2 s until it is terminal (T-303). The extract job's progress shape is in docs/06. Storage buckets (all private):
artwork, documents, reports, exports, sources, quarantine. Paths start with the workspace id:
`artwork/<workspace_id>/<product_id>/<sha256>.pdf` (`.png` or `.jpg` for an image of the label). The browser checks type (by magic bytes) and size (≤ 50 MiB, the bucket limit) before any upload and computes the hash itself (T-303). Viewing uses short-lived signed URLs; exports last 7 days.
Members read their workspace's artwork, documents and reports; only an internal, unscoped admin reads its exports
(`private.can_export`: a full export carries every product, so scoped and external members, admins included, never read
one).
