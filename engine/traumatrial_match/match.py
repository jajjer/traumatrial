"""The matching engine.

Evaluates a Patient against a Trial's structured rules and returns a MatchResult
with eligibility, confidence, and a clause-level reasoning trace.

Confidence rubric (single coherent path):
- Any hard inclusion missed OR any hard exclusion hit -> eligible=false, confidence=0.0
- Otherwise eligible=true; confidence = soft_inclusion_hits / soft_inclusion_total
  (or 1.0 if there are zero soft inclusions).
"""

from __future__ import annotations

from typing import Any, Iterable

from traumatrial_match.schema import (
    ClauseTrace,
    MatchResult,
    Patient,
    Rule,
    Trial,
)


def _evaluate(op: str, patient_value: Any, rule_value: Any) -> bool:
    """Apply one of the 8 supported operators. Returns True if the clause holds."""
    if patient_value is None:
        return False
    if op == "eq":
        return patient_value == rule_value
    if op == "ne":
        return patient_value != rule_value
    if op == "gte":
        return patient_value >= rule_value
    if op == "lte":
        return patient_value <= rule_value
    if op == "gt":
        return patient_value > rule_value
    if op == "lt":
        return patient_value < rule_value
    if op == "in":
        return patient_value in rule_value
    if op == "not_in":
        return patient_value not in rule_value
    raise ValueError(f"unsupported operator: {op!r}")


def _format_value(v: Any) -> str:
    if isinstance(v, list):
        if len(v) <= 3:
            return "[" + ", ".join(repr(x) for x in v) + "]"
        return "[" + ", ".join(repr(x) for x in v[:3]) + ", ...]"
    return repr(v)


def _clause_text(rule: Rule) -> str:
    return f"{rule.field} {rule.op} {_format_value(rule.value)}"


def _trace_one(
    rule: Rule, kind: str, patient: Patient
) -> tuple[ClauseTrace, bool]:
    patient_value = getattr(patient, rule.field, None)
    hit = _evaluate(rule.op, patient_value, rule.value)
    trace = ClauseTrace(
        clause=_clause_text(rule),
        kind=kind,  # type: ignore[arg-type]
        hard=rule.hard,
        hit=hit,
        patient_value=patient_value,
    )
    return trace, hit


def match(patient: Patient, trial: Trial) -> MatchResult:
    """Evaluate one patient against one trial. Returns a complete MatchResult.

    The trace always contains every clause, even after a hard fail, so the UI
    can show coordinators exactly why the match landed where it did.
    """
    trace: list[ClauseTrace] = []
    hard_fail = False
    soft_total = 0
    soft_hits = 0

    for rule in trial.inclusion:
        ct, hit = _trace_one(rule, "inclusion", patient)
        trace.append(ct)
        if rule.hard:
            if not hit:
                hard_fail = True
        else:
            soft_total += 1
            if hit:
                soft_hits += 1

    for rule in trial.exclusion:
        ct, hit = _trace_one(rule, "exclusion", patient)
        trace.append(ct)
        if rule.hard and hit:
            hard_fail = True

    if hard_fail:
        return MatchResult(
            patient_id=patient.patient_id,
            trial_id=trial.trial_id,
            eligible=False,
            confidence=0.0,
            trace=trace,
        )

    confidence = 1.0 if soft_total == 0 else soft_hits / soft_total
    return MatchResult(
        patient_id=patient.patient_id,
        trial_id=trial.trial_id,
        eligible=True,
        confidence=confidence,
        trace=trace,
    )


def match_all(
    patient: Patient, trials: Iterable[Trial]
) -> list[MatchResult]:
    """Evaluate one patient against many trials. Eligible-first, then by confidence desc."""
    results = [match(patient, t) for t in trials]
    results.sort(key=lambda r: (not r.eligible, -r.confidence))
    return results
