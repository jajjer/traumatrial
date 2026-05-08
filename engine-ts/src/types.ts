// Mirrors the Python pydantic schema in engine/traumatrial_match/schema.py.
// Snake_case matches the JSON the Python pipeline produces — no translation
// layer between languages.

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

export interface Rule {
  field: keyof Patient;
  op: Operator;
  value: unknown;
  hard: boolean;
}

export interface TrialMetadata {
  source?: string;
  skipped_criteria?: string[];
  // Provenance — populated by engine/scripts/parse_trial.py at import time.
  // See engine/traumatrial_match/schema.py:TrialMetadata for field semantics.
  imported_at?: string | null;
  parser_version?: string | null;
  schema_version?: string | null;
  source_url?: string | null;
  source_last_update_posted?: string | null;
  source_overall_status?: string | null;
  source_criteria_sha256?: string | null;
}

export interface Trial {
  trial_id: string;
  short_name: string;
  title: string;
  requires_efic: boolean;
  phase: string;
  inclusion: Rule[];
  exclusion: Rule[];
  _metadata?: TrialMetadata;
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
