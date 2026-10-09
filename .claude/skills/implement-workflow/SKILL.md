---
name: implement-workflow
description: Procedure for implementing Nutrivo workflows (A01-P02) end to end from docs/workflows. Use when a milestone prompt names workflow ids.
---
1. Read docs/workflows/<id>.md for each id, the BE rows they cite (docs/13-testing.md), docs/04-contracts.md and the
   design file each spec names.
2. Plan in plan mode: database changes, RPCs, worker handlers, screens and tests. Name every must-hold and failure
   case and where it is enforced (constraint, trigger, policy, RPC check, handler, UI state).
3. Database: use the new-migration skill; pgTAP tests in supabase/tests/app/.
4. Worker: handler plus unit tests; idempotent; job payloads carry ids only.
5. Web: the screen as designed; reads under RLS; writes through RPCs; Playwright for the main path and every failure
   case the screen shows.
6. `make verify-fast`. Ask the rls-reviewer subagent if supabase/ changed and the spec-checker before finishing.
7. Update the Status line of each workflow file and any doc whose behaviour changed.
