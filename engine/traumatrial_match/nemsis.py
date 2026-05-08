"""NEMSIS v3.5 ePCR XML → Patient adapter.

Converts a NEMSIS v3.5 PatientCareReport into the engine's structured Patient
record, plus a field-by-field NemsisConversionTrace explaining where each
value came from (extracted / inferred / defaulted / skipped).

This is a deliberately small adapter. ~15 high-signal eFields are mapped
explicitly; everything else surfaces in the trace with a one-line reason.
The trace is the contract: a coordinator should be able to read it and
understand exactly which Patient values were lifted from XML, which were
inferred by rule, and which were guessed because the source was silent.

What this is NOT:
- Not a clinical-grade extractor. Several Patient fields (presumed_tbi,
  presumed_hemorrhage, presumed_intracranial_hemorrhage,
  spinal_injury_suspected) have no direct NEMSIS counterpart and are
  inferred from physiology + mechanism. The trace says so.
- Not a state-extension parser. Core v3.5 only.
- Not a replacement for the ImageTrend / ESO / etc. ePCR vendor mappings,
  which carry their own conventions and validations.

Usage:
    from traumatrial_match import from_nemsis_xml
    patient, trace, coverage = from_nemsis_xml(xml_str)
    for line in trace.summary_lines():
        print(line)
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from traumatrial_match.nemsis_vocab import (
    KNOWN as NEMSIS_KNOWN,
    MAPPED as NEMSIS_MAPPED,
    SECTION_CONTAINERS as NEMSIS_CONTAINERS,
    classify as classify_field,
)
from traumatrial_match.schema import Mechanism, Patient, PregnancyStatus, Sex


# NEMSIS code lists — partial, illustrative. Full list at https://nemsis.org/standards/v350/.
# These cover the codes our bundled personas plausibly carry.
NEMSIS_GENDER: dict[str, Sex] = {
    "9906001": "F",
    "9906003": "M",
    "9906005": "U",  # "Other / Female-to-Male" etc. → Unknown for our schema
    "9906007": "U",  # Unknown
}

NEMSIS_PREGNANCY: dict[str, PregnancyStatus] = {
    "3133001": "pregnant",
    "3133003": "not_pregnant",
    "3133005": "unknown_could_be_pregnant",
}

# ICD-10 prefix → mechanism. Order matters for the longest-prefix match.
# We're being conservative: only obvious mappings, everything else falls
# through to "other" with a skip note.
ICD10_MECHANISM_PREFIXES: list[tuple[str, Mechanism]] = [
    ("V", "blunt_mvc"),       # V01-V99 transport accidents
    ("W00", "fall"),          # falls on same level
    ("W01", "fall"),
    ("W02", "fall"),
    ("W03", "fall"),
    ("W04", "fall"),
    ("W05", "fall"),
    ("W06", "fall"),
    ("W07", "fall"),
    ("W08", "fall"),
    ("W09", "fall"),
    ("W10", "fall"),
    ("W11", "fall"),
    ("W12", "fall"),
    ("W13", "fall"),
    ("W14", "fall"),
    ("W15", "fall"),
    ("W16", "fall"),
    ("W17", "fall"),
    ("W18", "fall"),
    ("W19", "fall"),
    ("W23", "crush"),         # caught between objects
    ("W25", "stab"),           # accidental sharp object
    ("W26", "stab"),
    ("W32", "gsw"),            # accidental firearm
    ("W33", "gsw"),
    ("W34", "gsw"),
    ("X00", "burn"),           # exposure to fire
    ("X01", "burn"),
    ("X02", "burn"),
    ("X03", "burn"),
    ("X04", "burn"),
    ("X05", "burn"),
    ("X06", "burn"),
    ("X08", "burn"),
    ("X09", "burn"),
    ("X72", "gsw"),            # self-harm firearm
    ("X73", "gsw"),
    ("X74", "gsw"),
    ("X92", "gsw"),            # assault firearm
    ("X93", "gsw"),
    ("X94", "gsw"),
    ("X95", "gsw"),
    ("X96", "blast"),          # assault explosive
    ("X97", "blast"),
    ("X98", "blast"),
    ("X99", "stab"),           # assault sharp object
    ("Y01", "blunt_other"),    # assault, blunt
    ("Y02", "blunt_other"),
    ("Y04", "blunt_other"),
    ("Y08", "blunt_other"),
    ("I46", "cardiac_arrest"), # not strictly a cause-of-injury but turns up in eHistory.08
]

# NEMSIS native cause-of-injury enumeration (eInjury.01 / eSituation.02 in some
# implementations). Synthetic codes for v0 illustration; the v3.5 spec carries
# its own enumeration too. We accept either ICD-10 strings or these codes.
NEMSIS_CAUSE_CODES: dict[str, Mechanism] = {
    "2120001": "blunt_mvc",        # Motor vehicle collision
    "2120003": "blunt_mvc",        # Motorcycle
    "2120005": "fall",             # Fall
    "2120007": "blunt_other",      # Struck by/against
    "2120009": "stab",             # Stab/cut
    "2120011": "gsw",              # Firearm
    "2120013": "burn",             # Burn
    "2120015": "blast",            # Explosion
    "2120017": "crush",            # Crush
    "2120019": "cardiac_arrest",   # Cardiac (rare for an injury cause but in some workflows)
}

# Substrings to look for in eHistory.06 medication free text. Lowercase
# substring match.
ANTICOAGULANT_STRINGS = (
    "warfarin", "coumadin",
    "apixaban", "eliquis",
    "rivaroxaban", "xarelto",
    "dabigatran", "pradaxa",
    "edoxaban", "savaysa",
    "heparin", "enoxaparin", "lovenox",
)

# RxNorm CUIs for anticoagulants. Partial — the live RxNorm graph has many
# concept-type variants per drug; this lifts the most common ingredient/branded
# CUIs that turn up in NEMSIS eHistory.06 fields. Cross-checked against
# https://uts.nlm.nih.gov/uts/rxnorm/.
ANTICOAGULANT_RXNORM_CUIS = frozenset({
    "11289",     # warfarin
    "855288",    # warfarin sodium
    "5224",      # heparin
    "67108",     # enoxaparin sodium
    "1037045",   # dabigatran etexilate
    "1114195",   # rivaroxaban
    "1364430",   # apixaban
    "1599538",   # edoxaban tosylate
    "284562",    # heparin sodium
    "11128",     # enoxaparin
})


# Reversal agents administered in the field — strong corroboration that the
# patient is anticoagulated. We pick these up from eMedications.03 (administered
# meds), separate from eHistory.06 (home meds). RxNorm CUIs are illustrative
# and partial; the substring channel does most of the actual matching since
# eMedications.03 in many ePCRs carries free-text or NEMSIS-specific codes.
REVERSAL_AGENT_RXNORM_CUIS = frozenset({
    "1604586",  # idarucizumab (Praxbind — reverses dabigatran)
    "1992425",  # andexanet alfa (Andexxa — reverses Xa inhibitors)
    "1862625",  # 4-factor PCC / Kcentra
    "67051",    # phytonadione (vitamin K1)
    "8819",     # protamine sulfate
})

REVERSAL_AGENT_STRINGS = (
    "idarucizumab", "praxbind",
    "andexanet", "andexxa",
    "kcentra", "prothrombin complex", "4f-pcc", "4-factor pcc", "ffp transfusion",
    "vitamin k", "phytonadione",
    "protamine",
)


# Tranexamic acid + similar antifibrinolytics — administered in the field
# strongly corroborates a clinical assessment of hemorrhage. Used to OR with
# physiology-derived presumed_hemorrhage.
HEMORRHAGE_TX_RXNORM_CUIS = frozenset({
    "11091",   # tranexamic acid (ingredient)
    "313364",  # tranexamic acid 100 MG/ML injectable
    "859078",  # tranexamic acid (alt SCD)
    "498",     # aminocaproic acid
})

HEMORRHAGE_TX_STRINGS = (
    "tranexamic", "txa", "cyklokapron", "lysteda",
    "aminocaproic", "amicar",
)


# eInjury.09 — NEMSIS v3.5 trauma triage criteria codes (CDC field triage).
# Partial: the codes that turn up most often in real ePCRs. Step 1/2 escalate
# to highest activation; Step 3 to Level 2; Step 4 to Level 2.
NEMSIS_TRIAGE_STEP1: frozenset[str] = frozenset({
    "4509001",  # GCS <= 13 / altered mental status
    "4509003",  # SBP < 90 (or age-adjusted shock)
    "4509005",  # respiratory rate < 10 or > 29
    "4509007",  # respiratory distress / need for ventilatory support
    "4509033",  # cardiopulmonary arrest
})
NEMSIS_TRIAGE_STEP2: frozenset[str] = frozenset({
    "4509013",  # penetrating injury head/neck/torso/proximal extremity
    "4509015",  # skull deformity / open or depressed skull fracture
    "4509017",  # chest wall instability / flail chest
    "4509019",  # two or more proximal long-bone fractures
    "4509021",  # crushed/degloved/mangled extremity
    "4509023",  # amputation proximal to wrist or ankle
    "4509025",  # pelvic fracture
    "4509027",  # paralysis
    "4509029",  # active bleeding requiring tourniquet
})
NEMSIS_TRIAGE_STEP3: frozenset[str] = frozenset({
    "4509031",  # high-energy MVC (intrusion / ejection / death same compartment)
    "4509035",  # auto vs pedestrian / cyclist >20mph
    "4509037",  # fall >20ft (adult) / >10ft (peds)
    "4509039",  # motorcycle crash >20mph
})
NEMSIS_TRIAGE_STEP4: frozenset[str] = frozenset({
    "4509049",  # older adult on anticoagulant
    "4509051",  # pregnancy >20 weeks
    "4509053",  # burns
    "4509055",  # EMS judgment / clinician concern
})


# eSituation.07 (primary impression) ICD-10 prefix → set of clinical flags.
# The flags map onto our Patient bool fields:
#   tbi    → presumed_tbi
#   ich    → presumed_intracranial_hemorrhage
#   spinal → spinal_injury_suspected
# When eSituation.07 is present and matches, we OR these into the
# physiology-derived inferences — the trace makes both sources visible.
ICD10_IMPRESSION_FLAGS: list[tuple[str, frozenset[str]]] = [
    # Intracranial hemorrhages — most specific, longest prefixes first.
    ("S06.4", frozenset({"tbi", "ich"})),  # epidural hemorrhage
    ("S06.5", frozenset({"tbi", "ich"})),  # subdural hemorrhage
    ("S06.6", frozenset({"tbi", "ich"})),  # subarachnoid hemorrhage
    # Other intracranial injuries — TBI without explicit hemorrhage code.
    ("S06", frozenset({"tbi"})),
    # Cervical / thoracic / lumbosacral spine fractures, dislocations, SCI.
    ("S12", frozenset({"spinal"})),
    ("S13", frozenset({"spinal"})),
    ("S14", frozenset({"spinal"})),
    ("S22", frozenset({"spinal"})),
    ("S23", frozenset({"spinal"})),
    ("S24", frozenset({"spinal"})),
    ("S32", frozenset({"spinal"})),
    ("S33", frozenset({"spinal"})),
    ("S34", frozenset({"spinal"})),
]


ExtractionSource = Literal["extracted", "inferred", "defaulted", "skipped"]


class FieldExtraction(BaseModel):
    """One row of the conversion trace — how a single Patient field was set."""

    field: str
    source: ExtractionSource
    value: Any = None
    nemsis_path: Optional[str] = Field(default=None, description="e.g., 'ePatient.15'")
    raw: Optional[str] = Field(default=None, description="Raw text or code from the XML")
    notes: Optional[str] = Field(default=None, description="Why inferred/defaulted/skipped")


class NemsisConversionTrace(BaseModel):
    """Field-by-field record of how a Patient was built from a NEMSIS XML."""

    extractions: list[FieldExtraction] = Field(default_factory=list)

    def add(self, **kwargs: Any) -> None:
        self.extractions.append(FieldExtraction(**kwargs))

    @property
    def extracted_count(self) -> int:
        return sum(1 for e in self.extractions if e.source == "extracted")

    @property
    def inferred_count(self) -> int:
        return sum(1 for e in self.extractions if e.source == "inferred")

    @property
    def defaulted_count(self) -> int:
        return sum(1 for e in self.extractions if e.source == "defaulted")

    @property
    def skipped_count(self) -> int:
        return sum(1 for e in self.extractions if e.source == "skipped")

    def summary_lines(self) -> list[str]:
        out: list[str] = []
        for e in self.extractions:
            tag = e.source.upper().ljust(10)
            path = (e.nemsis_path or "—").ljust(20)
            line = f"  [{tag}] {e.field:35s} {path} {e.value!r}"
            if e.notes:
                line += f"  ({e.notes})"
            out.append(line)
        return out


class NemsisParseError(ValueError):
    """Raised when the XML is malformed or doesn't look like a NEMSIS PCR."""


class CoverageEntry(BaseModel):
    """One element seen in the source XML that the adapter didn't consume."""

    path: str = Field(description="dotted path under PatientCareReport, e.g. 'eExam.eExam.13'")
    field: str = Field(description="the eField local name, e.g. 'eExam.13'")
    classification: Literal["known_unmapped", "unknown"]
    description: Optional[str] = Field(
        default=None,
        description="one-phrase description of the field (KNOWN entries only)",
    )
    sample_value: Optional[str] = Field(
        default=None,
        description="first non-empty text seen at this path; helpful for auditing",
    )


class NemsisCoverageReport(BaseModel):
    """What the adapter saw in the XML vs. what it consumed.

    `mapped_fields` is the set of eFields the adapter actually read on this PCR.
    `unmapped` lists everything else the walker found, classified as either
    `known_unmapped` (recognized v3.5 eField the adapter intentionally skips —
    e.g. eExam findings, eMedications, RR/SpO2) or `unknown` (not in our
    vocabulary at all; could be a state extension, a typo, or a v3.5 field we
    forgot to catalog).

    This is the patient-side counterpart to Trial.metadata.skipped_criteria —
    a coordinator should be able to read it and know exactly which signal in
    their ePCR was ignored.
    """

    mapped_fields: list[str] = Field(default_factory=list)
    unmapped: list[CoverageEntry] = Field(default_factory=list)

    @property
    def mapped_count(self) -> int:
        return len(self.mapped_fields)

    @property
    def known_unmapped_count(self) -> int:
        return sum(1 for e in self.unmapped if e.classification == "known_unmapped")

    @property
    def unknown_count(self) -> int:
        return sum(1 for e in self.unmapped if e.classification == "unknown")

    def summary_line(self) -> str:
        return (
            f"NEMSIS coverage: {self.mapped_count} mapped, "
            f"{self.known_unmapped_count} known unmapped, "
            f"{self.unknown_count} unknown"
        )


def _local_name(tag: str) -> str:
    """Strip an XML namespace prefix '{ns}Foo' → 'Foo'."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _walk_coverage(
    pcr: ET.Element, mapped_fields_consumed: set[str]
) -> NemsisCoverageReport:
    """Walk every leaf element under the PCR and build a coverage report.

    A "leaf" is an element with no element children — that's where the actual
    eField value lives. Containers (eHistory, eVitalsGroup, etc.) are
    descended into but not classified.

    Repeats (e.g. multiple eHistory.06) collapse into one CoverageEntry per
    field, with the first non-empty text retained as `sample_value`. That
    keeps the report compact on real PCRs without losing audit signal.
    """
    seen_unmapped: dict[str, CoverageEntry] = {}

    def walk(node: ET.Element, parent_path: str) -> None:
        children = list(node)
        local = _local_name(node.tag)
        path = f"{parent_path}.{local}" if parent_path else local

        # Container with children: descend.
        if children:
            for child in children:
                walk(child, path)
            return

        # Leaf node — classify it.
        klass = classify_field(local)
        if klass == "container":
            # Empty container — nothing to record.
            return
        if klass == "mapped":
            # Mapped fields are tracked separately via the trace; the walker
            # doesn't list them here (they show up in mapped_fields_consumed
            # if the adapter actually pulled them).
            return
        if local in seen_unmapped:
            # Already recorded; capture sample_value if we didn't have one yet.
            entry = seen_unmapped[local]
            if entry.sample_value is None and node.text:
                entry.sample_value = node.text.strip() or None
            return
        sample = (node.text or "").strip() or None
        seen_unmapped[local] = CoverageEntry(
            path=path,
            field=local,
            classification="known_unmapped" if klass == "known_unmapped" else "unknown",
            description=NEMSIS_KNOWN.get(local),
            sample_value=sample,
        )

    walk(pcr, "")

    # Sort: knowns first (alphabetical), unknowns last (alphabetical). Stable
    # ordering means snapshot tests don't churn.
    unmapped = sorted(
        seen_unmapped.values(),
        key=lambda e: (0 if e.classification == "known_unmapped" else 1, e.field),
    )
    return NemsisCoverageReport(
        mapped_fields=sorted(mapped_fields_consumed),
        unmapped=unmapped,
    )


# ---------- public entry point ----------


def from_nemsis_xml(
    xml_str: str,
    *,
    patient_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> tuple[Patient, NemsisConversionTrace, NemsisCoverageReport]:
    """Convert a NEMSIS v3.5 PatientCareReport XML into a Patient + trace + coverage.

    The Patient returned is always valid (pydantic enforces this). Fields
    without a NEMSIS source are defaulted with a clear note in the trace.
    The coverage report enumerates every NEMSIS eField present in the source
    that the adapter did not consume — see NemsisCoverageReport for details.

    `now` is used as the reference clock for ETA inference (eTimes.07 − now).
    Defaults to the current UTC time; tests pass a fixed value for determinism.
    """
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError as e:
        raise NemsisParseError(f"could not parse XML: {e}") from e

    ns = _detect_namespace(root)
    pcr = _find_pcr(root, ns)

    trace = NemsisConversionTrace()

    age_years = _extract_age(pcr, ns, trace)
    sex = _extract_sex(pcr, ns, trace)
    gcs, sbp, hr = _extract_vitals(pcr, ns, trace)
    mechanism = _extract_mechanism(pcr, ns, trace)
    pregnancy_status = _extract_pregnancy(pcr, ns, trace, sex)
    # Reversal agents administered in the field (eMedications.03) are a strong
    # corroborating signal for anticoagulant_use beyond eHistory.06 home meds.
    # Hemorrhage-control meds (TXA et al) corroborate presumed_hemorrhage.
    admin_signals = _extract_administered_med_signals(pcr, ns, trace)
    anticoagulant_use = _extract_anticoagulant(
        pcr, ns, trace, admin_reversal=admin_signals["reversal"],
    )
    eta_minutes = _extract_eta(pcr, ns, trace, now=now)
    # Triage criteria (eInjury.09) are authoritative when present; otherwise
    # we fall through to the rules-based inference.
    activation = _extract_or_infer_activation(
        pcr, ns, gcs, sbp, mechanism, age_years, trace,
    )

    # ICD-10 primary impression (eSituation.07) flags act as authoritative
    # OR-channels for the inferred clinical bools below.
    impression_flags = _extract_primary_impression_flags(pcr, ns, trace)

    # Inferred clinical flags. The XML-sourced impression flags are OR'd in
    # so a coded primary impression flips the bool even when physiology alone
    # wouldn't. The trace makes both channels visible.
    presumed_tbi = _infer_presumed_tbi(gcs, mechanism, trace, impression_flags)
    presumed_hemorrhage = _infer_presumed_hemorrhage(
        sbp, hr, mechanism, trace, admin_hemorrhage_tx=admin_signals["hemorrhage_tx"],
    )
    presumed_ich = _infer_presumed_ich(presumed_tbi, gcs, trace, impression_flags)
    spinal_injury = _infer_spinal_injury(mechanism, gcs, trace, impression_flags)

    pid = patient_id or _extract_patient_id(pcr, ns, trace) or "P-NEMSIS"
    trace.add(
        field="patient_id",
        source="extracted" if patient_id is None else "defaulted",
        value=pid,
        nemsis_path="eRecord.01" if patient_id is None else None,
        notes=None if patient_id is None else "caller-provided",
    )

    patient = Patient(
        patient_id=pid,
        age_years=age_years,
        sex=sex,
        gcs=gcs,
        sbp_mmhg=sbp,
        hr_bpm=hr,
        mechanism=mechanism,
        trauma_activation_level=activation,
        eta_minutes=eta_minutes,
        pregnancy_status=pregnancy_status,
        anticoagulant_use=anticoagulant_use,
        presumed_tbi=presumed_tbi,
        presumed_hemorrhage=presumed_hemorrhage,
        presumed_intracranial_hemorrhage=presumed_ich,
        spinal_injury_suspected=spinal_injury,
    )

    # Build the coverage report from the union of MAPPED fields actually
    # observed in the trace (i.e. an "extracted" row) — that way we don't
    # claim coverage for a field whose source element was missing.
    consumed = {
        e.nemsis_path for e in trace.extractions
        if e.source == "extracted" and e.nemsis_path in NEMSIS_MAPPED
    }
    coverage = _walk_coverage(pcr, consumed)
    return patient, trace, coverage


# ---------- XML helpers ----------


def _detect_namespace(root: ET.Element) -> str:
    """Return the namespace prefix (with braces) used by the root, or empty."""
    if root.tag.startswith("{"):
        return root.tag.split("}", 1)[0] + "}"
    return ""


def _find_pcr(root: ET.Element, ns: str) -> ET.Element:
    """Locate the PatientCareReport element (root or child)."""
    if root.tag == f"{ns}PatientCareReport":
        return root
    pcr = root.find(f".//{ns}PatientCareReport")
    if pcr is None:
        raise NemsisParseError("no PatientCareReport element found")
    return pcr


def _find_text(parent: ET.Element, ns: str, *path: str) -> Optional[str]:
    """Find a nested element by NEMSIS local name path; return its text or None."""
    cursor = parent
    for step in path:
        nxt = cursor.find(f"{ns}{step}")
        if nxt is None:
            return None
        cursor = nxt
    text = (cursor.text or "").strip()
    return text or None


def _find_all_groups(parent: ET.Element, ns: str, group: str) -> list[ET.Element]:
    return list(parent.findall(f"{ns}{group}"))


# ---------- field extractors ----------


def _extract_patient_id(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> Optional[str]:
    pid = _find_text(pcr, ns, "eRecord", "eRecord.01")
    return pid


def _extract_age(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> int:
    raw_age = _find_text(pcr, ns, "ePatient", "ePatient.15")
    raw_units = _find_text(pcr, ns, "ePatient", "ePatient.16")
    if raw_age is None:
        trace.add(
            field="age_years", source="defaulted", value=0,
            nemsis_path="ePatient.15",
            notes="no age in PCR; defaulted to 0 (will hard-fail any age inclusion)",
        )
        return 0
    try:
        age_num = int(raw_age)
    except ValueError:
        trace.add(
            field="age_years", source="defaulted", value=0,
            nemsis_path="ePatient.15", raw=raw_age,
            notes=f"non-integer age {raw_age!r}; defaulted to 0",
        )
        return 0
    # Age units (2516001=Years, 2516003=Months, 2516005=Weeks, 2516007=Days, 2516009=Hours).
    # If anything other than years, normalize to 0 years and note it (a
    # 6-month-old can't qualify for any of our trauma trials anyway).
    if raw_units and raw_units != "2516001":
        trace.add(
            field="age_years", source="extracted", value=0,
            nemsis_path="ePatient.15", raw=f"{raw_age} (units {raw_units})",
            notes="non-year age units → 0 years",
        )
        return 0
    age = max(0, min(120, age_num))
    trace.add(
        field="age_years", source="extracted", value=age,
        nemsis_path="ePatient.15", raw=raw_age,
    )
    return age


def _extract_sex(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> Sex:
    raw = _find_text(pcr, ns, "ePatient", "ePatient.13")
    if raw is None:
        trace.add(
            field="sex", source="defaulted", value="U",
            nemsis_path="ePatient.13",
            notes="no gender code in PCR; defaulted to 'U'",
        )
        return "U"
    sex = NEMSIS_GENDER.get(raw, "U")
    if raw not in NEMSIS_GENDER:
        trace.add(
            field="sex", source="defaulted", value="U",
            nemsis_path="ePatient.13", raw=raw,
            notes=f"unrecognized gender code {raw!r}; defaulted to 'U'",
        )
    else:
        trace.add(
            field="sex", source="extracted", value=sex,
            nemsis_path="ePatient.13", raw=raw,
        )
    return sex


def _latest_vitals_group(pcr: ET.Element, ns: str) -> Optional[ET.Element]:
    """Return the last eVitalsGroup, which by convention is the most recent."""
    e_vitals = pcr.find(f"{ns}eVitals")
    if e_vitals is None:
        return None
    groups = _find_all_groups(e_vitals, ns, "eVitalsGroup")
    return groups[-1] if groups else e_vitals


def _extract_vitals(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> tuple[int, int, int]:
    group = _latest_vitals_group(pcr, ns)

    def take(local: str, label: str, default: int, lo: int, hi: int) -> int:
        if group is None:
            trace.add(
                field=label, source="defaulted", value=default,
                nemsis_path=local,
                notes="no eVitals section; defaulted",
            )
            return default
        raw = _find_text(group, ns, local)
        if raw is None:
            trace.add(
                field=label, source="defaulted", value=default,
                nemsis_path=local,
                notes="not present in latest eVitalsGroup; defaulted",
            )
            return default
        try:
            v = int(raw)
        except ValueError:
            trace.add(
                field=label, source="defaulted", value=default,
                nemsis_path=local, raw=raw,
                notes=f"non-integer {label}; defaulted",
            )
            return default
        v = max(lo, min(hi, v))
        trace.add(
            field=label, source="extracted", value=v,
            nemsis_path=local, raw=raw,
        )
        return v

    gcs = take("eVitals.23", "gcs", 15, 3, 15)
    sbp = take("eVitals.06", "sbp_mmhg", 120, 0, 300)
    hr = take("eVitals.10", "hr_bpm", 80, 0, 300)
    return gcs, sbp, hr


_ICD10_CODE_RE = re.compile(r"^[A-Z]\d{2}")


def _extract_mechanism(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> Mechanism:
    # Try eSituation.02 first (Possible Cause / Cause of Injury).
    raw = _find_text(pcr, ns, "eSituation", "eSituation.02")
    if raw is None:
        # eInjury.01 is another common location for cause of injury.
        raw = _find_text(pcr, ns, "eInjury", "eInjury.01")
    if raw is None:
        trace.add(
            field="mechanism", source="defaulted", value="other",
            nemsis_path="eSituation.02",
            notes="no cause-of-injury code in PCR; defaulted to 'other'",
        )
        return "other"

    raw_norm = raw.strip()

    # NEMSIS native code first.
    if raw_norm in NEMSIS_CAUSE_CODES:
        m = NEMSIS_CAUSE_CODES[raw_norm]
        trace.add(
            field="mechanism", source="extracted", value=m,
            nemsis_path="eSituation.02", raw=raw_norm,
            notes="NEMSIS native cause code",
        )
        return m

    # ICD-10 longest-prefix match.
    if _ICD10_CODE_RE.match(raw_norm):
        for prefix, mech in sorted(
            ICD10_MECHANISM_PREFIXES, key=lambda x: -len(x[0])
        ):
            if raw_norm.startswith(prefix):
                trace.add(
                    field="mechanism", source="extracted", value=mech,
                    nemsis_path="eSituation.02", raw=raw_norm,
                    notes=f"ICD-10 prefix {prefix!r}",
                )
                return mech

    trace.add(
        field="mechanism", source="defaulted", value="other",
        nemsis_path="eSituation.02", raw=raw_norm,
        notes="cause code not in our mapping table; defaulted to 'other'",
    )
    return "other"


def _extract_pregnancy(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace, sex: Sex
) -> PregnancyStatus:
    # If the patient isn't female, pregnancy status is N/A regardless of XML.
    if sex != "F":
        trace.add(
            field="pregnancy_status", source="inferred",
            value="not_applicable", nemsis_path=None,
            notes="patient sex is not F → not_applicable",
        )
        return "not_applicable"

    raw = _find_text(pcr, ns, "eHistory", "eHistory.16")
    if raw is None:
        trace.add(
            field="pregnancy_status", source="defaulted",
            value="unknown_could_be_pregnant",
            nemsis_path="eHistory.16",
            notes="female patient, no pregnancy field; defaulted to 'unknown_could_be_pregnant' (conservative for trial enrollment)",
        )
        return "unknown_could_be_pregnant"
    status = NEMSIS_PREGNANCY.get(raw, "unknown_could_be_pregnant")
    if raw not in NEMSIS_PREGNANCY:
        trace.add(
            field="pregnancy_status", source="defaulted",
            value="unknown_could_be_pregnant",
            nemsis_path="eHistory.16", raw=raw,
            notes=f"unrecognized pregnancy code {raw!r}; conservative default",
        )
    else:
        trace.add(
            field="pregnancy_status", source="extracted", value=status,
            nemsis_path="eHistory.16", raw=raw,
        )
    return status


def _extract_anticoagulant(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace,
    *, admin_reversal: Optional[str] = None,
) -> bool:
    # Channel 0 (highest signal): a reversal agent was administered in the field.
    # If the EMS crew gave idarucizumab/andexanet/4F-PCC/vitamin K/protamine,
    # the patient is anticoagulated regardless of what eHistory says.
    if admin_reversal:
        trace.add(
            field="anticoagulant_use", source="inferred", value=True,
            nemsis_path="eMedications.03", raw=admin_reversal,
            notes=f"reversal agent administered in the field ({admin_reversal!r}) → True",
        )
        return True

    e_history = pcr.find(f"{ns}eHistory")
    if e_history is None:
        trace.add(
            field="anticoagulant_use", source="defaulted", value=False,
            nemsis_path="eHistory.06", notes="no eHistory; defaulted to False",
        )
        return False
    # eHistory.06 (medications) often appears multiple times. NEMSIS v3.5 may
    # carry an RxNorm CUI as the element text or in a nested code element;
    # we check both. Free-text descriptions also flow through.
    meds = e_history.findall(f"{ns}eHistory.06")
    raw_values: list[str] = []
    for m in meds:
        if m.text:
            raw_values.append(m.text.strip())
        # Some implementations carry codes nested as eHistory.061
        for child in m:
            if child.text:
                raw_values.append(child.text.strip())

    # Channel 1: RxNorm code match (deterministic).
    for v in raw_values:
        if v in ANTICOAGULANT_RXNORM_CUIS:
            trace.add(
                field="anticoagulant_use", source="inferred", value=True,
                nemsis_path="eHistory.06", raw=v,
                notes=f"RxNorm CUI {v} matches anticoagulant list",
            )
            return True

    # Channel 2: substring match (catches free-text descriptions).
    haystack = " ".join(raw_values).lower()
    for needle in ANTICOAGULANT_STRINGS:
        if needle in haystack:
            trace.add(
                field="anticoagulant_use", source="inferred", value=True,
                nemsis_path="eHistory.06", raw=needle,
                notes=f"medication list contains {needle!r}",
            )
            return True

    trace.add(
        field="anticoagulant_use", source="extracted" if meds else "defaulted",
        value=False, nemsis_path="eHistory.06",
        notes="no anticoagulant code or substring matched"
        if meds
        else "no eHistory.06 entries; defaulted to False",
    )
    return False


def _extract_eta(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace,
    *, now: Optional[datetime] = None,
) -> int:
    """Infer ETA as max(0, eTimes.07 − now) in whole minutes.

    eTimes.07 is "Unit Arrived at Destination" in NEMSIS v3.5. While the unit
    is in transit it carries the receiving facility's *estimated* arrival time;
    after arrival it carries the actual. Either way, max(0, ...) gives us a
    sensible ETA that floors at 0 when the patient has already landed.

    `now` is injectable for deterministic tests. Production callers leave it
    None and we use UTC-now.
    """
    raw = _find_text(pcr, ns, "eTimes", "eTimes.07")
    if raw is None:
        trace.add(
            field="eta_minutes", source="defaulted", value=0,
            nemsis_path="eTimes.07",
            notes="no eTimes.07 (estimated/actual arrival) in PCR; defaulted to 0",
        )
        return 0
    parsed = _parse_iso_datetime(raw)
    if parsed is None:
        trace.add(
            field="eta_minutes", source="defaulted", value=0,
            nemsis_path="eTimes.07", raw=raw,
            notes=f"could not parse eTimes.07 timestamp {raw!r}; defaulted to 0",
        )
        return 0
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta_seconds = (parsed - reference).total_seconds()
    minutes = max(0, min(480, int(delta_seconds // 60)))
    trace.add(
        field="eta_minutes", source="inferred", value=minutes,
        nemsis_path="eTimes.07", raw=raw,
        notes=f"max(0, eTimes.07 − now) ≈ {minutes}m",
    )
    return minutes


def _parse_iso_datetime(raw: str) -> Optional[datetime]:
    """Parse a NEMSIS-style ISO 8601 timestamp; tolerate trailing Z."""
    cleaned = raw.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


def _extract_administered_med_signals(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace,
) -> dict[str, Optional[str]]:
    """Walk eMedications/eMedicationsGroup/eMedications.03 entries, looking for
    reversal agents (anticoagulant evidence) and hemorrhage-control meds (TXA).

    Returns a dict with two optional keys: ``reversal`` and ``hemorrhage_tx``.
    Each carries the matched RxNorm CUI or substring that triggered the hit,
    or None if nothing matched. The actual booleans flow into anticoagulant_use
    and presumed_hemorrhage downstream — this function only collects evidence
    and adds a single trace row when a signal fires.
    """
    e_meds = pcr.find(f"{ns}eMedications")
    if e_meds is None:
        # No administered meds at all — write one trace row so the absence is
        # visible. Field-level skip rather than per-channel skip to keep the
        # trace compact on minimal fixtures.
        trace.add(
            field="eMedications.03", source="skipped", value=None,
            nemsis_path="eMedications.03",
            notes="no eMedications section in PCR",
        )
        return {"reversal": None, "hemorrhage_tx": None}

    raw_values: list[str] = []
    for group in e_meds.findall(f"{ns}eMedicationsGroup"):
        for med in group.findall(f"{ns}eMedications.03"):
            if med.text:
                raw_values.append(med.text.strip())
            for child in med:
                if child.text:
                    raw_values.append(child.text.strip())
    # Some PCRs put eMedications.03 directly under eMedications without groups.
    for med in e_meds.findall(f"{ns}eMedications.03"):
        if med.text:
            raw_values.append(med.text.strip())

    cleaned = [v for v in raw_values if v]
    haystack = " ".join(cleaned).lower()

    reversal_hit: Optional[str] = None
    for v in cleaned:
        if v in REVERSAL_AGENT_RXNORM_CUIS:
            reversal_hit = v
            break
    if reversal_hit is None:
        for needle in REVERSAL_AGENT_STRINGS:
            if needle in haystack:
                reversal_hit = needle
                break

    hemorrhage_hit: Optional[str] = None
    for v in cleaned:
        if v in HEMORRHAGE_TX_RXNORM_CUIS:
            hemorrhage_hit = v
            break
    if hemorrhage_hit is None:
        for needle in HEMORRHAGE_TX_STRINGS:
            if needle in haystack:
                hemorrhage_hit = needle
                break

    if not cleaned:
        trace.add(
            field="eMedications.03", source="skipped", value=None,
            nemsis_path="eMedications.03",
            notes="eMedications present but no eMedications.03 entries",
        )
    else:
        if reversal_hit or hemorrhage_hit:
            hits = ", ".join(
                tag for tag in (
                    f"reversal={reversal_hit!r}" if reversal_hit else "",
                    f"hemorrhage_tx={hemorrhage_hit!r}" if hemorrhage_hit else "",
                ) if tag
            )
            trace.add(
                field="eMedications.03", source="extracted", value=hits,
                nemsis_path="eMedications.03",
                notes=f"administered meds matched: {hits}",
            )
        else:
            trace.add(
                field="eMedications.03", source="extracted", value=None,
                nemsis_path="eMedications.03",
                notes=f"{len(cleaned)} administered med(s); no reversal or hemorrhage-tx match",
            )

    return {"reversal": reversal_hit, "hemorrhage_tx": hemorrhage_hit}


def _extract_primary_impression_flags(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace,
) -> frozenset[str]:
    """Parse eSituation.07 (primary impression) ICD-10 → flag set.

    Returns a possibly-empty frozenset drawn from {"tbi", "ich", "spinal"}.
    Adds one trace row for the field whether or not it matched (so absence
    is visible in the audit). The flags then get OR'd into the inferred
    clinical bools downstream.
    """
    raw = _find_text(pcr, ns, "eSituation", "eSituation.07")
    if raw is None:
        trace.add(
            field="eSituation.07", source="skipped", value=None,
            nemsis_path="eSituation.07",
            notes="no eSituation.07 (primary impression) in PCR",
        )
        return frozenset()
    code = raw.strip().upper()

    # Longest-prefix match wins (S06.4 before S06).
    flags: frozenset[str] = frozenset()
    matched_prefix: Optional[str] = None
    for prefix, prefix_flags in sorted(
        ICD10_IMPRESSION_FLAGS, key=lambda x: -len(x[0])
    ):
        if code.startswith(prefix):
            flags = prefix_flags
            matched_prefix = prefix
            break

    if matched_prefix is None:
        trace.add(
            field="eSituation.07", source="extracted", value=None,
            nemsis_path="eSituation.07", raw=code,
            notes="primary impression present; no ICD-10 prefix matched",
        )
        return frozenset()

    trace.add(
        field="eSituation.07", source="extracted",
        value=sorted(flags), nemsis_path="eSituation.07", raw=code,
        notes=f"ICD-10 prefix {matched_prefix!r} → flags {sorted(flags)}",
    )
    return flags


def _extract_or_infer_activation(
    pcr: ET.Element, ns: str,
    gcs: int, sbp: int, mechanism: Mechanism, age: int,
    trace: NemsisConversionTrace,
) -> int:
    """Use eInjury.09 (CDC trauma triage criteria) when present, otherwise
    fall through to the physiology/mechanism inference."""
    e_injury = pcr.find(f"{ns}eInjury")
    codes: list[str] = []
    if e_injury is not None:
        # NEMSIS v3.5 wraps repeats in eInjuryGroup; some PCRs flatten to direct
        # children. Walk both layouts.
        scopes = [e_injury, *e_injury.findall(f"{ns}eInjuryGroup")]
        for scope in scopes:
            for el in scope.findall(f"{ns}eInjury.09"):
                if el.text:
                    codes.append(el.text.strip())
                for child in el:
                    if child.text:
                        codes.append(child.text.strip())
    codes = [c for c in codes if c]

    has_step12 = any(
        c in NEMSIS_TRIAGE_STEP1 or c in NEMSIS_TRIAGE_STEP2 for c in codes
    )
    has_step34 = any(
        c in NEMSIS_TRIAGE_STEP3 or c in NEMSIS_TRIAGE_STEP4 for c in codes
    )

    if has_step12:
        matched = next(
            c for c in codes
            if c in NEMSIS_TRIAGE_STEP1 or c in NEMSIS_TRIAGE_STEP2
        )
        trace.add(
            field="trauma_activation_level", source="extracted", value=1,
            nemsis_path="eInjury.09", raw=matched,
            notes=f"CDC Step 1/2 criterion {matched!r} on PCR → Level 1",
        )
        return 1
    if has_step34:
        matched = next(
            c for c in codes
            if c in NEMSIS_TRIAGE_STEP3 or c in NEMSIS_TRIAGE_STEP4
        )
        trace.add(
            field="trauma_activation_level", source="extracted", value=2,
            nemsis_path="eInjury.09", raw=matched,
            notes=f"CDC Step 3/4 criterion {matched!r} on PCR → Level 2",
        )
        return 2
    if codes:
        # eInjury.09 carried codes we don't recognize — note the skip and fall
        # through to physiology inference. Use 'skipped' so the downstream
        # 'inferred' row (added by _infer_activation_level) still carries the
        # canonical trauma_activation_level value.
        trace.add(
            field="eInjury.09", source="skipped", value=None,
            nemsis_path="eInjury.09",
            raw=", ".join(codes[:3]) + ("…" if len(codes) > 3 else ""),
            notes="eInjury.09 codes present but not in our triage table; using physiology inference",
        )
    return _infer_activation_level(gcs, sbp, mechanism, age, trace)


def _infer_activation_level(
    gcs: int, sbp: int, mechanism: Mechanism, age: int,
    trace: NemsisConversionTrace,
) -> int:
    """Infer trauma activation level using simplified CDC field triage criteria.

    Step 1 (physiology) → Level 1: GCS <= 13 OR SBP < 90.
    Step 2 (anatomy / mechanism) → Level 2: penetrating mechanisms (gsw, stab,
    blast, crush) OR (blunt MVC/fall AND age >= 55 — proxy for energy + frailty).
    Otherwise → Level 3.

    Citable but illustrative: real activation triggers vary by trauma center
    and don't reduce to four ints. The trace makes the rule visible.
    """
    if gcs <= 13 or sbp < 90:
        reason = (
            f"GCS<=13 ({gcs})" if gcs <= 13 else f"SBP<90 ({sbp})"
        )
        trace.add(
            field="trauma_activation_level", source="inferred", value=1,
            nemsis_path=None,
            notes=f"CDC Step 1 physiology: {reason} → Level 1",
        )
        return 1
    if mechanism in {"gsw", "stab", "blast", "crush"}:
        trace.add(
            field="trauma_activation_level", source="inferred", value=2,
            nemsis_path=None,
            notes=f"penetrating/crush mechanism ({mechanism}) → Level 2",
        )
        return 2
    if mechanism in {"blunt_mvc", "fall"} and age >= 55:
        trace.add(
            field="trauma_activation_level", source="inferred", value=2,
            nemsis_path=None,
            notes=f"high-energy blunt ({mechanism}) + age>=55 ({age}) → Level 2",
        )
        return 2
    trace.add(
        field="trauma_activation_level", source="inferred", value=3,
        nemsis_path=None,
        notes="no Step 1 / Step 2 criteria met → Level 3",
    )
    return 3


# ---------- inferred clinical flags ----------


def _infer_presumed_tbi(
    gcs: int, mechanism: Mechanism, trace: NemsisConversionTrace,
    impression_flags: frozenset[str] = frozenset(),
) -> bool:
    blunt = mechanism in {"blunt_mvc", "blunt_other", "fall", "head_strike"}
    physiology = gcs <= 13 and blunt
    impression = "tbi" in impression_flags
    val = physiology or impression
    if impression and not physiology:
        notes = (
            f"eSituation.07 primary impression flagged TBI → True "
            f"(physiology alone: GCS={gcs}, mechanism={mechanism})"
        )
        path: Optional[str] = "eSituation.07"
    elif impression and physiology:
        notes = (
            f"GCS<=13 ({gcs}) AND blunt mechanism ({mechanism}); "
            "eSituation.07 corroborates → True"
        )
        path = "eSituation.07"
    else:
        notes = (
            f"GCS<=13 ({gcs}) AND mechanism in blunt set ({mechanism}) → {val}"
        )
        path = None
    trace.add(
        field="presumed_tbi", source="inferred", value=val,
        nemsis_path=path, notes=notes,
    )
    return val


def _infer_presumed_hemorrhage(
    sbp: int, hr: int, mechanism: Mechanism, trace: NemsisConversionTrace,
    *, admin_hemorrhage_tx: Optional[str] = None,
) -> bool:
    physiology = sbp < 90 and hr > 110 and mechanism != "cardiac_arrest"
    val = physiology or bool(admin_hemorrhage_tx)
    if admin_hemorrhage_tx and not physiology:
        notes = (
            f"hemorrhage-tx med administered ({admin_hemorrhage_tx!r}) → True "
            f"(physiology alone: SBP={sbp}, HR={hr})"
        )
        path: Optional[str] = "eMedications.03"
    elif admin_hemorrhage_tx and physiology:
        notes = (
            f"SBP<90 ({sbp}) AND HR>110 ({hr}); "
            f"hemorrhage-tx med ({admin_hemorrhage_tx!r}) corroborates → True"
        )
        path = "eMedications.03"
    else:
        notes = f"SBP<90 ({sbp}) AND HR>110 ({hr}) AND non-cardiac → {val}"
        path = None
    trace.add(
        field="presumed_hemorrhage", source="inferred", value=val,
        nemsis_path=path, notes=notes,
    )
    return val


def _infer_presumed_ich(
    presumed_tbi: bool, gcs: int, trace: NemsisConversionTrace,
    impression_flags: frozenset[str] = frozenset(),
) -> bool:
    physiology = presumed_tbi and gcs <= 8
    impression = "ich" in impression_flags
    val = physiology or impression
    if impression and not physiology:
        notes = (
            f"eSituation.07 primary impression flagged ICH → True "
            f"(physiology alone: presumed_tbi={presumed_tbi}, GCS={gcs})"
        )
        path: Optional[str] = "eSituation.07"
    elif impression and physiology:
        notes = (
            f"presumed_tbi ({presumed_tbi}) AND GCS<=8 ({gcs}); "
            "eSituation.07 corroborates → True"
        )
        path = "eSituation.07"
    else:
        notes = f"presumed_tbi ({presumed_tbi}) AND GCS<=8 ({gcs}) → {val}"
        path = None
    trace.add(
        field="presumed_intracranial_hemorrhage", source="inferred", value=val,
        nemsis_path=path, notes=notes,
    )
    return val


def _infer_spinal_injury(
    mechanism: Mechanism, gcs: int, trace: NemsisConversionTrace,
    impression_flags: frozenset[str] = frozenset(),
) -> bool:
    physiology = mechanism in {"blunt_mvc", "fall"} and gcs <= 13
    impression = "spinal" in impression_flags
    val = physiology or impression
    if impression and not physiology:
        notes = (
            f"eSituation.07 primary impression flagged spinal injury → True "
            f"(physiology alone: mechanism={mechanism}, GCS={gcs})"
        )
        path: Optional[str] = "eSituation.07"
    elif impression and physiology:
        notes = (
            f"mechanism in {{blunt_mvc, fall}} ({mechanism}) AND GCS<=13 ({gcs}); "
            "eSituation.07 corroborates → True"
        )
        path = "eSituation.07"
    else:
        notes = (
            f"mechanism in {{blunt_mvc, fall}} ({mechanism}) AND GCS<=13 ({gcs}) → {val}"
        )
        path = None
    trace.add(
        field="spinal_injury_suspected", source="inferred", value=val,
        nemsis_path=path, notes=notes,
    )
    return val
