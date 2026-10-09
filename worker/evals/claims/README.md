One JSONL file per language (sv.jsonl, da.jsonl, fi.jsonl, de.jsonl, en.jsonl): {"text": ..., "label": "permitted" |
"prohibited" | "needs_evidence", "rule_key": ..., "labelled_by": ...}. Labels by people only. Threshold before a
claim rule may join a ruleset: Cohen's kappa >= 0.8 on at least 50 examples and no prohibited claim judged
permitted (docs/07-ai.md).
