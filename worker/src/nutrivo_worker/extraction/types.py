"""The extraction contract (docs/06-extraction.md). Millimetres from the top-left of the page, `[x0, y0, x1, y1]`.
Maps one-to-one onto app.extraction_runs, app.artwork_panels and app.text_objects."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

PT_TO_MM = 25.4 / 72
TOLERANCE_MM = 0.15
FailureCode = Literal["outlined_text", "rasterised", "missing_font", "colour_space", "no_true_scale", "unreadable"]
FAILURE_CODES: tuple[str, ...] = ("outlined_text", "rasterised", "missing_font", "colour_space", "no_true_scale",
                                  "unreadable")


@dataclass
class TextObject:
    text: str
    bbox_mm: list[float]
    font_name: str | None
    font_size_pt: float                 # effective size: the font size times the text matrix's vertical scale
    x_height_mm: float
    cap_height_mm: float
    is_ocr: bool = False
    confidence: float = 1.0             # 1.0 cross-checked against tight glyph boxes; 0.8 nothing to check; 0.5 disagree
    height_source: str = "outline"      # 'os2' | 'outline' | 'glyph_box'


@dataclass
class Panel:
    index: int
    page: int
    bbox_mm: list[float]
    language: str                       # ISO 639-1, or 'und'
    language_confidence: float | None
    status: Literal["extracted", "not_assessable"]
    failure_code: FailureCode | None
    text_objects: list[TextObject] = field(default_factory=list)


@dataclass
class ExtractionResult:
    file_sha256: str
    idempotency_key: str
    engine: str
    engine_version: str
    page_size_mm: list[tuple[float, float]]
    panels: list[Panel]

    @property
    def failure_codes(self) -> list[str]:
        return sorted({p.failure_code for p in self.panels if p.failure_code})

    @property
    def status(self) -> Literal["succeeded", "partial", "failed"]:
        """app.extraction_runs.status: partial results persist (BE-18)."""
        extracted = sum(p.status == "extracted" for p in self.panels)
        if extracted and extracted == len(self.panels):
            return "succeeded"
        return "partial" if extracted else "failed"
