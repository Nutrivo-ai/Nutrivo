# 03 · Data model

The migrations in `supabase/migrations/` are the canonical model; this page is the map. Never edit an applied
migration.

## Schemas
| Schema | Holds | Access |
|---|---|---|
| `app` | Tenant data (42 tables) | RLS on every table; authenticated may SELECT under policy; writes only through RPCs or the worker (service role); anon has nothing |
| `ref` | Jurisdictions, rules and versions, rulesets, coverage and gaps, terms, glossary, obligations, document requirements, horizon, candidates, fixtures, additive register, feed-material catalogue | Authenticated read (unaccepted rule versions and terms visible to staff only); staff tables (`rule_candidates`, `sources`, `term_decisions`) service-role only |
| `private` | Helpers and guard triggers | Executable by authenticated and service_role; never exposed through the API |
| `public` | `verify_reference(ref)`, `coverage_snapshot()` | anon may execute these two functions only |

## Table groups (app)
Tenancy: people, workspaces, memberships, invitations, signing_grants · Products: families, products, product_nodes,
formula_lines, intended_claims · Artwork: artwork_versions, extraction_runs, artwork_panels, text_objects,
classifications · Checks: checks, check_findings, envelopes, envelope_items · Artefacts: reports, certificates,
shares, share_access_log, supersessions · Registration and documents: registrations, registration_packs, suppliers,
supplier_documents, document_requests · Money: subscriptions, allowances, allowance_consumptions, billing_details,
payment_events · Ops: jobs, notifications, notification_prefs, alerts, alert_reads, saved_views, model_calls,
audit_events.

**Insert-only:** checks, check_findings, reports, certificates, supersessions, supplier_documents, audit_events,
payment_events, allowance_consumptions, classifications, model_calls, share_access_log, ref.ruleset_versions,
ref.ruleset_members, ref.term_decisions. Privileges are revoked and a trigger rejects UPDATE, DELETE and TRUNCATE,
including for the table owner (BE-05). Accepted `ref.rule_versions` rows are permanent (BE-08). Products have no
delete (BE-13).

## Vocabularies
| Field | Values |
|---|---|
| memberships.role | admin · portfolio_manager · editor · viewer |
| workspaces.default_operator | `{name, address, country (ISO 3166-1 alpha-2), approval_number?}`, exactly as printed; set by `app.set_default_operator` |
| products.stage | brief · in_development · active · discontinued |
| jurisdictions.node_type | region · country · state · federal (83 nodes: EU + 27, UK + GB + NI, US + federal + 50) |
| product_nodes.label_state | clear · action · not_assessed |
| product_nodes.registration_state | not_required · registered · not_registered · expired · unknown |
| product_nodes.display_state (generated) | blocked if not_registered or expired; not_assessed if clear but registration unknown; else label_state |
| check_findings.provenance | deterministic_rule · model_judgement · authored_definition · not_assessed |
| check_findings.state | action · not_assessed · info |
| rules.shape | threshold · mandatory_particular · prescribed_wording · character_height · additive_condition · claim_judgement |
| coverage domain | mandatory_particulars · composition · claims_wording · type_geometry · language · registration |
| coverage state | complete · partial · not_encoded (anything but complete needs a gap_id) |
| rule effect_type | new_obligation · tightened_threshold · withdrawn_authorisation · prescribed_wording · editorial |
| panel failure_code | outlined_text · rasterised · missing_font · colour_space · no_true_scale · unreadable |
| audit_events.kind (access) | `session.started` (one row per active membership at every sign-in, `after` = `{aal}`) · `access.password_changed` (no before or after: never the secret). Written by triggers on `auth.sessions` and `auth.users`, so no client can skip or forge them (T-103) |
| withheld reason_code | coverage: not_encoded · partially_encoded · out_of_scope · pending_acceptance (need gap_id); extraction: the failure codes (need panel_id); data_missing · model_abstained · model_unavailable |

## Error codes raised by the database
| Code | Meaning |
|---|---|
| 42501 | Not permitted (role, scope or authentication) |
| 22023 | Invalid argument: an unknown role or missing external flag, a scope naming another workspace's family or an unknown market, an end date in the past, a default operator without name, address or two-letter country |
| P0002 / P0003 | No artwork to check / no released ruleset |
| P0004 | BE-04: signing grant to an external or inactive membership |
| P0005 | BE-05: insert-only table mutated |
| P0007 | BE-07: jurisdiction shape violated |
| P0008 | BE-08: accepted rule version edited or deleted |
| P0021 | BE-21: Clear where coverage is incomplete |
| P0032 / P0033 / P0036 | Free allowance used / no editor seat / new artworks paused by dunning |
| P0038 | Ruleset member is not an accepted version |
| P0040 / P0041 / P0042 | Invitation invalid (or already accepted, so it cannot be revoked) / email mismatch / already a member |
| P0043 | The last admin cannot be removed, demoted or given an end date: one active admin with no end date must remain |
| P0044 | The membership has ended and cannot be changed |
| P0291 / P0292 / P0293 | Certificate: no signing grant / two-factor required / open findings |

## Naming reconciliation
| Handoff and BE register (5 Sep) | Workflow Register (25 Sep) | This repository |
|---|---|---|
| schemas app, ref | public, rules, ops | `app`, `ref` (+ `private`) |
| product_market | product_nodes | app.product_nodes |
| check_events (applied/passed/withheld arrays) | checks + applied_rules table | app.checks with three arrays (gate BE-23) |
| findings | check_findings | app.check_findings |
| documents (report or certificate), certificate_chain | reports, certificates | app.reports, app.certificates (hash chain) |
| artworks | artwork_versions, artwork_panels, text_objects | as the register, plus extraction_runs |
| coverage | coverage_nodes, coverage_gaps | ref.coverage_nodes (versioned per ruleset), ref.coverage_gaps |
| terms · glossary | term_entries, term_decisions | ref.term_entries, ref.term_decisions, ref.glossary_entries |
| rule_key, supersedes_rule_id | rules, rule_versions (supersedes) | ref.rules(rule_key), ref.rule_versions(version, supersedes_version) |
| node_type region · country · state · federal | kind region · state · node | BE-07 values |
| lifecycle brief · in_development · active · discontinued | products.stage | BE-13 values |
| documents (supplier) | documents | app.supplier_documents |
| — | check_jobs, export_jobs | app.jobs (kind) |
| — | invoices (own, with VAT treatment) | Stripe (D-18) |
| — | extraction_runs, document_requirements (used, never defined) | app.extraction_runs, ref.document_requirements |
| — | prompts (N03) | after launch |
