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
| `notify` (template `report`) | `{template, share_id}`; key `share:<id>` (T-601) | I02, Template 01 to `app.shares.recipient` (channel `email`), email only, no row. Mints the share's token like the invitation and stores its SHA-256 in `app.shares.token_hash` while the share is live (the RPC inserts a placeholder hash); emails `${APP_BASE_URL}/share/<token>`. Counts over `reports.check_ids`: Clear = passed rules, Action needed and Not assessed = findings in that state, Blocked = the report's markets whose `product_nodes.display_state` is blocked | `sent` · `already_sent` · `skipped_revoked` · `skipped_expired` · `skipped_not_pending` |
| `notify` (template `rule_changed`) | `{template, rule_diff_id}`, job workspace = the affected workspace; key and timing (the design's daily batch) are J03's (T-901) | Template 03 and kind `rule_changed` (severity `warning`, `object_ref` `{rule_diff_id, product_ids}`) to each active member whose scope holds an affected product (contract 5), naming their recipes. Gated per person and channel | `sent` · `already_sent` · `skipped_editorial` (O01.must.1) · `skipped_no_impact` |
| `notify` (template `document_expiring`) | `{template, document_id, notice_days, person_ids}`: 60, 30 or 7; `person_ids` are the pack owners the producer names (H04, T-803); key `doc:<id>:<days>` | Template 04 and kind `document_expiring` (`warning`, `{document_id, notice_days}`) to those people, plus the admins on the 7-day notice only (no owner footer for them), while they are active members. Gated per person and channel. It never prints the `doc_type` key: until a document's display name is stored the job fails with `document <id> has no display name` | `sent` · `already_sent` · `skipped_not_expiring` · `skipped_no_recipient` |
| `notify` (template `allowance_used`) | `{template}`, job workspace; key `allowance:<workspace_id>` (B02, T-401) | Template 05 and kind `allowance_used` (`info`, `{workspace_id}`) once, to the workspace's creator while an active member, after the last free label is used. Always sent | `sent` · `already_sent` · `skipped_not_used_up` · `skipped_no_recipient` |
| `notify` (template `receipt`) | `{template, payment_event_id}` (the Stripe event id); key `receipt:<event id>` (M03's producer) | Template 06 with its PDF to the invoice's `customer_email` (provisional: the payer and finance addresses are a founder item), email only, no row; read from the stored `invoice.paid` event and `app.subscriptions`, never from Stripe. VAT is the sum of `total_taxes` (Stripe API 2025-03-31.basil), else `tax`; neither fails the job. No PDF, no send: the job fails with `the invoice PDF is not available` | `sent` · `already_sent` |
| `session_revoke` | `{membership_id, person_id}` | A06: deletes the person's `auth.sessions` created before the membership ended (refresh tokens cascade); `progress.sessions_revoked` counts them | `revoked` · `skipped_active` · `skipped_no_user` |

Every `notify` job names its workspace, which must be the object's (a job without one fails at once); a job a web
request starts also carries its `request_id` (docs/17). Every delivery writes its `app.notifications` rows and
`progress.in_app` in one transaction and records each person emailed in `progress.emailed` (person ids), so a retry
never adds a row or a second email. An address the provider rejects for good is recorded in `progress.rejected` and
the others still get theirs: outcome `partly_sent`, or `rejected` when nobody could be emailed. Notification and
preference kinds: `rule_changed` and `document_expiring` honour `app.notification_prefs` per person and channel
(`in_app`, `email`; no row means enabled); `allowance_used` is always sent; `report`, `invitation` and `receipt` go to
addresses, never to rows. Editorial ruleset changes never notify, on any setting.

## Realtime and storage
Progress: subscribe to Postgres changes on `app.jobs` filtered by id (RLS applies). Storage buckets (all private):
artwork, documents, reports, exports, sources, quarantine. Paths start with the workspace id:
`artwork/<workspace_id>/<product_id>/<sha256>.pdf`. Viewing uses short-lived signed URLs; exports last 7 days.
