#!/usr/bin/env bash
# Maps names already used in Infisical to the canonical names in config/secrets.yaml (config/secret-aliases.env).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$ROOT/config/secret-aliases.env" ]; then
  while IFS='=' read -r canonical alias; do
    canonical="${canonical// /}"; alias="${alias// /}"
    [ -z "$canonical" ] || [ "${canonical:0:1}" = "#" ] || [ -z "$alias" ] && continue
    if [ -z "${!canonical:-}" ] && [ -n "${!alias:-}" ]; then export "$canonical=${!alias}"; fi
  done < "$ROOT/config/secret-aliases.env"
fi
exec "$@"
