"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. A kind without a handler is not polled, so its messages wait in pgmq.
Handlers land with their tasks (plan/tasks.yaml): notify and session_revoke with T-105, export with T-804."""
from . import export, notify, session_revoke  # noqa: F401
