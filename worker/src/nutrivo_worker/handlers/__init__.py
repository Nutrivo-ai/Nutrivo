"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. A kind without a handler is not polled, so its messages wait in pgmq.
Handlers land with their tasks (plan/tasks.yaml): notify and session_revoke with T-105; extract with T-303 (D01: the
registered artwork through the extraction engine into panels and text objects); export with T-804."""
from . import export, extract, notify, session_revoke  # noqa: F401
