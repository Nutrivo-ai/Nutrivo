"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. A kind without a handler is not polled, so its messages wait in pgmq.
Handlers land with their tasks (plan/tasks.yaml): notify and session_revoke with T-105; extract with T-303 (D01: the
registered artwork through the extraction engine into panels and text objects); export with T-804; check with T-403;
report with T-405 (I01: a check's label report PDF); billing_sync and billing_reconcile with T-702 (M04: Stripe
subscriptions onto the mirror); scan with T-802 (H03: a supplier upload is malware-scanned, then promoted as a new
row); diff_fanout with T-901 (J03: a released rule diff onto alerts, and the daily alert sweep; T-903 adds supersession);
recheck with T-903 (J05: the scoped re-check of one recipe after a material rule diff); expiry_reminders with T-803
(H04: the daily producer of the document_expiring notices); envelope with T-1002 (E02: a brief's compliance envelope
from accepted rules only); rate_purge with T-1103 (the daily purge of the RPC rate counters)."""
from . import (  # noqa: F401
    billing,
    check,
    diff_fanout,
    envelope,
    expiry,
    export,
    extract,
    maintenance,
    notify,
    recheck,
    report,
    scan,
    session_revoke,
)
