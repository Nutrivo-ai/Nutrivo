"""Annex units across the numbering every language version prints (no network: small XHTML snippets)."""
from __future__ import annotations

from nutrivo_worker.content import articles


def _act(*annex_headings: str, article: str = "Artikel 1") -> bytes:
    body = f'<p class="title-article-norm">{article}</p><p>Text of the article.</p>'
    for i, heading in enumerate(annex_headings):
        body += f'<p class="title-annex-1">{heading}</p><p>Body of annex {i}.</p>'
    return f"<html><head><title>t</title></head><body>{body}</body></html>".encode()


def test_arabic_annex_numbers_get_the_same_label_as_roman_ones():
    units = articles.split_units(_act("BILAGA 1", "BILAGA 2", "BILAGA 14"))
    assert sorted(units) == ["Annex I", "Annex II", "Annex XIV", "Art. 1"]
    assert units["Annex I"].heading == "BILAGA 1"
    assert units["Annex I"].text == "BILAGA 1\nBody of annex 0."


def test_roman_and_arabic_versions_of_one_act_name_the_same_units():
    sv = articles.split_units(_act("BILAGA 1", "BILAGA 2"))
    da = articles.split_units(_act("BILAG I", "BILAG II"))
    assert set(sv) == set(da) == {"Art. 1", "Annex I", "Annex II"}


def test_a_sole_unnumbered_annex_is_labelled_annex():
    for heading in ("ANNEX", "BILAGA", "LIITE", "ANHANG", "BILAG"):
        units = articles.split_units(_act(heading))
        assert sorted(units) == ["Annex", "Art. 1"], heading
        assert units["Annex"].text == f"{heading}\nBody of annex 0."


def test_an_unnumbered_heading_among_several_annexes_gets_no_unit():
    units = articles.split_units(_act("ANNEX I", "ANNEX"))
    assert sorted(units) == ["Annex I", "Art. 1"]


def test_a_label_printed_twice_keeps_the_first_whatever_the_numbering():
    units = articles.split_units(_act("BILAGA 1", "BILAGA I"))
    assert units["Annex I"].text == "BILAGA 1\nBody of annex 0."
