#!/usr/bin/env bash
# Maps names already used in Infisical to the canonical names in config/secrets.yaml (config/secret-aliases.env).
# A malformed alias file stops the command, with the line aliases.py names, rather than dropping an alias.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
pairs="$(python3 "$ROOT/scripts/env/aliases.py" "$ROOT/config/secret-aliases.env")" || exit 1
while read -r canonical alias; do
  [ -n "$canonical" ] || continue
  if [ -z "${!canonical:-}" ] && [ -n "${!alias:-}" ]; then export "$canonical=${!alias}"; fi
done <<< "$pairs"
exec "$@"
