"""End-to-end matching behavior — eligibility, confidence rubric, reasoning trace."""

import pytest

from traumatrial_match import Patient, Rule, Trial, match


def _patient(**overrides) -> Patient:
    base = dict(
        patient_id="P-test",
        age_years=30,
        sex="M",
        gcs=10,
        sbp_mmhg=110,
        hr_bpm=100,
        mechanism="blunt_mvc",
        trauma_activation_level=1,
        eta_minutes=5,
        pregnancy_status="not_applicable",
        anticoagulant_use=False,
        presumed_tbi=False,
        presumed_hemorrhage=False,
        presumed_intracranial_hemorrhage=False,
        spinal_injury_suspected=False,
    )
    base.update(overrides)
    return Patient(**base)


def _trial(inclusion=None, exclusion=None) -> Trial:
    return Trial(
        trial_id="NCT-test",
        short_name="TEST",
        title="Test Trial",
        requires_efic=False,
        inclusion=inclusion or [],
        exclusion=exclusion or [],
    )


def test_no_rules_means_eligible_with_full_confidence():
    res = match(_patient(), _trial())
    assert res.eligible is True
    assert res.confidence == 1.0
    assert res.trace == []


def test_hard_inclusion_missed_means_ineligible():
    trial = _trial(
        inclusion=[Rule(field="age_years", op="gte", value=18, hard=True)]
    )
    res = match(_patient(age_years=15), trial)
    assert res.eligible is False
    assert res.confidence == 0.0
    assert len(res.trace) == 1
    assert res.trace[0].hit is False


def test_hard_exclusion_hit_means_ineligible():
    trial = _trial(
        exclusion=[Rule(field="anticoagulant_use", op="eq", value=True, hard=True)]
    )
    res = match(_patient(anticoagulant_use=True), trial)
    assert res.eligible is False
    assert res.confidence == 0.0


def test_all_hard_passing_no_soft_means_full_confidence():
    trial = _trial(
        inclusion=[
            Rule(field="age_years", op="gte", value=18, hard=True),
            Rule(field="presumed_hemorrhage", op="eq", value=True, hard=True),
        ]
    )
    res = match(_patient(presumed_hemorrhage=True), trial)
    assert res.eligible is True
    assert res.confidence == 1.0


def test_soft_partial_hits_yield_fractional_confidence():
    trial = _trial(
        inclusion=[
            Rule(field="age_years", op="gte", value=18, hard=True),
            Rule(field="trauma_activation_level", op="lte", value=1, hard=False),
            Rule(field="eta_minutes", op="lte", value=3, hard=False),
        ]
    )
    p = _patient(trauma_activation_level=1, eta_minutes=5)
    res = match(p, trial)
    assert res.eligible is True
    assert res.confidence == pytest.approx(0.5)


def test_soft_inclusion_doesnt_block_eligibility():
    trial = _trial(
        inclusion=[Rule(field="eta_minutes", op="lte", value=3, hard=False)]
    )
    res = match(_patient(eta_minutes=10), trial)
    assert res.eligible is True
    assert res.confidence == 0.0


def test_soft_exclusion_does_not_change_eligibility_or_confidence():
    """Soft exclusions are recorded in the trace but don't affect scoring in v0."""
    trial = _trial(
        exclusion=[Rule(field="spinal_injury_suspected", op="eq", value=True, hard=False)]
    )
    res = match(_patient(spinal_injury_suspected=True), trial)
    assert res.eligible is True
    assert res.confidence == 1.0
    assert len(res.trace) == 1
    assert res.trace[0].hit is True


def test_trace_contains_every_clause_even_after_hard_fail():
    """Coordinators need to see all the reasoning, not stop at the first miss."""
    trial = _trial(
        inclusion=[
            Rule(field="age_years", op="gte", value=18, hard=True),
            Rule(field="presumed_hemorrhage", op="eq", value=True, hard=True),
        ],
        exclusion=[Rule(field="pregnancy_status", op="eq", value="pregnant", hard=True)],
    )
    res = match(_patient(age_years=15, presumed_hemorrhage=False, pregnancy_status="pregnant"), trial)
    assert res.eligible is False
    assert len(res.trace) == 3


def test_in_operator_with_list_value():
    trial = _trial(
        inclusion=[Rule(field="mechanism", op="in", value=["gsw", "stab", "blast"], hard=True)]
    )
    assert match(_patient(mechanism="gsw"), trial).eligible is True
    assert match(_patient(mechanism="fall"), trial).eligible is False


def test_clause_text_renders_field_op_value():
    trial = _trial(inclusion=[Rule(field="gcs", op="lte", value=8, hard=True)])
    res = match(_patient(gcs=14), trial)
    assert "gcs lte 8" in res.trace[0].clause


def test_match_result_is_pydantic_serializable():
    """The MatchResult must round-trip through JSON for the demo's pre-compute step."""
    trial = _trial(inclusion=[Rule(field="age_years", op="gte", value=18, hard=True)])
    res = match(_patient(), trial)
    payload = res.model_dump_json()
    assert "patient_id" in payload
    assert "trace" in payload


def test_rule_rejects_string_for_int_field():
    """The schema is the contract — LLM-invented enum strings on int fields fail loudly."""
    with pytest.raises(Exception):
        Rule(
            field="trauma_activation_level",
            op="eq",
            value="massive_hemorrhage_protocol",
            hard=True,
        )


def test_rule_rejects_bool_for_enum_field():
    """pregnancy_status is an enum string; passing True fails fast."""
    with pytest.raises(Exception):
        Rule(field="pregnancy_status", op="eq", value=True, hard=True)


def test_rule_rejects_unknown_enum_value():
    """Unknown mechanism values like 'spaceship_collision' must be rejected."""
    with pytest.raises(Exception):
        Rule(field="mechanism", op="eq", value="spaceship_collision", hard=True)


def test_rule_rejects_int_out_of_range():
    """gcs is bounded 3-15; a value of 42 is wrong on its face."""
    with pytest.raises(Exception):
        Rule(field="gcs", op="lte", value=42, hard=True)


def test_rule_accepts_valid_enum_in_list():
    """The `in` operator must validate every list element against the field type."""
    rule = Rule(
        field="mechanism",
        op="in",
        value=["gsw", "stab"],
        hard=True,
    )
    assert rule.value == ["gsw", "stab"]


def test_rule_rejects_invalid_enum_in_list():
    """One bad element in an `in` list is enough to fail."""
    with pytest.raises(Exception):
        Rule(
            field="mechanism",
            op="in",
            value=["gsw", "made_up_mechanism"],
            hard=True,
        )


def test_rule_rejects_empty_list_for_in():
    """An `in` rule with an empty list is a coding error, not a valid spec."""
    with pytest.raises(Exception):
        Rule(field="mechanism", op="in", value=[], hard=True)
