import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fromNemsisXml } from "../dist/nemsis.js";

// Reuse the Python engine's noisy fixture suite — keeps Python and TS adapters
// asserting the same behavior on identical inputs.
const FIXTURES = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "engine",
  "tests",
  "fixtures",
  "nemsis",
);
const loadFixture = (name) =>
  readFileSync(path.join(FIXTURES, name), "utf-8");

const HEMORRHAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<EMSDataSet xmlns="http://www.nemsis.org">
  <PatientCareReport>
    <eRecord><eRecord.01>SYN-P001</eRecord.01></eRecord>
    <ePatient>
      <ePatient.13>9906003</ePatient.13>
      <ePatient.15>34</ePatient.15>
      <ePatient.16>2516001</ePatient.16>
    </ePatient>
    <eHistory><eHistory.16>3133003</eHistory.16></eHistory>
    <eVitals>
      <eVitalsGroup>
        <eVitals.06>82</eVitals.06>
        <eVitals.10>128</eVitals.10>
        <eVitals.23>7</eVitals.23>
      </eVitalsGroup>
    </eVitals>
    <eSituation><eSituation.02>V43.5XXA</eSituation.02></eSituation>
  </PatientCareReport>
</EMSDataSet>`;

test("hemorrhage round-trip produces expected Patient", () => {
  const { patient, trace } = fromNemsisXml(HEMORRHAGE_XML);
  assert.equal(patient.age_years, 34);
  assert.equal(patient.sex, "M");
  assert.equal(patient.gcs, 7);
  assert.equal(patient.sbp_mmhg, 82);
  assert.equal(patient.hr_bpm, 128);
  assert.equal(patient.mechanism, "blunt_mvc");
  assert.equal(patient.presumed_hemorrhage, true);
  assert.equal(patient.presumed_tbi, true);
  assert.equal(patient.presumed_intracranial_hemorrhage, true);

  // The trace should record the source for every Patient field
  const fields = new Set(trace.extractions.map((e) => e.field));
  assert.ok(fields.has("age_years"));
  assert.ok(fields.has("mechanism"));
  assert.ok(fields.has("presumed_hemorrhage"));
});

test("anticoagulant inferred from medication substring", () => {
  const xml = `<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"><PatientCareReport>
  <eRecord><eRecord.01>X</eRecord.01></eRecord>
  <ePatient><ePatient.13>9906001</ePatient.13><ePatient.15>62</ePatient.15><ePatient.16>2516001</ePatient.16></ePatient>
  <eHistory>
    <eHistory.06>Apixaban 5mg PO BID</eHistory.06>
    <eHistory.16>3133003</eHistory.16>
  </eHistory>
</PatientCareReport></EMSDataSet>`;
  const { patient } = fromNemsisXml(xml);
  assert.equal(patient.anticoagulant_use, true);
});

// ---------- noisy persona round-trips (shared fixtures with Python) ----------

test("P-002 namespaced + multi-vitals + non-anticoag meds", () => {
  const { patient, trace } = fromNemsisXml(
    loadFixture("persona-002-geriatric-fall.xml"),
  );
  assert.equal(patient.patient_id, "SYN-P002-FALL");
  assert.equal(patient.age_years, 67);
  assert.equal(patient.sex, "F");
  assert.equal(patient.gcs, 14);
  assert.equal(patient.sbp_mmhg, 134);
  assert.equal(patient.hr_bpm, 88);
  assert.equal(patient.mechanism, "fall");
  assert.equal(patient.pregnancy_status, "not_pregnant");
  assert.equal(patient.anticoagulant_use, false);
  // Adapter rule: fall + age>=55 → activation Level 2
  assert.equal(patient.trauma_activation_level, 2);
  const preg = trace.extractions.find((e) => e.field === "pregnancy_status");
  assert.equal(preg.source, "extracted");
});

test("P-003 GSW + missing eHistory + ICD-10 X95 prefix", () => {
  const { patient, trace } = fromNemsisXml(loadFixture("persona-003-gsw.xml"));
  assert.equal(patient.age_years, 28);
  assert.equal(patient.sex, "M");
  assert.equal(patient.gcs, 15);
  assert.equal(patient.sbp_mmhg, 70);
  assert.equal(patient.hr_bpm, 138);
  assert.equal(patient.mechanism, "gsw");
  assert.equal(patient.anticoagulant_use, false);
  assert.equal(patient.presumed_hemorrhage, true);
  assert.equal(patient.trauma_activation_level, 1);
  const ac = trace.extractions.find((e) => e.field === "anticoagulant_use");
  assert.equal(ac.source, "defaulted");
});

test("P-004 latest-vitals wins over earlier out-of-range group", () => {
  const { patient } = fromNemsisXml(loadFixture("persona-004-tbi-mvc.xml"));
  // Earlier group has HR=350; adapter must use the second group's HR=102
  assert.equal(patient.gcs, 9);
  assert.equal(patient.sbp_mmhg, 110);
  assert.equal(patient.hr_bpm, 102);
  assert.equal(patient.mechanism, "blunt_mvc"); // via eInjury.01 fallback
  assert.equal(patient.presumed_tbi, true);
  // GCS=9 (>8) → presumed_ich is False per the rule
  assert.equal(patient.presumed_intracranial_hemorrhage, false);
});

test("P-005 anticoag via nested RxNorm CUI (1114195 = rivaroxaban)", () => {
  const { patient, trace } = fromNemsisXml(
    loadFixture("persona-005-anticoag-mvc.xml"),
  );
  assert.equal(patient.age_years, 19);
  assert.equal(patient.sex, "M");
  assert.equal(patient.mechanism, "blunt_mvc"); // NEMSIS native code 2120001
  assert.equal(patient.anticoagulant_use, true);
  const ac = trace.extractions.find((e) => e.field === "anticoagulant_use");
  assert.equal(ac.source, "inferred");
  assert.ok(String(ac.notes).includes("1114195"));
  // Adapter doesn't bump activation for anticoag — Level 3 (persona JSON has 2)
  assert.equal(patient.trauma_activation_level, 3);
});

test("P-006 explicit pregnant code respected over age inference", () => {
  const { patient } = fromNemsisXml(
    loadFixture("persona-006-pregnant-fall.xml"),
  );
  assert.equal(patient.age_years, 52);
  assert.equal(patient.sex, "F");
  assert.equal(patient.pregnancy_status, "pregnant");
  assert.equal(patient.gcs, 9);
  assert.equal(patient.sbp_mmhg, 78);
  assert.equal(patient.hr_bpm, 124);
  assert.equal(patient.mechanism, "fall");
  assert.equal(patient.trauma_activation_level, 1);
  assert.equal(patient.presumed_hemorrhage, true);
  assert.equal(patient.presumed_tbi, true);
  // Persona has presumed_ich=true, adapter rule (GCS<=8) gives false here
  assert.equal(patient.presumed_intracranial_hemorrhage, false);
});

test("P-008 caller-provided ID + unmapped cause code falls to 'other'", () => {
  const { patient, trace } = fromNemsisXml(
    loadFixture("persona-008-pediatric-mvc.xml"),
    { patient_id: "P-008" },
  );
  assert.equal(patient.patient_id, "P-008");
  const pid = trace.extractions.find((e) => e.field === "patient_id");
  assert.equal(pid.notes, "caller-provided");
  assert.equal(patient.age_years, 8);
  // Documented adapter limitation: when eSituation.02 is present but unmapped,
  // adapter does NOT fall through to eInjury.01 → mechanism becomes 'other'.
  assert.equal(patient.mechanism, "other");
});

// ---------- adversarial: known false-positive in substring matcher ----------

test("substring matcher false-positive on allergy note (current behavior)", () => {
  const { patient, trace } = fromNemsisXml(
    loadFixture("adversarial-substring-trap.xml"),
  );
  // Pinned to current (incorrect) behavior. A future hardening pass parses
  // eHistory.06 into structured fields and this flips to false.
  assert.equal(patient.anticoagulant_use, true);
  const ac = trace.extractions.find((e) => e.field === "anticoagulant_use");
  assert.ok(String(ac.notes).includes("warfarin"));
});
