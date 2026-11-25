#!/usr/bin/env bash
# Build and deploy apps/web with Vercel: staging to the nutrivo-staging project, prod to nutrivo, each as that
# project's production deploy. Usage: vercel.sh staging|prod. Writes the deployment URL to .vercel-url, which
# the smoke step tests (the build just deployed, not whatever APP_BASE_URL last pointed at).
set -euo pipefail
TARGET="${1:?staging | prod}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/deploy/vercel-cli.sh
. "$ROOT/scripts/deploy/vercel-cli.sh"
# From the repository root: the Vercel project's Root Directory is apps/web, so the CLI resolves it itself (run inside
# apps/web it looked for apps/web/apps/web). The build reads the job's own environment (the staging or prod Infisical
# project); variables the sync marks sensitive come back from `vercel pull` only as placeholders, which never override
# it.
cd "$ROOT"
vercel_expect_project "$TARGET"
# Staging has its own project (#19): both targets are production deploys of their own project, so both roll back
# instantly with `vercel rollback`.
env=production; flag=--prod
vercel_cli pull --yes --environment="$env" --token="$VERCEL_TOKEN" >/dev/null
vercel_cli build $flag --token="$VERCEL_TOKEN" >/dev/null
url="$(vercel_cli deploy --prebuilt $flag --token="$VERCEL_TOKEN")"
[ -n "$url" ] || { echo "vercel $TARGET: deploy returned no URL" >&2; exit 1; }
# After `vercel rollback`, Vercel stops assigning the production domains to new production deployments until one is
# promoted; promoting this one makes it live either way. A normal --prod deploy is already the current production
# deployment, and Vercel answers that promote with 409 "already the current production deployment": that is success
# (the first nutrivo-staging deploy failed on it, 25 Nov 2026). Any other refusal fails the step.
if ! out="$(vercel_cli promote "$url" --yes --token="$VERCEL_TOKEN" 2>&1)"; then
  if printf '%s' "$out" | grep -q "already the current production deployment"; then
    echo "vercel $TARGET: $url is already the current production deployment"
  else
    printf '%s\n' "$out" >&2
    exit 1
  fi
fi
if [ "$TARGET" = staging ] && [ -n "${STAGING_DOMAIN:-}" ]; then
  vercel_cli alias set "$url" "$STAGING_DOMAIN" --token="$VERCEL_TOKEN" >/dev/null
fi
echo "$url" > "$ROOT/.vercel-url"
echo "vercel $TARGET: $url"
