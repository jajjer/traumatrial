// TS port of engine/traumatrial_match/nemsis.py.
// Same field-by-field semantics. Uses fast-xml-parser for the parse step;
// everything downstream (mappings, inference, trace) mirrors the Python.

import { XMLParser } from "fast-xml-parser";

import type { Mechanism, Patient, PregnancyStatus, Sex } from "./types.js";

export type { Patient } from "./types.js";

const NEMSIS_GENDER: Record<string, Sex> = {
  "9906001": "F",
  "9906003": "M",
  "9906005": "U",
  "9906007": "U",
};

const NEMSIS_PREGNANCY: Record<string, PregnancyStatus> = {
  "3133001": "pregnant",
  "3133003": "not_pregnant",
  "3133005": "unknown_could_be_pregnant",
};

const ICD10_PREFIXES: [string, Mechanism][] = [
  ["W23", "crush"],
  ["W25", "stab"], ["W26", "stab"],
  ["W32", "gsw"], ["W33", "gsw"], ["W34", "gsw"],
  ["X00", "burn"], ["X01", "burn"], ["X02", "burn"], ["X03", "burn"],
  ["X04", "burn"], ["X05", "burn"], ["X06", "burn"], ["X08", "burn"], ["X09", "burn"],
  ["X72", "gsw"], ["X73", "gsw"], ["X74", "gsw"],
  ["X92", "gsw"], ["X93", "gsw"], ["X94", "gsw"], ["X95", "gsw"],
  ["X96", "blast"], ["X97", "blast"], ["X98", "blast"], ["X99", "stab"],
  ["Y01", "blunt_other"], ["Y02", "blunt_other"], ["Y04", "blunt_other"], ["Y08", "blunt_other"],
  ["W00", "fall"], ["W01", "fall"], ["W02", "fall"], ["W03", "fall"],
  ["W04", "fall"], ["W05", "fall"], ["W06", "fall"], ["W07", "fall"],
  ["W08", "fall"], ["W09", "fall"], ["W10", "fall"], ["W11", "fall"],
  ["W12", "fall"], ["W13", "fall"], ["W14", "fall"], ["W15", "fall"],
  ["W16", "fall"], ["W17", "fall"], ["W18", "fall"], ["W19", "fall"],
  ["I46", "cardiac_arrest"],
  ["V", "blunt_mvc"],
];

const NEMSIS_CAUSE_CODES: Record<string, Mechanism> = {
  "2120001": "blunt_mvc",
  "2120003": "blunt_mvc",
  "2120005": "fall",
  "2120007": "blunt_other",
  "2120009": "stab",
  "2120011": "gsw",
  "2120013": "burn",
  "2120015": "blast",
  "2120017": "crush",
  "2120019": "cardiac_arrest",
};

const ANTICOAGULANT_STRINGS = [
  "warfarin", "coumadin",
  "apixaban", "eliquis",
  "rivaroxaban", "xarelto",
  "dabigatran", "pradaxa",
  "edoxaban", "savaysa",
  "heparin", "enoxaparin", "lovenox",
];

const ANTICOAGULANT_RXNORM_CUIS = new Set([
  "11289", "855288",
  "5224", "284562",
  "67108", "11128",
  "1037045",
  "1114195",
  "1364430",
  "1599538",
]);

// NEMSIS v3.5 eField vocabulary — kept in sync with engine/traumatrial_match/nemsis_vocab.py.
// MAPPED = fields the adapter actively reads; KNOWN = recognized fields the adapter
// intentionally skips (with a one-phrase description for the audit trail).
const NEMSIS_MAPPED = new Set<string>([
  "eRecord.01",
  "ePatient.13", "ePatient.15", "ePatient.16",
  "eVitals.06", "eVitals.10", "eVitals.23",
  "eSituation.02", "eInjury.01",
  "eHistory.06", "eHistory.16",
  "eTimes.07",
]);

const NEMSIS_KNOWN: Record<string, string> = {
  "eRecord.SoftwareCreatorAndName": "ePCR vendor identifier",
  "eRecord.02": "ePCR software version",
  "eResponse.01": "EMS agency identifier",
  "eResponse.03": "type of service requested",
  "eResponse.05": "primary role of the unit",
  "eResponse.13": "type of dispatch (911, transfer, etc.)",
  "eDispatch.01": "complaint reported by dispatch",
  "eDispatch.04": "EMD performed (priority)",
  "eTimes.01": "PSAP call time",
  "eTimes.03": "unit notified by dispatch",
  "eTimes.05": "unit en route",
  "eTimes.06": "unit arrived on scene",
  "eTimes.09": "unit back in service",
  "eTimes.13": "unit canceled",
  "eScene.07": "incident location type",
  "eScene.09": "rural/urban/suburban",
  "eScene.18": "number of patients at scene",
  "eScene.21": "first/second/etc. EMS on scene",
  "ePatient.02": "patient last name (PHI; intentionally not consumed)",
  "ePatient.03": "patient first name (PHI; intentionally not consumed)",
  "ePatient.14": "race",
  "ePatient.17": "date of birth (PHI; intentionally not consumed)",
  "ePatient.NN": "ethnicity / language / SSN (PHI; intentionally not consumed)",
  "eHistory.05": "allergies",
  "eHistory.08": "medical/surgical history (comorbidities)",
  "eHistory.09": "physician orders / DNR status",
  "eHistory.061": "RxNorm CUI nested under eHistory.06 (consumed when present)",
  "eVitals.01": "vitals timestamp",
  "eVitals.07": "diastolic BP",
  "eVitals.14": "respiratory rate",
  "eVitals.16": "respiratory effort",
  "eVitals.20": "SpO2",
  "eVitals.21": "EtCO2",
  "eVitals.22": "blood glucose",
  "eVitals.24": "GCS-Eye component",
  "eVitals.25": "GCS-Verbal component",
  "eVitals.26": "GCS-Motor component",
  "eVitals.27": "stroke scale",
  "eVitals.28": "pain scale",
  "eExam.01": "exam timestamp",
  "eExam.13": "chest exam findings",
  "eExam.18": "abdomen exam findings",
  "eExam.19": "back/flank exam findings",
  "eExam.20": "pelvis/genitourinary findings",
  "eExam.21": "extremity findings",
  "eExam.23": "neurological exam findings",
  "eMedications.01": "medication administration time",
  "eMedications.03": "administered medication (RxNorm/SNOMED)",
  "eMedications.05": "dosage",
  "eMedications.06": "dosage units",
  "eMedications.07": "route of administration",
  "eMedications.10": "medication response",
  "eProcedures.01": "procedure timestamp",
  "eProcedures.03": "procedure performed (SNOMED)",
  "eProcedures.06": "procedure successful (yes/no)",
  "eProcedures.07": "procedure complications",
  "eSituation.01": "patient's primary symptom",
  "eSituation.07": "primary impression",
  "eSituation.09": "secondary impression",
  "eSituation.11": "injury type (single/multi system)",
  "eSituation.12": "work-related?",
  "eSituation.13": "patient activity at time of injury",
  "eInjury.02": "vehicle role (driver/passenger/pedestrian)",
  "eInjury.03": "use of safety equipment",
  "eInjury.04": "airbag deployment",
  "eInjury.05": "height of fall",
  "eInjury.09": "trauma triage criteria met (CDC step 1/2/3)",
  "eNarrative.01": "free-text narrative (out of scope; consider NLP later)",
  "eDisposition.01": "patient disposition",
  "eDisposition.02": "transport mode",
  "eDisposition.16": "destination type",
  "eDisposition.20": "destination trauma center designation",
  "eDisposition.23": "level of care provided to receiving facility",
  "eOutcome.01": "ED disposition",
  "eOutcome.02": "ED diagnosis",
  "eOutcome.10": "ED procedures",
  "eOther.01": "QA/QI flags",
  "eOther.06": "PCR signatures",
  "eOther.12": "state-defined customizations",
  "eCrew.01": "crew member id",
  "eCrew.02": "crew member level",
};

const NEMSIS_CONTAINERS = new Set<string>([
  "EMSDataSet", "Header", "Source", "SchemaVersion", "PatientCareReport",
  "eRecord", "eResponse", "eDispatch", "eTimes", "eScene", "ePatient",
  "eHistory", "eVitals", "eVitalsGroup",
  "eExam", "eExamGroup",
  "eMedications", "eMedicationsGroup",
  "eProcedures", "eProceduresGroup",
  "eSituation", "eInjury", "eInjuryGroup",
  "eNarrative", "eDisposition", "eOutcome", "eOther",
  "eCrew", "eCrewGroup",
]);

export type ExtractionSource = "extracted" | "inferred" | "defaulted" | "skipped";

export interface FieldExtraction {
  field: string;
  source: ExtractionSource;
  value: unknown;
  nemsis_path?: string | null;
  raw?: string | null;
  notes?: string | null;
}

export interface NemsisConversionTrace {
  extractions: FieldExtraction[];
}

export interface CoverageEntry {
  field: string;
  classification: "known_unmapped" | "unknown";
  description: string | null;
  sample_value: string | null;
}

export interface NemsisCoverageReport {
  mapped_fields: string[];
  unmapped: CoverageEntry[];
}

export class NemsisParseError extends Error {}

interface NemsisNode {
  [k: string]: unknown;
}

function findFirst(node: unknown, path: string[]): NemsisNode | null {
  let cursor: unknown = node;
  for (const step of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[step];
    if (Array.isArray(cursor)) cursor = cursor[0];
  }
  return cursor === null || typeof cursor !== "object" ? null : (cursor as NemsisNode);
}

function findText(node: unknown, path: string[]): string | null {
  const last = path[path.length - 1];
  const parent = findFirst(node, path.slice(0, -1));
  if (!parent) return null;
  const v = parent[last];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]).trim() || null : null;
  if (typeof v === "object") {
    // fast-xml-parser sometimes wraps text in {"#text": "..."} when attrs exist
    const text = (v as Record<string, unknown>)["#text"];
    return text === undefined ? null : String(text).trim() || null;
  }
  return String(v).trim() || null;
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function inferPresumedTbi(gcs: number, mechanism: Mechanism, trace: NemsisConversionTrace): boolean {
  const blunt = mechanism === "blunt_mvc" || mechanism === "blunt_other" || mechanism === "fall" || mechanism === "head_strike";
  const val = gcs <= 13 && blunt;
  trace.extractions.push({
    field: "presumed_tbi", source: "inferred", value: val, nemsis_path: null,
    notes: `GCS<=13 (${gcs}) AND mechanism in blunt set (${mechanism}) → ${val}`,
  });
  return val;
}

function inferPresumedHemorrhage(sbp: number, hr: number, mechanism: Mechanism, trace: NemsisConversionTrace): boolean {
  const val = sbp < 90 && hr > 110 && mechanism !== "cardiac_arrest";
  trace.extractions.push({
    field: "presumed_hemorrhage", source: "inferred", value: val, nemsis_path: null,
    notes: `SBP<90 (${sbp}) AND HR>110 (${hr}) AND non-cardiac → ${val}`,
  });
  return val;
}

function inferPresumedIch(presumedTbi: boolean, gcs: number, trace: NemsisConversionTrace): boolean {
  const val = presumedTbi && gcs <= 8;
  trace.extractions.push({
    field: "presumed_intracranial_hemorrhage", source: "inferred", value: val, nemsis_path: null,
    notes: `presumed_tbi (${presumedTbi}) AND GCS<=8 (${gcs}) → ${val}`,
  });
  return val;
}

function inferSpinalInjury(mechanism: Mechanism, gcs: number, trace: NemsisConversionTrace): boolean {
  const val = (mechanism === "blunt_mvc" || mechanism === "fall") && gcs <= 13;
  trace.extractions.push({
    field: "spinal_injury_suspected", source: "inferred", value: val, nemsis_path: null,
    notes: `mechanism in {blunt_mvc, fall} (${mechanism}) AND GCS<=13 (${gcs}) → ${val}`,
  });
  return val;
}

const PARSER = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  // eVitals can have multiple eVitalsGroup, eHistory.06 can repeat — keep arrays.
  isArray: (name) => name === "eVitalsGroup" || name === "eHistory.06" || name === "PatientCareReport",
});

function classifyField(local: string): "mapped" | "known_unmapped" | "container" | "unknown" {
  if (NEMSIS_MAPPED.has(local)) return "mapped";
  if (local in NEMSIS_KNOWN) return "known_unmapped";
  if (NEMSIS_CONTAINERS.has(local)) return "container";
  return "unknown";
}

// Walk the parsed PCR object tree and return a coverage report. fast-xml-parser
// gives us nested objects keyed by element local name. A "leaf" here is a key
// whose value is a primitive (string/number/boolean) — that's where the eField
// value lives. Containers (objects) get descended.
function walkCoverage(pcr: unknown, mappedConsumed: Set<string>): NemsisCoverageReport {
  const seen = new Map<string, CoverageEntry>();

  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "#text") continue;
      const klass = classifyField(key);
      const isLeaf =
        value === null || typeof value !== "object" ||
        (typeof value === "object" && !Array.isArray(value) &&
          Object.keys(value as Record<string, unknown>).every((k) => k === "#text"));
      if (isLeaf) {
        if (klass === "mapped" || klass === "container") continue;
        if (seen.has(key)) {
          const existing = seen.get(key)!;
          if (existing.sample_value === null) {
            const sample = leafText(value);
            if (sample) existing.sample_value = sample;
          }
          continue;
        }
        seen.set(key, {
          field: key,
          classification: klass === "known_unmapped" ? "known_unmapped" : "unknown",
          description: NEMSIS_KNOWN[key] ?? null,
          sample_value: leafText(value),
        });
      } else {
        // Container or wrapper: descend.
        visit(value);
      }
    }
  };
  visit(pcr);

  const unmapped = [...seen.values()].sort((a, b) => {
    const aKey = a.classification === "known_unmapped" ? 0 : 1;
    const bKey = b.classification === "known_unmapped" ? 0 : 1;
    if (aKey !== bKey) return aKey - bKey;
    return a.field.localeCompare(b.field);
  });
  return { mapped_fields: [...mappedConsumed].sort(), unmapped };
}

function leafText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>)["#text"];
    if (text !== undefined && text !== null) return String(text).trim() || null;
  }
  return null;
}

function parseIsoDate(raw: string): Date | null {
  // Tolerate trailing Z; Date(...) handles ISO 8601 with offsets natively.
  const cleaned = raw.trim();
  const t = Date.parse(cleaned);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function fromNemsisXml(
  xml: string,
  opts: { patient_id?: string; now?: Date } = {},
): { patient: Patient; trace: NemsisConversionTrace; coverage: NemsisCoverageReport } {
  let parsed: unknown;
  try {
    parsed = PARSER.parse(xml);
  } catch (e) {
    throw new NemsisParseError(`could not parse XML: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") throw new NemsisParseError("empty XML");

  // Find PatientCareReport — could be at root or inside EMSDataSet.
  const root = parsed as Record<string, unknown>;
  let pcr: NemsisNode | null = null;
  const ds = root.EMSDataSet ?? root;
  if (ds && typeof ds === "object") {
    const arr = asArray((ds as Record<string, unknown>).PatientCareReport);
    if (arr.length > 0 && typeof arr[0] === "object") pcr = arr[0] as NemsisNode;
  }
  if (!pcr) throw new NemsisParseError("no PatientCareReport element found");

  const trace: NemsisConversionTrace = { extractions: [] };

  // patient_id
  const recordId = findText(pcr, ["eRecord", "eRecord.01"]);
  const pid = opts.patient_id ?? recordId ?? "P-NEMSIS";
  trace.extractions.push({
    field: "patient_id",
    source: opts.patient_id ? "defaulted" : recordId ? "extracted" : "defaulted",
    value: pid,
    nemsis_path: opts.patient_id ? null : "eRecord.01",
    notes: opts.patient_id ? "caller-provided" : (recordId ? null : "no eRecord.01; defaulted"),
  });

  // age
  const rawAge = findText(pcr, ["ePatient", "ePatient.15"]);
  const rawUnits = findText(pcr, ["ePatient", "ePatient.16"]);
  let age = 0;
  if (rawAge === null) {
    trace.extractions.push({
      field: "age_years", source: "defaulted", value: 0, nemsis_path: "ePatient.15",
      notes: "no age in PCR; defaulted to 0 (will hard-fail any age inclusion)",
    });
  } else {
    const n = Number.parseInt(rawAge, 10);
    if (!Number.isInteger(n)) {
      trace.extractions.push({
        field: "age_years", source: "defaulted", value: 0, nemsis_path: "ePatient.15", raw: rawAge,
        notes: `non-integer age ${JSON.stringify(rawAge)}; defaulted to 0`,
      });
    } else if (rawUnits && rawUnits !== "2516001") {
      trace.extractions.push({
        field: "age_years", source: "extracted", value: 0, nemsis_path: "ePatient.15",
        raw: `${rawAge} (units ${rawUnits})`, notes: "non-year age units → 0 years",
      });
    } else {
      age = clamp(n, 0, 120);
      trace.extractions.push({
        field: "age_years", source: "extracted", value: age, nemsis_path: "ePatient.15", raw: rawAge,
      });
    }
  }

  // sex
  const rawSex = findText(pcr, ["ePatient", "ePatient.13"]);
  let sex: Sex = "U";
  if (rawSex === null) {
    trace.extractions.push({
      field: "sex", source: "defaulted", value: "U", nemsis_path: "ePatient.13",
      notes: "no gender code in PCR; defaulted to 'U'",
    });
  } else if (rawSex in NEMSIS_GENDER) {
    sex = NEMSIS_GENDER[rawSex];
    trace.extractions.push({
      field: "sex", source: "extracted", value: sex, nemsis_path: "ePatient.13", raw: rawSex,
    });
  } else {
    trace.extractions.push({
      field: "sex", source: "defaulted", value: "U", nemsis_path: "ePatient.13", raw: rawSex,
      notes: `unrecognized gender code ${JSON.stringify(rawSex)}; defaulted to 'U'`,
    });
  }

  // vitals — use latest eVitalsGroup
  const vitalsGroups = asArray((pcr.eVitals as NemsisNode | undefined)?.eVitalsGroup);
  const latest = (vitalsGroups[vitalsGroups.length - 1] ?? null) as NemsisNode | null;

  function takeVital(local: string, label: string, def: number, lo: number, hi: number): number {
    if (!latest) {
      trace.extractions.push({
        field: label, source: "defaulted", value: def, nemsis_path: local,
        notes: "no eVitals section; defaulted",
      });
      return def;
    }
    const raw = findText(latest, [local]);
    if (raw === null) {
      trace.extractions.push({
        field: label, source: "defaulted", value: def, nemsis_path: local,
        notes: "not present in latest eVitalsGroup; defaulted",
      });
      return def;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n)) {
      trace.extractions.push({
        field: label, source: "defaulted", value: def, nemsis_path: local, raw,
        notes: `non-integer ${label}; defaulted`,
      });
      return def;
    }
    const v = clamp(n, lo, hi);
    trace.extractions.push({
      field: label, source: "extracted", value: v, nemsis_path: local, raw,
    });
    return v;
  }

  const gcs = takeVital("eVitals.23", "gcs", 15, 3, 15);
  const sbp = takeVital("eVitals.06", "sbp_mmhg", 120, 0, 300);
  const hr = takeVital("eVitals.10", "hr_bpm", 80, 0, 300);

  // mechanism
  const causeCode =
    findText(pcr, ["eSituation", "eSituation.02"]) ??
    findText(pcr, ["eInjury", "eInjury.01"]);
  let mechanism: Mechanism = "other";
  if (causeCode === null) {
    trace.extractions.push({
      field: "mechanism", source: "defaulted", value: "other", nemsis_path: "eSituation.02",
      notes: "no cause-of-injury code in PCR; defaulted to 'other'",
    });
  } else if (causeCode in NEMSIS_CAUSE_CODES) {
    mechanism = NEMSIS_CAUSE_CODES[causeCode];
    trace.extractions.push({
      field: "mechanism", source: "extracted", value: mechanism, nemsis_path: "eSituation.02", raw: causeCode,
      notes: "NEMSIS native cause code",
    });
  } else if (/^[A-Z]\d{2}/.test(causeCode)) {
    let matched = false;
    for (const [prefix, mech] of [...ICD10_PREFIXES].sort((a, b) => b[0].length - a[0].length)) {
      if (causeCode.startsWith(prefix)) {
        mechanism = mech;
        trace.extractions.push({
          field: "mechanism", source: "extracted", value: mechanism, nemsis_path: "eSituation.02",
          raw: causeCode, notes: `ICD-10 prefix ${JSON.stringify(prefix)}`,
        });
        matched = true;
        break;
      }
    }
    if (!matched) {
      trace.extractions.push({
        field: "mechanism", source: "defaulted", value: "other", nemsis_path: "eSituation.02", raw: causeCode,
        notes: "cause code not in our mapping table; defaulted to 'other'",
      });
    }
  } else {
    trace.extractions.push({
      field: "mechanism", source: "defaulted", value: "other", nemsis_path: "eSituation.02", raw: causeCode,
      notes: "cause code not in our mapping table; defaulted to 'other'",
    });
  }

  // pregnancy
  let pregnancy_status: PregnancyStatus;
  if (sex !== "F") {
    pregnancy_status = "not_applicable";
    trace.extractions.push({
      field: "pregnancy_status", source: "inferred", value: pregnancy_status, nemsis_path: null,
      notes: "patient sex is not F → not_applicable",
    });
  } else {
    const rawP = findText(pcr, ["eHistory", "eHistory.16"]);
    if (rawP === null) {
      pregnancy_status = "unknown_could_be_pregnant";
      trace.extractions.push({
        field: "pregnancy_status", source: "defaulted", value: pregnancy_status, nemsis_path: "eHistory.16",
        notes: "female patient, no pregnancy field; defaulted to 'unknown_could_be_pregnant' (conservative for trial enrollment)",
      });
    } else if (rawP in NEMSIS_PREGNANCY) {
      pregnancy_status = NEMSIS_PREGNANCY[rawP];
      trace.extractions.push({
        field: "pregnancy_status", source: "extracted", value: pregnancy_status, nemsis_path: "eHistory.16", raw: rawP,
      });
    } else {
      pregnancy_status = "unknown_could_be_pregnant";
      trace.extractions.push({
        field: "pregnancy_status", source: "defaulted", value: pregnancy_status, nemsis_path: "eHistory.16", raw: rawP,
        notes: `unrecognized pregnancy code ${JSON.stringify(rawP)}; conservative default`,
      });
    }
  }

  // anticoagulant_use
  const eHistory = pcr.eHistory as NemsisNode | undefined;
  let anticoagulant_use = false;
  if (!eHistory) {
    trace.extractions.push({
      field: "anticoagulant_use", source: "defaulted", value: false, nemsis_path: "eHistory.06",
      notes: "no eHistory; defaulted to False",
    });
  } else {
    // Collect every text value reachable from eHistory.06 entries — both the
    // direct text content and any nested code element text. Catches RxNorm
    // CUIs whether they sit at the root of eHistory.06 or nested inside.
    const rawValues: string[] = [];
    for (const m of asArray(eHistory["eHistory.06"])) {
      if (m === null || m === undefined) continue;
      if (typeof m === "string" || typeof m === "number") {
        rawValues.push(String(m).trim());
        continue;
      }
      if (typeof m === "object") {
        const obj = m as Record<string, unknown>;
        const text = obj["#text"];
        if (text !== undefined && text !== null) rawValues.push(String(text).trim());
        for (const [, v] of Object.entries(obj)) {
          if (v === null || v === undefined) continue;
          if (typeof v === "string" || typeof v === "number") rawValues.push(String(v).trim());
        }
      }
    }
    const cleaned = rawValues.filter(Boolean);

    // Channel 1: RxNorm CUI (deterministic)
    let matchedRxNorm: string | null = null;
    for (const v of cleaned) {
      if (ANTICOAGULANT_RXNORM_CUIS.has(v)) { matchedRxNorm = v; break; }
    }
    if (matchedRxNorm) {
      anticoagulant_use = true;
      trace.extractions.push({
        field: "anticoagulant_use", source: "inferred", value: true, nemsis_path: "eHistory.06", raw: matchedRxNorm,
        notes: `RxNorm CUI ${matchedRxNorm} matches anticoagulant list`,
      });
    } else {
      // Channel 2: substring match on free text
      const haystack = cleaned.join(" ").toLowerCase();
      let matchedString: string | null = null;
      for (const needle of ANTICOAGULANT_STRINGS) {
        if (haystack.includes(needle)) { matchedString = needle; break; }
      }
      if (matchedString) {
        anticoagulant_use = true;
        trace.extractions.push({
          field: "anticoagulant_use", source: "inferred", value: true, nemsis_path: "eHistory.06", raw: matchedString,
          notes: `medication list contains ${JSON.stringify(matchedString)}`,
        });
      } else {
        trace.extractions.push({
          field: "anticoagulant_use", source: cleaned.length > 0 ? "extracted" : "defaulted",
          value: false, nemsis_path: "eHistory.06",
          notes: cleaned.length > 0 ? "no anticoagulant code or substring matched" : "no eHistory.06 entries; defaulted to False",
        });
      }
    }
  }

  // eta_minutes — inferred from eTimes.07 (estimated/actual arrival at destination).
  // Floors at 0 if the unit has already landed; clamps at 480 (8h) to keep the
  // value within the Patient schema's bounds.
  const rawEta = findText(pcr, ["eTimes", "eTimes.07"]);
  let eta_minutes = 0;
  if (rawEta === null) {
    trace.extractions.push({
      field: "eta_minutes", source: "defaulted", value: 0, nemsis_path: "eTimes.07",
      notes: "no eTimes.07 (estimated/actual arrival) in PCR; defaulted to 0",
    });
  } else {
    const parsed = parseIsoDate(rawEta);
    if (parsed === null) {
      trace.extractions.push({
        field: "eta_minutes", source: "defaulted", value: 0, nemsis_path: "eTimes.07", raw: rawEta,
        notes: `could not parse eTimes.07 timestamp ${JSON.stringify(rawEta)}; defaulted to 0`,
      });
    } else {
      const reference = opts.now ?? new Date();
      const deltaSeconds = (parsed.getTime() - reference.getTime()) / 1000;
      eta_minutes = Math.max(0, Math.min(480, Math.floor(deltaSeconds / 60)));
      trace.extractions.push({
        field: "eta_minutes", source: "inferred", value: eta_minutes, nemsis_path: "eTimes.07", raw: rawEta,
        notes: `max(0, eTimes.07 − now) ≈ ${eta_minutes}m`,
      });
    }
  }

  // trauma_activation_level — simplified CDC field triage criteria.
  // Step 1 (physiology) → Level 1: GCS<=13 OR SBP<90.
  // Step 2 (anatomy/mechanism) → Level 2: penetrating mechanism OR (high-energy blunt + age>=55).
  // Otherwise → Level 3.
  let trauma_activation_level: number;
  if (gcs <= 13 || sbp < 90) {
    const reason = gcs <= 13 ? `GCS<=13 (${gcs})` : `SBP<90 (${sbp})`;
    trauma_activation_level = 1;
    trace.extractions.push({
      field: "trauma_activation_level", source: "inferred", value: 1, nemsis_path: null,
      notes: `CDC Step 1 physiology: ${reason} → Level 1`,
    });
  } else if (mechanism === "gsw" || mechanism === "stab" || mechanism === "blast" || mechanism === "crush") {
    trauma_activation_level = 2;
    trace.extractions.push({
      field: "trauma_activation_level", source: "inferred", value: 2, nemsis_path: null,
      notes: `penetrating/crush mechanism (${mechanism}) → Level 2`,
    });
  } else if ((mechanism === "blunt_mvc" || mechanism === "fall") && age >= 55) {
    trauma_activation_level = 2;
    trace.extractions.push({
      field: "trauma_activation_level", source: "inferred", value: 2, nemsis_path: null,
      notes: `high-energy blunt (${mechanism}) + age>=55 (${age}) → Level 2`,
    });
  } else {
    trauma_activation_level = 3;
    trace.extractions.push({
      field: "trauma_activation_level", source: "inferred", value: 3, nemsis_path: null,
      notes: "no Step 1 / Step 2 criteria met → Level 3",
    });
  }

  // Inferred clinical flags
  const presumed_tbi = inferPresumedTbi(gcs, mechanism, trace);
  const presumed_hemorrhage = inferPresumedHemorrhage(sbp, hr, mechanism, trace);
  const presumed_intracranial_hemorrhage = inferPresumedIch(presumed_tbi, gcs, trace);
  const spinal_injury_suspected = inferSpinalInjury(mechanism, gcs, trace);

  const patient: Patient = {
    patient_id: pid,
    age_years: age,
    sex,
    gcs,
    sbp_mmhg: sbp,
    hr_bpm: hr,
    mechanism,
    trauma_activation_level,
    eta_minutes,
    pregnancy_status,
    anticoagulant_use,
    presumed_tbi,
    presumed_hemorrhage,
    presumed_intracranial_hemorrhage,
    spinal_injury_suspected,
  };

  // Coverage report — what we mapped on this PCR vs. every NEMSIS field present
  // that we left on the floor. Mirror of Python's NemsisCoverageReport.
  const consumed = new Set<string>();
  for (const e of trace.extractions) {
    if (e.source === "extracted" && e.nemsis_path && NEMSIS_MAPPED.has(e.nemsis_path)) {
      consumed.add(e.nemsis_path);
    }
  }
  const coverage = walkCoverage(pcr, consumed);
  return { patient, trace, coverage };
}

export function traceCounts(trace: NemsisConversionTrace) {
  let extracted = 0, inferred = 0, defaulted = 0, skipped = 0;
  for (const e of trace.extractions) {
    if (e.source === "extracted") extracted++;
    else if (e.source === "inferred") inferred++;
    else if (e.source === "defaulted") defaulted++;
    else skipped++;
  }
  return { extracted, inferred, defaulted, skipped };
}
