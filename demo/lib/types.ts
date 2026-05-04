// Mirrors traumatrial_match/schema.py exactly. Snake_case matches the JSON
// produced by engine/scripts/precompute.py — no translation layer.

export type Mechanism =
  | "blunt_mvc"
  | "blunt_other"
  | "fall"
  | "gsw"
  | "stab"
  | "blast"
  | "burn"
  | "cardiac_arrest"
  | "head_strike"
  | "crush"
  | "other";

export type PregnancyStatus =
  | "not_applicable"
  | "not_pregnant"
  | "pregnant"
  | "unknown_could_be_pregnant";

export type Sex = "M" | "F" | "U";

export type Operator =
  | "eq"
  | "ne"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "in"
  | "not_in";

export interface Patient {
  patient_id: string;
  age_years: number;
  sex: Sex;
  gcs: number;
  sbp_mmhg: number;
  hr_bpm: number;
  mechanism: Mechanism;
  trauma_activation_level: number;
  eta_minutes: number;
  pregnancy_status: PregnancyStatus;
  anticoagulant_use: boolean;
  presumed_tbi: boolean;
  presumed_hemorrhage: boolean;
  presumed_intracranial_hemorrhage: boolean;
  spinal_injury_suspected: boolean;
}

export interface Trial {
  trial_id: string;
  short_name: string;
  title: string;
  requires_efic: boolean;
  phase: string;
  inclusion: unknown[];
  exclusion: unknown[];
}

export interface ClauseTrace {
  clause: string;
  kind: "inclusion" | "exclusion";
  hard: boolean;
  hit: boolean;
  patient_value: unknown;
}

export interface MatchResult {
  patient_id: string;
  trial_id: string;
  eligible: boolean;
  confidence: number;
  trace: ClauseTrace[];
}

export interface PatientMatchPayload {
  patient: Patient;
  results: MatchResult[];
  // Present on /api/match responses; omitted from precomputed persona payloads.
  latency_ms?: number;
  trials_evaluated?: number;
}
