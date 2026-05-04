"""One test per supported operator. These are the contract tests for the engine."""

import pytest

from traumatrial_match.match import _evaluate
from traumatrial_match.schema import OPERATORS


def test_all_operators_documented_match_implementation():
    """The OPERATORS tuple must match what _evaluate handles."""
    expected = {"eq", "ne", "gte", "lte", "gt", "lt", "in", "not_in"}
    assert set(OPERATORS) == expected


def test_eq():
    assert _evaluate("eq", 18, 18) is True
    assert _evaluate("eq", 17, 18) is False
    assert _evaluate("eq", "M", "M") is True


def test_ne():
    assert _evaluate("ne", "pregnant", "not_applicable") is True
    assert _evaluate("ne", True, True) is False


def test_gte():
    assert _evaluate("gte", 18, 18) is True
    assert _evaluate("gte", 19, 18) is True
    assert _evaluate("gte", 17, 18) is False


def test_lte():
    assert _evaluate("lte", 8, 8) is True
    assert _evaluate("lte", 7, 8) is True
    assert _evaluate("lte", 9, 8) is False


def test_gt():
    assert _evaluate("gt", 19, 18) is True
    assert _evaluate("gt", 18, 18) is False


def test_lt():
    assert _evaluate("lt", 89, 90) is True
    assert _evaluate("lt", 90, 90) is False


def test_in():
    assert _evaluate("in", "gsw", ["gsw", "stab", "blast"]) is True
    assert _evaluate("in", "fall", ["gsw", "stab", "blast"]) is False


def test_not_in():
    assert _evaluate("not_in", "fall", ["gsw", "stab", "blast"]) is True
    assert _evaluate("not_in", "gsw", ["gsw", "stab", "blast"]) is False


def test_none_patient_value_never_satisfies():
    """Missing patient data should miss every clause, not silently match."""
    for op in OPERATORS:
        rule_value = [1, 2] if op in ("in", "not_in") else 1
        assert _evaluate(op, None, rule_value) is False


def test_unknown_operator_raises():
    with pytest.raises(ValueError):
        _evaluate("approximately", 1, 1)
