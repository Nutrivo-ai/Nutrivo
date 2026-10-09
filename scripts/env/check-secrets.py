"""Runs inside scripts/env/run.sh. Reports which canonical secret names exist for the environment. Names only."""
import argparse, os, sys
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser(); ap.add_argument("--env", required=True); ap.add_argument("--baseline")
a = ap.parse_args()
secrets = yaml.safe_load((ROOT / "config/secrets.yaml").read_text())["secrets"]
aliases = {}
alias_file = ROOT / "config/secret-aliases.env"
if alias_file.exists():
    for line in alias_file.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = (p.strip() for p in line.split("=", 1)); aliases[v] = k
missing, present = [], []
for s in secrets:
    if a.env not in s.get("envs", []):
        continue
    (present if os.environ.get(s["name"]) else missing).append(s)
print(f"Infisical environment '{a.env}': {len(present)} required names present, {len(missing)} missing")
for s in missing:
    print(f"  MISSING {s['name']:<28} used by {', '.join(s.get('used_by', []))}")
if a.baseline:
    base = set(Path(a.baseline).read_text().split())
    known = {s["name"] for s in secrets} | set(aliases)
    extra = sorted(n for n in os.environ if n not in base and n not in known and n != "NUTRIVO_ENV")
    if extra:
        print("Names in Infisical that are not mapped (candidates for config/secret-aliases.env):")
        print("  " + ", ".join(extra))
sys.exit(1 if missing else 0)
