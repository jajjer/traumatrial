# traumatrial-match

> Real-time trauma trial eligibility matching. TypeScript port of the [Python engine](https://github.com/jajjer/traumatrial/tree/main/engine) — same operators, same trace format, same confidence rubric. Includes a NEMSIS v3.5 ePCR adapter.

[![npm](https://img.shields.io/npm/v/traumatrial-match.svg)](https://www.npmjs.com/package/traumatrial-match)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![demo](https://img.shields.io/badge/live%20demo-traumatrial.vercel.app-rose)](https://traumatrial.vercel.app)

```bash
npm install traumatrial-match
```

The matching engine has zero runtime dependencies. The optional NEMSIS adapter at `traumatrial-match/nemsis` requires `fast-xml-parser` (declared as a peer dep).

## Match a patient

```ts
import { match, matchAll, type Patient, type Trial } from "traumatrial-match";

const patient: Patient = {
  patient_id: "P-001",
  age_years: 34, sex: "M",
  gcs: 7, sbp_mmhg: 82, hr_bpm: 128,
  mechanism: "blunt_mvc",
  trauma_activation_level: 1, eta_minutes: 4,
  pregnancy_status: "not_applicable",
  anticoagulant_use: false,
  presumed_tbi: true, presumed_hemorrhage: true,
  presumed_intracranial_hemorrhage: false,
  spinal_injury_suspected: false,
};

const trial: Trial = {
  trial_id: "NCT05638581",
  short_name: "TROOP",
  title: "Trauma Resuscitation With Low-Titer Group O Whole Blood",
  requires_efic: true, phase: "3",
  inclusion: [
    { field: "age_years", op: "gte", value: 15, hard: true },
    { field: "presumed_hemorrhage", op: "eq", value: true, hard: true },
  ],
  exclusion: [
    { field: "pregnancy_status", op: "in",
      value: ["pregnant", "unknown_could_be_pregnant"], hard: true },
  ],
};

const result = match(patient, trial);
// { eligible: true, confidence: 1.0, trace: [...] }

const ranked = matchAll(patient, [trial, ...]);
// eligible-first, then confidence desc
```

Eight operators: `eq`, `ne`, `gte`, `lte`, `gt`, `lt`, `in`, `not_in`. `in`/`not_in` take a list value; the others take a scalar.

**Confidence rubric.** Any hard inclusion missed or hard exclusion hit → `eligible=false`, `confidence=0.0`. Otherwise eligible; `confidence = soft_inclusion_hits / soft_inclusion_total` (or 1.0 if no soft inclusions).

## Convert a NEMSIS v3.5 ePCR

```bash
npm install traumatrial-match fast-xml-parser
```

```ts
import { fromNemsisXml } from "traumatrial-match/nemsis";
import { matchAll } from "traumatrial-match";

const xml = `<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"> … </EMSDataSet>`;

const { patient, trace } = fromNemsisXml(xml);
// trace.extractions: [{ field, source: "extracted"|"inferred"|"defaulted"|"skipped",
//                       value, nemsis_path, raw, notes }, ...]

const results = matchAll(patient, myTrials);
```

The adapter pulls ~10 high-signal eFields (`ePatient.13`, `ePatient.15`, `eVitals.06/10/23`, `eSituation.02`, `eHistory.06/16`) and surfaces every Patient field with a one-line trace explaining where it came from. Fields without a clean NEMSIS source (e.g. `presumed_tbi`) are inferred from physiology + mechanism rules; the trace records the rule.

**v0 mapping; not a clinical-grade extractor.** Core v3.5 only, no state extensions, no XSD validation.

## What this is NOT

- Not a clinical decision-support system.
- Not regulated, certified, or BAA-able.
- Not a substitute for a research coordinator's clinical judgment.

It is a structured, testable, transparent **starting point** for talking about how trauma trial enrollment could be automated.

## License

MIT — see [`LICENSE`](LICENSE).
