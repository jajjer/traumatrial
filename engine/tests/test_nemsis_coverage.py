"""Tests for the NEMSIS adapter's coverage report.

The adapter consumes ~10 eFields explicitly. Real ePCRs carry many more.
The coverage report enumerates everything the adapter saw but didn't
consume — split into `known_unmapped` (recognized v3.5 fields, intentionally
skipped) and `unknown` (not in our vocabulary).

These tests are the "honest gap" guardrail: they assert that a realistic
multi-section export surfaces a meaningful number of skipped fields, that
none of those skipped fields fall into the `unknown` bucket (i.e. our vocab
keeps pace with the fixtures), and that mapped fields stay consistent.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from traumatrial_match import from_nemsis_xml
from traumatrial_match.nemsis_vocab import KNOWN as NEMSIS_KNOWN, MAPPED as NEMSIS_MAPPED


FIXTURES = Path(__file__).parent / "fixtures" / "nemsis"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


# ---------- realistic multi-section ePCR ----------


def test_realistic_polytrauma_coverage_has_substantial_unmapped() -> None:
    """A realistic ePCR carries dozens of eFields the adapter doesn't consume.
    Surface them honestly so reviewers can see what was left on the table."""
    _, _, coverage = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"))

    assert coverage.mapped_count >= 5, (
        f"realistic export should have ≥5 mapped fields; got {coverage.mapped_count}"
    )
    assert coverage.known_unmapped_count >= 20, (
        f"realistic export should report ≥20 known unmapped fields; "
        f"got {coverage.known_unmapped_count}"
    )
    assert coverage.unknown_count == 0, (
        f"realistic fixture should have 0 unknown fields; got "
        f"{[e.field for e in coverage.unmapped if e.classification == 'unknown']}"
    )


def test_realistic_polytrauma_coverage_includes_expected_skipped_sections() -> None:
    """Spot-check that high-signal-but-skipped sections show up in the report:
    eExam findings, eMedications administrations, eProcedures interventions,
    eDisposition. A coordinator looking at the demo should see these listed."""
    _, _, coverage = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"))
    skipped_fields = {e.field for e in coverage.unmapped}
    expected = {
        "eVitals.14",         # respiratory rate
        "eVitals.20",         # SpO2
        "eExam.13",           # chest deformity
        "eExam.18",           # abdominal tenderness
        "eProcedures.03",     # procedure performed
        "eDisposition.20",    # destination trauma center designation
        "eNarrative.01",      # free-text narrative
    }
    missing = expected - skipped_fields
    assert not missing, f"realistic export missing expected skipped fields: {missing}"
    # The fields we now map should NOT appear in unmapped on a fixture that uses them.
    newly_mapped = {"eMedications.03", "eInjury.09", "eSituation.07"}
    promoted = newly_mapped & skipped_fields
    assert not promoted, (
        f"these fields should be reported as mapped on the realistic fixture, "
        f"not unmapped: {promoted}"
    )


def test_realistic_polytrauma_coverage_describes_skipped_fields() -> None:
    """Every known_unmapped entry should carry a one-phrase description.
    That's the audit value — 'eExam.18' alone is meaningless to a reviewer."""
    _, _, coverage = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"))
    for entry in coverage.unmapped:
        if entry.classification == "known_unmapped":
            assert entry.description, (
                f"known_unmapped entry {entry.field} has no description"
            )


def test_realistic_polytrauma_mapped_fields_are_canonical() -> None:
    """Whatever the adapter claims as mapped must come from the curated
    MAPPED set. Guards against drift between the vocab and the extractors."""
    _, _, coverage = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"))
    drift = set(coverage.mapped_fields) - NEMSIS_MAPPED
    assert not drift, f"adapter reported mapped fields not in vocab: {drift}"


# ---------- thin persona fixtures ----------


def test_persona_001_minimal_fixture_has_few_unmapped() -> None:
    """Persona fixtures are deliberately stripped — they should report only
    a handful of unmapped fields. A regression here usually means a fixture
    grew accidentally."""
    _, _, coverage = from_nemsis_xml(_load("persona-001-hemorrhage.xml"))
    assert coverage.known_unmapped_count <= 3, (
        f"persona-001 should have ≤3 known unmapped fields; "
        f"got {coverage.known_unmapped_count}: "
        f"{[e.field for e in coverage.unmapped]}"
    )
    assert coverage.unknown_count == 0


# ---------- unknown bucket ----------


def test_unknown_field_is_classified_as_unknown() -> None:
    """A made-up element name not in the vocab should land in `unknown`."""
    xml = """<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"><PatientCareReport>
  <eRecord><eRecord.01>X</eRecord.01></eRecord>
  <ePatient><ePatient.13>9906003</ePatient.13><ePatient.15>30</ePatient.15><ePatient.16>2516001</ePatient.16></ePatient>
  <eVitals><eVitalsGroup>
    <eVitals.06>120</eVitals.06><eVitals.10>80</eVitals.10><eVitals.23>15</eVitals.23>
  </eVitalsGroup></eVitals>
  <eSituation><eSituation.02>V40</eSituation.02></eSituation>
  <eFakeSection><eFake.99>some-value</eFake.99></eFakeSection>
</PatientCareReport></EMSDataSet>"""
    _, _, coverage = from_nemsis_xml(xml)
    unknowns = [e.field for e in coverage.unmapped if e.classification == "unknown"]
    assert "eFake.99" in unknowns
    fake = next(e for e in coverage.unmapped if e.field == "eFake.99")
    assert fake.sample_value == "some-value"
    assert fake.description is None


def test_coverage_summary_line_format() -> None:
    """The summary line is what the demo will print verbatim. Lock the format."""
    _, _, coverage = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"))
    line = coverage.summary_line()
    assert line.startswith("NEMSIS coverage:")
    assert "mapped" in line and "known unmapped" in line and "unknown" in line


# ---------- ETA inference from eTimes.07 ----------


def test_eta_inferred_when_etimes_07_present() -> None:
    """eTimes.07 is the receiving facility arrival time. While the unit is
    in transit it carries the *estimated* arrival; max(0, eTimes.07 − now)
    is a sensible ETA. Pinned with a fixed `now` for determinism."""
    # Realistic fixture's eTimes.07 = 2026-05-04T13:21:43-05:00 (= 18:21:43 UTC).
    now = datetime(2026, 5, 4, 18, 14, 0, tzinfo=timezone.utc)  # 7m43s before arrival
    _, trace, _ = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"), now=now)
    eta = next(e for e in trace.extractions if e.field == "eta_minutes")
    assert eta.source == "inferred"
    assert eta.value == 7
    assert eta.notes is not None and "eTimes.07" in eta.notes


def test_eta_floors_at_zero_when_already_arrived() -> None:
    """If 'now' is past the eTimes.07 timestamp, ETA should clamp to 0
    rather than going negative."""
    now = datetime(2026, 5, 4, 19, 0, 0, tzinfo=timezone.utc)  # 38m after arrival
    _, trace, _ = from_nemsis_xml(_load("realistic-mva-polytrauma.xml"), now=now)
    eta = next(e for e in trace.extractions if e.field == "eta_minutes")
    assert eta.source == "inferred"
    assert eta.value == 0


def test_eta_defaulted_when_etimes_07_missing() -> None:
    """The persona fixtures don't carry eTimes.07 — should default with a
    clear note, not silently produce a number."""
    _, trace, _ = from_nemsis_xml(_load("persona-001-hemorrhage.xml"))
    eta = next(e for e in trace.extractions if e.field == "eta_minutes")
    assert eta.source == "defaulted"
    assert eta.value == 0
    assert eta.notes is not None and "no eTimes.07" in eta.notes


# ---------- vocab catalog sanity ----------


def test_vocab_mapped_and_known_are_disjoint() -> None:
    """A field can't be both 'mapped' and 'known unmapped' — that would
    confuse the coverage classifier."""
    overlap = NEMSIS_MAPPED & set(NEMSIS_KNOWN.keys())
    assert not overlap, f"vocab overlap between MAPPED and KNOWN: {overlap}"
