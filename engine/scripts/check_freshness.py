"""Check whether cached trial JSONs are still in sync with clinicaltrials.gov.

For each trial under engine/trials/, fetches the live record from the v2 API
and compares to the cached `_metadata`:

  * If the source eligibility criteria text has changed (sha256 mismatch),
    the cached rules may no longer reflect the trial → report DRIFT.
  * If overallStatus has moved away from a recruiting-ish state, report
    NOT_RECRUITING (e.g., COMPLETED, WITHDRAWN, TERMINATED).
  * If lastUpdatePostDate moved forward but criteria_sha256 still matches,
    report SOFT_UPDATE — non-criteria fields changed; usually safe to ignore
    but worth knowing.
  * If the cached metadata has null source_* fields (e.g., from
    backfill_provenance.py), there's no baseline to compare against. Pass
    --baseline to write the current source state into those trial files,
    establishing a baseline for future runs.

This script is read-only by default. Pass --baseline to mutate trial files,
or --json to emit a machine-readable report.

Usage:
    python scripts/check_freshness.py
    python scripts/check_freshness.py --baseline    # populate null source_* fields
    python scripts/check_freshness.py --json > freshness.json
    python scripts/check_freshness.py --only NCT02407028 NCT05638581
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

try:
    import httpx
except ImportError:
    sys.stderr.write(
        "missing dependency 'httpx'. Install the parse extras:\n"
        "  pip install -e \".[parse]\"\n"
    )
    sys.exit(2)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.parse_trial import (  # noqa: E402
    CTG_API,
    criteria_sha256,
    extract_metadata,
)

# Statuses where the trial is plausibly still recruiting trauma patients.
# Anything else is reported as NOT_RECRUITING so a human can re-evaluate
# whether to keep matching against this trial.
RECRUITING_STATUSES = {
    "RECRUITING",
    "ENROLLING_BY_INVITATION",
    "NOT_YET_RECRUITING",
    "ACTIVE_NOT_RECRUITING",  # ongoing follow-up; rules may still be relevant
}


def fetch_trial(nct_id: str, client: httpx.Client) -> Optional[dict[str, Any]]:
    r = client.get(CTG_API.format(nct_id=nct_id))
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise RuntimeError(f"clinicaltrials.gov returned {r.status_code} for {nct_id}")
    return r.json()


def classify(cached_md: dict[str, Any], live: dict[str, Any]) -> dict[str, Any]:
    """Compare cached metadata to live ctgov state. Returns a dict with at
    least {status, reasons[]} and any human-readable diff fields."""
    live_hash = criteria_sha256(live["criteria_text"])
    live_status = live["status"]
    live_last_update = live["last_update_posted"]

    cached_hash = cached_md.get("source_criteria_sha256")
    cached_status = cached_md.get("source_overall_status")
    cached_last_update = cached_md.get("source_last_update_posted")

    reasons: list[str] = []
    flags: list[str] = []

    if cached_hash is None:
        flags.append("NO_BASELINE")
        reasons.append(
            "trial has no cached criteria hash; pass --baseline to record current state"
        )
    elif cached_hash != live_hash:
        flags.append("DRIFT")
        reasons.append("eligibilityCriteria text changed since import")

    if live_status not in RECRUITING_STATUSES:
        flags.append("NOT_RECRUITING")
        reasons.append(f"overallStatus is {live_status!r}")

    if (
        cached_hash is not None
        and cached_hash == live_hash
        and cached_last_update is not None
        and live_last_update is not None
        and live_last_update > cached_last_update
    ):
        flags.append("SOFT_UPDATE")
        reasons.append(
            f"lastUpdatePostDate moved {cached_last_update} → {live_last_update} "
            "but criteria text unchanged"
        )

    if not flags:
        flags.append("OK")

    return {
        "status": flags[0],
        "flags": flags,
        "reasons": reasons,
        "live_status": live_status,
        "live_last_update_posted": live_last_update,
        "live_criteria_sha256": live_hash,
        "cached_status": cached_status,
        "cached_last_update_posted": cached_last_update,
        "cached_criteria_sha256": cached_hash,
    }


def maybe_baseline(path: Path, data: dict[str, Any], result: dict[str, Any]) -> bool:
    """If --baseline is on and the trial has null source_* fields, populate
    them from the live state. Returns True if the file was modified."""
    md = data.setdefault("_metadata", {})
    changed = False
    if md.get("source_criteria_sha256") is None:
        md["source_criteria_sha256"] = result["live_criteria_sha256"]
        changed = True
    if md.get("source_overall_status") is None:
        md["source_overall_status"] = result["live_status"]
        changed = True
    if md.get("source_last_update_posted") is None:
        md["source_last_update_posted"] = result["live_last_update_posted"]
        changed = True
    if changed:
        path.write_text(json.dumps(data, indent=2) + "\n")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--trials-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "trials",
    )
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="Fill null source_* fields with current live state.",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="NCT_ID",
        help="Limit the check to these NCT IDs.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON report on stdout.")
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        help="Seconds to sleep between API calls (default 0.2).",
    )
    args = parser.parse_args()

    files = sorted(args.trials_dir.glob("NCT*.json"))
    if args.only:
        wanted = set(args.only)
        files = [p for p in files if p.stem in wanted]
    if not files:
        print("no trial files matched")
        return

    report: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    n_baselined = 0

    with httpx.Client(timeout=30.0) as client:
        for path in files:
            data = json.loads(path.read_text())
            md = data.get("_metadata") or {}
            nct_id = data.get("trial_id", path.stem)

            try:
                study = fetch_trial(nct_id, client)
            except Exception as e:
                entry = {"trial_id": nct_id, "status": "FETCH_ERROR", "reasons": [str(e)]}
                report.append(entry)
                counts["FETCH_ERROR"] = counts.get("FETCH_ERROR", 0) + 1
                if not args.json:
                    print(f"  {nct_id}: FETCH_ERROR — {e}")
                continue

            if study is None:
                entry = {"trial_id": nct_id, "status": "NOT_FOUND", "reasons": ["404 from clinicaltrials.gov"]}
                report.append(entry)
                counts["NOT_FOUND"] = counts.get("NOT_FOUND", 0) + 1
                if not args.json:
                    print(f"  {nct_id}: NOT_FOUND")
                continue

            live = extract_metadata(study)
            result = classify(md, live)
            entry = {"trial_id": nct_id, **result}

            if args.baseline and "NO_BASELINE" in result["flags"]:
                if maybe_baseline(path, data, result):
                    n_baselined += 1
                    entry["baselined"] = True

            report.append(entry)
            counts[result["status"]] = counts.get(result["status"], 0) + 1

            if not args.json:
                short = result["status"]
                detail = "; ".join(result["reasons"]) if result["reasons"] else ""
                tail = f" — {detail}" if detail else ""
                print(f"  {nct_id}: {short}{tail}")

            time.sleep(args.sleep)

    if args.json:
        print(json.dumps({"summary": counts, "trials": report}, indent=2))
        return

    print()
    print("Summary:")
    for k in sorted(counts):
        print(f"  {k}: {counts[k]}")
    if args.baseline:
        print(f"  baselined: {n_baselined}")


if __name__ == "__main__":
    main()
