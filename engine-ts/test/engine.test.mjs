import { test } from "node:test";
import assert from "node:assert/strict";

import { match, matchAll } from "../dist/index.js";

const patient = {
  patient_id: "P-001",
  age_years: 34,
  sex: "M",
  gcs: 7,
  sbp_mmhg: 82,
  hr_bpm: 128,
  mechanism: "blunt_mvc",
  trauma_activation_level: 1,
  eta_minutes: 4,
  pregnancy_status: "not_applicable",
  anticoagulant_use: false,
  presumed_tbi: true,
  presumed_hemorrhage: true,
  presumed_intracranial_hemorrhage: false,
  spinal_injury_suspected: false,
};

const eligibleTrial = {
  trial_id: "NCT05638581",
  short_name: "TROOP",
  title: "Trauma Resuscitation With Low-Titer Group O Whole Blood",
  requires_efic: true,
  phase: "3",
  inclusion: [
    { field: "age_years", op: "gte", value: 15, hard: true },
    { field: "presumed_hemorrhage", op: "eq", value: true, hard: true },
    { field: "trauma_activation_level", op: "lte", value: 1, hard: false },
  ],
  exclusion: [
    { field: "pregnancy_status", op: "in", value: ["pregnant", "unknown_could_be_pregnant"], hard: true },
  ],
};

const ineligibleTrial = {
  trial_id: "NCT-AGE-FAIL",
  short_name: "OLDONLY",
  title: "Adults 65+ Only",
  requires_efic: false,
  phase: "?",
  inclusion: [
    { field: "age_years", op: "gte", value: 65, hard: true },
  ],
  exclusion: [],
};

test("eligible match returns confidence 1.0 with full trace", () => {
  const r = match(patient, eligibleTrial);
  assert.equal(r.eligible, true);
  assert.equal(r.confidence, 1.0);
  assert.equal(r.trace.length, 4);
  assert.equal(r.trace.every((c) => c.kind === "inclusion" ? c.hit : !c.hit), true);
});

test("hard-fail inclusion → eligible=false confidence=0", () => {
  const r = match(patient, ineligibleTrial);
  assert.equal(r.eligible, false);
  assert.equal(r.confidence, 0.0);
});

test("matchAll sorts eligible-first then by confidence", () => {
  const ranked = matchAll(patient, [ineligibleTrial, eligibleTrial]);
  assert.equal(ranked[0].trial_id, "NCT05638581");
  assert.equal(ranked[1].trial_id, "NCT-AGE-FAIL");
});
