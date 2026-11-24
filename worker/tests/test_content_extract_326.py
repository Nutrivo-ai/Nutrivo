"""Incident #326: K01 withheld 17 of 77 language targets as excerpt_not_in_source although every passage is printed.

Each cause found in the local run gets a test: the answer the model gave (still withheld, the verbatim guarantee is
unchanged) next to the answer prompt v2 asks for (verified). The texts are short excerpts of the stored official
texts (Reg. 767/2009 de/fi, Dir. 76/211/EEC en), copied from ref.sources bodies; they are test data, not content."""
from nutrivo_worker.config import WORKER_ROOT
from nutrivo_worker.content import extract
from nutrivo_worker.models import load_prompt

# Reg. 767/2009 Art. 15(a), de, as stored (list markers on their own lines).
DE_15A = ("a)\ndie Futtermittelart: „Einzelfuttermittel“, „Alleinfuttermittel“ oder „Ergänzungsfuttermittel“;\n—\n"
          "bei „Alleinfuttermittel“ kann gegebenenfalls die Bezeichnung „Milchaustausch-Alleinfuttermittel“ "
          "verwendet werden;")
# Reg. 767/2009 Art. 17(1)(d), fi, as stored.
FI_17D = ("d) vähimmäissäilyvyys, joka ilmoitetaan noudattaen seuraavia vaatimuksia:\n"
          "— ”käytettävä ennen ...” ja päiväysmerkintä (päivämäärä) helposti pilaantuvan rehun osalta;\n"
          "— ”parasta ennen ...” ja päiväysmerkintä (kuukausi) muun rehun osalta.")
# Dir. 76/211/EEC Annex I point 3.1, en, as stored (first two bands).
EN_31 = ("3.1.\nThe nominal quantity (nominal weight or nominal volume) expressed in kilograms, grams, litres, "
         "centilitres or millilitres, and marked in figures at least 6 mm high if the nominal quantity exceeds "
         "1 000 g or 100 cl, 4 mm high if it is from 1 000 g or 100 cl inclusive down to but not including 200 g "
         "or 20 cl,")


def _answer(excerpt, params):
    return {"found": True, "article_ref": "Art. 15(a)", "excerpt": excerpt, "abstain_reason": None, "params": params}


def _check(shape, output, text):
    out, _ = extract.as_printed(shape, output, text)
    return extract.unverified_fields(shape, out, text)


def test_incident_326_a_string_cut_at_a_printed_quote_is_withheld_and_the_full_copy_verifies():
    # The model typed " for the printed “, which closed the JSON string: the excerpt stops at „Einzelfuttermittel.
    cut = _answer("die Futtermittelart: „Einzelfuttermittel",
                  {"wordings": ["Einzelfuttermittel", "Alleinfuttermittel"], "alternatives": []})
    assert _check("prescribed_wording", cut, DE_15A) == ["params.wordings"]
    whole = _answer("die Futtermittelart: „Einzelfuttermittel“, „Alleinfuttermittel“ oder „Ergänzungsfuttermittel“;",
                    {"wordings": ["Einzelfuttermittel", "Alleinfuttermittel", "Ergänzungsfuttermittel"],
                     "alternatives": []})
    assert _check("prescribed_wording", whole, DE_15A) == []


def test_incident_326_a_value_that_drops_a_list_marker_inside_it_is_withheld_and_the_unbroken_copy_verifies():
    excerpt = FI_17D[3:]
    dropped = ("ilmoitetaan noudattaen seuraavia vaatimuksia: ”käytettävä ennen ...” ja päiväysmerkintä (päivämäärä) "
               "helposti pilaantuvan rehun osalta;")
    assert _check("mandatory_particular", _answer(excerpt, {"particular": "vähimmäissäilyvyys",
                                                            "conditions": [dropped]}), FI_17D) == ["params.conditions"]
    kept = ("ilmoitetaan noudattaen seuraavia vaatimuksia: — ”käytettävä ennen ...” ja päiväysmerkintä (päivämäärä) "
            "helposti pilaantuvan rehun osalta;")
    item = "”parasta ennen ...” ja päiväysmerkintä (kuukausi) muun rehun osalta."
    assert _check("mandatory_particular", _answer(excerpt, {"particular": "vähimmäissäilyvyys",
                                                            "conditions": [kept, item]}), FI_17D) == []


def test_incident_326_a_value_outside_a_short_excerpt_stays_withheld_even_when_printed_elsewhere():
    # SPECIES_AND_USE fi, MOISTURE fi, PET_FOOD_CONTACT de/sv: the excerpt stopped at the list's lead-in.
    short = _answer("d) vähimmäissäilyvyys, joka ilmoitetaan noudattaen seuraavia vaatimuksia:",
                    {"particular": "vähimmäissäilyvyys",
                     "conditions": ["”parasta ennen ...” ja päiväysmerkintä (kuukausi) muun rehun osalta."]})
    assert _check("mandatory_particular", short, FI_17D) == ["params.conditions"]


def test_incident_326_a_band_unit_composed_from_two_units_is_withheld_and_one_band_per_unit_verifies():
    line = "6 mm high if the nominal quantity exceeds 1 000 g or 100 cl"
    composed = _answer(EN_31[5:], {"target": "The nominal quantity", "bands": [
        {"text": line, "quantity_from": 1000, "quantity_to": None, "quantity_unit": "g or cl", "min_height_mm": 6}]})
    assert _check("character_height", composed, EN_31) == ["params.bands.quantity_unit"]
    per_unit = _answer(EN_31[5:], {"target": "The nominal quantity", "bands": [
        {"text": line, "quantity_from": 1000, "quantity_to": None, "quantity_unit": "g", "min_height_mm": 6},
        {"text": line, "quantity_from": 100, "quantity_to": None, "quantity_unit": "cl", "min_height_mm": 6}]})
    assert _check("character_height", per_unit, EN_31) == []
    reworded = _answer(EN_31[5:], {"target": "Figures of the nominal quantity", "bands": []})
    assert _check("character_height", reworded, EN_31) == ["params.target"]


def test_incident_326_extraction_uses_prompt_v2_which_forbids_straight_quotes_and_stitched_values():
    assert extract.PROMPT_VERSION == "v2"
    for purpose in (extract.PRIMARY, extract.SECONDARY):
        system = " ".join(load_prompt(purpose, extract.PROMPT_VERSION, WORKER_ROOT / "prompts").system.split())
        assert "„ “ ” » « ‘ ’ ‚" in system
        assert "per unit" in system
        assert 'never as ",' in system or 'straight double quote (")' in system
