"""Tests for the NEMSIS v3.5 → Patient adapter."""

from __future__ import annotations

from pathlib import Path

import pytest

from traumatrial_match import (
    NemsisParseError,
    Patient,
    from_nemsis_xml,
    match_all,
)
from traumatrial_match.loader import load_trials


FIXTURES = Path(__file__).parent / "fixtures" / "nemsis"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


# ---------- happy paths ----------


def test_persona_001_hemorrhage_round_trip() -> None:
    patient, trace = from_nemsis_xml(_load("persona-001-hemorrhage.xml"))
    assert isinstance(patient, Patient)
    assert patient.patient_id == "SYN-P001-HEMORRHAGE"
    assert patient.age_years == 34
    assert patient.sex == "M"
    # Latest eVitalsGroup is the second one — those are the values we should pick.
    assert patient.gcs == 7
    assert patient.sbp_mmhg == 82
    assert patient.hr_bpm == 128
    assert patient.mechanism == "blunt_mvc"
    assert patient.pregnancy_status == "not_applicable"
    assert patient.anticoagulant_use is False
    # Inferred flags
    assert patient.presumed_hemorrhage is True
    assert patient.presumed_tbi is True
    assert patient.presumed_intracranial_hemorrhage is True
    assert patient.spinal_injury_suspected is True

    # Trace shape
    assert trace.extracted_count >= 5
    fields = {e.field for e in trace.extractions}
    assert {
        "age_years", "sex", "gcs", "sbp_mmhg", "hr_bpm", "mechanism",
        "presumed_tbi", "presumed_hemorrhage",
    } <= fields


def test_persona_007_cardiac_arrest_extraction() -> None:
    patient, trace = from_nemsis_xml(_load("persona-007-cardiac-arrest.xml"))
    assert patient.age_years == 62
    assert patient.sex == "F"
    assert patient.mechanism == "cardiac_arrest"
    # Apixaban in eHistory.06 → anticoagulant_use=True via inference
    assert patient.anticoagulant_use is True
    # Cardiac arrest + low SBP/HR shouldn't infer hemorrhage
    assert patient.presumed_hemorrhage is False
    # Female patient with explicit "not pregnant" code → respect it
    assert patient.pregnancy_status == "not_pregnant"

    # The anticoagulant trace row should explain itself
    anticoag = next(e for e in trace.extractions if e.field == "anticoagulant_use")
    assert anticoag.source == "inferred"
    assert anticoag.notes is not None and "apixaban" in anticoag.notes.lower()


# ---------- defaults / missing fields ----------


def test_incomplete_xml_falls_back_safely() -> None:
    patient, trace = from_nemsis_xml(_load("incomplete.xml"))
    # Patient still validates — every Patient field must have a value.
    assert isinstance(patient, Patient)
    assert patient.age_years == 0           # non-int age → defaulted
    assert patient.sex == "U"               # 9906007 = unknown
    assert patient.gcs == 15                # missing eVitals → defaulted to 15
    assert patient.sbp_mmhg == 120
    assert patient.hr_bpm == 80
    assert patient.mechanism == "other"     # no cause-of-injury

    # Trace should have at least one defaulted note for each missing field.
    defaulted_fields = {e.field for e in trace.extractions if e.source == "defaulted"}
    assert {"age_years", "gcs", "sbp_mmhg", "hr_bpm", "mechanism",
            "eta_minutes"} <= defaulted_fields
    # trauma_activation_level is now inferred (CDC field triage), not defaulted.
    activation = next(e for e in trace.extractions if e.field == "trauma_activation_level")
    assert activation.source == "inferred"


def test_invalid_xml_raises() -> None:
    with pytest.raises(NemsisParseError):
        from_nemsis_xml("<this is not xml")


def test_no_pcr_element_raises() -> None:
    with pytest.raises(NemsisParseError):
        from_nemsis_xml('<EMSDataSet xmlns="http://www.nemsis.org"/>')


# ---------- end-to-end with real trials ----------


def test_extracted_patient_runs_through_match_all() -> None:
    """The whole point — convert NEMSIS, match against bundled trials."""
    patient, _ = from_nemsis_xml(_load("persona-001-hemorrhage.xml"))
    trials = load_trials(Path(__file__).resolve().parents[1] / "trials")
    results = match_all(patient, trials)
    # P-001 hemorrhage shock should hit at least one eligible trial
    eligible = [r for r in results if r.eligible]
    assert len(eligible) >= 1, "synthetic hemorrhage patient hit zero trials"


# ---------- mechanism mapping ----------


def _wrap_pcr(extra: str = "", *, gcs: int = 15, sbp: int = 120, hr: int = 80,
              age: int = 30, mechanism_code: str = "V40") -> str:
    return f"""<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"><PatientCareReport>
  <eRecord><eRecord.01>X</eRecord.01></eRecord>
  <ePatient><ePatient.13>9906003</ePatient.13><ePatient.15>{age}</ePatient.15><ePatient.16>2516001</ePatient.16></ePatient>
  <eVitals><eVitalsGroup>
    <eVitals.06>{sbp}</eVitals.06><eVitals.10>{hr}</eVitals.10><eVitals.23>{gcs}</eVitals.23>
  </eVitalsGroup></eVitals>
  <eSituation><eSituation.02>{mechanism_code}</eSituation.02></eSituation>
  {extra}
</PatientCareReport></EMSDataSet>"""


# ---------- CDC field triage activation level ----------


def test_activation_level_1_on_low_gcs() -> None:
    p, trace = from_nemsis_xml(_wrap_pcr(gcs=8))
    assert p.trauma_activation_level == 1
    note = next(e.notes for e in trace.extractions if e.field == "trauma_activation_level")
    assert "GCS<=13" in note


def test_activation_level_1_on_hypotension() -> None:
    p, _ = from_nemsis_xml(_wrap_pcr(sbp=80))
    assert p.trauma_activation_level == 1


def test_activation_level_2_on_penetrating() -> None:
    p, _ = from_nemsis_xml(_wrap_pcr(mechanism_code="X95"))  # gsw
    assert p.trauma_activation_level == 2


def test_activation_level_2_on_geriatric_mvc() -> None:
    p, _ = from_nemsis_xml(_wrap_pcr(age=70, mechanism_code="V40"))
    assert p.trauma_activation_level == 2


def test_activation_level_3_on_normal_blunt() -> None:
    p, _ = from_nemsis_xml(_wrap_pcr(age=30, mechanism_code="V40", gcs=15, sbp=120))
    assert p.trauma_activation_level == 3


# ---------- RxNorm anticoagulant detection ----------


def test_anticoagulant_via_rxnorm_cui() -> None:
    p, trace = from_nemsis_xml(
        _wrap_pcr(extra="<eHistory><eHistory.06>1364430</eHistory.06></eHistory>")
    )
    assert p.anticoagulant_use is True
    note = next(e.notes for e in trace.extractions if e.field == "anticoagulant_use")
    assert "RxNorm CUI 1364430" in note


def test_anticoagulant_via_substring_still_works() -> None:
    p, _ = from_nemsis_xml(
        _wrap_pcr(extra="<eHistory><eHistory.06>warfarin 5mg PO QD</eHistory.06></eHistory>")
    )
    assert p.anticoagulant_use is True


# ---------- mechanism mapping ----------


@pytest.mark.parametrize(
    "code,expected",
    [
        ("V43.5XXA", "blunt_mvc"),
        ("V01", "blunt_mvc"),
        ("W19", "fall"),
        ("X95", "gsw"),
        ("X99", "stab"),
        ("Y04XXA", "blunt_other"),
        ("2120001", "blunt_mvc"),
        ("2120013", "burn"),
        ("2120019", "cardiac_arrest"),
        ("Q12345", "other"),
    ],
)
def test_mechanism_mapping(code: str, expected: str) -> None:
    xml = f"""<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"><PatientCareReport>
  <eRecord><eRecord.01>X</eRecord.01></eRecord>
  <ePatient><ePatient.13>9906003</ePatient.13><ePatient.15>30</ePatient.15><ePatient.16>2516001</ePatient.16></ePatient>
  <eSituation><eSituation.02>{code}</eSituation.02></eSituation>
</PatientCareReport></EMSDataSet>"""
    patient, _ = from_nemsis_xml(xml)
    assert patient.mechanism == expected
