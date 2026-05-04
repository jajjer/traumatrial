# Contributing to traumatrial

Issues, PRs, and pointed criticism welcome. Especially from people who have worked the trauma bay or run a trial enrollment desk.

## What we're looking for

- **Schema fidelity.** The patient and rule schemas in `engine/traumatrial_match/schema.py` are an opinionated v0. If the schema doesn't represent something a real coordinator needs to make a decision, that's a bug. Open an issue.
- **Trial corpus expansion.** New trial JSONs in `engine/trials/`. We want trauma trials whose criteria fit the 8-operator vocabulary. If your trial requires temporal/lab/compound logic that doesn't fit, file an issue describing the gap — we'd rather extend the operator vocabulary deliberately than smuggle in nested logic.
- **Operator vocabulary.** Adding operators is a deliberate change. PRs adding operators must include: a real-world trial inclusion/exclusion clause that motivates it, a unit test in `engine/tests/test_operators.py`, and a corresponding update to `OPERATORS` and the `Operator` Literal in `schema.py`.
- **Reasoning trace polish.** The clause-level trace is the SME magic moment. Ideas for clearer wording, better grouping, more readable formatting are welcome.

## Local setup

```bash
# engine
cd engine
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
pytest

# demo
cd ../demo
npm install
npm run dev
```

## House rules

1. **Synthetic data only.** No real patient data, ever. No data with the smell of a specific institution. If a trial JSON references a hospital, scrub it.
2. **No clinical claims.** This is structured-rule infrastructure, not a clinical decision-support system. PRs that add language implying clinical validation will be sent back.
3. **Keep the engine pure.** No web framework, no I/O beyond the JSON loaders, no LLM calls. The matching engine has to be deterministic and embeddable.
4. **Tests with PRs.** Engine PRs include pytest coverage for the changed behavior. Demo PRs include a before/after screenshot.
5. **MIT-licensed contributions.** By submitting a PR you agree your contribution is MIT-licensed.

## Filing an issue

Open issues for: schema gaps, trial criteria you can't encode, real-world workflow scenarios the demo misses, accuracy problems in bundled trial JSONs.

Before opening: search existing issues. If you're a clinical coordinator, please say so — your context is the most valuable signal we can get.

## License

MIT. See [`LICENSE`](./LICENSE).
