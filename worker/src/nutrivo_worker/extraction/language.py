"""Language per panel with lingua (docs/06). The candidates are the EU and EEA official languages lingua knows (all
but Maltese), which also keeps the models inside the 1 GB budget; anything too short or too unsure is 'und'."""
from __future__ import annotations

import functools

MIN_LETTERS = 20
MIN_CONFIDENCE = 0.5
CANDIDATES = ("BULGARIAN", "CROATIAN", "CZECH", "DANISH", "DUTCH", "ENGLISH", "ESTONIAN", "FINNISH", "FRENCH",
              "GERMAN", "GREEK", "HUNGARIAN", "IRISH", "ITALIAN", "LATVIAN", "LITHUANIAN", "POLISH", "PORTUGUESE",
              "ROMANIAN", "SLOVAK", "SLOVENE", "SPANISH", "SWEDISH", "BOKMAL", "NYNORSK", "ICELANDIC")


@functools.cache
def _detector():
    from lingua import Language, LanguageDetectorBuilder

    return LanguageDetectorBuilder.from_languages(*(getattr(Language, n) for n in CANDIDATES)).build()


def detect(text: str) -> tuple[str, float | None]:
    """(ISO 639-1 code, confidence) or ('und', None)."""
    if sum(ch.isalpha() for ch in text) < MIN_LETTERS:
        return "und", None
    values = _detector().compute_language_confidence_values(text)
    if not values or values[0].value < MIN_CONFIDENCE:
        return "und", None if not values else round(values[0].value, 3)
    return values[0].language.iso_code_639_1.name.lower(), round(values[0].value, 3)
