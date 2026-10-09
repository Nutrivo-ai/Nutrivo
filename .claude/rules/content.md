---
paths:
  - "content/**"
  - "scripts/content/**"
---
# Content rules
- You build tools that move official text into candidates. You never write a rule, threshold, term, obligation or
  coverage state from memory, and you never set status 'accepted'.
- Every candidate carries source_id, article, the verbatim excerpt and, for thresholds and prescribed terms, two
  independent extractions.
- Terms come from each official language version of the act. Never translate.
- FEDIAF and AAFCO texts are copyrighted: do not fetch, store or quote them.
- `content/accepted/` is written only by the acceptance flow after a person clicks accept.
