// TS port of engine/scripts/parse_trial.py.
// Fetches a trial from clinicaltrials.gov v2, asks Claude to convert criteria
// into our Rule schema, validates, retries with feedback on failure. Same
// system prompt as the Python script — keep them in sync if either changes.

import Anthropic from "@anthropic-ai/sdk";

import { matchAll } from "./engine";
import type { MatchResult, Patient, Trial } from "./types";
import { validateTrial } from "./validateTrial";

const CTG_API = "https://clinicaltrials.gov/api/v2/studies/{nct_id}?format=json";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_LLM_ATTEMPTS = 3;

const PATIENT_FIELD_LINES = [
  "- age_years: int (range 0-120)",
  "- sex: enum, must be one of ['M', 'F', 'U']",
  "- gcs: int (range 3-15)",
  "- sbp_mmhg: int (range 0-300)",
  "- hr_bpm: int (range 0-300)",
  "- mechanism: enum, must be one of ['blunt_mvc', 'blunt_other', 'fall', 'gsw', 'stab', 'blast', 'burn', 'cardiac_arrest', 'head_strike', 'crush', 'other']",
  "- trauma_activation_level: int (range 1-3)",
  "- eta_minutes: int (range 0-480)",
  "- pregnancy_status: enum, must be one of ['not_applicable', 'not_pregnant', 'pregnant', 'unknown_could_be_pregnant']",
  "- anticoagulant_use: bool (true/false only)",
  "- presumed_tbi: bool (true/false only)",
  "- presumed_hemorrhage: bool (true/false only)",
  "- presumed_intracranial_hemorrhage: bool (true/false only)",
  "- spinal_injury_suspected: bool (true/false only)",
].join("\n");

const OPERATORS_LINE = "eq, ne, gte, lte, gt, lt, in, not_in";

const SYSTEM_PROMPT = `You convert clinical trial eligibility criteria into structured JSON rules for the traumatrial-match engine.

You may ONLY use these patient fields, and the value must match the field's type EXACTLY:

${PATIENT_FIELD_LINES}

You may ONLY use these operators: ${OPERATORS_LINE}

For \`in\` and \`not_in\`, the value must be a non-empty list whose elements all match the field type. For all others, the value must be a scalar matching the field type. NEVER invent enum values not in the allowed list above. NEVER pass a string where an int is expected (e.g., trauma_activation_level is an int 1-3, NOT a string label).

Each rule has: field (one of the allowed fields), op (one of the allowed operators), value (typed), hard (bool: true if the criterion is a hard dealbreaker, false if it's a soft preference / nice-to-have).

If a criterion CANNOT be expressed cleanly using the allowed fields and operators (e.g., it requires a field that doesn't exist, temporal logic like "within 3 hours of injury", compound boolean trees, lab values, prior medical history not in the schema), DO NOT invent a rule for it. List it in metadata.skipped_criteria with a one-sentence explanation.

If a criterion is partially expressible, encode the part that fits and add the unencoded part to metadata.skipped_criteria.

Be conservative: hard=true ONLY when missing/violating that criterion definitely excludes the patient. Otherwise hard=false.

Avoid tautological rule pairs. If you encode "age >= X" as a hard inclusion, do NOT also add "age < X" as a hard exclusion — the inclusion already covers it.

Prefer \`in\` over multiple \`eq\`. If two clauses test the same field with the same operator (e.g., pregnancy_status eq 'pregnant' AND pregnancy_status eq 'unknown_could_be_pregnant'), MERGE them into one \`in\` rule.

If the trial title contains a recognized acronym in parentheses (e.g., "Foo Bar (FIT-BRAIN) Trial"), use the acronym as short_name — never the truncated full title.

Output valid JSON only — no prose, no markdown fences, no preamble.`;

interface CtgMeta {
  trial_id: string;
  short_name: string;
  title: string;
  phase: string;
  status: string;
  criteria_text: string;
}

const PARENS_RE = /\(([A-Z][A-Z0-9-]{1,15}(?:\s*[A-Z0-9-]+)?)\)/;

function shortNameFromTitle(title: string): string | null {
  const m = title.match(PARENS_RE);
  return m ? m[1] : null;
}

export async function fetchTrialFromCTG(nctId: string): Promise<CtgMeta> {
  const url = CTG_API.replace("{nct_id}", nctId);
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new ParseError(`clinicaltrials.gov returned ${r.status} for ${nctId}: ${body.slice(0, 200)}`);
  }
  const study = (await r.json()) as Record<string, unknown>;
  const ps = (study.protocolSection as Record<string, unknown> | undefined) ?? {};
  const ident = (ps.identificationModule as Record<string, unknown> | undefined) ?? {};
  const status = (ps.statusModule as Record<string, unknown> | undefined) ?? {};
  const elig = (ps.eligibilityModule as Record<string, unknown> | undefined) ?? {};
  const design = (ps.designModule as Record<string, unknown> | undefined) ?? {};

  const phases = (design.phases as string[] | undefined) ?? [(design.phase as string | undefined) ?? "?"];
  const phase = phases[0] ?? "?";
  const title = (ident.briefTitle as string | undefined) ?? "?";
  const short_name =
    (ident.acronym as string | undefined) ?? shortNameFromTitle(title) ?? title;

  return {
    trial_id: (ident.nctId as string | undefined) ?? nctId,
    short_name,
    title,
    phase,
    status: (status.overallStatus as string | undefined) ?? "?",
    criteria_text: (elig.eligibilityCriteria as string | undefined) ?? "",
  };
}

function buildUserPrompt(meta: CtgMeta): string {
  return `Trial: ${meta.trial_id} (${meta.short_name})
Title: ${meta.title}
Phase: ${meta.phase}

Inclusion/exclusion criteria from clinicaltrials.gov:

${meta.criteria_text}

Convert this trial into JSON with this exact shape:

{
  "trial_id": "${meta.trial_id}",
  "short_name": "${meta.short_name}",
  "title": "${meta.title}",
  "requires_efic": <true|false based on whether this trial requires Exception from Informed Consent>,
  "phase": "${meta.phase}",
  "inclusion": [
    {"field": "<field>", "op": "<op>", "value": <value>, "hard": <bool>}
  ],
  "exclusion": [
    {"field": "<field>", "op": "<op>", "value": <value>, "hard": <bool>}
  ],
  "metadata": {
    "source": "clinicaltrials.gov",
    "skipped_criteria": [
      "Original criterion text (one-sentence reason it can't fit the schema)"
    ]
  }
}

Output the JSON object only. No markdown, no commentary.`;
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const after = t.split("```")[1] ?? "";
    t = after.startsWith("json") ? after.slice(4) : after;
    const end = t.lastIndexOf("```");
    if (end >= 0) t = t.slice(0, end);
    t = t.trim();
  }
  return t;
}

export class ParseError extends Error {}

export interface ParsedTrialResult {
  trial: Trial;
  skipped_criteria: string[];
  status: string;
  attempts: number;
}

export async function parseTrial(nctId: string, apiKey: string, model = DEFAULT_MODEL): Promise<ParsedTrialResult> {
  const meta = await fetchTrialFromCTG(nctId);
  if (!meta.criteria_text) {
    throw new ParseError(`no eligibility criteria text returned for ${nctId}`);
  }

  const client = new Anthropic({ apiKey });
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: buildUserPrompt(meta) },
  ];

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages,
    });
    const text = stripFences(
      resp.content.map((b) => ("text" in b ? b.text : "")).join(""),
    );

    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
    } catch (e) {
      throw new ParseError(`LLM returned invalid JSON: ${(e as Error).message}`);
    }

    const obj = candidate as Record<string, unknown>;
    const metadata = obj.metadata;
    const trialPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "metadata") trialPayload[k] = v;
    }

    const v = validateTrial(trialPayload);
    if (v.ok) {
      const skipped =
        (metadata && typeof metadata === "object" && Array.isArray((metadata as Record<string, unknown>).skipped_criteria)
          ? ((metadata as Record<string, unknown>).skipped_criteria as string[])
          : []);
      return { trial: v.trial, skipped_criteria: skipped, status: meta.status, attempts: attempt };
    }

    lastError = v.error;
    if (attempt === MAX_LLM_ATTEMPTS) break;
    messages.push({ role: "assistant", content: JSON.stringify(candidate) });
    messages.push({
      role: "user",
      content: `That JSON failed schema validation. The error was:\n\n${lastError}\n\nRe-emit the entire JSON object with this error fixed. Stay strictly within the allowed fields, types, and operators. Output JSON only — no prose.`,
    });
  }

  throw new ParseError(`could not produce a valid trial after ${MAX_LLM_ATTEMPTS} attempts. Last error: ${lastError ?? "?"}`);
}

export function matchParsedTrial(trial: Trial, patients: Patient[]): { patient: Patient; result: MatchResult }[] {
  return patients.map((p) => {
    const [r] = matchAll(p, [trial]);
    return { patient: p, result: r };
  });
}
