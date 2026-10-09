"""make verify-task T=T-123: every acceptance ID of the task has a test, and the task's checks pass."""
import subprocess, sys
from lib import ROOT, ID_RE, acceptance, acceptance_ids, normalise_id, plan, task_by_id

tid = sys.argv[1]
p, acc = plan(), acceptance()
task = task_by_id(p, tid)
if not task:
    sys.exit(f"unknown task {tid}")
found = set()
for folder in ("apps/web", "worker/tests", "supabase/tests"):
    for path in (ROOT / folder).rglob("*"):
        if path.is_file() and path.suffix in {".ts", ".tsx", ".py", ".sql"} and "node_modules" not in path.parts:
            found |= {normalise_id(m) for m in ID_RE.finditer(path.read_text(errors="ignore"))}
missing = [i for i in acceptance_ids(task, acc) if i not in found]
for i in missing:
    print(f"  missing test for {i}: {acc[i.split('.')[0]]['tests'][i]}")
failed = []
for check in task.get("checks", []):
    print(f"  running check: {check}")
    if subprocess.run(check, shell=True, cwd=ROOT).returncode != 0:
        failed.append(check)
if missing or failed:
    sys.exit(f"{tid}: {len(missing)} acceptance IDs without tests, {len(failed)} checks failing")
print(f"{tid}: every acceptance ID has a test; checks pass")
