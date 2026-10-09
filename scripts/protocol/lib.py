"""Shared helpers for the build protocol scripts. Run them with: uv run --no-project --with pyyaml python <script>."""
import json, re, subprocess
from fnmatch import fnmatch
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
ID_RE = re.compile(r"\b([A-P]\d{2})[._](main|must[._]\d+|fail[._]\d+)\b")


def load(rel):
    return yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))


def plan():
    return load("plan/tasks.yaml")


def acceptance():
    return load("spec/acceptance.yaml")["workflows"]


def task_by_id(p, tid):
    return next((t for t in p["tasks"] if t["id"] == tid), None)


def acceptance_ids(task, acc):
    ids = []
    for wf in task.get("wf", []):
        ids += list((acc.get(wf) or {}).get("tests", {}).keys())
    return ids


def allowed_paths(p, task):
    paths = list(p.get("always_allowed", []))
    for lane in task.get("lanes", []):
        paths += p["lanes"][lane]
    return paths


def matches(path, patterns):
    return any(fnmatch(path, pat) for pat in patterns)


def normalise_id(m):
    return f"{m.group(1)}.{m.group(2).replace('_', '.')}"


def sh(*cmd, check=True):
    return subprocess.run(cmd, check=check, capture_output=True, text=True, cwd=ROOT).stdout


def gh_json(*args):
    return json.loads(sh("gh", *args) or "null")


def ms_rank(p, ms):
    return p["milestone_order"].index(ms)


def task_num(tid):
    return int(tid.split("-")[1])
