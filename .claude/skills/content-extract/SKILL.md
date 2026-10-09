---
name: content-extract
description: Run the K01/K02 dual extraction of candidate rules and terms from stored EUR-Lex sources. Use in content operations from milestone 2.
---
1. Confirm the source is stored (ref.sources with sha256) and is EU primary law or the EU Register of Feed
   Additives. Refuse FEDIAF and AAFCO.
2. First extraction: worker/prompts/rule_extraction.v<N>.md on the article text only; validate against the shape's
   params schema; write ref.rule_candidates.first_value with source_id, article and the verbatim excerpt.
3. Second extraction: a different prompt and, where available, a different model, with no access to the first
   result; write second_value and compute agree field by field.
4. Every disagreement, and every threshold and prescribed term, goes to the review queue. Never accept.
5. Draft fixtures (passed, failed, withheld) for the reviewer to confirm.
