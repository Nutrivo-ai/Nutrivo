"""Cap height and x-height from the embedded font programme (BE-17), in em.

OS/2 sCapHeight and sxHeight when the programme carries them (read with fontTools from FPDFFont_GetFontData);
otherwise the top of a flat reference glyph's outline, which pdfium maps from Unicode. A font that is not embedded
gives nothing: a substituted system font would be a guess (docs/06, missing_font)."""
from __future__ import annotations

import ctypes
import io
from dataclasses import dataclass

import pypdfium2.raw as pdfium_c

# Glyphs whose top sits on the cap line or the x line with no overshoot, in order of preference.
CAP_GLYPHS = "HEITLFBDKNPRUZ"
X_GLYPHS = "xzvwy"
FLAT_CAPS = frozenset("BDEFHIKLMNPRTUVWXYZ")
FLAT_X = frozenset("vwxyz")


@dataclass(frozen=True)
class FontMetrics:
    name: str | None
    embedded: bool
    cap_em: float | None
    x_em: float | None
    source: str | None                  # 'os2' | 'outline' | None


def _name(font) -> str | None:
    n = pdfium_c.FPDFFont_GetBaseFontName(font, None, 0)
    if n <= 0:
        return None
    buf = ctypes.create_string_buffer(n)
    pdfium_c.FPDFFont_GetBaseFontName(font, buf, n)
    return buf.value.decode("latin-1") or None


def _os2(font) -> tuple[float, float] | None:
    from fontTools.ttLib import TTFont

    size = ctypes.c_size_t()
    if not pdfium_c.FPDFFont_GetFontData(font, None, 0, ctypes.byref(size)) or not size.value:
        return None
    buf = (ctypes.c_uint8 * size.value)()
    if not pdfium_c.FPDFFont_GetFontData(font, buf, size.value, ctypes.byref(size)):
        return None
    try:
        tt = TTFont(io.BytesIO(bytes(buf)), lazy=True)
        upm = tt["head"].unitsPerEm
        os2 = tt.get("OS/2")
    except Exception:                   # noqa: BLE001  a bare CFF or Type 1 programme: no OS/2 table to read
        return None
    if os2 is None or os2.version < 2 or not getattr(os2, "sCapHeight", 0) or not getattr(os2, "sxHeight", 0):
        return None
    return os2.sCapHeight / upm, os2.sxHeight / upm


def glyph_top_em(font, char: str) -> float | None:
    """Top of the glyph outline in em (the path is in em whatever size is passed); None when the font lacks it."""
    path = pdfium_c.FPDFFont_GetGlyphPath(font, ord(char), ctypes.c_float(1.0))
    if not path:
        return None
    x, y, top = ctypes.c_float(), ctypes.c_float(), None
    for i in range(pdfium_c.FPDFGlyphPath_CountGlyphSegments(path)):
        seg = pdfium_c.FPDFGlyphPath_GetGlyphPathSegment(path, i)
        if seg and pdfium_c.FPDFPathSegment_GetPoint(seg, ctypes.byref(x), ctypes.byref(y)):
            top = y.value if top is None else max(top, y.value)
    return top if top and top > 0 else None


def _first_top(font, glyphs: str) -> float | None:
    for ch in glyphs:
        top = glyph_top_em(font, ch)
        if top is not None:
            return top
    return None


def font_metrics(font) -> FontMetrics:
    name = _name(font)
    if not pdfium_c.FPDFFont_GetIsEmbedded(font):
        return FontMetrics(name, False, None, None, None)
    os2 = _os2(font)
    if os2 is not None:
        return FontMetrics(name, True, os2[0], os2[1], "os2")
    cap, x = _first_top(font, CAP_GLYPHS), _first_top(font, X_GLYPHS)
    return FontMetrics(name, True, cap, x, "outline" if cap is not None and x is not None else None)
