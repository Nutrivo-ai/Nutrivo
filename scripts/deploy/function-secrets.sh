#!/usr/bin/env bash
# Push the Edge Functions' secrets to a hosted Supabase project before `supabase functions deploy` (T-702 follow-up).
# Usage: function-secrets.sh <staging|prod> <release-sha>. Run only in GitHub Actions, inside the deploy job's
# Infisical environment; a session never runs it (CLAUDE.md non-negotiable 11).
#   STRIPE_WEBHOOK_SECRET  stripe-webhook verifies Stripe's signature with it; without it every event is refused
#   SENTRY_DSN_FUNCTIONS   Sentry project nutrivo-functions, EU region only (D-17)
#   NUTRIVO_ENV, NUTRIVO_RELEASE  Sentry's environment and release for the functions
# Values go through a mode-600 file that is removed on exit, never on a command line or in the log.
set -euo pipefail
ENV_NAME="${1:?staging or prod}"; RELEASE="${2:?release sha}"
case "$ENV_NAME" in staging|prod) ;; *) echo "function-secrets: unknown environment $ENV_NAME" >&2; exit 2;; esac
missing=()
for n in SUPABASE_PROJECT_REF STRIPE_WEBHOOK_SECRET SENTRY_DSN_FUNCTIONS; do [ -n "${!n:-}" ] || missing+=("$n"); done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "function-secrets: missing ${missing[*]} in the $ENV_NAME Infisical project (config/secrets.yaml)" >&2; exit 1
fi
case "$STRIPE_WEBHOOK_SECRET" in whsec_*) ;; *) echo "function-secrets: STRIPE_WEBHOOK_SECRET is not a Stripe signing secret (whsec_...)" >&2; exit 1;; esac
host="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlparse(sys.argv[1]).hostname or "")' "$SENTRY_DSN_FUNCTIONS")"
case "$host" in *.de.sentry.io) ;; *) echo "function-secrets: SENTRY_DSN_FUNCTIONS is not in Sentry's EU region (*.de.sentry.io, D-17)" >&2; exit 1;; esac
f="$(umask 077 && mktemp)"
trap 'rm -f "$f"' EXIT
printf 'STRIPE_WEBHOOK_SECRET=%s\nSENTRY_DSN_FUNCTIONS=%s\nNUTRIVO_ENV=%s\nNUTRIVO_RELEASE=%s\n' \
  "$STRIPE_WEBHOOK_SECRET" "$SENTRY_DSN_FUNCTIONS" "$ENV_NAME" "$RELEASE" > "$f"
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$f" >/dev/null
echo "function-secrets: STRIPE_WEBHOOK_SECRET, SENTRY_DSN_FUNCTIONS, NUTRIVO_ENV, NUTRIVO_RELEASE set for $ENV_NAME"
