# BOOTSTRAP · for Claude Code

Execute in order. Append each completed step to `.bootstrap-state` (git-ignored) so a restarted session resumes where
it stopped. At a GATE, write what you need from the founders in plain language and wait.
Never print a secret value; never write a .env file; never run `infisical export`, `infisical secrets` or `printenv`.

## 1 · Tools (GATE G0)
`bash scripts/bootstrap/check-tools.sh`. If it reports anything missing, show its install commands and stop.

## 2 · Repository (GATE G1 if the repository already has code)
1. `gh auth status`. If it is not authenticated, try `scripts/env/run.sh dev -- gh auth status` (GH_TOKEN in
   Infisical). Otherwise ask the founder to run `gh auth login`, and stop.
2. Find the repository:
   - `gh repo list --limit 300 --json nameWithOwner --jq '.[].nameWithOwner' | grep -i '/nutrivo$'`
   - then the same for each organisation in `gh api user/orgs --jq '.[].login'`.
   Exactly one match: use it. None or several: ask.
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
2. `make env-check ENV=dev`, then `ENV=staging`, then `ENV=prod`. These print names only.
3. A missing canonical name with an obvious equivalent already in Infisical (for example SENTRY_DSN for
   SENTRY_DSN_WEB): add `CANONICAL=EXISTING` to `config/secret-aliases.env` and re-run.
4. Anything still missing: list it with its purpose from `config/secrets.yaml`, and stop.

## 4 · Doctor (GATE G2 on a bad key)
`make doctor ENV=dev`, `make doctor ENV=staging`, `make doctor ENV=prod READONLY=1`.
Every check is green or explicitly not applicable. Sentry and Langfuse are proven by a round-trip: send, then read
back.

## 5 · Local stack
`make bootstrap && make fixtures && make db-start && make gates`. Every gate test passes.

## 6 · Design set (GATE G3 only if the download is refused)
`make design-fetch && make design-check`. If Drive refuses (the folder is not link-shared and there is no
GOOGLE_SERVICE_ACCOUNT_JSON), ask the founder to download the folder into `design/`, then run `make design-check`.

## 7 · GitHub
1. `bash scripts/bootstrap/github-setup.sh <owner>/<repo>`. It sets:
   - labels, milestones and environments;
   - protection for main (a merge-queue ruleset where the plan allows it, otherwise up-to-date branches);
   - Actions secrets INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET and variable INFISICAL_PROJECT_ID, taken from
     Infisical's `github-actions` machine identity. Ask the founder to create that identity if it does not exist.
2. Ask for the founders' GitHub usernames and replace `@NUTRIVO_OWNER` in `.github/CODEOWNERS`.
3. Pin every third-party action in `.github/workflows/` to a full commit SHA.

## 8 · Tasks
`make issues-sync`. Every task in `plan/tasks.yaml` becomes an issue with lanes, dependencies, acceptance IDs and
ready or blocked status. Confirm the issue count equals the task count.

## 9 · Build
Follow docs/15-build-protocol.md:
1. Start with the M0 tasks. `make next LANE=any` claims the next ready task. For each task: plan on the issue,
   implement, `make verify-task T=<id>`, open the PR, wait for CI and review.
2. `make autopilot MAX_TASKS=5` runs several tasks in sequence.
3. Once T-009 and T-010 are merged, label ready issues `autopilot` to run lanes in parallel on GitHub.

## 10 · Report
After each merged task, report what now passes (CONFORMANCE.md), what is next, and any gate waiting on a person.
