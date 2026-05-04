"""Precompute match results for the demo.

Reads engine/patients/*.json and engine/trials/*.json, runs every patient against
every trial, and writes one JSON file per patient to demo/public/matches/ that
the Next.js app loads when its "Simulate Patient Arrival" button fires.

Run from the engine/ directory:
    python scripts/precompute.py
"""

from __future__ import annotations

import json
from pathlib import Path

from traumatrial_match.loader import load_patients, load_trials
from traumatrial_match.match import match_all


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    engine_dir = repo_root / "engine"
    out_dir = repo_root / "demo" / "public" / "matches"
    out_dir.mkdir(parents=True, exist_ok=True)

    patients = load_patients(engine_dir / "patients")
    trials = load_trials(engine_dir / "trials")

    print(f"Loaded {len(patients)} patients, {len(trials)} trials")

    # Per-patient match files
    for patient in patients:
        results = match_all(patient, trials)
        payload = {
            "patient": patient.model_dump(),
            "results": [r.model_dump() for r in results],
        }
        out_file = out_dir / f"{patient.patient_id}.json"
        out_file.write_text(json.dumps(payload, indent=2))

    # Index of trials so the demo can render headers, EFIC flags, etc.
    trials_index_file = out_dir.parent / "trials.json"
    trials_index_file.write_text(
        json.dumps([t.model_dump() for t in trials], indent=2)
    )

    # Index of patients so the demo can list available simulations
    patients_index_file = out_dir.parent / "patients.json"
    patients_index_file.write_text(
        json.dumps([p.model_dump() for p in patients], indent=2)
    )

    print(f"Wrote {len(patients)} match files to {out_dir.relative_to(repo_root)}")
    print(f"Wrote trials index to {trials_index_file.relative_to(repo_root)}")
    print(f"Wrote patients index to {patients_index_file.relative_to(repo_root)}")

    # Quick stdout summary so a human can sanity-check the matching behavior.
    print()
    print("Match summary (eligible trials per patient):")
    for patient in patients:
        eligible = [r for r in match_all(patient, trials) if r.eligible]
        names = ", ".join(f"{r.trial_id}({r.confidence:.2f})" for r in eligible) or "(none)"
        print(f"  {patient.patient_id} ({patient.mechanism}, GCS {patient.gcs}): {names}")


if __name__ == "__main__":
    main()
