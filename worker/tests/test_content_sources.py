"""T-203 · the deterministic parts: stored bodies split into units, targets resolved to acts, stored bodies read back."""
import gzip
from pathlib import Path

import pytest

from nutrivo_worker.config import WORKER_ROOT
from nutrivo_worker.content import articles, targets
from nutrivo_worker.sources.fetch import load_sources
from nutrivo_worker.sources.http import Response, TransportError
from nutrivo_worker.sources.store import StorageClient, StorageError

REC = Path(__file__).parent / "recordings" / "eurlex"
# The recorded T-201 consolidated texts of Reg. 767/2009 (02009R0767-20181226), one per launch language.
BODIES = {"en": "c1df7a69bdf2de16", "da": "7585be7f2e9f3ae1", "sv": "b16e707a4302a3bc", "fi": "c15754457991a9ba",
          "de": "60bea58479836339"}


@pytest.mark.parametrize("lang", sorted(BODIES))
def test_every_language_version_splits_into_the_same_articles_and_annexes(lang):
    units = articles.split_units(gzip.decompress((REC / f"{BODIES[lang]}.body.gz").read_bytes()))
    assert [u for u in units if u.startswith("Art.")] == [f"Art. {n}" for n in range(1, 34)]
    assert [u for u in units if u.startswith("Annex")] == [f"Annex {r}" for r in
                                                          ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX")]
    art15 = units["Art. 15"]
    assert "15" in art15.heading and art15.text.startswith(art15.heading)
    assert "Art. 16" in units and units["Art. 16"].text not in art15.text     # a unit stops at the next heading


def test_contains_is_verbatim_up_to_whitespace():
    assert articles.contains("a b\n  c", "a b c")
    assert not articles.contains("a b c", "A b c") and not articles.contains("a b c", "  ")


def test_targets_resolve_to_their_first_act_and_its_units():
    acts, _, _ = load_sources(WORKER_ROOT.parent / "content" / "sources.yaml")
    listed = {a.celex for a in acts}
    by_key = {t.key: t for t in targets.load_targets(
        WORKER_ROOT.parent / "content" / "candidates" / "eu-core.yaml", listed)}
    assert (by_key["EU.767.BATCH"].act, by_key["EU.767.BATCH"].units) == ("32009R0767", ("Art. 15",))
    # An aside naming another act's article does not add it; a bare "and 17(1)(c)" stays with the first act.
    assert by_key["EU.767.ESTABLISHMENT_NUMBER"].units == ("Art. 15", "Art. 17")
    assert by_key["EU.767.MOISTURE"].units == ("Art. 15", "Annex I")
    assert by_key["EU.767.ADDITIVES_DECLARATION"].units == ("Art. 15", "Annex VII")
    assert by_key["EU.76-211.FIGURE_HEIGHT"].act == "31976L0211"
    assert by_key["EU.76-211.FIGURE_HEIGHT"].units == ("Annex I",)
    assert by_key["EU.767.CLAIMS_GENERAL"].skip_reason == "needs_claims_harness"
    assert by_key["EU.1831.ADDITIVE_AUTHORISED"].skip_reason == "needs_additive_register"
    assert all(t.skip_reason is None for t in by_key.values() if t.shape in targets.EXTRACTED_SHAPES)


@pytest.mark.parametrize("kind,a,b,celex", [
    ("Reg", "767", "2009", "32009R0767"), ("Reg", "1831", "2003", "32003R1831"), ("Reg", "68", "2013", "32013R0068"),
    ("Reg", "2017", "2279", "32017R2279"), ("Reg", "2020", "354", "32020R0354"), ("Dir", "76", "211", "31976L0211"),
    ("Dir", "2002", "32", "32002L0032")])
def test_act_numbers_become_celex_ids(kind, a, b, celex):
    assert targets.act_celex(kind, a, b) == celex


class Flaky:
    def __init__(self, *outcomes):
        self.outcomes, self.sent = list(outcomes), []

    def send(self, method, url, headers, body=None):
        self.sent.append((method, url))
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return Response(out, {}, b"<body/>" if out == 200 else b"{}", url)


def test_stored_bodies_are_read_back_with_bounded_retries():
    t = Flaky(TransportError("timeout"), 503, 200)
    client = StorageClient("https://x.supabase.co", "k", t)
    assert client.get("sources", "eurlex/a b/en/1.xhtml", sleep=lambda s: None) == b"<body/>"
    assert t.sent[0] == ("GET", "https://x.supabase.co/storage/v1/object/authenticated/sources/eurlex/a%20b/en/1.xhtml")
    with pytest.raises(StorageError, match="HTTP 503"):
        StorageClient("https://x", "k", Flaky(503, 503, 503)).get("sources", "p", sleep=lambda s: None)
    gone = Flaky(404, 200)
    with pytest.raises(StorageError, match="HTTP 404"):
        StorageClient("https://x", "k", gone).get("sources", "p", sleep=lambda s: None)
    assert len(gone.sent) == 1                       # a 4xx is not retried


def _body(*headings: str) -> bytes:
    blocks = "".join(f'<p class="title-annex-1">{h}</p><p>text of {h}</p>' for h in headings)
    return f'<html><body><p class="title-article-norm">Artikel 1</p><p>a</p>{blocks}</body></html>'.encode()


def test_an_annex_numbered_in_arabic_figures_gets_the_same_label_as_in_roman_ones():
    # The Swedish consolidated Dir. 76/211 (01976L0211-20190726) prints BILAGA 1 and BILAGA 2 where the other
    # language versions print ANNEX I and BILAG I: a target naming Annex I must find it in every language.
    sv = articles.split_units(_body("BILAGA 1", "BILAGA 2"))
    da = articles.split_units(_body("BILAG I", "BILAG II"))
    assert [u for u in sv if u.startswith("Annex")] == [u for u in da if u.startswith("Annex")] == ["Annex I",
                                                                                                    "Annex II"]
    assert sv["Annex I"].heading == "BILAGA 1" and "text of BILAGA 1" in sv["Annex I"].text
    assert "text of BILAGA 2" not in sv["Annex I"].text
    assert list(articles.split_units(_body("ANNEX 9", "ANNEX 14", "ANNEX 40", "ANNEX 90"))) == [
        "Art. 1", "Annex IX", "Annex XIV", "Annex XL", "Annex XC"]


def test_a_heading_that_is_not_one_word_and_a_numeral_gives_no_unit_rather_than_a_guessed_one():
    # A trailing number elsewhere in a heading is not the annex number: the real ANNEX V must keep its label.
    units = articles.split_units(_body("ANNEX referred to in Article 5", "ANNEX V"))
    assert [u for u in units if u.startswith("Annex")] == ["Annex V"] and units["Annex V"].heading == "ANNEX V"
    assert [u for u in articles.split_units(_body("ANNEX referred to in 2017/1"))] == ["Art. 1"]
    # One word without a number is "Annex" only when it is the act's only annex heading.
    assert [u for u in articles.split_units(_body("ANNEX I", "APPENDIX"))] == ["Art. 1", "Annex I"]


def test_an_acts_only_annex_printed_without_a_number_is_labelled_annex():
    # Reg. 68/2013 and Reg. 2020/354 print a single unnumbered ANNEX / BILAGA / LIITE.
    for heading in ("ANNEX", "BILAGA", "LIITE", "ANHANG"):
        units = articles.split_units(_body(heading))
        assert list(units) == ["Art. 1", "Annex"] and units["Annex"].heading == heading
    assert "Annex" not in articles.split_units(_body("ANNEX 0"))
