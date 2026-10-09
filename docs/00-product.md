# 00 · Product

**Nutrivo** checks a pet-food label against encoded feed law and answers, for each market and each printed language
panel: what is compliant, what needs action, and what was not assessed and why. Every result names its rule, its
citation and its provenance. Where no rule is held, the product says so instead of guessing.

**Buyers.** Pet-food brands and manufacturers, co-packers and private-label owners; later, consultants managing
several client workspaces (the Partner tier). Buyers work in English; checking happens in the printed language.

**What the designs promise, and the backend must keep** (Handoff §01 and §03):
results per language panel; findings pinned to the artwork with measured character heights; registration modelled
apart from label compliance (the Texas case); every Not assessed linking to a published coverage gap; alerts that
name the affected recipes; a plan picker that knows the workspace; an audit log that marks external work; public
verification that outlives the subscription.

## The MVP

The MVP Tracker's Alpha: *a trustworthy EU single-label checker people can log into and use.*
Of the 71 workflows in the register: **53 are built, 7 are run by people with scripts and 11 come after launch.**
The full table is in `docs/workflows/README.md`.

| Area | At launch |
|---|---|
| Markets | EU region, with Sweden, Denmark, Finland and Germany as the first nodes (D-01). UK and US are not sold until encoded. |
| Content | EU primary law (EUR-Lex) and the EU Register of Feed Additives only. FEDIAF and AAFCO material is not ingested (D-10). |
| Artwork | Vector print PDFs. Photos and flattened images are accepted but geometry on them is Not assessed. |
| Checks | Mandatory particulars, composition and additives, prescribed wording, language, net-quantity figure height, registration state, general claims judgement (model, with abstention). |
| Documents | Pinned PDF reports, share links, public verification. Signed certificates come after launch (database ready). |
| Billing | Free (three new label artworks), Basic, Standard, Advanced through Stripe, with VAT by place of supply. |

## After launch
Signed certificates and signing grants (A08, I03) · the Compliance Worker (L01–L03, BE-43, deliberately after
coverage is real) · search and saved views (F02) · user-started bulk re-check (F03) · SSO (A09) · Partner tier
(N01, N03) · Worker proposals (E03) · UK and US regions · GBP and USD catalogues · OCR geometry for raster artwork.
