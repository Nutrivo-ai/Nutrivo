"""Milestone gating: a test marked @pytest.mark.milestone(n) runs once the repo's .milestone file is >= n.
Bump .milestone only when a milestone starts (docs/11-milestones.md). Never lower it to make CI pass.

Required local stack: with NUTRIVO_REQUIRE_DB=1 (CI's `worker` job), a test that skips for want of a local service
(a reason starting "no local ", tests/pgtest.py) fails instead, so the database and Mailpit acceptance tests cannot
pass CI unrun."""
import os
from pathlib import Path

import pytest
from pgtest import SKIP_PREFIX

ROOT = Path(__file__).resolve().parents[2]


def current_milestone() -> int:
    try:
        return int((ROOT / ".milestone").read_text().strip())
    except (FileNotFoundError, ValueError):
        return 0


def pytest_collection_modifyitems(config, items):
    m = current_milestone()
    for item in items:
        marker = item.get_closest_marker("milestone")
        if marker and m < marker.args[0]:
            item.add_marker(pytest.mark.skip(reason=f"activates at milestone {marker.args[0]} (repo is at {m})"))


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item, call):
    report = yield
    if report.skipped and os.environ.get("NUTRIVO_REQUIRE_DB") == "1" and isinstance(report.longrepr, tuple):
        reason = report.longrepr[2].removeprefix("Skipped: ")
        if reason.startswith(SKIP_PREFIX):
            report.outcome = "failed"
            report.longrepr = f"NUTRIVO_REQUIRE_DB=1 but the test skipped: {reason}"
    return report
