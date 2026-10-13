"""Claim the next ready task in a lane: make next LANE=web. Ready = issue open, unassigned, not labelled autopilot, no
open PR, every dependency closed. The GitHub assignment is the lock; on a race the later claimer backs off and takes
the next task. Repository-scoped REST only (lib.api), so it also runs in Claude Code on the web, where the session
already has its own branch: there the claim creates none (CLAUDE_CODE_REMOTE=true); elsewhere it starts t/T-123-...
from origin/main."""
import argparse, json, os, re, subprocess, sys
from lib import ROOT, api, gh_failure, ms_rank, plan, repo, sh, task_num

ap = argparse.ArgumentParser()
ap.add_argument("--lane", default="any")
ap.add_argument("--claim", action="store_true")
ap.add_argument("--json", action="store_true")
ap.add_argument("--include-human", action="store_true", default=os.environ.get("INCLUDE_HUMAN") == "1")
a = ap.parse_args()
p = plan()
web = os.environ.get("CLAUDE_CODE_REMOTE") == "true"


def pages(path):
    return [x for page in api(path, "--paginate", "--slurp") for x in page]


def release(n, me, reaction):
    """Undo a claim. False, after gh's message, if GitHub kept you assigned (the lock); the reaction is cosmetic."""
    try:
        api(f"issues/{n}/assignees", "-X", "DELETE", "-f", f"assignees[]={me}")
        unassigned = True
    except subprocess.CalledProcessError as e:
        print(gh_failure(e), file=sys.stderr)
        unassigned = False
    sh("gh", "api", "-X", "DELETE", f"repos/{repo()}/issues/{n}/reactions/{reaction}", check=False)
    return unassigned


def claim(n):
    """Assign yourself, then re-read: the claim holds only if you are the one assignee. Your login comes from the
    'eyes' reaction that marks the claim, since gh api user is not repository-scoped."""
    reaction = api(f"issues/{n}/reactions", "-X", "POST", "-f", "content=eyes")
    held, won = (reaction["user"]["login"], reaction["id"]), False
    try:
        # GitHub silently drops an assignee it cannot take (a bot, an app, no write access): not a race, so stop here.
        if held[0] not in [x["login"] for x in api(f"issues/{n}/assignees", "-X", "POST", "-f",
                                                   f"assignees[]={held[0]}")["assignees"]]:
            sys.exit(f"GitHub did not assign #{n} to {held[0]}: claims need a person with write access to {repo()}")
        won = [x["login"] for x in api(f"issues/{n}")["assignees"]] == [held[0]]
    finally:
        if not won:
            release(n, *held)
    return held if won else None


try:
    issues = [i for i in pages("issues?labels=task&state=all&per_page=100") if "pull_request" not in i]
    prs = pages("pulls?state=open&per_page=100")
except subprocess.CalledProcessError as e:
    sys.exit(gh_failure(e))
by_task = {i["title"].split(":")[0].strip(): i for i in issues}
closed = {tid for tid, i in by_task.items() if i["state"] == "closed"}
# A task is in flight while it is claimed (an open issue, assigned, or labelled autopilot: the GitHub autopilot cannot
# be assigned) or has an open PR, found by the 'Task: T-123' line check-pr reads (the head is claude/... in web
# sessions), else a t/T-123-... head. In flight is never offered, and one db task in flight holds back the others.
in_flight = {tid for tid, i in by_task.items() if i["state"] == "open"
             and (i["assignees"] or "autopilot" in {l["name"] for l in i["labels"]})}
for pr in prs:
    m = re.search(r"Task:\s*(T-\d+|none)\b", pr.get("body") or "") or re.match(r"t/(T-\d+)(?:-|$)", pr["head"]["ref"])
    if m and m.group(1) != "none":
        in_flight.add(m.group(1))
db = {t["id"] for t in p["tasks"] if "db" in t["lanes"]}
for t in sorted(p["tasks"], key=lambda t: (ms_rank(p, t["ms"]), task_num(t["id"]))):
    issue = by_task.get(t["id"])
    if not issue or issue["state"] == "closed" or t["id"] in in_flight:
        continue
    if not all(d in closed for d in t.get("deps", [])):
        continue
    if a.lane != "any" and a.lane not in t["lanes"]:
        continue
    if t.get("gate") == "human" and not a.include_human:
        continue
    if "db" in t["lanes"] and in_flight & db:
        continue
    n = issue["number"]
    slug = re.sub(r"[^a-z0-9]+", "-", t["title"].lower())[:40].strip("-")
    branch = sh("git", "branch", "--show-current").strip() if web else f"t/{t['id']}-{slug}"
    if a.claim:
        try:
            if not (held := claim(n)):
                in_flight.add(t["id"])  # the other claimer's now: a lost db task holds back the next one too
                continue
        except subprocess.CalledProcessError as e:
            sys.exit(gh_failure(e))
        if not web:
            try:  # an earlier attempt's branch is reused, with its work
                sh("git", "fetch", "origin", "main")
                if sh("git", "branch", "--list", branch).strip():
                    sh("git", "switch", branch)
                else:
                    sh("git", "switch", "-c", branch, "origin/main")
            except subprocess.CalledProcessError as e:
                why = gh_failure(e)
                sys.exit(f"{why}\n#{n} is " + ("unassigned again" if release(n, *held) else "still yours: unassign it"))
        (ROOT / ".task").write_text(json.dumps({"id": t["id"], "issue": n, "branch": branch}))
        print(f"The pull request body must say 'Task: {t['id']}' and 'Closes #{n}'.", file=sys.stderr)
    out = {"id": t["id"], "issue": n, "branch": branch, "title": t["title"], "lanes": t["lanes"]}
    where = f"this session's branch {branch}" if web else branch
    print(json.dumps(out) if a.json else f"{'claimed' if a.claim else 'next'}: {t['id']} #{n} {t['title']} -> {where}")
    sys.exit(0)
print("no ready task for this lane (dependencies open, all claimed, or gated)", file=sys.stderr)
sys.exit(3)
