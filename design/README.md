# Design set (read-only reference)

Copy the whole Claude Design folder from Google Drive here, keeping its structure: `index.dc.html`, `support.js`,
`_ds/`, `brand/`, `build/`, `documents/`, `product/` and `public/` (43 files; `MANIFEST.json` lists each one and
`make design-check` verifies them). Commit the set once it checks, so Claude Code sessions and the GitHub autopilot
have it. Every `.dc.html` opens directly in a browser.
When two files disagree, the Handoff's §06 list decides (summarised in docs/10-design-system.md).
Claude Code reads these files but never edits them.
