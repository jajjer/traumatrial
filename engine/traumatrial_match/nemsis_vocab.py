"""NEMSIS v3.5 eField vocabulary — partial, scoped to sections we see in real ePCRs.

The adapter only consumes ~10 of these fields (see MAPPED). The rest sit in
KNOWN to power the coverage report: when an XML element matches a KNOWN entry
the report classifies it as a *known unmapped* field with a one-phrase
description, rather than as something we don't recognize.

This is not a full v3.5 dictionary. It's a curated working set: the eFields
that turn up in our fixture suite plus the close neighbors a coordinator would
expect us to know exist. Full spec at https://nemsis.org/standards/v350/.

Each entry maps "eFoo.NN" → human-readable description. The keys must be the
literal element local names you'd find in a NEMSIS v3.5 XML payload.
"""

from __future__ import annotations

from typing import Final


# eFields the adapter actively reads. Tracked here (not just in nemsis.py) so
# the coverage walker can mark them "mapped" without re-deriving extractor logic.
MAPPED: Final[frozenset[str]] = frozenset({
    "eRecord.01",
    "ePatient.13",
    "ePatient.15",
    "ePatient.16",
    "eVitals.06",
    "eVitals.10",
    "eVitals.23",
    "eSituation.02",
    "eSituation.07",
    "eInjury.01",
    "eInjury.09",
    "eHistory.06",
    "eHistory.16",
    "eMedications.03",
    "eTimes.07",
})


# Known v3.5 eFields we've decided NOT to consume. The description is the
# one-phrase reason a coordinator would want to see when they're auditing
# what got ignored ("oh, RR; we don't model it yet").
KNOWN: Final[dict[str, str]] = {
    # eRecord
    "eRecord.SoftwareCreatorAndName": "ePCR vendor identifier",
    "eRecord.02": "ePCR software version",
    # eResponse — agency / unit / call setup
    "eResponse.01": "EMS agency identifier",
    "eResponse.03": "type of service requested",
    "eResponse.05": "primary role of the unit",
    "eResponse.13": "type of dispatch (911, transfer, etc.)",
    # eDispatch — call complaint / priority
    "eDispatch.01": "complaint reported by dispatch",
    "eDispatch.04": "EMD performed (priority)",
    # eTimes — call timestamps
    "eTimes.01": "PSAP call time",
    "eTimes.03": "unit notified by dispatch",
    "eTimes.05": "unit en route",
    "eTimes.06": "unit arrived on scene",
    "eTimes.09": "unit back in service",
    "eTimes.13": "unit canceled",
    # eScene — scene context
    "eScene.07": "incident location type",
    "eScene.09": "rural/urban/suburban",
    "eScene.18": "number of patients at scene",
    "eScene.21": "first/second/etc. EMS on scene",
    # ePatient — demographics beyond age/sex
    "ePatient.02": "patient last name (PHI; intentionally not consumed)",
    "ePatient.03": "patient first name (PHI; intentionally not consumed)",
    "ePatient.14": "race",
    "ePatient.17": "date of birth (PHI; intentionally not consumed)",
    "ePatient.NN": "ethnicity / language / SSN (PHI; intentionally not consumed)",
    # eHistory — medical history beyond meds/pregnancy
    "eHistory.05": "allergies",
    "eHistory.08": "medical/surgical history (comorbidities)",
    "eHistory.09": "physician orders / DNR status",
    "eHistory.061": "RxNorm CUI nested under eHistory.06 (consumed when present)",
    # eVitals — vitals beyond GCS/SBP/HR
    "eVitals.01": "vitals timestamp",
    "eVitals.07": "diastolic BP",
    "eVitals.14": "respiratory rate",
    "eVitals.16": "respiratory effort",
    "eVitals.20": "SpO2",
    "eVitals.21": "EtCO2",
    "eVitals.22": "blood glucose",
    "eVitals.24": "GCS-Eye component",
    "eVitals.25": "GCS-Verbal component",
    "eVitals.26": "GCS-Motor component",
    "eVitals.27": "stroke scale",
    "eVitals.28": "pain scale",
    # eExam — physical exam findings (rich in real PCRs; we don't model body-region findings)
    "eExam.01": "exam timestamp",
    "eExam.13": "chest exam findings",
    "eExam.18": "abdomen exam findings",
    "eExam.19": "back/flank exam findings",
    "eExam.20": "pelvis/genitourinary findings",
    "eExam.21": "extremity findings",
    "eExam.23": "neurological exam findings",
    # eMedications — administered meds (different from eHistory.06)
    "eMedications.01": "medication administration time",
    "eMedications.05": "dosage",
    "eMedications.06": "dosage units",
    "eMedications.07": "route of administration",
    "eMedications.10": "medication response",
    # eProcedures — interventions performed
    "eProcedures.01": "procedure timestamp",
    "eProcedures.03": "procedure performed (SNOMED)",
    "eProcedures.06": "procedure successful (yes/no)",
    "eProcedures.07": "procedure complications",
    # eSituation — the call context beyond cause-of-injury
    "eSituation.01": "patient's primary symptom",
    "eSituation.09": "secondary impression",
    "eSituation.11": "injury type (single/multi system)",
    "eSituation.12": "work-related?",
    "eSituation.13": "patient activity at time of injury",
    # eInjury — injury detail beyond cause
    "eInjury.02": "vehicle role (driver/passenger/pedestrian)",
    "eInjury.03": "use of safety equipment",
    "eInjury.04": "airbag deployment",
    "eInjury.05": "height of fall",
    # eNarrative — free-text PCR narrative
    "eNarrative.01": "free-text narrative (out of scope; consider NLP later)",
    # eDisposition — destination + transport mode
    "eDisposition.01": "patient disposition",
    "eDisposition.02": "transport mode",
    "eDisposition.16": "destination type",
    "eDisposition.20": "destination trauma center designation",
    "eDisposition.23": "level of care provided to receiving facility",
    # eOutcome — hospital handoff, rare in field PCR but appears in linked records
    "eOutcome.01": "ED disposition",
    "eOutcome.02": "ED diagnosis",
    "eOutcome.10": "ED procedures",
    # eOther — quality / signatures / state
    "eOther.01": "QA/QI flags",
    "eOther.06": "PCR signatures",
    "eOther.12": "state-defined customizations",
    # eCrew — responder demographics
    "eCrew.01": "crew member id",
    "eCrew.02": "crew member level",
}


# Element NAMES (not eField numbers) we recognize as section containers or
# repeating-group wrappers. The walker descends into these but doesn't classify
# them as data fields themselves.
SECTION_CONTAINERS: Final[frozenset[str]] = frozenset({
    "EMSDataSet",
    "Header",
    "Source",
    "SchemaVersion",
    "PatientCareReport",
    "eRecord",
    "eResponse",
    "eDispatch",
    "eTimes",
    "eScene",
    "ePatient",
    "eHistory",
    "eVitals",
    "eVitalsGroup",
    "eExam",
    "eExamGroup",
    "eMedications",
    "eMedicationsGroup",
    "eProcedures",
    "eProceduresGroup",
    "eSituation",
    "eInjury",
    "eInjuryGroup",
    "eNarrative",
    "eDisposition",
    "eOutcome",
    "eOther",
    "eCrew",
    "eCrewGroup",
})


def classify(local_name: str) -> str:
    """Return one of: 'mapped', 'known_unmapped', 'container', 'unknown'."""
    if local_name in MAPPED:
        return "mapped"
    if local_name in KNOWN:
        return "known_unmapped"
    if local_name in SECTION_CONTAINERS:
        return "container"
    return "unknown"


def describe(local_name: str) -> str | None:
    """Return the one-phrase description for a known eField, or None."""
    return KNOWN.get(local_name)
