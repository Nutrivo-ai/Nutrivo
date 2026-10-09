#!/usr/bin/env bash
# BOOTSTRAP step 1: confirm every tool exists. Prints install commands for anything missing.
missing=0
need() { if command -v "$1" >/dev/null 2>&1; then printf '  ✓ %-10s %s\n' "$1" "$($1 --version 2>/dev/null | head -1)"; else printf '  ✗ %-10s install: %s\n' "$1" "$2"; missing=1; fi; }
need git "brew install git"
need gh "brew install gh"
need node "brew install node   (22 or newer)"
need pnpm "brew install pnpm"
need uv "brew install uv"
need docker "brew install --cask docker   (then start Docker Desktop)"
need supabase "brew install supabase/tap/supabase"
need infisical "brew install infisical/get-cli/infisical"
need gs "brew install ghostscript"
need pdftoppm "brew install poppler"
need python3 "brew install python@3.12"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then echo "  ✗ node 22 or newer is required"; missing=1; fi
if command -v docker >/dev/null && ! docker info >/dev/null 2>&1; then echo "  ✗ Docker is installed but not running"; missing=1; fi
if [ -z "${INFISICAL_TOKEN:-}" ]; then echo "  ✗ INFISICAL_TOKEN is not set in this shell"; missing=1; else echo "  ✓ INFISICAL_TOKEN is set (value not shown)"; fi
command -v psql >/dev/null || echo "  · psql not found (optional; the doctor skips its direct Postgres check)"
exit $missing
