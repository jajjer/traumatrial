# traumatrial

Real-time trauma trial eligibility matching.

**Live demo:** https://traumatrial.vercel.app

Monorepo containing:

- **`engine/`** — `traumatrial-match`, the Python OSS matching engine. MIT-licensed. Evaluates structured trauma trial inclusion/exclusion rules against patient records in <100ms with clause-level reasoning trace.
- **`demo/`** — Next.js demo deployed to Vercel. Pre-computed match results from the engine, animated coordinator-view UI, "Simulate Patient Arrival" button.

The engine is the public infrastructure. The demo is a wedge for trauma research conversations. Neither contains real patient data.

## Quick start (engine)

```bash
cd engine
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
pytest
```

## Quick start (demo)

```bash
cd demo
npm install
npm run dev
```

## Why this exists

Trauma patients die who could have been saved by drugs already in clinical trials, because trials can't enroll fast enough. The consent window is minutes (patient unconscious), not days. This project is open infrastructure for matching qualifying patients to active trauma trials in real time.

See `engine/README.md` for the matching engine spec and `demo/README.md` for the demo flow.
