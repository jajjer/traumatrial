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
    eta_minutes: int = Field(ge=0, le=240)
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
    def _value_for_in_ops_must_be_list(cls, v: Any, info: Any) -> Any:
        op = info.data.get("op")
        if op in ("in", "not_in") and not isinstance(v, list):
            raise ValueError(f"operator {op!r} requires value to be a list")
        if op not in ("in", "not_in") and isinstance(v, list):
            raise ValueError(f"operator {op!r} cannot take a list value")
        return v


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
