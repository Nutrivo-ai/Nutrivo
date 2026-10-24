"""Panel clustering: recursive XY-cut over everything printed on a page (docs/06, "Panels and languages").

Pure geometry on millimetre boxes, top-left origin. Rows are cut before columns, so panels come out row-major.
A gutter is a band at least MIN_GUTTER_MM wide with content wholly on both sides. Between columns, at most
MAX_CROSSING text lines may cross it, because real artwork runs the odd line past its panel (#39); between rows the
band must be clear. An item that crosses a gutter belongs to the side where it starts (left-to-right reading)."""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Any

MIN_GUTTER_MM = 4.0
MAX_CROSSING = 2
BACKGROUND_SHARE = 0.9                  # an object this wide and tall on the page is background, not layout


@dataclass
class Item:
    kind: str                           # 'text' | 'path' | 'image'
    bbox: list[float]
    ref: Any = None                     # the text line, for kind 'text'


@dataclass
class Region:
    bounds: list[float]
    items: list[Item] = field(default_factory=list)
    bbox: list[float] = field(default_factory=list)   # the printed extent (printed_bbox)

    def printed_bbox(self) -> list[float]:
        """The extent of what sits wholly inside the panel; a line running on across a gutter does not widen it."""
        b = self.bounds
        inside = [i.bbox for i in self.items if b[0] <= i.bbox[0] and i.bbox[2] <= b[2]
                  and b[1] <= i.bbox[1] and i.bbox[3] <= b[3]]
        boxes = inside or [[max(i.bbox[0], b[0]), max(i.bbox[1], b[1]), min(i.bbox[2], b[2]), min(i.bbox[3], b[3])]
                           for i in self.items]
        return [min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes)]


def is_background(item: Item, page_w: float, page_h: float) -> bool:
    w, h = item.bbox[2] - item.bbox[0], item.bbox[3] - item.bbox[1]
    return item.kind != "text" and w >= BACKGROUND_SHARE * page_w and h >= BACKGROUND_SHARE * page_h


def _gutters(items: list[Item], axis: int) -> list[float]:
    """Cut positions along axis (0: x, columns; 1: y, rows)."""
    lo, hi = min(i.bbox[axis] for i in items), max(i.bbox[axis + 2] for i in items)
    deltas: dict[float, list[int]] = {}         # position -> [change in text cover, change in other cover]
    for i in items:
        k = 0 if i.kind == "text" else 1
        deltas.setdefault(i.bbox[axis], [0, 0])[k] += 1
        deltas.setdefault(i.bbox[axis + 2], [0, 0])[k] -= 1
    allowed = MAX_CROSSING if axis == 0 else 0
    runs: list[list[float]] = []
    text = other = 0
    positions = sorted(deltas)
    for a, b in itertools.pairwise(positions):
        text, other = text + deltas[a][0], other + deltas[a][1]
        if other == 0 and text <= allowed:
            if runs and runs[-1][1] == a:
                runs[-1][1] = b
            else:
                runs.append([a, b])
    cuts = []
    for a, b in runs:
        if b - a < MIN_GUTTER_MM or a <= lo or b >= hi:
            continue
        cut = (a + b) / 2
        before = any(i.bbox[axis + 2] <= a for i in items)
        after = any(i.bbox[axis] >= b for i in items)
        if before and after:
            cuts.append(cut)
    return cuts


def _split(region: Region, axis: int) -> list[Region]:
    cuts = _gutters(region.items, axis)
    if not cuts:
        return [region]
    edges = [-math.inf, *cuts, math.inf]   # open outer edges: bleed past the page still belongs to a panel
    parts = []
    for a, b in itertools.pairwise(edges):
        bounds = list(region.bounds)
        bounds[axis], bounds[axis + 2] = a, b
        parts.append(Region(bounds, [i for i in region.items if a <= i.bbox[axis] < b]))
    parts = [p for p in parts if p.items]
    # Each part must hold something that does not cross a cut; a part made only of overflow is no panel.
    if len(parts) < 2 or any(all(i.bbox[axis + 2] > p.bounds[axis + 2] for i in p.items) for p in parts):
        return [region]
    return parts


def cluster(items: list[Item], page_w: float, page_h: float, trim: list[float] | None = None) -> list[Region]:
    """Panels on one page in reading order. What lies wholly outside the trim box (crop marks, slug) is cut off in
    print and left out. Backgrounds are left out of the cut and added back to every panel they overlap; a page with
    nothing but background is one panel. Panel boxes are clamped to the page."""
    if trim is not None:
        items = [i for i in items if _overlaps(i.bbox, trim)]
    layout = [i for i in items if not is_background(i, page_w, page_h)]
    backgrounds = [i for i in items if is_background(i, page_w, page_h)]
    if not layout:
        layout, backgrounds = backgrounds, []
    if not layout:
        return []

    def rec(region: Region, depth: int = 0) -> list[Region]:
        if depth > 32:
            return [region]
        for axis in (1, 0):
            parts = _split(region, axis)
            if len(parts) > 1:
                return [leaf for p in parts for leaf in rec(p, depth + 1)]
        return [region]

    leaves = rec(Region([-math.inf, -math.inf, math.inf, math.inf], layout))
    for leaf in leaves:
        b = leaf.printed_bbox()
        leaf.bbox = [min(max(b[0], 0.0), page_w), min(max(b[1], 0.0), page_h),
                     min(max(b[2], 0.0), page_w), min(max(b[3], 0.0), page_h)]
        leaf.items += [g for g in backgrounds if _overlaps(g.bbox, b)]
    return leaves


def _overlaps(a: list[float], b: list[float]) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def dominant_signal(chars: int, paths: int, images: int) -> str:
    """'extracted' | 'outlined_text' | 'rasterised' (the T-301 rule): the dominant signal, not "any text"."""
    if chars and chars >= max(paths, images):
        return "extracted"
    return "rasterised" if images >= paths else "outlined_text"
