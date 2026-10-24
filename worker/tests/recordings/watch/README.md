# Recorded CELLAR answers for the source watch (T-207, J01)

Real SPARQL answers, written by `nutrivo sources watch --record` against the live endpoint on 23 Oct 2026, with no
model configured (so the run itself withheld every item as `model_unavailable`). Never edit a body by hand:
`body_sha256` in each `<key>.json` must match the gzipped body.

- Regulation (EC) No 767/2009 and Regulation (EU) 2020/354: the works that amend, are based on, correct or cite
  each act, dated on or after 2025-10-01, with English titles; and each act's consolidated versions.

To re-record (the query text is the key, so `--since` and the acts must match the tests):
`uv run nutrivo sources watch --celex 32009R0767 --celex 32020R0354 --since 2025-10-01 --today 2026-10-23
--record tests/recordings/watch` with DATABASE_URL and the model settings unset.
