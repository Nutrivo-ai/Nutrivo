"""make verify-task T=T-123: every acceptance ID of the task has a test, and the task's checks pass."""
import re, subprocess, sys
from lib import ROOT, ID_RE, acceptance, acceptance_ids, normalise_id, plan, task_by_id

# Where an ID counts: a test's title (docs/19), never a comment. Each pattern's groups capture titles only; comments,
# other strings and $$-quoted SQL are matched too, so they are consumed without counting.
TS = re.compile(r"""//[^\n]*|/\*.*?\*/|(?<![\w.$])(?:test|it)\s*\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`)"""
                r"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`""", re.S)
TITLES = {
    ".py": re.compile(r"^[ \t]*(?:async[ \t]+)?def[ \t]+(test_\w+)", re.M),  # pytest: test_D04_must_1_...
    ".ts": TS, ".tsx": TS,  # Playwright / Vitest: test('[A01.main] ...') or it(...)
    ".sql": re.compile(r"--[^\n]*|/\*.*?\*/|\$(?:\w*)\$.*?\$(?:\w*)\$|'((?:[^']|'')*)'", re.S),  # pgTAP descriptions
}

tid = sys.argv[1]
p, acc = plan(), acceptance()
task = task_by_id(p, tid)
if not task:
    sys.exit(f"unknown task {tid}")
found = set()
for folder in ("apps/web", "worker/tests", "supabase/tests"):
    for path in (ROOT / folder).rglob("*"):
        if path.is_file() and path.suffix in TITLES and "node_modules" not in path.parts:
            for t in TITLES[path.suffix].finditer(path.read_text(errors="ignore")):
                found |= {normalise_id(m) for title in t.groups() if title for m in ID_RE.finditer(title)}
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
