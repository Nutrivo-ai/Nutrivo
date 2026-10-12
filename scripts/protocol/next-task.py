"""Claim the next ready task in a lane: make next LANE=web. Ready = issue open, unassigned, every dependency closed.
The GitHub assignment is the lock; on a race the later claimer backs off and takes the next task."""
import argparse, json, os, re, sys
from lib import ROOT, gh_json, ms_rank, plan, sh, task_by_id, task_num

ap = argparse.ArgumentParser()
ap.add_argument("--lane", default="any")
ap.add_argument("--claim", action="store_true")
ap.add_argument("--json", action="store_true")
ap.add_argument("--include-human", action="store_true", default=os.environ.get("INCLUDE_HUMAN") == "1")
a = ap.parse_args()
p = plan()
issues = gh_json("issue", "list", "--label", "task", "--state", "all", "--limit", "500",
                 "--json", "number,title,state,assignees")
by_task = {i["title"].split(":")[0].strip(): i for i in issues}
closed = {tid for tid, i in by_task.items() if i["state"] == "CLOSED"}
# One open migration PR at a time: an open PR whose branch t/T-123-... names a task with the db lane.
prs = gh_json("pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName")
open_tasks = [task_by_id(p, m.group(1)) for pr in prs if (m := re.match(r"t/(T-\d+)(?:-|$)", pr["headRefName"]))]
db_busy = any(t and "db" in t["lanes"] for t in open_tasks)
me = sh("gh", "api", "user", "--jq", ".login").strip()
for t in sorted(p["tasks"], key=lambda t: (ms_rank(p, t["ms"]), task_num(t["id"]))):
    issue = by_task.get(t["id"])
    if not issue or issue["state"] == "CLOSED" or issue["assignees"]:
        continue
    if not all(d in closed for d in t.get("deps", [])):
        continue
    if a.lane != "any" and a.lane not in t["lanes"]:
        continue
    if t.get("gate") == "human" and not a.include_human:
        continue
    if "db" in t["lanes"] and db_busy:
        continue
    slug = re.sub(r"[^a-z0-9]+", "-", t["title"].lower())[:40].strip("-")
    branch = f"t/{t['id']}-{slug}"
    if a.claim:
        sh("gh", "issue", "edit", str(issue["number"]), "--add-assignee", "@me")
        after = gh_json("issue", "view", str(issue["number"]), "--json", "assignees")
        if [x["login"] for x in after["assignees"]] != [me]:
            sh("gh", "issue", "edit", str(issue["number"]), "--remove-assignee", "@me", check=False)
            continue
        sh("git", "fetch", "origin", "main")
        sh("git", "switch", "-c", branch, "origin/main")
        (ROOT / ".task").write_text(json.dumps({"id": t["id"], "issue": issue["number"], "branch": branch}))
    out = {"id": t["id"], "issue": issue["number"], "branch": branch, "title": t["title"], "lanes": t["lanes"]}
    print(json.dumps(out) if a.json else f"{'claimed' if a.claim else 'next'}: {t['id']} #{issue['number']} {t['title']} -> {branch}")
    sys.exit(0)
print("no ready task for this lane (dependencies open, all claimed, or gated)", file=sys.stderr)
sys.exit(3)
