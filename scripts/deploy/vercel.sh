#!/usr/bin/env bash
# Build and deploy apps/web with Vercel. Usage: vercel.sh staging|prod. Writes the deployment URL to .vercel-url, which
# the smoke step tests (the build just deployed, not whatever APP_BASE_URL last pointed at).
set -euo pipefail
TARGET="${1:?staging | prod}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/deploy/vercel-cli.sh
. "$ROOT/scripts/deploy/vercel-cli.sh"
cd "$ROOT/apps/web"
if [ "$TARGET" = prod ]; then env=production; flag=--prod; else env=preview; flag=; fi
vercel_cli pull --yes --environment="$env" --token="$VERCEL_TOKEN" >/dev/null
vercel_cli build $flag --token="$VERCEL_TOKEN" >/dev/null
url="$(vercel_cli deploy --prebuilt $flag --token="$VERCEL_TOKEN")"
[ -n "$url" ] || { echo "vercel $TARGET: deploy returned no URL" >&2; exit 1; }
if [ "$TARGET" = staging ] && [ -n "${STAGING_DOMAIN:-}" ]; then
  vercel_cli alias set "$url" "$STAGING_DOMAIN" --token="$VERCEL_TOKEN" >/dev/null
fi
echo "$url" > "$ROOT/.vercel-url"
echo "vercel $TARGET: $url"
