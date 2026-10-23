"""What an extraction returns, per rule shape (docs/05): the article reference, a verbatim excerpt and the shape's
params, or `found: false` with a reason. Closed schemas for structured outputs; pydantic validates the answer.

`VERBATIM` names the fields that must be printed in the excerpt exactly (up to whitespace), and the excerpt in the
stored text: a value the text does not carry was not extracted from it, so it is withheld (non-negotiable 7: never
from memory, never translated). `NUMBERS` ties each number to the printed field it must be read from."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MandatoryParticular(_Closed):
    particular: str = Field(description="The particular that must be indicated, copied exactly from the text")
    conditions: list[str] = Field(description="Qualifiers copied exactly from the text (e.g. when it applies)")


class PrescribedWording(_Closed):
    wordings: list[str] = Field(description="Each prescribed designation exactly as printed, without quotes")
    alternatives: list[str] = Field(description="Designations the text permits instead, exactly as printed")


class Threshold(_Closed):
    quantity: str = Field(description="What is measured, copied exactly from the text")
    operator: Literal["gt", "ge", "lt", "le", "eq"]
    value: float
    value_text: str = Field(description="The value with its unit exactly as printed, e.g. '14 %'")
    unit: str = Field(description="The unit exactly as printed, e.g. '%'")
    then: str = Field(description="What becomes required when the condition holds, copied exactly from the text")


class HeightBand(_Closed):
    text: str = Field(description="The band's line exactly as printed")
    quantity_from: float | None
    quantity_to: float | None
    quantity_unit: str = Field(description="The unit of the band's quantities exactly as printed")
    min_height_mm: float


class CharacterHeight(_Closed):
    target: str = Field(description="What the height applies to, copied exactly from the text")
    bands: list[HeightBand]


class _Envelope(_Closed):
    found: bool = Field(description="False when the units given do not contain what is asked; then explain why")
    article_ref: str = Field(description="Exact to the paragraph and point: 'Art. 15(e)' or 'Annex I point 6'")
    excerpt: str = Field(description="The shortest passage that carries every value, copied exactly")
    abstain_reason: str | None = Field(description="Why nothing was extracted; null when found")


class MandatoryParticularExtraction(_Envelope):
    params: MandatoryParticular | None


class PrescribedWordingExtraction(_Envelope):
    params: PrescribedWording | None


class ThresholdExtraction(_Envelope):
    params: Threshold | None


class CharacterHeightExtraction(_Envelope):
    params: CharacterHeight | None


OUTPUT_SCHEMAS: dict[str, type[_Envelope]] = {
    "mandatory_particular": MandatoryParticularExtraction,
    "prescribed_wording": PrescribedWordingExtraction,
    "threshold": ThresholdExtraction,
    "character_height": CharacterHeightExtraction,
}

VERBATIM: dict[str, tuple[str, ...]] = {
    "mandatory_particular": ("particular", "conditions"),
    "prescribed_wording": ("wordings", "alternatives"),
    "threshold": ("quantity", "value_text", "unit", "then"),
    "character_height": ("target", "bands.text", "bands.quantity_unit"),
}

# (list in params, or "" for params itself; number field; the printed field the number must be read from).
NUMBERS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "threshold": (("", "value", "value_text"),),
    "character_height": (("bands", "min_height_mm", "text"), ("bands", "quantity_from", "text"),
                         ("bands", "quantity_to", "text")),
}
