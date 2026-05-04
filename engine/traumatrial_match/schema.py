"""Schemas for patient records, trial rules, and match results.

The Patient and Trial schemas are the OSS contract. The MatchResult schema is
the engine's output. Field names in Rule.field must be members of PATIENT_FIELDS.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field, field_validator

Mechanism = Literal[
    "blunt_mvc",
    "blunt_other",
    "fall",
    "gsw",
    "stab",
    "blast",
    "burn",
    "cardiac_arrest",
    "head_strike",
    "crush",
    "other",
]

PregnancyStatus = Literal[
    "not_applicable",
    "not_pregnant",
    "pregnant",
    "unknown_could_be_pregnant",
]

Sex = Literal["M", "F", "U"]

Operator = Literal["eq", "ne", "gte", "lte", "gt", "lt", "in", "not_in"]
OPERATORS: tuple[str, ...] = (
    "eq",
    "ne",
    "gte",
    "lte",
    "gt",
    "lt",
    "in",
    "not_in",
)

PatientField = Literal[
    "age_years",
    "sex",
    "gcs",
    "sbp_mmhg",
    "hr_bpm",
    "mechanism",
    "trauma_activation_level",
    "eta_minutes",
    "pregnancy_status",
    "anticoagulant_use",
    "presumed_tbi",
    "presumed_hemorrhage",
    "presumed_intracranial_hemorrhage",
    "spinal_injury_suspected",
]
PATIENT_FIELDS: tuple[str, ...] = (
    "age_years",
    "sex",
    "gcs",
    "sbp_mmhg",
    "hr_bpm",
    "mechanism",
    "trauma_activation_level",
    "eta_minutes",
    "pregnancy_status",
    "anticoagulant_use",
    "presumed_tbi",
    "presumed_hemorrhage",
    "presumed_intracranial_hemorrhage",
    "spinal_injury_suspected",
)

# Field-type metadata used to validate Rule values at load time. The LLM-driven
# parser uses this to constrain its output; the Rule validator uses it to catch
# garbage early (string compared to an int field, etc.) instead of at match time.
PATIENT_FIELD_TYPES: dict[str, dict[str, Any]] = {
    "age_years": {"type": "int", "range": [0, 120]},
    "sex": {"type": "enum", "values": ["M", "F", "U"]},
    "gcs": {"type": "int", "range": [3, 15]},
    "sbp_mmhg": {"type": "int", "range": [0, 300]},
    "hr_bpm": {"type": "int", "range": [0, 300]},
    "mechanism": {
        "type": "enum",
        "values": [
            "blunt_mvc", "blunt_other", "fall", "gsw", "stab", "blast",
            "burn", "cardiac_arrest", "head_strike", "crush", "other",
        ],
    },
    "trauma_activation_level": {"type": "int", "range": [1, 3]},
    "eta_minutes": {"type": "int", "range": [0, 480]},
    "pregnancy_status": {
        "type": "enum",
        "values": [
            "not_applicable", "not_pregnant", "pregnant",
            "unknown_could_be_pregnant",
        ],
    },
    "anticoagulant_use": {"type": "bool"},
    "presumed_tbi": {"type": "bool"},
    "presumed_hemorrhage": {"type": "bool"},
    "presumed_intracranial_hemorrhage": {"type": "bool"},
    "spinal_injury_suspected": {"type": "bool"},
}


class Patient(BaseModel):
    """A trauma bay patient snapshot. Synthetic only; never PHI."""

    patient_id: str
    age_years: int = Field(ge=0, le=120)
    sex: Sex
    gcs: int = Field(ge=3, le=15)
    sbp_mmhg: int = Field(ge=0, le=300)
    hr_bpm: int = Field(ge=0, le=300)
    mechanism: Mechanism
    trauma_activation_level: int = Field(ge=1, le=3, description="1 = highest acuity")
    eta_minutes: int = Field(ge=0, le=480)
    pregnancy_status: PregnancyStatus
    anticoagulant_use: bool
    presumed_tbi: bool
    presumed_hemorrhage: bool
    presumed_intracranial_hemorrhage: bool
    spinal_injury_suspected: bool


class Rule(BaseModel):
    """A single inclusion or exclusion clause."""

    field: PatientField
    op: Operator
    value: Union[int, float, str, bool, list[Any]]
    hard: bool

    @field_validator("value")
    @classmethod
    def _value_must_match_field_type(cls, v: Any, info: Any) -> Any:
        op = info.data.get("op")
        field = info.data.get("field")

        # Operator/value shape must agree
        if op in ("in", "not_in"):
            if not isinstance(v, list):
                raise ValueError(f"operator {op!r} requires value to be a list")
            if not v:
                raise ValueError(f"operator {op!r} requires a non-empty list")
        elif isinstance(v, list):
            raise ValueError(f"operator {op!r} cannot take a list value")

        # Field/value type must agree (the schema is the contract; bad values
        # like trauma_activation_level eq "massive_hemorrhage_protocol" should
        # fail at load time, not silently never-match at runtime).
        if field is None:
            return v
        meta = PATIENT_FIELD_TYPES.get(field)
        if meta is None:
            return v

        scalars = v if isinstance(v, list) else [v]
        for scalar in scalars:
            _check_scalar_for_field(field, scalar, meta)
        return v


def _check_scalar_for_field(field: str, value: Any, meta: dict[str, Any]) -> None:
    kind = meta["type"]
    if kind == "bool":
        if not isinstance(value, bool):
            raise ValueError(
                f"field {field!r} expects a bool; got {type(value).__name__} {value!r}"
            )
    elif kind == "int":
        # bool is a subclass of int in Python — exclude it explicitly
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(
                f"field {field!r} expects an int; got {type(value).__name__} {value!r}"
            )
        lo, hi = meta["range"]
        if not lo <= value <= hi:
            raise ValueError(
                f"field {field!r} value {value} out of range [{lo}, {hi}]"
            )
    elif kind == "enum":
        if not isinstance(value, str):
            raise ValueError(
                f"field {field!r} expects a string from {meta['values']!r}; "
                f"got {type(value).__name__} {value!r}"
            )
        if value not in meta["values"]:
            raise ValueError(
                f"field {field!r} value {value!r} not in allowed values {meta['values']!r}"
            )


class Trial(BaseModel):
    """A clinical trial's structured eligibility rules."""

    trial_id: str = Field(description="NCT ID")
    short_name: str
    title: str
    requires_efic: bool
    phase: str = Field(default="?")
    inclusion: list[Rule] = Field(default_factory=list)
    exclusion: list[Rule] = Field(default_factory=list)


class ClauseTrace(BaseModel):
    """One clause's evaluation result, used to build the reasoning trace."""

    clause: str
    kind: Literal["inclusion", "exclusion"]
    hard: bool
    hit: bool
    patient_value: Any


class MatchResult(BaseModel):
    """Output of evaluating one Patient against one Trial."""

    patient_id: str
    trial_id: str
    eligible: bool
    confidence: float = Field(ge=0.0, le=1.0)
    trace: list[ClauseTrace]
