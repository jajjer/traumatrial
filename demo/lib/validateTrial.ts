// Mirrors engine/traumatrial_match/schema.py — Rule._value_must_match_field_type
// and the Trial fields. Used by /api/parse-trial to fail fast (with feedback)
// when the LLM hallucinates an enum value or pipes a string into an int field.

import type { Operator, Trial } from "./types";

interface FieldMeta {
  type: "int" | "bool" | "enum";
  range?: [number, number];
  values?: readonly string[];
}

const PATIENT_FIELD_META: Record<string, FieldMeta> = {
  age_years: { type: "int", range: [0, 120] },
  sex: { type: "enum", values: ["M", "F", "U"] },
  gcs: { type: "int", range: [3, 15] },
  sbp_mmhg: { type: "int", range: [0, 300] },
  hr_bpm: { type: "int", range: [0, 300] },
  mechanism: {
    type: "enum",
    values: [
      "blunt_mvc", "blunt_other", "fall", "gsw", "stab", "blast",
      "burn", "cardiac_arrest", "head_strike", "crush", "other",
    ],
  },
  trauma_activation_level: { type: "int", range: [1, 3] },
  eta_minutes: { type: "int", range: [0, 480] },
  pregnancy_status: {
    type: "enum",
    values: ["not_applicable", "not_pregnant", "pregnant", "unknown_could_be_pregnant"],
  },
  anticoagulant_use: { type: "bool" },
  presumed_tbi: { type: "bool" },
  presumed_hemorrhage: { type: "bool" },
  presumed_intracranial_hemorrhage: { type: "bool" },
  spinal_injury_suspected: { type: "bool" },
};
const ALLOWED_OPS: Operator[] = ["eq", "ne", "gte", "lte", "gt", "lt", "in", "not_in"];

function checkScalar(field: string, value: unknown, meta: FieldMeta): string | null {
  if (meta.type === "bool") {
    if (typeof value !== "boolean") {
      return `field ${field} expects a bool; got ${typeof value} ${JSON.stringify(value)}`;
    }
  } else if (meta.type === "int") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return `field ${field} expects an int; got ${typeof value} ${JSON.stringify(value)}`;
    }
    const [lo, hi] = meta.range!;
    if (value < lo || value > hi) {
      return `field ${field} value ${value} out of range [${lo}, ${hi}]`;
    }
  } else if (meta.type === "enum") {
    if (typeof value !== "string") {
      return `field ${field} expects a string from ${JSON.stringify(meta.values)}; got ${typeof value} ${JSON.stringify(value)}`;
    }
    if (!meta.values!.includes(value)) {
      return `field ${field} value ${JSON.stringify(value)} not in allowed values ${JSON.stringify(meta.values)}`;
    }
  }
  return null;
}

function validateRule(rule: unknown, idx: number, kind: "inclusion" | "exclusion"): string | null {
  if (!rule || typeof rule !== "object") return `${kind}[${idx}] must be an object`;
  const r = rule as Record<string, unknown>;
  const field = r.field;
  const op = r.op;
  const value = r.value;
  const hard = r.hard;
  if (typeof field !== "string" || !(field in PATIENT_FIELD_META)) {
    return `${kind}[${idx}].field "${String(field)}" is not an allowed patient field`;
  }
  if (typeof op !== "string" || !ALLOWED_OPS.includes(op as Operator)) {
    return `${kind}[${idx}].op "${String(op)}" is not a valid operator`;
  }
  if (typeof hard !== "boolean") {
    return `${kind}[${idx}].hard must be a boolean`;
  }

  if (op === "in" || op === "not_in") {
    if (!Array.isArray(value)) return `${kind}[${idx}] op '${op}' requires value to be a list`;
    if (value.length === 0) return `${kind}[${idx}] op '${op}' requires a non-empty list`;
  } else if (Array.isArray(value)) {
    return `${kind}[${idx}] op '${op}' cannot take a list value`;
  }

  const meta = PATIENT_FIELD_META[field];
  const scalars = Array.isArray(value) ? value : [value];
  for (const s of scalars) {
    const err = checkScalar(field, s, meta);
    if (err) return `${kind}[${idx}]: ${err}`;
  }
  return null;
}

export function validateTrial(payload: unknown): { ok: true; trial: Trial } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") return { ok: false, error: "trial payload must be an object" };
  const t = payload as Record<string, unknown>;
  if (typeof t.trial_id !== "string" || !t.trial_id) return { ok: false, error: "trial_id is required" };
  if (typeof t.short_name !== "string" || !t.short_name) return { ok: false, error: "short_name is required" };
  if (typeof t.title !== "string") return { ok: false, error: "title is required" };
  if (typeof t.requires_efic !== "boolean") return { ok: false, error: "requires_efic must be a boolean" };
  const phase = typeof t.phase === "string" ? t.phase : "?";

  const inclusion = Array.isArray(t.inclusion) ? t.inclusion : [];
  const exclusion = Array.isArray(t.exclusion) ? t.exclusion : [];

  for (let i = 0; i < inclusion.length; i++) {
    const e = validateRule(inclusion[i], i, "inclusion");
    if (e) return { ok: false, error: e };
  }
  for (let i = 0; i < exclusion.length; i++) {
    const e = validateRule(exclusion[i], i, "exclusion");
    if (e) return { ok: false, error: e };
  }

  return {
    ok: true,
    trial: {
      trial_id: t.trial_id,
      short_name: t.short_name,
      title: t.title,
      requires_efic: t.requires_efic,
      phase,
      inclusion: inclusion as Trial["inclusion"],
      exclusion: exclusion as Trial["exclusion"],
    },
  };
}
