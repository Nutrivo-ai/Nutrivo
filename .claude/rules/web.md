---
paths:
  - "apps/web/**"
---
# Web rules
- Colour, type and spacing come only from the Cobalt tokens (docs/10-design-system.md). The accent never signals a
  verdict. The four states always show their glyph, never colour alone.
- Reads use supabase-js under the user's session (RLS). Writes use `supabase.schema('app').rpc(...)` only.
- The service-role key is used only in server-side /admin routes after checking app_metadata.nutrivo_staff, and
  never reaches the browser.
- Every screen matches its file in design/ at 1600 px, with a Playwright screenshot test.
- Every finding shows its provenance and citation; every Not assessed links to its coverage gap.
- Database types come from `make typegen`; never hand-write them.
