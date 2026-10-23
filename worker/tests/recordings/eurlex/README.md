# Recorded EUR-Lex / CELLAR responses (T-201)

Real responses, written by `nutrivo sources fetch --record` (and `RecordingTransport` for the two error cases)
against the live services on 23 Oct 2026. Never edit a body by hand: `body_sha256` in each `<key>.json` must match
the gzipped body, and the replay refuses a mismatch.

- Regulation (EC) No 767/2009, consolidated version 02009R0767-20181226, in EN, SV, DA, FI and DE: the SPARQL
  answer, the five 303 redirects and the five XHTML manifestations.
- Regulation (EU) 2017/2279: the empty SPARQL answer (no consolidated version) and the EN text as published.
- `https://eur-lex.europa.eu/legal-content/...`: the AWS WAF bot challenge (202, `x-amzn-waf-action: challenge`).
- `https://publications.europa.eu/resource/celex/02017R2279-20171214`: 404 (no such consolidated version).

Only content headers are kept (content-type, location, retry-after, x-amzn-waf-action, etag, last-modified).
To re-record: `uv run nutrivo sources fetch --dry-run --celex 32009R0767 --record tests/recordings/eurlex`.
