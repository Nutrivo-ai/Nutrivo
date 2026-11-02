"""T-402 (D03): the classification suggestion. The model is a scripted fake or a recorded cassette; CI never calls a
model (docs/07)."""
import json
from pathlib import Path

import pytest
from fakes import FakeProvider, FakeStore

from nutrivo_worker import models
from nutrivo_worker.classification import (
    FIELDS,
    MIN_CONFIDENCE,
    ClassificationSuggestion,
    PanelText,
    guard,
    model_inputs,
    suggest,
)
from nutrivo_worker.config import Settings
from nutrivo_worker.models import Models, input_hash, load_prompt, output_json_schema

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "fixtures" / "synth" / "out"

PANELS = [PanelText(0, "en", "Complete feed for adult cats\nComposition:\nChicken (26%), rice"),
          PanelText(1, "de", "Alleinfuttermittel für ausgewachsene\nKatzen\nZusammensetzung:")]


def field(value=None, *, abstain=False, confidence=0.95, quote=None, panel_index=None):
    return {"value": value, "abstain": abstain, "confidence": confidence, "quote": quote, "panel_index": panel_index}


def answer(**over):
    base = {"species": field("cat", quote="for adult cats", panel_index=0),
            "life_stage": field("adult", quote="ausgewachsene Katzen", panel_index=1),
            "product_class": field("complete", quote="Complete feed", panel_index=0),
            "intended_use": field(abstain=True, confidence=0),
            "parnut_status": field(abstain=True, confidence=0)}
    base.update(over)
    return ClassificationSuggestion.model_validate(base)


def test_D03_main_a_sure_evidenced_answer_is_kept_with_its_label_citation():
    s = guard(answer(), PANELS)
    assert s.values == {"species": "cat", "life_stage": "adult", "product_class": "complete",
                        "intended_use": None, "parnut_status": None}
    # the quote spans a line break on the label: matched with whitespace collapsed, in the printed language
    assert s.cites["life_stage"] == {"quote": "ausgewachsene Katzen", "panel_index": 1, "language": "de",
                                     "confidence": 0.95}
    assert s.reasons == {"intended_use": "abstained", "parnut_status": "abstained"}


@pytest.mark.parametrize("over, reason", [
    ({"species": field("cat", abstain=True, quote="for adult cats", panel_index=0)}, "abstained"),
    ({"species": field("cat", confidence=MIN_CONFIDENCE - 0.01, quote="for adult cats", panel_index=0)},
     "low_confidence"),
    ({"species": field("cat", confidence=1.5, quote="for adult cats", panel_index=0)}, "low_confidence"),
    ({"species": field("cat", quote=None, panel_index=0)}, "no_evidence"),
    ({"species": field("cat", quote="for adult cats", panel_index=7)}, "no_evidence"),
    ({"species": field("cat", quote="for adult kittens", panel_index=0)}, "quote_not_on_label"),
    ({"species": field("cat", quote="ausgewachsene Katzen", panel_index=0)}, "quote_not_on_label"),
    ({"species": field("cat", quote="   ", panel_index=0)}, "quote_not_on_label"),
])
def test_D03_fail_1_an_unsure_field_is_left_empty_never_guessed(over, reason):
    s = guard(answer(**over), PANELS)
    assert s.values["species"] is None and "species" not in s.cites
    assert s.reasons["species"] == reason
    assert s.values["product_class"] == "complete"           # the other fields are judged on their own


def test_D03_fail_1_values_outside_the_vocabulary_are_refused_by_the_schema():
    with pytest.raises(ValueError):
        answer(species=field("hamster", quote="for adult cats", panel_index=0))
    with pytest.raises(ValueError):
        answer(intended_use=field("daily ration", quote="Complete feed", panel_index=0))


def make(tmp_path, provider):
    s = Settings(models_mode="live", cassette_dir=tmp_path)
    return Models(s, [provider])


@pytest.mark.parametrize("provider", [FakeProvider(fail=99), FakeProvider(text="{not json"),
                                      FakeProvider(stop_reason="refusal"), FakeProvider(stop_reason="max_tokens")])
def test_D03_fail_1_a_model_error_leaves_every_field_empty_and_is_withheld(provider, tmp_path, monkeypatch):
    m = make(tmp_path, provider)
    monkeypatch.setattr(models, "_default", m)
    s, withheld = suggest(PANELS)
    assert withheld in ("model_unavailable", "model_output_invalid", "model_refused")
    assert all(v is None for v in s.values.values()) and s.cites == {}
    assert set(s.reasons) == set(FIELDS)


def test_D03_main_the_call_goes_through_models_and_writes_one_model_calls_row(tmp_path, monkeypatch):
    provider = FakeProvider(text=answer().model_dump_json())
    store = FakeStore()
    monkeypatch.setattr(models, "_default", make(tmp_path, provider))
    s, withheld = suggest(PANELS, workspace_id="ws", store=store)
    assert withheld is None and s.values["species"] == "cat"
    assert len(store.model_calls) == 1
    row = store.model_calls[0]
    assert row["purpose"] == "classification" and row["prompt_version"] == "classification.v1"
    # the printed panel text is sent as data
    sent = provider.calls[0]
    assert "Complete feed for adult cats" in sent["user"]


def test_no_label_text_calls_no_model(monkeypatch, tmp_path):
    provider = FakeProvider()
    monkeypatch.setattr(models, "_default", make(tmp_path, provider))
    s, withheld = suggest([])
    assert withheld == "no_label_text" and provider.calls == [] and s.filled == 0


def test_the_output_schema_is_closed():
    schema = output_json_schema(ClassificationSuggestion)
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(FIELDS)


@pytest.mark.skipif(not (SYNTH / "clean_3lang.pdf").exists(), reason="no local fixtures: run make fixtures")
def test_D03_main_the_committed_cassette_replays_a_real_answer_on_a_synthetic_label():
    from nutrivo_worker.handlers.extract import extract_bytes
    r = extract_bytes((SYNTH / "clean_3lang.pdf").read_bytes())
    panels = [PanelText(p.index, p.language, "\n".join(t.text for t in p.text_objects))
              for p in r.panels if p.status == "extracted" and p.text_objects]
    m = Models(Settings(models_mode="replay"), providers=[])
    out = m.call("classification", "v1", model_inputs(panels), ClassificationSuggestion)
    s = guard(out, panels)
    assert s.values["species"] == "cat" and s.values["product_class"] == "complete"
    assert s.values["intended_use"] is None and s.values["parnut_status"] is None
    for cite in s.cites.values():                      # every kept value is quoted from its own panel
        assert cite["quote"] in " ".join(panels[[p.index for p in panels].index(cite["panel_index"])].text.split())
    # the cassette's key is independent of the model id, so dev recordings replay in CI
    key = input_hash("classification", load_prompt("classification", "v1", m.settings.prompts_dir), "judgement",
                     model_inputs(panels), output_json_schema(ClassificationSuggestion))
    assert json.loads((m.settings.cassette_dir / "classification" / f"{key}.json").read_text())["provider"]
