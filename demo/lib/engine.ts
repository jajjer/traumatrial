// TypeScript port of engine/traumatrial_match/match.py.
// Same operators, same trace format, same confidence rubric — so a custom
// patient submitted from the demo gets results indistinguishable from the
// pre-computed Python pipeline.

import type {
  ClauseTrace,
  MatchResult,
  Operator,
  Patient,
  Trial,
} from "./types";

interface Rule {
  field: keyof Patient;
  op: Operator;
  value: unknown;
  hard: boolean;
}

function evaluate(op: Operator, patientValue: unknown, ruleValue: unknown): boolean {
  if (patientValue === null || patientValue === undefined) return false;
  switch (op) {
    case "eq": return patientValue === ruleValue;
    case "ne": return patientValue !== ruleValue;
    case "gte": return (patientValue as number) >= (ruleValue as number);
    case "lte": return (patientValue as number) <= (ruleValue as number);
    case "gt": return (patientValue as number) > (ruleValue as number);
    case "lt": return (patientValue as number) < (ruleValue as number);
    case "in": return Array.isArray(ruleValue) && ruleValue.includes(patientValue);
    case "not_in": return Array.isArray(ruleValue) && !ruleValue.includes(patientValue);
  }
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) {
    const head = v.slice(0, 3).map((x) => JSON.stringify(x)).join(", ");
    return v.length <= 3 ? `[${head}]` : `[${head}, ...]`;
  }
  return JSON.stringify(v);
}

function clauseText(rule: Rule): string {
  return `${rule.field} ${rule.op} ${formatValue(rule.value)}`;
}

function traceOne(
  rule: Rule,
  kind: "inclusion" | "exclusion",
  patient: Patient,
): { trace: ClauseTrace; hit: boolean } {
  const patientValue = (patient as unknown as Record<string, unknown>)[rule.field];
  const hit = evaluate(rule.op, patientValue, rule.value);
  return {
    trace: {
      clause: clauseText(rule),
      kind,
      hard: rule.hard,
      hit,
      patient_value: patientValue,
    },
    hit,
  };
}

export function match(patient: Patient, trial: Trial): MatchResult {
  const trace: ClauseTrace[] = [];
  let hardFail = false;
  let softTotal = 0;
  let softHits = 0;

  for (const rule of trial.inclusion as Rule[]) {
    const { trace: ct, hit } = traceOne(rule, "inclusion", patient);
    trace.push(ct);
    if (rule.hard) {
      if (!hit) hardFail = true;
    } else {
      softTotal += 1;
      if (hit) softHits += 1;
    }
  }
  for (const rule of trial.exclusion as Rule[]) {
    const { trace: ct, hit } = traceOne(rule, "exclusion", patient);
    trace.push(ct);
    if (rule.hard && hit) hardFail = true;
  }

  if (hardFail) {
    return {
      patient_id: patient.patient_id,
      trial_id: trial.trial_id,
      eligible: false,
      confidence: 0.0,
      trace,
    };
  }
  const confidence = softTotal === 0 ? 1.0 : softHits / softTotal;
  return {
    patient_id: patient.patient_id,
    trial_id: trial.trial_id,
    eligible: true,
    confidence,
    trace,
  };
}

export function matchAll(patient: Patient, trials: Trial[]): MatchResult[] {
  const results = trials.map((t) => match(patient, t));
  results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.confidence - a.confidence;
  });
  return results;
}
