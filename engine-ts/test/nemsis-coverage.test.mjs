import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fromNemsisXml } from "../dist/nemsis.js";

// Reuse the Python engine's noisy fixture suite — keeps the TS coverage
// adapter asserting the same behavior on identical inputs.
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
const loadFixture = (name) => readFileSync(path.join(FIXTURES, name), "utf-8");

test("realistic ePCR surfaces ≥20 known unmapped fields, 0 unknowns", () => {
  const { coverage } = fromNemsisXml(loadFixture("realistic-mva-polytrauma.xml"));
  assert.ok(coverage.mapped_fields.length >= 5, `mapped=${coverage.mapped_fields.length}`);
  const known = coverage.unmapped.filter((e) => e.classification === "known_unmapped");
  const unknown = coverage.unmapped.filter((e) => e.classification === "unknown");
  assert.ok(known.length >= 20, `known unmapped=${known.length}`);
  assert.equal(unknown.length, 0, `unexpected unknowns: ${unknown.map((e) => e.field).join(", ")}`);
});

test("realistic ePCR includes high-signal skipped sections", () => {
  const { coverage } = fromNemsisXml(loadFixture("realistic-mva-polytrauma.xml"));
  const fields = new Set(coverage.unmapped.map((e) => e.field));
  for (const expected of [
    "eVitals.14", "eVitals.20",
    "eExam.13", "eExam.18",
    "eMedications.03",
    "eProcedures.03",
    "eDisposition.20",
    "eNarrative.01",
  ]) {
    assert.ok(fields.has(expected), `expected ${expected} in unmapped`);
  }
});

test("known unmapped entries carry a description", () => {
  const { coverage } = fromNemsisXml(loadFixture("realistic-mva-polytrauma.xml"));
  for (const entry of coverage.unmapped) {
    if (entry.classification === "known_unmapped") {
      assert.ok(entry.description, `known_unmapped ${entry.field} missing description`);
    }
  }
});

test("persona-001 minimal fixture has few unmapped fields", () => {
  const { coverage } = fromNemsisXml(loadFixture("persona-001-hemorrhage.xml"));
  const known = coverage.unmapped.filter((e) => e.classification === "known_unmapped");
  assert.ok(known.length <= 3, `expected ≤3 known unmapped, got ${known.length}`);
  const unknown = coverage.unmapped.filter((e) => e.classification === "unknown");
  assert.equal(unknown.length, 0);
});

test("made-up element name lands in 'unknown'", () => {
  const xml = `<?xml version="1.0"?>
<EMSDataSet xmlns="http://www.nemsis.org"><PatientCareReport>
  <eRecord><eRecord.01>X</eRecord.01></eRecord>
  <ePatient><ePatient.13>9906003</ePatient.13><ePatient.15>30</ePatient.15><ePatient.16>2516001</ePatient.16></ePatient>
  <eVitals><eVitalsGroup>
    <eVitals.06>120</eVitals.06><eVitals.10>80</eVitals.10><eVitals.23>15</eVitals.23>
  </eVitalsGroup></eVitals>
  <eSituation><eSituation.02>V40</eSituation.02></eSituation>
  <eFakeSection><eFake.99>some-value</eFake.99></eFakeSection>
</PatientCareReport></EMSDataSet>`;
  const { coverage } = fromNemsisXml(xml);
  const fake = coverage.unmapped.find((e) => e.field === "eFake.99");
  assert.ok(fake);
  assert.equal(fake.classification, "unknown");
  assert.equal(fake.sample_value, "some-value");
  assert.equal(fake.description, null);
});

test("ETA inferred from eTimes.07 with fixed 'now'", () => {
  // Realistic fixture's eTimes.07 = 2026-05-04T13:21:43-05:00 (= 18:21:43 UTC).
  const now = new Date("2026-05-04T18:14:00Z"); // 7m43s before arrival
  const { trace } = fromNemsisXml(loadFixture("realistic-mva-polytrauma.xml"), { now });
  const eta = trace.extractions.find((e) => e.field === "eta_minutes");
  assert.equal(eta.source, "inferred");
  assert.equal(eta.value, 7);
});

test("ETA floors at 0 when already arrived", () => {
  const now = new Date("2026-05-04T19:00:00Z"); // 38m after arrival
  const { trace } = fromNemsisXml(loadFixture("realistic-mva-polytrauma.xml"), { now });
  const eta = trace.extractions.find((e) => e.field === "eta_minutes");
  assert.equal(eta.source, "inferred");
  assert.equal(eta.value, 0);
});

test("ETA defaulted when eTimes.07 missing", () => {
  const { trace } = fromNemsisXml(loadFixture("persona-001-hemorrhage.xml"));
  const eta = trace.extractions.find((e) => e.field === "eta_minutes");
  assert.equal(eta.source, "defaulted");
  assert.equal(eta.value, 0);
});
