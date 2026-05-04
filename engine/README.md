# traumatrial-match

Open infrastructure for trauma trial eligibility matching. Evaluates structured trauma trial inclusion/exclusion rules against patient records in <100ms with clause-level reasoning trace.

MIT licensed. Synthetic data only — never PHI. Pure-Python core; pydantic for validation.

## 60-second example

```python
from traumatrial_match import Patient, Trial, Rule, match

patient = Patient(
    patient_id="P-001",
    age_years=34,
    sex="M",
    gcs=7,
    sbp_mmhg=82,
    hr_bpm=128,
    mechanism="blunt_mvc",
    trauma_activation_level=1,
    eta_minutes=4,
    pregnancy_status="not_applicable",
    anticoagulant_use=False,
    presumed_tbi=True,
    presumed_hemorrhage=True,
    presumed_intracranial_hemorrhage=False,
    spinal_injury_suspected=False,
)

trial = Trial(
    trial_id="NCT05638581",
    short_name="TROOP",
    title="Trauma Resuscitation With Low-Titer Group O Whole Blood",
    requires_efic=True,
    inclusion=[
        Rule(field="age_years", op="gte", value=15, hard=True),
        Rule(field="presumed_hemorrhage", op="eq", value=True, hard=True),
        Rule(field="trauma_activation_level", op="lte", value=1, hard=False),
    ],
    exclusion=[
        Rule(field="pregnancy_status", op="in",
             value=["pregnant", "unknown_could_be_pregnant"], hard=True),
    ],
)

result = match(patient, trial)
print(result.eligible, result.confidence)
# True 1.0
for clause in result.trace:
    mark = "HIT" if clause.hit else "MISS"
    print(f"  [{mark}] {clause.clause}  patient={clause.patient_value}")
```

## What's in the box

- **`Patient`** — pydantic model for a trauma bay patient snapshot.
- **`Trial`** — pydantic model for a trial's structured eligibility rules.
- **`Rule`** — a single inclusion or exclusion clause: field + operator + value + hard/soft.
- **`MatchResult`** — eligibility, confidence, and a complete clause-level reasoning trace.
- **`match(patient, trial)`** — evaluate one patient against one trial.
- **`match_all(patient, trials)`** — evaluate against many; sorted eligible-first, confidence desc.

## Operators (8)

`eq`, `ne`, `gte`, `lte`, `gt`, `lt`, `in`, `not_in`.

`in` and `not_in` require a list value; the others require a scalar.

## Confidence rubric

- Any **hard inclusion missed** OR any **hard exclusion hit** → `eligible=False`, `confidence=0.0`.
- Otherwise → `eligible=True`. `confidence = soft_inclusion_hits / soft_inclusion_total`, or `1.0` if no soft inclusions.

The categorical signal is `eligible: bool`; magnitude is `confidence: float`. There is no `HIGH/MEDIUM/LOW` enum.

## Bundled corpus

The repo ships with 5 verified active trauma trials (TROOP, SWiFTCanada, ICECAP, SELECT-TBI, AEDH-MT) and 8 patient personas covering hemorrhage, TBI, anticoagulation, pregnancy exclusion, cardiac arrest, and pediatric exclusion. See `trials/` and `patients/`.

These are hand-written from the public clinicaltrials.gov criteria. **They are an approximation, not a clinical decision system.** PRs welcome that improve fidelity, add trials, or extend the operator vocabulary.

## Install (dev)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
pytest
```

## Run the precompute script

This generates the static match payloads consumed by the Next.js demo in `../demo/`.

```bash
python scripts/precompute.py
```

## What this is NOT

- Not a clinical decision-support system.
- Not validated against real patient data.
- Not regulated, not certified, not BAA-able.
- Not a substitute for a research coordinator's clinical judgment.

It is a structured, testable, transparent **starting point** for talking about how trauma trial matching could be automated. Treat it that way.

## Contributing

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md). PRs and issues welcome — particularly from trauma research coordinators, EMS data SMEs, and clinical trial operations folks who can tell us where the schema is wrong.

## License

MIT. See `../LICENSE`.
