#!/bin/bash
# SessionStart hook for Claude Code on the web (cloud sessions only; local machines follow SETUP.md step 2).
# Provisions what BOOTSTRAP step 1 checks and starts the local stack, so `make verify-fast` (the Stop hook) works
# from the first turn. Idempotent: a resumed or cached container skips what is already in place.
#
# Cloud egress usually blocks GitHub release downloads and the public.ecr.aws image store, so the Supabase CLI comes
# from its npm prebuilt package, the Infisical CLI from its Docker Hub image, and Supabase images from Docker Hub.
# Optional environment variables (set them in the cloud environment, never in the repository):
#   INFISICAL_TOKEN                               used as is by scripts/env/run.sh
#   INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET  a machine identity (universal auth); exchanged for INFISICAL_TOKEN
#   DOCKERHUB_USERNAME + DOCKERHUB_TOKEN          authenticated pulls, avoiding Docker Hub's anonymous rate limit
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

SUPABASE_VERSION=2.120.0
INFISICAL_VERSION=0.43.140
export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io

ready=(); problems=()
ok() { ready+=("$1"); }
fail() { problems+=("$1"); echo "[session-start] $1" >&2; }
persist() { [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "$1" >> "$CLAUDE_ENV_FILE"; }

persist "export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io"

# Ghostscript and Poppler: synthetic fixtures (make fixtures) and extraction.
if command -v gs >/dev/null && command -v pdftoppm >/dev/null; then ok "ghostscript+poppler"
elif { apt-get install -y -q ghostscript poppler-utils || { apt-get update -q && apt-get install -y -q ghostscript poppler-utils; }; } >/dev/null 2>&1
then ok "ghostscript+poppler"; else fail "apt could not install ghostscript and poppler-utils"; fi

# Docker daemon: the local Supabase stack runs in it.
if ! docker info >/dev/null 2>&1; then
  (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
if docker info >/dev/null 2>&1; then ok "docker"; else fail "dockerd did not start (see /tmp/dockerd.log)"; fi
if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  printf %s "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin >/dev/null 2>&1 \
    || fail "docker login to Docker Hub failed"
fi

pull() { # pull with retries: Docker Hub answers 429 when the shared egress address is over its anonymous limit
  for wait in 0 20 60; do sleep "$wait"; docker pull -q "$1" >/dev/null 2>&1 && return 0; done; return 1
}

# Supabase CLI, pinned. The npm package @supabase/cli-<platform> carries the prebuilt binary.
if [ "$(supabase --version 2>/dev/null)" != "$SUPABASE_VERSION" ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) arch="" ;; esac
  tmp="$(mktemp -d)"
  if [ -n "$arch" ] && (cd "$tmp" && npm pack -q "@supabase/cli-linux-$arch@$SUPABASE_VERSION" >/dev/null 2>&1 \
       && tar xzf ./*.tgz && install -m755 package/bin/supabase /usr/local/bin/supabase); then :
  else fail "could not install Supabase CLI $SUPABASE_VERSION from npm"; fi
  rm -rf "$tmp"
fi
[ "$(supabase --version 2>/dev/null)" = "$SUPABASE_VERSION" ] && ok "supabase $SUPABASE_VERSION"

# Infisical CLI, pinned, copied out of its Docker Hub image.
if [ "$(infisical --version 2>/dev/null)" != "infisical version $INFISICAL_VERSION" ] && docker info >/dev/null 2>&1; then
  if pull "infisical/cli:$INFISICAL_VERSION" && cid="$(docker create "infisical/cli:$INFISICAL_VERSION")"; then
    docker cp "$cid:/bin/infisical" /usr/local/bin/infisical >/dev/null 2>&1 || fail "could not copy the Infisical CLI out of its image"
    docker rm "$cid" >/dev/null 2>&1
  else fail "could not pull infisical/cli:$INFISICAL_VERSION from Docker Hub"; fi
fi
[ "$(infisical --version 2>/dev/null)" = "infisical version $INFISICAL_VERSION" ] && ok "infisical $INFISICAL_VERSION"

# Infisical access: a machine identity's client id and secret become a session token. Nothing is printed, and the
# secret reaches the CLI through its own environment variables, never the command line (readable in /proc).
if [ -z "${INFISICAL_TOKEN:-}" ] && [ -n "${INFISICAL_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ]; then
  if token="$(INFISICAL_UNIVERSAL_AUTH_CLIENT_ID="$INFISICAL_CLIENT_ID" \
              INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET="$INFISICAL_CLIENT_SECRET" \
              infisical login --method=universal-auth --silent --plain 2>/dev/null)" && [ -n "$token" ]; then
    persist "export INFISICAL_TOKEN='$token'"; ok "infisical login"
  else fail "Infisical login failed: is the Infisical host allowed in this environment's network settings?"; fi
elif [ -z "${INFISICAL_TOKEN:-}" ]; then
  fail "no INFISICAL_TOKEN (or INFISICAL_CLIENT_ID/INFISICAL_CLIENT_SECRET) in this environment: secret-backed commands will not run"
fi

# Worker dependencies and the synthetic fixtures the worker tests read.
if (cd worker && uv sync -q) >/dev/null 2>&1; then ok "worker deps"; else fail "uv sync failed in worker/"; fi
if [ -d fixtures/synth/out ] || make -s fixtures >/dev/null 2>&1; then ok "fixtures"; else fail "make fixtures failed"; fi
if [ -f apps/web/package.json ]; then
  if pnpm --dir apps/web install --prefer-offline >/dev/null 2>&1; then ok "web deps"; else fail "pnpm install failed in apps/web"; fi
fi

# Local Supabase. A container restored from a snapshot can come back unhealthy; the local database only holds what
# the migrations seed, so it is rebuilt rather than repaired.
if docker info >/dev/null 2>&1 && command -v supabase >/dev/null; then
  if ! supabase status >/dev/null 2>&1; then
    supabase stop --no-backup >/dev/null 2>&1
    for attempt in 1 2 3; do
      supabase start -x studio,imgproxy,supavisor,logflare,vector >/tmp/supabase-start.log 2>&1 && break
      supabase stop --no-backup >/dev/null 2>&1; sleep $((attempt * 20))
    done
  fi
  # A reused container keeps the schema it was built with: apply the migrations merged since. Data is never reset.
  if ! supabase status >/dev/null 2>&1; then fail "local Supabase did not start (see /tmp/supabase-start.log)"
  elif supabase migration up --local --include-all >/tmp/supabase-migrate.log 2>&1; then ok "local supabase"
  else fail "local migrations did not apply (see /tmp/supabase-migrate.log): run make db-reset"; fi
fi

echo "Nutrivo cloud session: ready: ${ready[*]:-nothing}."
[ ${#problems[@]} -eq 0 ] || echo "Not ready: $(IFS=';'; echo "${problems[*]}"). See docs/22-github-and-team.md, section 5."
exit 0
