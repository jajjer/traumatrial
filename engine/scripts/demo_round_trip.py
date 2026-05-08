"""End-to-end demonstration: NEMSIS v3.5 ePCR XML → eligible trials.

Reads a NEMSIS XML file, runs it through the adapter to a Patient, evaluates
that Patient against the bundled trial corpus, and prints the full round-trip
to stdout.

This is the artifact you point a research coordinator at when they ask
"so what does this engine actually do with one of our exports?" — it shows
every value extracted from XML, every inferred clinical flag, every trial
that comes back eligible, and the failing clause for excluded trials.

Run from the engine/ directory:

    python3 scripts/demo_round_trip.py tests/fixtures/nemsis/realistic-mva-polytrauma.xml

Or pipe an XML on stdin:

    cat my-export.xml | python3 scripts/demo_round_trip.py -

No deps beyond the engine itself. Synthetic XML only — never real PHI.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from traumatrial_match import from_nemsis_xml, match_all
from traumatrial_match.loader import load_trials


def _section(title: str) -> None:
    print()
    print("=" * 76)
    print(title)
    print("=" * 76)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "xml_file",
        help="path to a NEMSIS v3.5 PatientCareReport XML, or '-' for stdin",
    )
    parser.add_argument(
        "--trials-dir",
        default=str(Path(__file__).resolve().parents[1] / "trials"),
        help="directory of trial JSON files (default: engine/trials)",
    )
    args = parser.parse_args()

    if args.xml_file == "-":
        xml = sys.stdin.read()
    else:
        xml = Path(args.xml_file).read_text()

    patient, trace, coverage = from_nemsis_xml(xml)
    trials = load_trials(args.trials_dir)

    _section(f"NEMSIS → Patient (XML: {args.xml_file})")
    print(
        f"  patient_id   {patient.patient_id}\n"
        f"  age / sex    {patient.age_years} / {patient.sex}\n"
        f"  vitals       GCS {patient.gcs}  SBP {patient.sbp_mmhg}  HR {patient.hr_bpm}\n"
        f"  mechanism    {patient.mechanism}\n"
        f"  activation   Level {patient.trauma_activation_level}  ETA {patient.eta_minutes}m\n"
        f"  pregnancy    {patient.pregnancy_status}\n"
        f"  anticoag     {patient.anticoagulant_use}\n"
        f"  flags        TBI={patient.presumed_tbi} hemo={patient.presumed_hemorrhage} "
        f"ICH={patient.presumed_intracranial_hemorrhage} spine={patient.spinal_injury_suspected}"
    )

    _section(
        f"Field-by-field conversion trace "
        f"(extracted={trace.extracted_count} · inferred={trace.inferred_count} "
        f"· defaulted={trace.defaulted_count} · skipped={trace.skipped_count})"
    )
    for line in trace.summary_lines():
        print(line)

    _section(coverage.summary_line())
    if coverage.unmapped:
        for entry in coverage.unmapped[:12]:
            tag = entry.classification.replace("_", " ").upper().ljust(15)
            desc = entry.description or "—"
            sample = (
                f"  e.g. {entry.sample_value!r}" if entry.sample_value else ""
            )
            print(f"  [{tag}] {entry.field:<28} {desc}{sample}")
        if len(coverage.unmapped) > 12:
            print(f"  ... and {len(coverage.unmapped) - 12} more unmapped fields")

    results = match_all(patient, trials)
    eligible = [r for r in results if r.eligible]
    excluded = [r for r in results if not r.eligible]

    _section(
        f"Match results: {len(eligible)} eligible / {len(trials)} trials evaluated"
    )
    for r in sorted(eligible, key=lambda x: -x.confidence):
        trial = next(t for t in trials if t.trial_id == r.trial_id)
        flag = " · EFIC" if trial.requires_efic else ""
        skipped_n = (
            len(trial.metadata.skipped_criteria) if trial.metadata else 0
        )
        skip_note = (
            f" · {skipped_n} criteria skipped during import" if skipped_n else ""
        )
        print(
            f"  ✓ {r.trial_id:<14} {trial.short_name[:46]:<48} "
            f"conf={r.confidence:.2f}{flag}{skip_note}"
        )

    _section(
        "First failing hard clause for excluded trials "
        "(why this patient didn't surface)"
    )
    for r in excluded[:8]:
        trial = next(t for t in trials if t.trial_id == r.trial_id)
        fail = next(
            (
                c for c in r.trace
                if c.hard
                and (c.kind == "inclusion" and not c.hit
                     or c.kind == "exclusion" and c.hit)
            ),
            None,
        )
        if fail:
            print(
                f"  ✗ {r.trial_id:<14} {trial.short_name[:36]:<38} "
                f"fails: {fail.clause}  (patient = {fail.patient_value!r})"
            )
    if len(excluded) > 8:
        print(f"  ... and {len(excluded) - 8} more excluded trials")

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
