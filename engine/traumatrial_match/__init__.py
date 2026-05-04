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
from traumatrial_match.nemsis import (
    FieldExtraction,
    NemsisConversionTrace,
    NemsisParseError,
    from_nemsis_xml,
)

__version__ = "0.0.2"

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
    "from_nemsis_xml",
    "NemsisConversionTrace",
    "FieldExtraction",
    "NemsisParseError",
    "__version__",
]
