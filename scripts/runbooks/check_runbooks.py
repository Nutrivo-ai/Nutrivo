"""T-1106: the runbooks name only things that exist, so they cannot rot silently.

Every runbook (docs/runbooks/*.md and docs/pilot-runbook.md) is read for the references below, and each must resolve
against the repository as it is:

| Written as | Must exist |
|---|---|
| a backticked path under a top-level directory (`scripts/deploy/rollback.sh`) | that file or directory |
| a relative Markdown link ([text](restore-drill.md)) | that file |
| `make <target> …` in backticks | a target in the Makefile |
| `app.x`, `public.x`, `private.x` in backticks | a function, table or view a migration in supabase/migrations creates |
| Actions → `name` | a workflow whose `name:` is that name |
| monitor `slug` (or monitors `a`, `b` and `c`) | a Sentry monitor the worker or a workflow checks in to |
| doctor check `name` | a check in scripts/doctor/doctor.py |
| label `name` (or labels / labelled) | a label scripts/protocol/tracker-setup.sh or a workflow creates |
| Render service `name` | a service in render.yaml |

Run: python3 scripts/runbooks/check_runbooks.py (exit 1 and one line per broken reference). Standard library only."""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUNBOOKS = ["docs/runbooks/*.md", "docs/pilot-runbook.md"]
TOP_DIRS = (".github", "apps", "config", "docs", "fixtures", "plan", "scripts", "spec", "supabase", "worker", "design",
            "content")


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def _files(pattern):
    return sorted(os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, pattern)))


def runbook_files():
    out = []
    for pattern in RUNBOOKS:
        out += _files(pattern)
    return out


class Repo:
    """What the repository actually holds, read once."""

    def __init__(self):
        mk = _read("Makefile")
        self.make_targets = set(re.findall(r"^([A-Za-z][A-Za-z0-9_-]*):", mk, re.M))
        sql = "\n".join(_read(p) for p in _files("supabase/migrations/*.sql"))
        self.functions = {m.lower() for m in re.findall(
            r"create\s+(?:or\s+replace\s+)?(?:function|table|view)\s+(?:if\s+not\s+exists\s+)?"
            r"((?:app|public|private)\.[a-z_0-9]+)", sql, re.I)}
        self.workflows, wf_text = set(), ""
        for p in _files(".github/workflows/*.yml"):
            text = _read(p)
            wf_text += text + "\n"
            m = re.search(r"^name:\s*(.+?)\s*$", text, re.M)
            if m:
                self.workflows.add(m.group(1).strip("'\""))
        obs = _read("worker/src/nutrivo_worker/observability.py")
        self.monitors = set(re.findall(r"^[A-Z_]+_MONITOR\s*=\s*\"([a-z0-9-]+)\"", obs, re.M))
        # `sentry-cli monitors run [flags] <slug> -- <command>` in a workflow: the slug is the last word before `--`
        for args in re.findall(r"monitors run\s+(.*?)\s--\s", wf_text, re.S):
            self.monitors.add(args.split()[-1])
        # T-1102's registry of every scheduled job's monitor, when present
        if os.path.exists(os.path.join(ROOT, "config/monitors.yaml")):
            self.monitors.update(re.findall(r"^\s*-\s*slug:\s*([a-z0-9-]+)", _read("config/monitors.yaml"), re.M))
        doctor = _read("scripts/doctor/doctor.py")
        checks = re.search(r"^CHECKS\s*=\s*\{(.*?)\}", doctor, re.M | re.S)
        self.doctor_checks = set(re.findall(r"\"([a-z-]+)\":", checks.group(1))) if checks else set()
        tracker = _read("scripts/protocol/tracker-setup.sh")
        self.labels = set(re.findall(r"^([a-z][a-z0-9:-]*)\|", tracker, re.M))
        for group in re.findall(r"--label[ =]\"?([a-z0-9:,${}-]+)", wf_text):
            self.labels.update(x for x in group.split(",") if x and "$" not in x)
        self.labels.update(re.findall(r"gh label create \"?([a-z0-9:-]+)", wf_text))
        self.render_services = set(re.findall(r"^\s*name:\s*([a-z0-9-]+)\s*$", _read("render.yaml"), re.M))


def _ticked_list(text):
    """`a`, `b` and `c` → [a, b, c]. A placeholder such as `<name>` is not a reference."""
    return [t for t in re.findall(r"`([^`]+)`", text) if "<" not in t]


def check_text(rel, text, repo):
    """Broken references in one runbook's text, as 'file:line: message'."""
    errors, refs = [], 0
    base = os.path.dirname(rel)
    for n, line in enumerate(text.splitlines(), 1):
        def bad(msg):
            errors.append(f"{rel}:{n}: {msg}")

        for tok in re.findall(r"`([^`\n]+)`", line):
            path = tok.split()[0] if tok.split() else tok
            if path.split("/")[0] in TOP_DIRS and "/" in path and not any(c in path for c in "<>*{}$"):
                refs += 1
                if not os.path.exists(os.path.join(ROOT, path.rstrip("/"))):
                    bad(f"path `{path}` does not exist")
            m = re.match(r"make ([A-Za-z][A-Za-z0-9_-]*)\b", tok)
            if m:
                refs += 1
                if m.group(1) not in repo.make_targets:
                    bad(f"`make {m.group(1)}`: no such Makefile target")
            m = re.fullmatch(r"((?:app|public|private)\.[a-z_0-9]+)(?:\(.*\))?", tok)
            if m:
                refs += 1
                if m.group(1).lower() not in repo.functions:
                    bad(f"`{m.group(1)}`: no migration creates this function, table or view")
        for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", line):
            if re.match(r"[a-z]+:", target):
                continue        # http:, https:, mailto:
            refs += 1
            if not os.path.exists(os.path.normpath(os.path.join(ROOT, base, target))):
                bad(f"link ({target}) does not exist")
        for name in [x for x in re.findall(r"Actions → `([^`]+)`", line) if "<" not in x]:
            refs += 1
            if name not in repo.workflows:
                bad(f"Actions → `{name}`: no workflow has this name")
        for group in re.findall(r"\b[Mm]onitors? ((?:`[^`]+`(?:, | and | or )?)+)", line):
            for slug in _ticked_list(group):
                refs += 1
                if slug not in repo.monitors:
                    bad(f"monitor `{slug}`: nothing checks in to it")
        for name in [x for x in re.findall(r"doctor check `([^`]+)`", line) if "<" not in x]:
            refs += 1
            if name not in repo.doctor_checks:
                bad(f"doctor check `{name}`: not in scripts/doctor/doctor.py")
        for group in re.findall(r"\blabel(?:s|led)? ((?:`[^`]+`(?:, | and | or )?)+)", line):
            for label in _ticked_list(group):
                refs += 1
                if label not in repo.labels:
                    bad(f"label `{label}`: no script or workflow creates it")
        for name in [x for x in re.findall(r"Render service `([^`]+)`", line) if "<" not in x]:
            refs += 1
            if name not in repo.render_services:
                bad(f"Render service `{name}`: not in render.yaml")
    return errors, refs


def check_all():
    repo = Repo()
    errors, counts = [], {}
    for rel in runbook_files():
        e, refs = check_text(rel, _read(rel), repo)
        errors += e
        counts[rel] = refs
    return errors, counts


if __name__ == "__main__":
    errs, counts = check_all()
    for rel, refs in counts.items():
        print(f"{rel}: {refs} references")
    for e in errs:
        print(e, file=sys.stderr)
    sys.exit(1 if errs else 0)
