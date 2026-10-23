"""Official source texts (docs/12-content-ops.md): fetched, hashed and stored exactly as served, never written by us.

  http     a polite HTTP client: rate limit, bounded retries, manual redirects, record and replay
  eurlex   EUR-Lex documents through the Publications Office's CELLAR repository (docs/14: the EUR-Lex site
           challenges automated clients; CELLAR serves the same manifestations to machines)
  store    the 'sources' bucket and ref.sources, idempotent by (celex, language, sha256)
  fetch    the run over content/sources.yaml behind `nutrivo sources fetch`
  imports  the outcomes an import run reports
  register the EU Register of Feed Additives → ref.feed_additives (`nutrivo sources import additives`)
  catalogue the Catalogue of feed materials → ref.feed_materials (`nutrivo sources import materials`)"""
