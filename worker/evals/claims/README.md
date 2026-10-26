# Claims evaluation sets

The harness is `nutrivo evals claims` (docs/07-ai.md, "The harness"). Its threshold: before a claim rule may join a
ruleset, Cohen's kappa must be >= 0.8 on at least 50 cases, with no prohibited claim judged permitted, for every
language the rule covers.

## Human-labelled sets
One JSONL file per language, named by its two-letter code: `sv.jsonl`, `da.jsonl`, `fi.jsonl`, `de.jsonl`,
`en.jsonl`. One case per line:

```json
{"id": "sv-0001", "rule_key": "EU.767.CLAIMS_GENERAL", "text": "<the claim exactly as printed>",
 "label": "permitted" | "prohibited" | "needs_evidence", "labelled_by": "<the person>",
 "source": "<the stored official source or accepted content the label rests on>", "note": "<optional>"}
```

- Labels come from people only. `labelled_by` and `source` are required, or the harness refuses the whole file.
  Never label from memory (CLAUDE.md 7).
- `text` is the printed target-language string, never a translation. `id` is stable: change a case by adding a new
  id, so earlier runs stay comparable.
- A case that repeats one of the rule's own `examples` is excluded from scoring.
- No set has been labelled yet.

## Synthetic harness cases
`synthetic/` holds `rule.json` (`HARNESS.SYNTHETIC.COLOUR`, "does the text name a colour?") and a few cases per
language, every one marked `"synthetic": true`. They test the harness itself and are not law. They never count
toward the threshold: a synthetic run always reports `synthetic_set`. Run them with
`nutrivo evals claims --synthetic --lang sv`.
