"""Every scheduled job has exactly one Sentry cron monitor (T-1102, docs/17). Reads the repository only.

Scheduled jobs come from three places, and each must have an entry in config/monitors.yaml:
  - pg_cron: every cron.schedule('<name>', '<crontab>', ...) left standing by supabase/migrations (in order, net of
    cron.unschedule), whose handler checks in with the worker's monitor_config of the same schedule;
  - the worker: every *_MONITOR constant in worker/src/nutrivo_worker/observability.py;
  - GitHub: every workflow with `on: schedule`, which checks in with `sentry-cli monitors run ... <slug>`.
Run `python scripts/monitors/monitors.py` (needs pyyaml) to list problems; exit 1 when there are any."""
import os, re, sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGISTRY = "config/monitors.yaml"
OBSERVABILITY = "worker/src/nutrivo_worker/observability.py"
MIGRATIONS = "supabase/migrations"
WORKFLOWS = ".github/workflows"
DOCS = "docs/17-observability.md"
SOURCES = {"pg_cron", "worker", "github"}
PROJECTS = {"worker", "web"}

_SQL_COMMENT = re.compile(r"--[^\n]*")
_CRON_CALL = re.compile(r"cron\.(schedule|unschedule)\s*\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?")
_MONITOR_CONST = re.compile(r'^([A-Z_]+)_MONITOR\s*=\s*"([^"]+)"', re.M)
_CONFIG_CONST = re.compile(r'^([A-Z_]+_CONFIG)\s*=\s*\{\s*"schedule":\s*\{\s*"type":\s*"crontab",\s*"value":\s*"([^"]+)"', re.M)
_MONITORS_RUN = re.compile(r"monitors run\b(.*?)\s--\s", re.S)


def _read(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as fh:
        return fh.read()


def pg_cron_jobs(root):
    """{job name: crontab} as the migrations leave pg_cron, applied in file order."""
    jobs = {}
    folder = os.path.join(root, MIGRATIONS)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".sql"):
            continue
        sql = _SQL_COMMENT.sub("", _read(root, os.path.join(MIGRATIONS, name)))
        for kind, job, schedule in _CRON_CALL.findall(sql):
            if kind == "schedule":
                jobs[job] = schedule
            else:
                jobs.pop(job, None)
    return jobs


def worker_monitors(root):
    """({constant: slug}, {config constant: crontab}) from the worker's observability module."""
    text = _read(root, OBSERVABILITY)
    monitors = {f"{prefix}_MONITOR": slug for prefix, slug in _MONITOR_CONST.findall(text)}
    configs = dict(_CONFIG_CONST.findall(text))
    return monitors, configs


def scheduled_workflows(root):
    """{workflow file: [crontab, ...]} for every workflow with an `on: schedule` trigger."""
    out = {}
    folder = os.path.join(root, WORKFLOWS)
    for name in sorted(os.listdir(folder)):
        if not name.endswith((".yml", ".yaml")):
            continue
        data = yaml.safe_load(_read(root, os.path.join(WORKFLOWS, name))) or {}
        on = data.get("on", data.get(True)) or {}     # YAML 1.1 reads a bare `on` key as True
        if isinstance(on, dict) and on.get("schedule"):
            out[name] = [s.get("cron") for s in on["schedule"]]
    return out


def checkins(text):
    """[(slug, schedule or None)] for every `sentry-cli monitors run` in a workflow."""
    found = []
    for block in _MONITORS_RUN.findall(text):
        schedule = re.search(r'(?:-s|--schedule)\s+"([^"]+)"', block)
        found.append((block.split()[-1], schedule.group(1) if schedule else None))
    return found


def problems(root=ROOT):
    errors = []
    registry = (yaml.safe_load(_read(root, REGISTRY)) or {}).get("monitors") or []
    docs = _read(root, DOCS)
    jobs = pg_cron_jobs(root)
    constants, configs = worker_monitors(root)
    workflows = scheduled_workflows(root)

    slugs, keys = set(), set()
    for entry in registry:
        slug, source, job = entry.get("slug"), entry.get("source"), entry.get("job")
        where = f"{REGISTRY} {slug or '?'}"
        if not slug or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
            errors.append(f"{where}: a slug of lowercase letters, digits and dashes is required")
        if slug in slugs:
            errors.append(f"{where}: the slug is used twice (one monitor per job)")
        slugs.add(slug)
        if (source, job) in keys:
            errors.append(f"{where}: {source} job {job} has two monitors")
        keys.add((source, job))
        if source not in SOURCES:
            errors.append(f"{where}: source must be one of {sorted(SOURCES)}")
        if entry.get("project") not in PROJECTS:
            errors.append(f"{where}: project must be one of {sorted(PROJECTS)}")
        if f"`{slug}`" not in docs:
            errors.append(f"{where}: {DOCS} does not name the monitor `{slug}`")
        schedule = entry.get("schedule")

        if source == "pg_cron":
            if job not in jobs:
                errors.append(f"{where}: no pg_cron job {job} in {MIGRATIONS}")
            elif jobs[job] != schedule:
                errors.append(f"{where}: pg_cron runs {job} at '{jobs[job]}', the registry says '{schedule}'")
            if slug not in constants.values():
                errors.append(f"{where}: the worker never checks in to {slug} (no *_MONITOR in {OBSERVABILITY})")
            config = entry.get("worker_config")
            if config not in configs:
                errors.append(f"{where}: worker_config {config} is not a crontab monitor_config in {OBSERVABILITY}")
            elif configs[config] != schedule:
                errors.append(f"{where}: {config} expects '{configs[config]}', pg_cron runs '{schedule}'")
        elif source == "worker":
            if constants.get(job) != slug:
                errors.append(f"{where}: {OBSERVABILITY} has no {job} = \"{slug}\"")
            config = job.removesuffix("_MONITOR") + "_CONFIG" if job else None
            if schedule is None and config in configs:
                errors.append(f"{where}: {config} declares '{configs[config]}' but the registry has no schedule")
            if schedule is not None and configs.get(config) != schedule:
                errors.append(f"{where}: {config} must declare '{schedule}'")
        elif source == "github":
            if job not in workflows:
                errors.append(f"{where}: {WORKFLOWS}/{job} has no `on: schedule`")
                continue
            found = [s for name, s in checkins(_read(root, os.path.join(WORKFLOWS, job))) if name == slug]
            if not found:
                errors.append(f"{where}: {job} never runs `sentry-cli monitors run ... {slug}`")
            elif any(s != schedule for s in found):
                errors.append(f"{where}: {job} checks in with schedule {found}, the registry says '{schedule}'")

    for job, schedule in sorted(jobs.items()):
        if ("pg_cron", job) not in keys:
            errors.append(f"pg_cron job {job} ('{schedule}') has no Sentry monitor in {REGISTRY}")
    for const, slug in sorted(constants.items()):
        if slug not in slugs:
            errors.append(f"worker monitor {const} = \"{slug}\" is not in {REGISTRY}")
    for name in sorted(workflows):
        if ("github", name) not in keys:
            errors.append(f"scheduled workflow {name} has no Sentry monitor in {REGISTRY}")
    return errors


if __name__ == "__main__":
    found = problems()
    for line in found:
        print(line)
    sys.exit(1 if found else 0)
