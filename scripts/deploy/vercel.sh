#!/usr/bin/env bash
# Build and deploy apps/web with Vercel. Usage: vercel.sh staging|prod. Writes the deployment URL to .vercel-url.
set -euo pipefail
TARGET="${1:?staging | prod}"
cd "$(dirname "$0")/../../apps/web"
V="npx --yes vercel@latest"
if [ "$TARGET" = prod ]; then env=production; flag=--prod; else env=preview; flag=; fi
$V pull --yes --environment="$env" --token="$VERCEL_TOKEN" >/dev/null
$V build $flag --token="$VERCEL_TOKEN" >/dev/null
url="$($V deploy --prebuilt $flag --token="$VERCEL_TOKEN")"
[ "$TARGET" = staging ] && [ -n "${STAGING_DOMAIN:-}" ] && $V alias set "$url" "$STAGING_DOMAIN" --token="$VERCEL_TOKEN" >/dev/null
echo "$url" > ../../.vercel-url
echo "vercel $TARGET: $url"
