// Light runtime validator for the /api/match POST body. Mirrors the pydantic
// constraints in engine/traumatrial_match/schema.py so the TS engine never
// matches against a malformed Patient.

import type { Mechanism, Patient, PregnancyStatus, Sex } from "./types";

const MECHANISMS: Mechanism[] = [
  "blunt_mvc", "blunt_other", "fall", "gsw", "stab", "blast",
  "burn", "cardiac_arrest", "head_strike", "crush", "other",
];
const PREGNANCY: PregnancyStatus[] = [
  "not_applicable", "not_pregnant", "pregnant", "unknown_could_be_pregnant",
];
const SEXES: Sex[] = ["M", "F", "U"];

interface IntField {
  key: keyof Patient;
  min: number;
  max: number;
}
const INT_FIELDS: IntField[] = [
  { key: "age_years", min: 0, max: 120 },
  { key: "gcs", min: 3, max: 15 },
  { key: "sbp_mmhg", min: 0, max: 300 },
  { key: "hr_bpm", min: 0, max: 300 },
  { key: "trauma_activation_level", min: 1, max: 3 },
  { key: "eta_minutes", min: 0, max: 480 },
];
const BOOL_FIELDS: (keyof Patient)[] = [
  "anticoagulant_use",
  "presumed_tbi",
  "presumed_hemorrhage",
  "presumed_intracranial_hemorrhage",
  "spinal_injury_suspected",
];

export function validatePatient(input: unknown): { ok: true; patient: Patient } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const o = input as Record<string, unknown>;

  if (typeof o.patient_id !== "string" || !o.patient_id.trim()) {
    return { ok: false, error: "patient_id must be a non-empty string" };
  }
  for (const f of INT_FIELDS) {
    const v = o[f.key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) {
      return { ok: false, error: `${f.key} must be an integer in [${f.min}, ${f.max}]` };
    }
  }
  if (!SEXES.includes(o.sex as Sex)) {
    return { ok: false, error: `sex must be one of ${SEXES.join(", ")}` };
  }
  if (!MECHANISMS.includes(o.mechanism as Mechanism)) {
    return { ok: false, error: `mechanism must be one of ${MECHANISMS.join(", ")}` };
  }
  if (!PREGNANCY.includes(o.pregnancy_status as PregnancyStatus)) {
    return { ok: false, error: `pregnancy_status must be one of ${PREGNANCY.join(", ")}` };
  }
  for (const k of BOOL_FIELDS) {
    if (typeof o[k] !== "boolean") return { ok: false, error: `${k} must be a boolean` };
  }
  return { ok: true, patient: o as unknown as Patient };
}
