"""traumatrial-match — real-time trauma trial eligibility matching engine."""

from traumatrial_match.schema import (
    Patient,
    Trial,
    Rule,
    MatchResult,
    ClauseTrace,
    PATIENT_FIELDS,
    PATIENT_FIELD_TYPES,
    OPERATORS,
)
from traumatrial_match.match import match, match_all

__version__ = "0.0.1"

__all__ = [
    "Patient",
    "Trial",
    "Rule",
    "MatchResult",
    "ClauseTrace",
    "PATIENT_FIELDS",
    "PATIENT_FIELD_TYPES",
    "OPERATORS",
    "match",
    "match_all",
    "__version__",
]
