# 18 · Reliability: how production heals itself

| Failure | Detected by | Automatic response | A person is told when |
|---|---|---|---|
| Worker crashes | Render restart; Sentry heartbeat cron | Render restarts it; pgmq redelivers unacknowledged jobs after the visibility timeout | Heartbeat missing for 5 minutes |
| Job throws | Sentry error | Retry with backoff, up to 5 attempts; handlers are idempotent | After the 5th attempt: job `failed`, user sees "retry", Sentry issue |
| Worker dies mid-job | Reaper (pg_cron, every 5 min): `running` for over 15 min | Requeued | Requeued twice |
| Model provider outage | Error rate; circuit breaker | Fall back to the second provider (D-11); otherwise claim rules are withheld as `model_unavailable`, never passed | Breaker open for 10 minutes |
| Email provider failure | Send errors | Retry from the queue | Persisting for an hour |
| Missed Stripe webhook | Daily reconciliation against the Stripe API | Mirror corrected | Any correction made |
| Bad web deploy | Post-deploy smoke tests | Vercel instant rollback to the previous deployment | Always (incident issue) |
| Bad worker deploy | Smoke tests; error spike | Render rollback to the previous deploy | Always |
| Bad migration | Applied to staging first, then smoke tests | None automatic: fix forward with a new migration; point-in-time recovery for disasters | Always |
| Overload | Queue depth; p95 latency | Backpressure (bounded concurrency per job kind); rate limits on RPCs and Edge Functions | Budgets exceeded |
| Feature misbehaving | Sentry, PostHog | Kill-switch flag off | Always |
| Expired or rotated key | Nightly doctor | — | Next morning |

## Rules that make this work
- **Idempotency.** Every job is keyed and every write is idempotent; unique constraints make repeated effects
  impossible.
- **Migrations are expand, migrate, contract.** Each migration works with the previous worker and web release, since
  deploy order is database, worker, web. Nothing destructive lands in the same release as the code that stops using
  it.
- **Fail visibly.** No silent failures: every terminal job state is shown to the user and recorded in Sentry.
- **Withhold rather than guess.** An unavailable dependency produces Not assessed with a reason, never Clear.
- **Backups.** Point-in-time recovery on production, with a scripted restore drill monthly.

## Service levels (spec/nfr.yaml)
- **Availability:** app 99.5% monthly; public verification 99.9%.
- **Speed:** check completion p95 under 2 minutes for a 10-page artwork; verification p95 under 300 ms.
- **Error budget:** when it is spent, feature work stops until reliability is restored.
