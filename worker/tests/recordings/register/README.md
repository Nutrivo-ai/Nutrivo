# Recorded EU Register of Feed Additives responses (T-202)

Real responses from the Food and Feed Information Portal's JSON API (the one its own feed-additives screen reads,
`https://ec.europa.eu/food/food-feed-portal/backend/api`), written by
`nutrivo sources import additives --dry-run --record tests/recordings/register` on 23 Oct 2026:

- `policy-items?foodDomain=fed&authorisationType=fed_auth`: every register entry (2,026), about 20 MB.
- `food_legislations?domain_code=fed`: the legislation the entries cite.
- `feed-refdata/en`: functional-group and legislation-link labels.

Never edit a body by hand: `body_sha256` in each `<key>.json` must match the gzipped body, and the replay refuses a
mismatch. To re-record, run the command above (it writes nothing else).
