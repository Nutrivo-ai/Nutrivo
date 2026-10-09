"""Milestone gating: a test marked @pytest.mark.milestone(n) runs once the repo's .milestone file is >= n.
Bump .milestone only when a milestone starts (docs/11-milestones.md). Never lower it to make CI pass."""
from pathlib import Path

import pytest

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
