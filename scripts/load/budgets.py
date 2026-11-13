"""Every budget in spec/nfr.yaml, checked (T-1105).

  budgets.py coverage                     list each budget and the tests that name it; fail when one has none
  budgets.py static                       run the checks that read the repository (quality, security, reliability)
  budgets.py report --profile P [--out reports/LOAD.md] [--summary FILE]
                                          one row per budget from the load run (reports/load/<budget>.json) and the
                                          static checks; fail when an enforced budget is not met or a budget is missing

A test names its budget as `[nfr:<section>.<key>]` in its title (Playwright, tests/load) or as
`test_nfr_<section>_<key>` (pytest and unittest). Statuses: met, exceeded, withheld (cannot be measured here, with a
reason; never counted as met) and staging_only (measured only on staging).
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
NFR = ROOT / "spec/nfr.yaml"
PROFILES = ROOT / "config/load/profiles.yaml"
LOAD_OUT = ROOT / "reports/load"

# Where tests that name a budget live.
TEST_DIRS = ("apps/web/tests", "worker/tests", "scripts/load", "supabase/tests")
TS_TITLE = re.compile(r"\[nfr:([a-z_]+)\.([a-z0-9_]+)\]")
PY_TEST = re.compile(r"^[ \t]*(?:async[ \t]+)?def[ \t]+test_nfr_([a-z]+)_([a-z0-9_]+)\s*\(", re.M)

# Static checks that are not enforced, each with the open question that holds it (#83).
NOT_ENFORCED = {
    "reliability.job_visibility_timeout_s": "#83 Q1: the worker's lease is the visibility timeout; spec and code differ",
}


def nfr() -> dict[str, dict[str, float]]:
    return yaml.safe_load(NFR.read_text())


def budget_keys(spec: dict | None = None) -> list[str]:
    spec = spec if spec is not None else nfr()
    return [f"{section}.{key}" for section, values in spec.items() for key in values]


def limit(key: str, spec: dict | None = None) -> float:
    section, name = key.split(".", 1)
    return (spec if spec is not None else nfr())[section][name]


def profiles() -> dict[str, dict]:
    return yaml.safe_load(PROFILES.read_text())


# ── Coverage ──────────────────────────────────────────────────────────────────────────────────────
def named_budgets(root: Path = ROOT, spec: dict | None = None) -> dict[str, list[str]]:
    """Budget → files whose test titles or names carry it."""
    keys = set(budget_keys(spec))
    sections = {k.split(".")[0] for k in keys}
    found: dict[str, list[str]] = {k: [] for k in keys}
    for folder in TEST_DIRS:
        base = root / folder
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or "node_modules" in path.parts or ".venv" in path.parts:
                continue
            text = path.read_text(errors="ignore") if path.suffix in {".ts", ".tsx", ".py"} else ""
            rel = str(path.relative_to(root))
            hits: set[str] = set()
            if path.suffix in {".ts", ".tsx"}:
                hits |= {f"{s}.{k}" for s, k in TS_TITLE.findall(text)}
            elif path.suffix == ".py" and path.name.startswith("test_"):
                for section, rest in PY_TEST.findall(text):
                    if section in sections:
                        hits.add(f"{section}.{rest}")
            for h in hits & keys:
                found[h].append(rel)
    return found


# ── Static checks: what the repository itself enforces ────────────────────────────────────────────
@dataclass
class Row:
    budget: str
    limit: float
    status: str                  # met · exceeded · withheld · staging_only · missing
    measured: float | None = None
    unit: str = ""
    n: int = 0
    enforced: bool = False
    reason: str = ""
    source: str = ""
    detail: dict = field(default_factory=dict)


def _read(rel: str) -> str:
    p = ROOT / rel
    return p.read_text() if p.exists() else ""


def _test_files() -> list[Path]:
    out = []
    for folder in ("apps/web/tests", "worker/tests", "supabase/tests"):
        for p in (ROOT / folder).rglob("*"):
            if p.is_file() and p.suffix in {".ts", ".tsx", ".py", ".sql"} and "node_modules" not in p.parts:
                out.append(p)
    return out


def worker_settings_defaults(source: str | None = None) -> dict[str, float]:
    """The worker's Settings defaults (worker/src/nutrivo_worker/config.py), read without importing the worker."""
    tree = ast.parse(source if source is not None else _read("worker/src/nutrivo_worker/config.py"))
    out: dict[str, float] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Settings":
            for stmt in node.body:
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is not None:
                    value = stmt.value
                    if isinstance(value, ast.Call) and value.args:   # Field(default, ...)
                        value = value.args[0]
                    try:
                        out[stmt.target.id] = _constant(value)
                    except ValueError:
                        pass
    return out


_OPS = {ast.Mult: lambda a, b: a * b, ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b}


def _constant(node: ast.AST):
    """A literal, or arithmetic over literals such as `15 * 60`; anything else is ValueError."""
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_constant(node.left), _constant(node.right))
    return ast.literal_eval(node)


def check_visual(spec) -> Row:
    key = "quality.visual_max_diff_pixel_ratio"
    lim = limit(key, spec)
    literals = []
    for p in _test_files() + [ROOT / "apps/web/playwright.config.ts", ROOT / "apps/web/playwright.baselines.config.ts"]:
        if p.suffix in {".ts", ".tsx"} and p.exists():
            literals += [float(m) for m in re.findall(r"maxDiffPixelRatio\s*:\s*([0-9.]+)", p.read_text())]
    reads_nfr = "nfr.quality.visual_max_diff_pixel_ratio" in _read("apps/web/tests/e2e/support/public.ts")
    worst = max(literals, default=0.0)
    ok = reads_nfr and worst <= lim
    return Row(key, lim, "met" if ok else "exceeded", worst if literals else lim, "ratio",
               reason="" if ok else ("support/public.ts no longer reads the budget" if not reads_nfr else "a screenshot test allows more"),
               source="screenshot tests read the budget from spec/nfr.yaml (tests/e2e/support/public.ts); no literal above it",
               detail={"literals": sorted(set(literals))})


def check_axe(spec) -> Row:
    key = "quality.axe_serious_or_critical"
    lim = limit(key, spec)
    lax = []
    for p in _test_files():
        text = p.read_text(errors="ignore")
        if p.suffix in {".ts", ".tsx"} and "AxeBuilder" in text and "support/public" not in str(p):
            if not ('"serious"' in text and '"critical"' in text and "toEqual([])" in text):
                lax.append(str(p.relative_to(ROOT)))
    shared = _read("apps/web/tests/e2e/support/public.ts")
    ok = not lax and "nfr.quality.axe_serious_or_critical" in shared
    return Row(key, lim, "met" if ok else "exceeded", 0 if ok else len(lax), "violations",
               reason="" if ok else "an axe run that does not fail on a serious or critical violation",
               source="every axe run fails on any serious or critical violation (tests/e2e/support/public.ts and the specs)",
               detail={"lax": lax})


def check_acceptance_ratio(spec) -> Row:
    key = "quality.required_acceptance_ratio"
    lim = limit(key, spec)
    ci = _read(".github/workflows/ci.yml")
    ok = "scripts/conformance/report.py" in ci and "--enforce" in ci
    return Row(key, lim, "met" if ok else "exceeded", 1.0 if ok else None, "ratio",
               reason="" if ok else "ci.yml's conformance job no longer runs the ratchet with --enforce",
               source="the conformance ratchet fails any baseline ID without a passing result (ci.yml, conformance); "
                      "the full ratio is read at the launch review (docs/21)")


QUARANTINE = re.compile(r"@quarantine|mark\.quarantine|\btest\.fixme\s*\(", re.I)


def check_quarantine(spec) -> Row:
    key = "quality.quarantined_acceptance_tests"
    lim = limit(key, spec)
    hits = []
    for p in _test_files():
        for line in p.read_text(errors="ignore").splitlines():
            if QUARANTINE.search(line):
                hits.append(str(p.relative_to(ROOT)))
                break
    ok = len(hits) <= lim
    return Row(key, lim, "met" if ok else "exceeded", len(hits), "tests",
               source="no test carries the quarantine tag (@quarantine, mark.quarantine, test.fixme)", detail={"files": hits},
               reason="" if ok else "quarantined tests count as failing (docs/19)")


def check_vulnerabilities(spec) -> Row:
    key = "security.high_or_critical_vulnerabilities"
    lim = limit(key, spec)
    nightly = _read(".github/workflows/nightly.yml")
    ok = "pip-audit" in nightly and "--audit-level high" in nightly
    return Row(key, lim, "staging_only" if ok else "exceeded", None, "vulnerabilities",
               reason="" if ok else "nightly.yml no longer audits dependencies at level high",
               source="the nightly dependency audit fails on any high or critical (pnpm audit --audit-level high, pip-audit)")


def check_secrets(spec) -> Row:
    key = "security.secrets_in_repository"
    lim = limit(key, spec)
    ci = _read(".github/workflows/ci.yml")
    ok = "gitleaks" in ci and " detect " in ci and "--exit-code 0" not in ci
    return Row(key, lim, "met" if ok else "exceeded", 0 if ok else None, "secrets",
               reason="" if ok else "ci.yml's secrets-scan no longer fails on a finding",
               source="the required secrets-scan check runs gitleaks on every PR and push (ci.yml)")


# Each reliability budget and the worker setting that holds it, with its unit conversion.
RELIABILITY = {
    "reliability.job_max_attempts": ("max_attempts", 1),
    "reliability.job_visibility_timeout_s": ("stale_after_s", 1),       # the lease: a claimed message stays hidden for it
    "reliability.reaper_stuck_after_min": ("stale_after_s", 1 / 60),
    "reliability.heartbeat_interval_s": ("heartbeat_every_s", 1),
}


def check_reliability(key: str, spec, defaults: dict | None = None) -> Row:
    lim = limit(key, spec)
    defaults = defaults if defaults is not None else worker_settings_defaults()
    setting, scale = RELIABILITY[key]
    value = defaults.get(setting)
    measured = None if value is None else value * scale
    ok = measured is not None and measured == lim
    return Row(key, lim, "met" if ok else "exceeded", measured, "",
               reason="" if ok else NOT_ENFORCED.get(key, f"the worker's {setting} is {value}"),
               source=f"worker Settings.{setting} (worker/src/nutrivo_worker/config.py)")


def static_rows(spec: dict | None = None) -> dict[str, Row]:
    spec = spec if spec is not None else nfr()
    rows = [check_visual(spec), check_axe(spec), check_acceptance_ratio(spec), check_quarantine(spec),
            check_vulnerabilities(spec), check_secrets(spec)]
    defaults = worker_settings_defaults()
    rows += [check_reliability(k, spec, defaults) for k in RELIABILITY if k in budget_keys(spec)]
    for r in rows:
        r.enforced = r.budget not in NOT_ENFORCED
    return {r.budget: r for r in rows}


# ── Report ────────────────────────────────────────────────────────────────────────────────────────
def load_rows(out: Path = LOAD_OUT) -> dict[str, Row]:
    rows = {}
    if out.exists():
        for p in sorted(out.glob("*.*.json")):
            d = json.loads(p.read_text())
            rows[d["budget"]] = Row(d["budget"], d["limit"], d["status"], d.get("measured"), d.get("unit", ""),
                                    d.get("n", 0), d.get("enforced", False), d.get("reason") or "",
                                    "load run (apps/web/tests/load)", d.get("detail") or {})
    return rows


def report(profile: str, out: Path = LOAD_OUT, spec: dict | None = None) -> tuple[list[Row], list[str]]:
    """Every budget's row, and the reasons the run fails (an enforced budget not met, a budget with no result)."""
    spec = spec if spec is not None else nfr()
    enforce = set(profiles()[profile]["enforce"])
    measured, static = load_rows(out), static_rows(spec)
    rows, failures = [], []
    for key in budget_keys(spec):
        row = measured.get(key) or static.get(key)
        if row is None:
            row = Row(key, limit(key, spec), "missing", reason="no result: the load run did not reach this budget")
        if key in enforce and key in measured:
            row.enforced = True
        rows.append(row)
        if row.status == "missing" or (row.enforced and row.status not in ("met", "staging_only")):
            failures.append(f"{key}: {row.status}{' (' + row.reason + ')' if row.reason else ''}")
    return rows, failures


def fmt(v) -> str:
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".")
    return str(v)


def markdown(profile: str, rows: list[Row], failures: list[str]) -> str:
    met = sum(r.status == "met" for r in rows)
    lines = [f"# Budgets: spec/nfr.yaml, profile `{profile}`", "",
             f"{met} of {len(rows)} met · {len(failures)} failing the run", "",
             "| Budget | Limit | Measured | n | Status | Enforced | Note |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        note = "; ".join(x for x in (r.reason, r.source) if x).replace("|", "\\|")
        lines.append(f"| `{r.budget}` | {fmt(r.limit)} {r.unit} | {fmt(r.measured)} | {r.n or ''} | {r.status} | "
                     f"{'yes' if r.enforced else 'no'} | {note} |")
    if failures:
        lines += ["", "**Failing:**", *[f"- {f}" for f in failures]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("coverage")
    sub.add_parser("static")
    r = sub.add_parser("report")
    r.add_argument("--profile", required=True)
    r.add_argument("--out")
    r.add_argument("--summary")
    a = ap.parse_args(argv)
    if a.cmd == "coverage":
        found = named_budgets()
        for k in budget_keys():
            print(f"  {k}: {', '.join(sorted(set(found[k]))) or 'NO TEST'}")
        missing = [k for k in budget_keys() if not found[k]]
        return 1 if missing else 0
    if a.cmd == "static":
        rows = static_rows()
        for row in rows.values():
            print(f"  {row.budget}: {row.status} {fmt(row.measured)} (limit {fmt(row.limit)}) {row.reason}")
        return 1 if any(r.enforced and r.status not in ("met", "staging_only") for r in rows.values()) else 0
    rows, failures = report(a.profile)
    text = markdown(a.profile, rows, failures)
    print(text)
    for target in filter(None, (a.out, a.summary)):
        with open(target, "a" if target == a.summary else "w") as f:
            f.write(text)
    (LOAD_OUT / "summary.json").parent.mkdir(parents=True, exist_ok=True)
    (LOAD_OUT / "summary.json").write_text(json.dumps([asdict(r) for r in rows], indent=2) + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
