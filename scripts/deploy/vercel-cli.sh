#!/usr/bin/env bash
# The Vercel CLI, pinned: it runs beside staging and production secrets, so never @latest. Sourced by vercel.sh and
# rollback.sh; bump the version in a reviewed pull request.
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-64.1.0}"
vercel_cli() { npx --yes "vercel@${VERCEL_CLI_VERSION}" "$@"; }
