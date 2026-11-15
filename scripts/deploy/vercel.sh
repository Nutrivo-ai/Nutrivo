#!/usr/bin/env bash
# Build and deploy apps/web with Vercel. Usage: vercel.sh staging|prod. Writes the deployment URL to .vercel-url, which
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
if [ "$TARGET" = prod ]; then env=production; flag=--prod; else env=preview; flag=; fi
vercel_cli pull --yes --environment="$env" --token="$VERCEL_TOKEN" >/dev/null
vercel_cli build $flag --token="$VERCEL_TOKEN" >/dev/null
url="$(vercel_cli deploy --prebuilt $flag --token="$VERCEL_TOKEN")"
[ -n "$url" ] || { echo "vercel $TARGET: deploy returned no URL" >&2; exit 1; }
if [ "$TARGET" = prod ]; then
  # After `vercel rollback`, Vercel stops assigning the production domains to new production deployments until one is
  # promoted; promoting this one makes it live either way.
  vercel_cli promote "$url" --yes --token="$VERCEL_TOKEN" >/dev/null
fi
if [ "$TARGET" = staging ] && [ -n "${STAGING_DOMAIN:-}" ]; then
  vercel_cli alias set "$url" "$STAGING_DOMAIN" --token="$VERCEL_TOKEN" >/dev/null
fi
echo "$url" > "$ROOT/.vercel-url"
echo "vercel $TARGET: $url"
