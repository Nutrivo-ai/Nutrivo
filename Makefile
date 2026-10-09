SHELL := /bin/bash
.DEFAULT_GOAL := help
ENV ?= dev
LANE ?= any
PY := uv run --no-project --with pyyaml python
RUN = scripts/env/run.sh $(ENV) --

# Every target is a command, never a file: without this, `make fixtures` sees the fixtures/ directory and does nothing.
.PHONY: help bootstrap db-start db-reset fixtures typegen env-check doctor design-fetch design-check validate-plan \
        workflows issues-sync next verify-task autopilot status gates test verify-fast verify e2e e2e-ci smoke \
        acceptance-staging conformance conformance-update

help: ## list targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

# ── Setup ─────────────────────────────────────────────────────────────────────────────────────────
bootstrap: ## install worker and web dependencies
	cd worker && uv sync
	@if [ -f apps/web/package.json ]; then pnpm --dir apps/web install; else echo "apps/web is scaffolded in T-007"; fi
db-start: ## start local Supabase (Docker)
	supabase start
db-reset: ## rebuild the local database from migrations
	supabase db reset
fixtures: ## synthetic labels with exact ground truth (needs ghostscript + poppler)
	cd worker && uv run python ../fixtures/synth/generate.py --out ../fixtures/synth/out
typegen: ## regenerate database types for the web app
	supabase gen types typescript --local --schema app,ref,public > apps/web/src/lib/database.types.ts

# ── Secrets and services ──────────────────────────────────────────────────────────────────────────
env-check: ## names present or missing in Infisical for ENV (never values)
	bash scripts/env/check.sh $(ENV)
doctor: ## prove every service for ENV, with Sentry and Langfuse round-trips (READONLY=1 for prod)
	$(RUN) uv run --no-project --with boto3 python scripts/doctor/doctor.py --env $(ENV) $(if $(READONLY),--readonly,)

# ── Design ────────────────────────────────────────────────────────────────────────────────────────
design-fetch: ## download the design set listed in design/MANIFEST.json
	$(RUN) uv run --no-project --with google-auth --with requests python scripts/design/fetch.py
design-check: ## verify every design file by exact size
	python3 scripts/design/fetch.py --check

# ── Protocol ──────────────────────────────────────────────────────────────────────────────────────
validate-plan: ## plan/tasks.yaml is a valid DAG covering every workflow
	$(PY) scripts/protocol/validate-plan.py
workflows: ## regenerate docs/workflows and spec/acceptance.yaml from scripts/workflows/data.py
	$(PY) scripts/workflows/render.py
issues-sync: ## create or update one GitHub issue per task
	$(PY) scripts/protocol/sync-issues.py
next: ## claim the next ready task: LANE=db|worker|web|infra|content|any
	$(PY) scripts/protocol/next-task.py --lane $(LANE) --claim
verify-task: ## T=T-123: the fast suite, acceptance coverage and the task's checks
	bash scripts/protocol/verify-task.sh $(T)
autopilot: ## run tasks with Claude Code headless: LANE=web MAX_TASKS=3
	LANE=$(LANE) MAX_TASKS=$(or $(MAX_TASKS),1) bash scripts/autopilot/loop.sh
status: ## where the build stands
	@if [ -f .bootstrap-state ]; then echo "Bootstrap:"; sed 's/^/  /' .bootstrap-state; else echo "Bootstrap not started"; fi
	@if [ -f CONFORMANCE.md ]; then sed -n '3p' CONFORMANCE.md; fi
	@gh issue list --label task --label status:ready --state open --limit 10 2>/dev/null || true

# ── Tests ─────────────────────────────────────────────────────────────────────────────────────────
gates: ## all database tests: supabase/tests/gates and supabase/tests/app
	supabase test db
test: ## worker tests and web unit tests
	@[ -d fixtures/synth/out ] || $(MAKE) fixtures
	cd worker && uv run pytest -q
	@if [ -f apps/web/package.json ]; then pnpm --dir apps/web test; fi
verify-fast: ## what the Claude Code Stop hook runs
	@supabase status >/dev/null 2>&1 || supabase start
	supabase test db
	@[ -d fixtures/synth/out ] || $(MAKE) fixtures
	cd worker && uv run pytest -q
	@if [ -f apps/web/package.json ]; then pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web test; fi
	$(PY) scripts/protocol/validate-plan.py
	$(PY) scripts/workflows/render.py --check
verify: verify-fast e2e ## everything CI runs
e2e: ## full-stack end-to-end on the local stack
	@if [ -f apps/web/package.json ]; then bash scripts/ci/e2e.sh; else echo "apps/web is scaffolded in T-007"; fi
e2e-ci: e2e ## CI entry point for the end-to-end job
smoke: ## @smoke suite against a deployed environment (ENV=staging|prod; secrets already in the environment)
	@if [ -f apps/web/package.json ]; then mkdir -p reports && BASE_URL="$$APP_BASE_URL" PLAYWRIGHT_JUNIT_OUTPUT_NAME="$(CURDIR)/reports/smoke-$(ENV).xml" pnpm --dir apps/web e2e --grep @smoke --reporter=junit,list; else echo "apps/web is scaffolded in T-007"; fi
acceptance-staging: ## the full acceptance suite against staging (nightly)
	@if [ -f apps/web/package.json ]; then mkdir -p reports && BASE_URL="$$APP_BASE_URL" PLAYWRIGHT_JUNIT_OUTPUT_NAME="$(CURDIR)/reports/acceptance-staging.xml" pnpm --dir apps/web e2e --grep-invert @local-only --reporter=junit,list; fi
conformance: ## CONFORMANCE.md from local reports
	$(PY) scripts/conformance/report.py
conformance-update: ## add newly passing acceptance IDs to the baseline (it never shrinks)
	$(PY) scripts/conformance/report.py --update-baseline
