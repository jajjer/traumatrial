# traumatrial demo

Single-page Next.js app showing what real-time trauma trial eligibility matching looks like from a research coordinator's seat.

The demo is a **canned playback**: match results are pre-computed offline by the Python engine in `../engine/` and served as static JSON from `public/`. There is no live backend, no auth, no real patient data. This is honest scope-setting; the OSS engine in `../engine/` is the live matcher.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Regenerate match payloads

If you change trials/patients in `engine/`, regenerate the demo data:

```bash
cd ../engine
source .venv/bin/activate
python scripts/precompute.py
```

This writes `demo/public/matches/*.json`, `demo/public/trials.json`, and `demo/public/patients.json`.

## Build

```bash
npm run build
```

## Deploy

```bash
vercel --prod
```

## What the demo shows

- **Idle state** — standby trauma bay, large "PRESS TO SIMULATE PATIENT ARRIVAL" button, persona picker for specific scenarios.
- **Active state** — patient panel (vitals, mechanism, ETA, demographics) on the left, ranked trial matches on the right.
- **Trial card** — eligibility chip, NCT, short name, EFIC badge in red if the trial requires it, confidence bar, "ACKNOWLEDGE & EN ROUTE" action.
- **Reasoning trace** — clause-level: every inclusion/exclusion clause with hit/miss, hard/soft, and the patient field that drove it. This is the SME magic moment.
- **Toast** — "Coordinator paged: TROOP" on acknowledge.
