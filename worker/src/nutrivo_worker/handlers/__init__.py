"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. A kind without a handler is not polled, so its messages wait in pgmq.
Handlers land with their tasks (plan/tasks.yaml): notify and session_revoke with T-105; extract with T-303 (D01: the
registered artwork through the extraction engine into panels and text objects); export with T-804; check with T-403;
report with T-405 (I01: a check's label report PDF); billing_sync and billing_reconcile with T-702 (M04: Stripe
subscriptions onto the mirror); scan with T-802 (H03: a supplier upload is malware-scanned, then promoted as a new
row); envelope with T-1002 (E02: a brief's compliance envelope from accepted rules only)."""
from . import billing, check, envelope, export, extract, notify, report, scan, session_revoke  # noqa: F401
