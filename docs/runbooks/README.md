# Runbooks

What a founder does when production or staging needs a person. Claude Code sessions never touch staging or production
(CLAUDE.md non-negotiable 11): in these runbooks every staging or production step is a dashboard or an Actions run that
a founder starts, and a session's part is a pull request that fixes forward.

| Runbook | Use it when |
|---|---|
| [incident-response.md](incident-response.md) | An alert fires, a deploy opens an `incident` issue, or a customer reports a fault |
| [rollback.md](rollback.md) | A web or worker release is bad and the previous one should be live again |
| [pitr-restore.md](pitr-restore.md) | Data in `nutrivo-prod` is lost or corrupted and rows cannot correct it |
| [restore-drill.md](restore-drill.md) | Each month: prove a backup restores (gate G7) |
| [../pilot-runbook.md](../pilot-runbook.md) | A pilot customer starts |

Every workflow, script, `make` target, Sentry monitor, doctor check, label and RPC these runbooks name is checked
against the repository by `scripts/runbooks/test_runbooks.py` (in `protocol` and `make verify-fast`), so a rename that
leaves a runbook stale fails CI. Write references so the checker sees them: paths and RPCs in backticks, workflows as
Actions → `<name>`, Sentry monitors as monitor `<slug>`, doctor checks as doctor check `<name>`, labels as label
`<name>`, Render services as Render service `<name>`.

Decisions these runbooks do not make are open on #84 with the label `needs-human`; each is marked **Open (#84)** where
it applies, with the default followed until a founder decides.
