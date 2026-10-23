"""Content operations over stored official texts (docs/12-content-ops.md): candidates only, never accepted content.

  articles  a stored EUR-Lex body split into its articles and annexes, deterministically, no model
  targets   content/candidates/eu-core.yaml resolved to an act listed in content/sources.yaml and its units
  extract   K01/K02: two independent extractions per target and stored source, compared field by field, written to
            ref.rule_candidates as pending or needs_review; nothing reaches ref.rules or ref.rule_versions"""
