# BOOTSTRAP · for Claude Code

Execute in order. On a laptop, append each completed step to `.bootstrap-state` (git-ignored) so a restarted session
resumes where it stopped. That file lives in one container only: in Claude Code on the web, progress is the bootstrap
task issues T-001…T-006 and their comments (step 8 maps steps to tasks), so comment on the matching issue after each
step and read them to resume. At a GATE, write what you need from the founders in plain language and wait.
Never print a secret value; never write a .env file; never run `infisical export`, `infisical secrets` or `printenv`.

## 1 · Tools (GATE G0)
`bash scripts/bootstrap/check-tools.sh`. If it reports anything missing, show its install commands and stop. In Claude
Code on the web the session start hook installs the tools, so usually only the `claude-dev` variables (docs/22 §5)
are missing; if a tool is, show the hook's "Not ready" line instead of install commands.

## 2 · Repository (GATE G1 if the repository already has code)
`main` of `nutrivo-ai/Nutrivo` already holds this hand-off, so in a clone of it (every web session, or SETUP Step 3 on a
laptop) skip step 2; 2.1–2.4 are for an unzipped hand-off only. On the web the session pushes through the Claude
GitHub App: if a push is refused, ask the founder to install the app on the repository (docs/22 §1).
1. `gh auth status`. If it is not authenticated, ask the founder to run `gh auth login`, and stop.
2. The repository is `nutrivo-ai/Nutrivo` (docs/22). If `gh repo view nutrivo-ai/Nutrivo` fails, ask.
3. In this folder: `git init -b main` (if needed), `git remote add origin <url>`, `git fetch origin`.
4. **Empty remote:** commit everything as "Hand-off baseline" and push to main.
   **Remote with commits:**
   - push its main to `archive/pre-handoff` (`git push origin origin/main:refs/heads/archive/pre-handoff`);
   - branch `handoff/import` from `origin/main`;
   - `git mv` every existing tracked file into `legacy/`;
   - copy this hand-off on top, and exclude `legacy/` from lint, build and the protocol check;
   - commit, push, and open the pull request "Import the Nutrivo hand-off".
   GATE G1: the founder approves and merges it. Then `git switch main && git pull`.

## 3 · Secrets (GATE G2)
1. Create `.infisical.json` from `.infisical.json.example` with the project id (INFISICAL_PROJECT_ID, or ask).
   Commit it; it holds no secret.
2. `make env-check ENV=dev`. It prints names only. A Claude Code session holds only the dev identity (docs/16), so
   staging and prod are checked by a founder: Actions → doctor → Run workflow, once with `staging` and once with
   `prod` (after the set-up pull request is merged and docs/22 §3 is done). Names whose resource a later task
   creates (`from:` in `config/secrets.yaml`, for example the Render worker in T-010) show as `later`, not missing.
3. A missing canonical name with an obvious equivalent already in Infisical (for example SENTRY_DSN for
   SENTRY_DSN_WEB): add `CANONICAL=EXISTING` to `config/secret-aliases.env` and re-run.
4. Anything still missing: list it with its purpose from `config/secrets.yaml`, and stop.

## 4 · Doctor (GATE G2 on a bad key)
`make doctor ENV=dev` here; staging and prod in the same `doctor` workflow run as step 3 (prod read-only).
Every check is green or explicitly skipped with a reason: until T-010 deploys staging, the database schema, the
Render worker and the Vercel project are skipped, not failed. Sentry and Langfuse are proven by a round-trip: send,
then read back.

## 5 · Local stack
`make bootstrap && make fixtures && make db-start && make gates`. Every gate test passes.

## 6 · Design set (GATE G3 only if the download is refused)
`make design-fetch && make design-check`. If Drive refuses (the folder is not link-shared and there is no
GOOGLE_SERVICE_ACCOUNT_JSON), ask the founder to download the folder into `design/` (in Claude Code on the web: to
upload it as a zip into the session, which you unzip into `design/`), then run `make design-check`.
Once it passes, commit `design/` as "Add design set" in its own pull request (task T-006), so every session and the
GitHub autopilot have the files.

## 7 · GitHub (docs/22-github-and-team.md)
1. Every third-party action in `.github/workflows/` is pinned to a full commit SHA (Dependabot keeps the pins
   current), and `.github/CODEOWNERS` names every founder's GitHub username (ask for any that are missing).
2. Before the set-up pull request is approved, an organisation owner creates the `scope-approved` and `human-approved`
   labels and adds the ones it needs; on it only the owner's labels count (docs/22 §1). After merging it, the founder applies the rest of docs/22 §1–§3: plan and
   collaborators, rulesets imported from `.github/rulesets/`, environments, the Infisical identities as Actions
   secrets and the `INFISICAL_PROJECT_ID` variable (and `INFISICAL_DOMAIN` if the project is in Infisical's EU cloud). The merge closes T-004's issue (the pull request's `Closes` line)
   before those settings exist: reopen it, and close it once they are done. A founder with a terminal can run
   `bash scripts/bootstrap/github-setup.sh <owner>/<repo>` instead; it exits non-zero on anything it could not set.
   Claude Code cannot change repository settings itself: list what is missing and stop.

## 8 · Tasks
The `tracker` workflow creates the labels, milestones and one issue per task in `plan/tasks.yaml` on every push to
main that changes the plan, and recomputes ready/blocked whenever a task issue closes. Run it once by hand (Actions →
tracker → Run workflow) or `make issues-sync` on a laptop, and confirm the issue count equals the task count.
Then close the issues of the bootstrap tasks that are done (on the web with the GitHub tools, since `gh issue` is
refused there), each with a comment naming the step: T-001 (step 2), T-002 (step 3), T-003 (step 4), T-004 (step 7),
T-005 (this step), T-006 (step 6). The founder confirms the human-gated ones. Their dependants become ready, which is
what step 9 starts from.

## 9 · Build
Follow docs/15-build-protocol.md:
1. Start with the M0 tasks. `make next LANE=any` claims the next ready task. For each task: plan on the issue,
   implement, `make verify-task T=<id>`, open the PR (`Task: T-123`, `Closes #N`), wait for CI and review. In
   Claude Code on the web the session's own branch is the task branch: one task per session.
2. On a laptop, `make autopilot MAX_TASKS=5` runs several tasks in sequence; it needs `gh pr`, which the web refuses.
3. Once T-009 and T-010 are merged, label ready issues `autopilot` to run lanes in parallel on GitHub. This is the
   autopilot to use from the web.

## 10 · Report
After each merged task, report what now passes (the CI conformance summary), what is next, and any gate waiting on a person.
