"""NEMSIS v3.5 ePCR XML → Patient adapter.

Converts a NEMSIS v3.5 PatientCareReport into the engine's structured Patient
record, plus a field-by-field NemsisConversionTrace explaining where each
value came from (extracted / inferred / defaulted / skipped).

This is a deliberately small adapter. ~10 high-signal eFields are mapped
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
    patient, trace = from_nemsis_xml(xml_str)
    for line in trace.summary_lines():
        print(line)
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from traumatrial_match.schema import Mechanism, Patient, PregnancyStatus, Sex


# NEMSIS code lists — partial, illustrative. Full list at https://nemsis.org/standards/v350/.
# These cover the codes our 8 personas would plausibly carry.
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
# substring match — illustrative, not RxNorm-strict.
ANTICOAGULANT_STRINGS = (
    "warfarin", "coumadin",
    "apixaban", "eliquis",
    "rivaroxaban", "xarelto",
    "dabigatran", "pradaxa",
    "edoxaban", "savaysa",
    "heparin", "enoxaparin", "lovenox",
)


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


# ---------- public entry point ----------


def from_nemsis_xml(
    xml_str: str, *, patient_id: Optional[str] = None
) -> tuple[Patient, NemsisConversionTrace]:
    """Convert a NEMSIS v3.5 PatientCareReport XML into a Patient + trace.

    The Patient returned is always valid (pydantic enforces this). Fields
    without a NEMSIS source are defaulted with a clear note in the trace.
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
    anticoagulant_use = _extract_anticoagulant(pcr, ns, trace)
    eta_minutes = _extract_eta(pcr, ns, trace)
    activation = _extract_activation(pcr, ns, trace)

    # Inferred clinical flags. None of these are canonical NEMSIS fields —
    # the trace makes the inference rule visible.
    presumed_tbi = _infer_presumed_tbi(gcs, mechanism, trace)
    presumed_hemorrhage = _infer_presumed_hemorrhage(sbp, hr, mechanism, trace)
    presumed_ich = _infer_presumed_ich(presumed_tbi, gcs, trace)
    spinal_injury = _infer_spinal_injury(mechanism, gcs, trace)

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
    return patient, trace


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
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> bool:
    e_history = pcr.find(f"{ns}eHistory")
    if e_history is None:
        trace.add(
            field="anticoagulant_use", source="defaulted", value=False,
            nemsis_path="eHistory.06", notes="no eHistory; defaulted to False",
        )
        return False
    # eHistory.06 (medications) often appears multiple times.
    meds = e_history.findall(f"{ns}eHistory.06")
    haystack = " ".join((m.text or "") for m in meds).lower()
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
        notes="no anticoagulant substring matched"
        if meds
        else "no eHistory.06 entries; defaulted to False",
    )
    return False


def _extract_eta(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> int:
    # ETA isn't a single NEMSIS field — it's the delta between current time
    # and eTimes.07 (arrival at destination) when known. For v0 we skip;
    # downstream logic can override.
    trace.add(
        field="eta_minutes", source="defaulted", value=0,
        nemsis_path="eTimes.07",
        notes="ETA inference (current time - estimated arrival) is out of scope for v0; defaulted to 0",
    )
    return 0


def _extract_activation(
    pcr: ET.Element, ns: str, trace: NemsisConversionTrace
) -> int:
    # Trauma activation level isn't a clean single NEMSIS field across
    # implementations. Default to level 2 with a note.
    trace.add(
        field="trauma_activation_level", source="defaulted", value=2,
        nemsis_path=None,
        notes="no canonical NEMSIS activation field in v0 mapping; defaulted to level 2",
    )
    return 2


# ---------- inferred clinical flags ----------


def _infer_presumed_tbi(
    gcs: int, mechanism: Mechanism, trace: NemsisConversionTrace
) -> bool:
    blunt = mechanism in {"blunt_mvc", "blunt_other", "fall", "head_strike"}
    val = gcs <= 13 and blunt
    trace.add(
        field="presumed_tbi", source="inferred", value=val,
        nemsis_path=None,
        notes=f"GCS<=13 ({gcs}) AND mechanism in blunt set ({mechanism}) → {val}",
    )
    return val


def _infer_presumed_hemorrhage(
    sbp: int, hr: int, mechanism: Mechanism, trace: NemsisConversionTrace
) -> bool:
    val = sbp < 90 and hr > 110 and mechanism != "cardiac_arrest"
    trace.add(
        field="presumed_hemorrhage", source="inferred", value=val,
        nemsis_path=None,
        notes=f"SBP<90 ({sbp}) AND HR>110 ({hr}) AND non-cardiac → {val}",
    )
    return val


def _infer_presumed_ich(
    presumed_tbi: bool, gcs: int, trace: NemsisConversionTrace
) -> bool:
    val = presumed_tbi and gcs <= 8
    trace.add(
        field="presumed_intracranial_hemorrhage", source="inferred", value=val,
        nemsis_path=None,
        notes=f"presumed_tbi ({presumed_tbi}) AND GCS<=8 ({gcs}) → {val}",
    )
    return val


def _infer_spinal_injury(
    mechanism: Mechanism, gcs: int, trace: NemsisConversionTrace
) -> bool:
    val = mechanism in {"blunt_mvc", "fall"} and gcs <= 13
    trace.add(
        field="spinal_injury_suspected", source="inferred", value=val,
        nemsis_path=None,
        notes=f"mechanism in {{blunt_mvc, fall}} ({mechanism}) AND GCS<=13 ({gcs}) → {val}",
    )
    return val
