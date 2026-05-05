# traumatrial-match

Open infrastructure for trauma trial eligibility matching. Evaluates structured trauma trial inclusion/exclusion rules against patient records in <100ms with clause-level reasoning trace.

[![PyPI](https://img.shields.io/pypi/v/traumatrial-match.svg)](https://pypi.org/project/traumatrial-match/)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![demo](https://img.shields.io/badge/live%20demo-traumatrial.vercel.app-rose)](https://traumatrial.vercel.app)

```bash
pip install traumatrial-match
```

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
- **`from_nemsis_xml(xml_str)`** — convert a NEMSIS v3.5 ePCR XML into `(Patient, NemsisConversionTrace)`. The trace records each Patient field as `extracted` / `inferred` / `defaulted` / `skipped` with a one-line reason. v0 mapping covers ~10 high-signal eFields; everything else is honestly defaulted. See `traumatrial_match/nemsis.py`.

## Operators (8)

`eq`, `ne`, `gte`, `lte`, `gt`, `lt`, `in`, `not_in`.

`in` and `not_in` require a list value; the others require a scalar.

## Confidence rubric

- Any **hard inclusion missed** OR any **hard exclusion hit** → `eligible=False`, `confidence=0.0`.
- Otherwise → `eligible=True`. `confidence = soft_inclusion_hits / soft_inclusion_total`, or `1.0` if no soft inclusions.

The categorical signal is `eligible: bool`; magnitude is `confidence: float`. There is no `HIGH/MEDIUM/LOW` enum.

## Bundled corpus

The repo ships with 15 verified active recruiting trauma trials (TROOP, SWiFTCanada, ICECAP, SELECT-TBI, AEDH-MT, BOOST3, WEBSTER, FIT-BRAIN, Ketamine-TBI, ELASTIC, INDICT, AFISTBI, Baricitinib-TBI, FEISTY II, CAVALIER) and 8 patient personas covering hemorrhage, TBI, anticoagulation, pregnancy exclusion, cardiac arrest, and pediatric exclusion. See `trials/` and `patients/`.

These are hand-written from the public clinicaltrials.gov criteria. **They are an approximation, not a clinical decision system.** PRs welcome that improve fidelity, add trials, or extend the operator vocabulary.

## Install (released)

```bash
pip install traumatrial-match
```

## Install (dev, from source)

```bash
git clone https://github.com/jajjer/traumatrial.git
cd traumatrial/engine
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
pytest
```

## Run the precompute script

This generates the static match payloads consumed by the Next.js demo in `../demo/`.

```bash
python scripts/precompute.py
```

## End-to-end round trip from a NEMSIS ePCR

Take a NEMSIS v3.5 PatientCareReport XML in, get a structured Patient out, match it against the bundled corpus, and print the full reasoning to stdout. This is the script you point a research coordinator at when they ask "what does this engine actually do with one of our exports?"

```bash
python scripts/demo_round_trip.py tests/fixtures/nemsis/realistic-mva-polytrauma.xml
```

The output has three sections: the parsed Patient, a field-by-field conversion trace (every value labelled `extracted` / `inferred` / `defaulted`), and the eligible-trial list with EFIC flags and skipped-criteria counts. The bundled `realistic-mva-polytrauma.xml` is a synthetic, multi-section ePCR (eDispatch / eResponse / eScene / eVitals progression / eHistory / eMedications / eProcedures / eNarrative / eDisposition) — a polytrauma adult with deteriorating vitals — and it currently surfaces 33 eligible trials.

## Auto-import a trial from clinicaltrials.gov

Watch a real trial become structured rules in 10 seconds. Fetches the trial from clinicaltrials.gov, sends the inclusion/exclusion text to Claude with our schema as the contract, validates the response with pydantic, and writes a `engine/trials/NCT….json`. If a criterion can't be expressed in our 8-operator vocabulary, it goes into `_metadata.skipped_criteria` instead of being silently dropped.

```bash
pip install -e ".[parse]"
export ANTHROPIC_API_KEY=sk-ant-...   # or put it in a .env at the repo root
python scripts/parse_trial.py NCT05638581
python scripts/parse_trial.py NCT05638581 NCT04217551 NCT04995068 --overwrite
```

**The schema is the constraint that keeps the LLM honest.** Field types (int / bool / enum) and value ranges are injected into the system prompt, AND validated at load time by `Rule._value_must_match_field_type`. A hallucinated value like `trauma_activation_level eq "massive_hemorrhage_protocol"` (the LLM's first attempt at TROOP) fails pydantic validation, which feeds the error back to the model for a retry. Up to 3 attempts before giving up.

Always hand-review the generated JSON before committing — the LLM is good but not perfect. Look for `gte` vs `gt` off-by-ones, soft-vs-hard misclassifications, and the `_metadata.skipped_criteria` list for things that need a schema extension.

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
