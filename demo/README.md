# traumatrial demo

Single-page Next.js app showing what real-time trauma trial eligibility matching looks like from a research coordinator's seat.

**Live at:** https://traumatrial.vercel.app

## What's in here

- **Coordinator UI** — idle screen with persona picker, custom-patient form, and live NCT parser. Active screen with patient panel, ranked trial cards, EFIC badges, clause-level reasoning trace, and ACKNOWLEDGE flow.
- **Faithful TS engine port** at `lib/engine.ts` — same operators, same trace format, same confidence rubric as the Python engine in `../engine/`. Used by both the in-browser custom-patient flow and the live `/api/match` route.
- **`POST /api/match`** — submit a Patient JSON, get ranked `MatchResult[]` against all bundled trials. Validates input and returns a 400 with a field-specific error on bad payloads.
- **`POST /api/parse-trial`** — submit `{ "nct_id": "NCT…" }`, the server fetches the trial from clinicaltrials.gov, sends criteria through Claude with the engine's rule schema as the contract, validates + retries on schema failure (max 3 attempts), and returns the parsed Trial + a list of skipped criteria that didn't fit the schema.

## Run locally

```bash
npm install
npm run dev    # http://localhost:3000
```

The custom-patient form and `/api/match` need no setup.

The NCT parser at `/api/parse-trial` needs `ANTHROPIC_API_KEY`. Put it in a `.env` at the repo root or `demo/.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Build

```bash
npm run build
```

## Deploy

```bash
vercel --prod
```

Make sure `ANTHROPIC_API_KEY` is set in your Vercel project's environment variables.

## Regenerate static match payloads

The persona buttons on the idle screen pull from pre-computed JSON in `public/matches/`. If you change trials or patients in `../engine/`, regenerate:

```bash
cd ../engine
source .venv/bin/activate
python scripts/precompute.py
```

This writes `demo/public/matches/*.json`, `demo/public/trials.json`, and `demo/public/patients.json`.

## Public surfaces

| Path | Method | Purpose |
|---|---|---|
| `/` | GET | Coordinator UI |
| `/api/match` | POST | Run engine against bundled trials, returns ranked `MatchResult[]`. |
| `/api/parse-trial` | POST | Fetch a trial from clinicaltrials.gov + parse via Claude. Rate-limited 5 calls / IP / 10 min. |

`/api/parse-trial` is a paid endpoint (each call is one Claude API request). The in-memory IP throttle is a basic abuse defense — swap for Upstash or similar if traffic picks up.

## Design notes

- The Python engine is the source of truth. The TS port in `lib/engine.ts` mirrors it byte-for-byte for the bundled corpus. The validator in `lib/validateTrial.ts` mirrors `engine/traumatrial_match/schema.py`'s `Rule._value_must_match_field_type` so LLM-generated trials fail fast at the same boundary.
- Three card states for matched trials: **ELIGIBLE** (green), **REVIEW NEEDED** (amber, hard-pass + soft-miss), **EXCLUDED** (grey, hard fail). Excluded cards surface the first failing hard clause inline so the coordinator doesn't have to expand the trace.
- Status bar gates trial/patient counts behind a `loaded` boolean so the right-hand counter never flashes "0 active trials" before the JSON fetch resolves.
