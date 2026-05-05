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


# ---------- noisy persona round-trips ----------
#
# Each fixture round-trips a persona's adapter-extractable fields. Where the
# adapter's simplified inference rules diverge from the human-curated persona
# JSON, the test asserts what the ADAPTER produces — the divergences are
# documented so future hardening (better activation logic, structured med
# parsing) shows up as visible test deltas.


def test_persona_002_geriatric_fall_namespaced() -> None:
    """xmlns:nem prefix variant + multi-vitals + non-anticoag meds."""
    patient, trace = from_nemsis_xml(_load("persona-002-geriatric-fall.xml"))
    assert patient.patient_id == "SYN-P002-FALL"
    assert patient.age_years == 67
    assert patient.sex == "F"
    # Latest of two eVitalsGroups: SBP 134, HR 88, GCS 14
    assert patient.gcs == 14
    assert patient.sbp_mmhg == 134
    assert patient.hr_bpm == 88
    assert patient.mechanism == "fall"
    # Explicit not_pregnant code → extracted, not defaulted
    preg = next(e for e in trace.extractions if e.field == "pregnancy_status")
    assert preg.source == "extracted"
    assert patient.pregnancy_status == "not_pregnant"
    # Metformin + atorvastatin: no anticoag hit
    assert patient.anticoagulant_use is False
    # Adapter activation: fall + age>=55 → Level 2 (Step 2 mechanism+age).
    # Persona JSON has level 3 (human curator's softer call); divergence is fine.
    assert patient.trauma_activation_level == 2


def test_persona_003_gsw_no_history() -> None:
    """ICD-10 X95.000A + missing eHistory + single vitals group."""
    patient, trace = from_nemsis_xml(_load("persona-003-gsw.xml"))
    assert patient.age_years == 28
    assert patient.sex == "M"
    assert patient.gcs == 15
    assert patient.sbp_mmhg == 70
    assert patient.hr_bpm == 138
    assert patient.mechanism == "gsw"
    # eHistory absent → anticoag defaulted False
    anticoag = next(e for e in trace.extractions if e.field == "anticoagulant_use")
    assert anticoag.source == "defaulted"
    assert patient.anticoagulant_use is False
    # Hypotension + tachycardia + non-cardiac → presumed_hemorrhage
    assert patient.presumed_hemorrhage is True
    # SBP<90 → Level 1
    assert patient.trauma_activation_level == 1


def test_persona_004_tbi_falls_back_to_einjury() -> None:
    """eSituation.02 absent — adapter falls through to eInjury.01 for mechanism."""
    patient, trace = from_nemsis_xml(_load("persona-004-tbi-mvc.xml"))
    assert patient.age_years == 45
    assert patient.sex == "F"
    # Latest vitals are the second group — out-of-range HR=350 in the first
    # group must NOT leak into the Patient.
    assert patient.gcs == 9
    assert patient.sbp_mmhg == 110
    assert patient.hr_bpm == 102
    # Mechanism resolved via eInjury.01 fallback
    mech = next(e for e in trace.extractions if e.field == "mechanism")
    assert mech.source == "extracted"
    assert patient.mechanism == "blunt_mvc"
    # GCS<=13 + blunt → presumed_tbi True
    assert patient.presumed_tbi is True
    # GCS=9 (>8) → presumed_ich is False per adapter rule, even though the
    # persona JSON has it as True (human curator factored in CT findings the
    # adapter can't see).
    assert patient.presumed_intracranial_hemorrhage is False


def test_persona_005_anticoag_via_nested_rxnorm() -> None:
    """RxNorm CUI inside an eHistory.061 child element + brand-name in sibling."""
    patient, trace = from_nemsis_xml(_load("persona-005-anticoag-mvc.xml"))
    assert patient.age_years == 19
    assert patient.sex == "M"
    assert patient.mechanism == "blunt_mvc"  # NEMSIS native code 2120001
    assert patient.anticoagulant_use is True
    anticoag = next(e for e in trace.extractions if e.field == "anticoagulant_use")
    # RxNorm channel hits before substring channel
    assert anticoag.source == "inferred"
    assert "1114195" in (anticoag.notes or "")
    # Adapter activation: GCS=14, SBP=105, age=19, blunt → Level 3.
    # Persona JSON has Level 2 (human bumped for anticoag — adapter's CDC
    # rules don't bump for that yet).
    assert patient.trauma_activation_level == 3


def test_persona_006_pregnant_fall_explicit_code() -> None:
    """Explicit pregnant code on a 52yo female + decompensating vitals."""
    patient, trace = from_nemsis_xml(_load("persona-006-pregnant-fall.xml"))
    assert patient.age_years == 52
    assert patient.sex == "F"
    assert patient.pregnancy_status == "pregnant"
    # Latest vitals (decompensated): SBP 78, HR 124, GCS 9
    assert patient.gcs == 9
    assert patient.sbp_mmhg == 78
    assert patient.hr_bpm == 124
    assert patient.mechanism == "fall"
    # Hypotension → Level 1
    assert patient.trauma_activation_level == 1
    # presumed_hemorrhage: SBP<90 + HR>110 + non-cardiac → True
    assert patient.presumed_hemorrhage is True
    # GCS=9 + blunt → presumed_tbi True
    assert patient.presumed_tbi is True
    # GCS=9 (>8) → presumed_ich False (persona has True)
    assert patient.presumed_intracranial_hemorrhage is False


def test_persona_008_pediatric_caller_provided_id() -> None:
    """Missing eRecord.01 (caller provides id) + unmapped cause code → 'other'."""
    patient, trace = from_nemsis_xml(
        _load("persona-008-pediatric-mvc.xml"), patient_id="P-008"
    )
    assert patient.patient_id == "P-008"
    pid = next(e for e in trace.extractions if e.field == "patient_id")
    assert pid.notes == "caller-provided"
    assert patient.age_years == 8
    assert patient.sex == "M"
    # Adapter limitation: when eSituation.02 is PRESENT but unmapped,
    # adapter doesn't fall through to eInjury.01. Mechanism becomes 'other'
    # even though eInjury.01 carries a valid V43 code.
    assert patient.mechanism == "other"
    mech = next(e for e in trace.extractions if e.field == "mechanism")
    assert mech.source == "defaulted"


# ---------- adversarial: known false-positive in substring matcher ----------


def test_adversarial_substring_false_positive_documented() -> None:
    """Allergy note containing 'warfarin' substring → adapter (incorrectly)
    flags anticoagulant_use=True. This test pins current behavior so a
    future fix (parsing eHistory.06 into structured fields) flips it."""
    patient, trace = from_nemsis_xml(_load("adversarial-substring-trap.xml"))
    assert patient.anticoagulant_use is True
    anticoag = next(e for e in trace.extractions if e.field == "anticoagulant_use")
    assert anticoag.source == "inferred"
    assert "warfarin" in (anticoag.notes or "")


# ---------- trace summary covers all Patient fields ----------


def test_trace_covers_every_patient_field() -> None:
    """Every Patient field should have at least one extraction row in the
    trace — no silent values. Guard against future fields being added to
    Patient without a corresponding adapter trace entry."""
    patient, trace = from_nemsis_xml(_load("persona-001-hemorrhage.xml"))
    fields_in_trace = {e.field for e in trace.extractions}
    fields_on_patient = set(patient.model_dump().keys())
    missing = fields_on_patient - fields_in_trace
    assert not missing, f"Patient fields with no trace row: {missing}"


# ---------- end-to-end: realistic ePCR → eligible trials ----------


def test_realistic_polytrauma_round_trip_to_corpus() -> None:
    """A realistic, multi-section NEMSIS export should parse cleanly,
    correctly pick the LATEST eVitals (deterioration), ignore the
    eDispatch/eResponse/eScene/eMedications/eProcedures/eNarrative noise
    a real ePCR carries, and surface a meaningful number of eligible
    trials when matched against the bundled corpus.

    The point of this test is the round-trip — adapter + matcher together
    on a realistic input. Per-field extraction rules are covered elsewhere."""
    xml = _load("realistic-mva-polytrauma.xml")
    patient, trace = from_nemsis_xml(xml)

    # Multi-section noise must not bleed into the Patient.
    assert patient.patient_id == "ANON-MVA-2026-0517"
    assert patient.age_years == 38
    assert patient.sex == "M"

    # Latest eVitalsGroup wins — initial GCS 13 must NOT have been picked.
    assert patient.gcs == 8
    assert patient.sbp_mmhg == 78
    assert patient.hr_bpm == 132

    # ICD-10 V44.5XXA → blunt_mvc via prefix match
    assert patient.mechanism == "blunt_mvc"

    # eHistory.06 carries lisinopril + acetaminophen — must NOT trip the
    # anticoagulant heuristic via substring match.
    assert patient.anticoagulant_use is False

    # Polytrauma flags all true from physiology + mechanism.
    assert patient.presumed_tbi is True
    assert patient.presumed_hemorrhage is True
    assert patient.presumed_intracranial_hemorrhage is True
    assert patient.spinal_injury_suspected is True
    assert patient.trauma_activation_level == 1

    # Trace should have substantial real signal, not just defaults.
    assert trace.extracted_count >= 6, (
        f"realistic export should yield ≥6 extracted fields; got {trace.extracted_count}"
    )

    # End-to-end: this profile should land eligible for a meaningful
    # number of TBI / hemorrhage / polytrauma trials. We assert ≥5 so
    # the threshold isn't fragile against single-trial corpus tweaks;
    # the actual count today is 33 of 61.
    trials_dir = Path(__file__).resolve().parent.parent / "trials"
    trials = load_trials(trials_dir)
    results = match_all(patient, trials)
    eligible = [r for r in results if r.eligible]
    assert len(eligible) >= 5, (
        f"polytrauma profile should match ≥5 trials; got {len(eligible)}"
    )

    # TROOP (whole blood for hemorrhage, age >=15, hemorrhage) must be in
    # the eligible set — it's the canonical trial this profile targets.
    eligible_ids = {r.trial_id for r in eligible}
    assert "NCT05638581" in eligible_ids, (
        f"TROOP (NCT05638581) should be eligible for polytrauma w/ hemorrhage; "
        f"got eligible={sorted(eligible_ids)}"
    )
