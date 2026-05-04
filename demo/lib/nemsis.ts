// TS port of engine/traumatrial_match/nemsis.py.
// Same field-by-field semantics. Uses fast-xml-parser for the parse step;
// everything downstream (mappings, inference, trace) mirrors the Python.

import { XMLParser } from "fast-xml-parser";

import type { Mechanism, Patient, PregnancyStatus, Sex } from "./types";

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

export function fromNemsisXml(xml: string, opts: { patient_id?: string } = {}): { patient: Patient; trace: NemsisConversionTrace } {
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
    const meds = asArray(eHistory["eHistory.06"]).map((m) => {
      if (typeof m === "string") return m;
      if (m && typeof m === "object") {
        const text = (m as Record<string, unknown>)["#text"];
        return text === undefined ? "" : String(text);
      }
      return String(m ?? "");
    });
    const haystack = meds.join(" ").toLowerCase();
    let matched: string | null = null;
    for (const needle of ANTICOAGULANT_STRINGS) {
      if (haystack.includes(needle)) { matched = needle; break; }
    }
    if (matched) {
      anticoagulant_use = true;
      trace.extractions.push({
        field: "anticoagulant_use", source: "inferred", value: true, nemsis_path: "eHistory.06", raw: matched,
        notes: `medication list contains ${JSON.stringify(matched)}`,
      });
    } else {
      trace.extractions.push({
        field: "anticoagulant_use", source: meds.length > 0 ? "extracted" : "defaulted",
        value: false, nemsis_path: "eHistory.06",
        notes: meds.length > 0 ? "no anticoagulant substring matched" : "no eHistory.06 entries; defaulted to False",
      });
    }
  }

  // eta_minutes
  trace.extractions.push({
    field: "eta_minutes", source: "defaulted", value: 0, nemsis_path: "eTimes.07",
    notes: "ETA inference (current time - estimated arrival) is out of scope for v0; defaulted to 0",
  });
  const eta_minutes = 0;

  // trauma_activation_level
  trace.extractions.push({
    field: "trauma_activation_level", source: "defaulted", value: 2, nemsis_path: null,
    notes: "no canonical NEMSIS activation field in v0 mapping; defaulted to level 2",
  });
  const trauma_activation_level = 2;

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
  return { patient, trace };
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
