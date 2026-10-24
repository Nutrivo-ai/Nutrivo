"""Job handlers, one module per kind, each registered with `@nutrivo_worker.jobs.handler("<kind>")`.
Importing this package registers them all. A kind without a handler is not polled, so its messages wait in pgmq;
the rest land with their tasks (plan/tasks.yaml).

  extract   D01 (T-303): the registered artwork through the extraction engine into panels and text objects"""
from . import extract  # noqa: F401
