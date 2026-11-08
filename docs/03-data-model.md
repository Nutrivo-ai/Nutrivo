# 03 · Data model

The migrations in `supabase/migrations/` are the canonical model; this page is the map. Never edit an applied
migration.

## Schemas
| Schema | Holds | Access |
|---|---|---|
| `app` | Tenant data (42 tables) | RLS on every table; authenticated may SELECT under policy; writes only through RPCs or the worker (service role); anon has nothing |
| `ref` | Jurisdictions, rules and versions, rulesets, coverage and gaps, terms, glossary, obligations, document requirements, horizon, candidates, fixtures, additive register, feed-material catalogue | Authenticated read (unaccepted rule versions and terms visible to staff only); staff tables (`rule_candidates`, `sources`, `term_decisions`, `ruleset_drafts`, `ruleset_draft_members`, `ruleset_draft_coverage`, `fixture_runs`) service-role only; staff write through the T-204 RPCs |
| `private` | Helpers and guard triggers; `consumer_email_domains` and `before_user_created_hook` (D-27, T-109) | Executable by authenticated and service_role; never exposed through the API. The free-mail list and its hook are for `supabase_auth_admin` only (service_role may read the list), versioned by `list_version` and extended only by a new migration |
| `public` | `verify_reference(ref)`, `coverage_snapshot()` | anon may execute these two functions only |

## Table groups (app)
Tenancy: people, workspaces, memberships, invitations, signing_grants · Products: families, products, product_nodes,
formula_lines, intended_claims · Artwork: artwork_versions, extraction_runs, artwork_panels, text_objects,
classifications · Checks: checks, check_findings, envelopes, envelope_items · Artefacts: reports, certificates,
shares, share_access_log, supersessions · Registration and documents: registrations, registration_packs, suppliers,
supplier_documents, document_requests · Money: subscriptions, allowances, allowance_consumptions, billing_details,
payment_events, dunning_steps · Ops: jobs, notifications, notification_prefs, alerts, alert_reads, saved_views, model_calls,
audit_events.

**Insert-only:** checks, check_findings, reports, certificates, supersessions, supplier_documents, audit_events,
payment_events, dunning_steps, allowance_consumptions, classifications, model_calls, share_access_log, ref.ruleset_versions,
ref.ruleset_members, ref.term_decisions, ref.fixture_runs, ref.ruleset_seals. Privileges are revoked and a trigger rejects UPDATE, DELETE and TRUNCATE,
including for the table owner (BE-05). Accepted `ref.rule_versions` rows are permanent (BE-08). Products have no
delete (BE-13).

**Released coverage is sealed (#197, #8 DB-3).** A deferred constraint trigger on `ref.ruleset_versions` writes a
`ref.ruleset_seals` row when the releasing transaction commits, after everything the release wrote; seals for every
earlier release were backfilled. For a sealed ruleset, P0047 refuses INSERT, UPDATE, DELETE and TRUNCATE on its
`ref.coverage_nodes` rows, INSERT into its `ref.ruleset_members`, UPDATE, DELETE and TRUNCATE of `ref.rules` (and
TRUNCATE of `ref.rule_versions`) it pins, and for `ref.coverage_gaps` its coverage names: DELETE, TRUNCATE and any
change to gap_id, node_id, domain or reason_code. `opened_in` and `closed_in` may each be set once, from null, to a
ruleset not yet sealed (the K05 bookkeeping of the release in progress); the service role may update only a gap's description, so only `app.release_ruleset` sets them. Changes go into the next draft. A release run
under `set constraints all immediate` seals its own version at its first statement and refuses itself, so never set it.

**No rule, no verdict in the schema (#179).** `private.node_fully_encoded(ruleset, node)` is true only when all six
domains (mandatory_particulars, composition, claims_wording, type_geometry, language, registration) have a complete
`ref.coverage_nodes` row; a missing row counts as not encoded. `app.checks` refuses clear otherwise (P0021). A
`check_findings` row must carry its check's workspace, product and node (P0046); an action with provenance
deterministic_rule or model_judgement needs a rule_key (23514); a clear check takes no action or not_assessed finding
(P0021), only info.

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
| product_nodes.label_state = clear | stored only when `ruleset_version` is set and `private.node_fully_encoded` holds for it; otherwise a write of clear is stored as not_assessed (trigger `product_node_verdict_guard`, #179 DB-2) |
| check_findings.provenance | deterministic_rule · model_judgement · authored_definition · not_assessed |
| check_findings.state | action · not_assessed · info |
| classifications.species · life_stage · intended_use · parnut_status | **Provisional** (T-402; decided on #44 to keep until the founders accept the first ruleset, T-208): species `dog` · `cat`; life_stage `growth` · `adult` · `senior`; intended_use none yet (always empty); parnut_status `parnut` only (no value says "not PARNUT"). The model may suggest only these and `app.confirm_classification` accepts only these (22023); a person's confirmation is the classification |
| classifications.product_class | complete · complementary · treat · mineral · dietetic · other (check constraint) |
| classifications.citation (model suggestion) | JSON text: `{basis: "label_text", artwork_version_id, extraction_run_id, prompt_version, fields: {<field>: {quote, panel_index, language, confidence}}, empty: {<field>: reason}}`. The quote is the printed string a value rests on, never a legal reference; `empty` reasons: abstained · low_confidence · no_evidence · quote_not_on_label · value_not_allowed · no_label_text (T-402) |
| classifications.citation (person's confirmation) | JSON text: `{basis: "person", basis_classification_id, fields: {<field>: <the basis's label evidence>}, edited: [<field>]}`: the label evidence is kept for each value confirmed as it was; an edited value rests on the person (`app.confirm_classification`) |
| rules.shape | threshold · mandatory_particular · prescribed_wording · character_height · additive_condition · claim_judgement |
| coverage domain | mandatory_particulars · composition · claims_wording · type_geometry · language · registration |
| coverage state | complete · partial · not_encoded (anything but complete needs a gap_id) |
| rule effect_type | new_obligation · tightened_threshold · withdrawn_authorisation · prescribed_wording · editorial |
| panel failure_code | outlined_text · rasterised · missing_font · colour_space · no_true_scale · unreadable |
| audit_events.kind (access) | `session.started` (one row per active membership at every sign-in, `after` = `{aal}`) · `access.password_changed` (no before or after: never the secret). Written by triggers on `auth.sessions` and `auth.users`, so no client can skip or forge them; the actor is always the account holder, also when the hash changes through the admin API (T-103) |
| withheld reason_code | coverage: not_encoded · partially_encoded · out_of_scope · pending_acceptance (need gap_id); extraction: the failure codes (need panel_id); data_missing · model_abstained · model_unavailable · model_refused · model_output_invalid; engine (T-403, #45): evaluator_missing (no evaluator for the rule's shape yet) · evaluator_error (the rule's params or applicability cannot be evaluated); claims (T-503, #53): claim_not_evaluated (no claims harness threshold record for the rule version and panel language) |

## Error codes raised by the database
| Code | Meaning |
|---|---|
| 42501 | Not permitted (role, scope or authentication) |
| 22023 | Invalid argument: an unknown role or missing external flag, a scope naming another workspace's family or an unknown market, an end date in the past, a default operator without name, address or two-letter country |
| P0002 / P0003 | No artwork to check, or no extraction to retry (`app.retry_extraction`) / no released ruleset |
| P0004 | BE-04: signing grant to an external or inactive membership |
| P0005 | BE-05: insert-only table mutated |
| P0007 | BE-07: jurisdiction shape violated |
| P0008 | BE-08: accepted rule version edited or deleted |
| P0010 | BE-10: coverage set complete where no accepted, tested member rule covers the node and domain |
| P0021 | BE-21: Clear where coverage is incomplete (any of the six domains not complete), or an action or not_assessed finding under a clear check |
| P0032 / P0033 / P0036 | Free allowance used / no editor seat / new artworks paused by dunning |
| P0034 | BE-34: a new recipe (family) that the paid plan cannot take: its paid recipes are all live and one more would pass the 1.5x overage cap (monthly terms only; annual terms take no overage). The hint is JSON `{plan, recipes_included, overage_cap, term, next_plan}` (T-401, T-704) |
| P0038 | Ruleset member is not an accepted version |
| P0039 | K05: release refused: a member without fixtures, or no passing fixture run that matches the draft's members and fixtures |
| P0040 / P0041 / P0042 | Invitation invalid (or already accepted, so it cannot be revoked) / email mismatch / already a member |
| P0043 | The last admin cannot be removed, demoted or given an end date: one active admin with no end date must remain |
| P0044 | The membership has ended and cannot be changed |
| P0045 | D03: the classification changed since it was read (the basis is not the product's latest); reload and confirm again |
| P0046 | A finding whose workspace, product or node differ from its check's (#179 DB-6) |
| P0047 | #197: a sealed (released) ruleset's coverage, members, pinned rule metadata or named gap changed after its release; change it in the next draft |
| P0048 | D-31: a draft's node × domain set complete, or a member set under complete coverage, while a held member's linked term has no accepted entry in one of the node's languages (T-209) |
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
