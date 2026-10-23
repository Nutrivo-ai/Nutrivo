"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. None exist at milestone 0: extract, check, notify and the rest land with
their tasks (plan/tasks.yaml). A kind without a handler is not polled, so its messages wait in pgmq."""
