"""Update or squash-merge a pull request the way D-24 allows, so a Claude Code session never needs raw `gh api -X`
writes (denied in .claude/settings.json).

  make pr-check  PR=123   say whether PR 123 may merge, and why not
  make pr-update PR=123   bring PR 123 up to date with its base (GitHub's "Update branch": a merge, never a rebase)
  make pr-merge  PR=123   squash-merge PR 123, only if every rule below holds on its current head
  make pr-comment PR=123 BODY=file.md   comment on PR or issue 123 (the body from a file, never a secret)
  make pr-open TITLE="…" BODY=file.md   open a PR from the current branch into main; the body must name its task
                                        ('Task: T-123' and 'Closes #N', or 'Incident: #N', or 'Task: none')

A PR may merge only when (CLAUDE.md 11, docs/15 step 9, D-24): it is open and not a draft; its head is up to date with
the base; every required check of the main ruleset has succeeded on the head; no reviewer's latest review requests
changes; and every review thread is resolved. The merge is pinned to the head SHA that was checked, so a push in
between makes GitHub refuse it rather than merge unchecked code."""
import json, os, re, sys
from pathlib import Path
from lib import api, repo, sh, ROOT

RULESET = ROOT / ".github/rulesets/main.json"


def required_checks():
    rules = json.loads(RULESET.read_text(encoding="utf-8"))["rules"]
    return [c["context"] for r in rules if r["type"] == "required_status_checks"
            for c in r["parameters"]["required_status_checks"]]


def write(method, path, *fields, files=()):
    """fields: key=value strings; files: key=path pairs read by gh (-F key=@path), for long markdown bodies."""
    args = ["api", "-X", method, f"repos/{repo()}/{path}"]
    for f in fields:
        args += ["-f", f]
    for key, path in files:
        args += ["-F", f"{key}=@{path}"]
    return json.loads(sh("gh", *args) or "null")


def body_file(path):
    if not path or not Path(path).is_file():
        sys.exit("BODY=<file> must name an existing markdown file")
    return str(Path(path).resolve())


def open_pr(title, body):
    text = Path(body).read_text(encoding="utf-8")
    if not re.search(r"Task:\s*(T-\d+|none)\b|Incident:\s*#\d+", text):
        sys.exit("the body must name its task: 'Task: T-123' + 'Closes #N', 'Incident: #N', or 'Task: none' (docs/15)")
    head = sh("git", "rev-parse", "--abbrev-ref", "HEAD").strip()
    if head in ("main", "HEAD"):
        sys.exit("open a PR from a branch, not from main")
    out = write("POST", "pulls", f"title={title}", f"head={head}", "base=main", files=[("body", body)])
    print(f"PR #{out['number']} opened: {out['html_url']}")


def blockers(n):
    """Every reason PR n may not merge now, and its head SHA."""
    pr = api(f"pulls/{n}")
    head, base = pr["head"]["sha"], pr["base"]["ref"]
    why = []
    if pr["state"] != "open":
        why.append(f"it is {'merged' if pr.get('merged') else pr['state']}")
        return why, head
    if pr.get("draft"):
        why.append("it is a draft")
    behind = api(f"compare/{base}...{head}")["behind_by"]
    if behind:
        why.append(f"it is {behind} commit(s) behind {base}: make pr-update PR={n}")
    runs = api(f"commits/{head}/check-runs?per_page=100")["check_runs"]
    for name in required_checks():
        mine = [r for r in runs if r["name"] == name]
        if not any(r["conclusion"] == "success" for r in mine):
            states = sorted({r["conclusion"] or r["status"] for r in mine}) or ["missing"]
            why.append(f"required check '{name}' is {'/'.join(states)} on {head[:7]}")
        elif any(r["status"] != "completed" for r in mine):
            why.append(f"required check '{name}' is still running on {head[:7]}")
    latest = {}
    for r in api(f"pulls/{n}/reviews?per_page=100"):
        if r["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[r["user"]["login"]] = r["state"]
    why += [f"{u} requests changes" for u, s in latest.items() if s == "CHANGES_REQUESTED"]
    try:
        threads = api(f"pulls/{n}/ccr/review_threads")
        open_threads = [t for t in (threads or []) if not t.get("isResolved", t.get("resolved", False))]
        if open_threads:
            why.append(f"{len(open_threads)} review thread(s) unresolved")
    except Exception:  # noqa: BLE001  outside Claude Code on the web there is no CCR route; GitHub's ruleset still checks
        pass
    return why, head


def main(cmd, n):
    if cmd == "check":
        why, head = blockers(n)
        print(f"PR #{n} at {head[:7]}: " + ("may merge" if not why else "may not merge:\n  - " + "\n  - ".join(why)))
        return 0 if not why else 1
    if cmd == "update":
        pr = api(f"pulls/{n}")
        print(write("PUT", f"pulls/{n}/update-branch", f"expected_head_sha={pr['head']['sha']}").get("message", ""))
        return 0
    if cmd == "merge":
        why, head = blockers(n)
        if why:
            print(f"PR #{n} not merged:\n  - " + "\n  - ".join(why), file=sys.stderr)
            return 1
        title = api(f"pulls/{n}")["title"]
        out = write("PUT", f"pulls/{n}/merge", "merge_method=squash", f"sha={head}", f"commit_title={title} (#{n})")
        print(f"PR #{n} merged as {out['sha'][:7]}" if out.get("merged") else out)
        return 0 if out.get("merged") else 1
    if cmd == "comment":
        out = write("POST", f"issues/{n}/comments", files=[("body", body_file(os.environ.get("BODY")))])
        print(out["html_url"])
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "open":
        if not os.environ.get("TITLE"):
            sys.exit("TITLE=\"…\" is required")
        open_pr(os.environ["TITLE"], body_file(os.environ.get("BODY")))
        sys.exit(0)
    if len(sys.argv) != 3 or not sys.argv[2].isdigit():
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
