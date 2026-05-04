import { test } from "node:test";
import assert from "node:assert/strict";

import { fromNemsisXml } from "../dist/nemsis.js";

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
