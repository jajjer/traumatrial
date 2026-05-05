"""Discover candidate trauma trials from clinicaltrials.gov for bulk import.

Queries the CTG v2 API across several trauma/critical-care condition keywords,
filters to interventional Phase 2/3/4 RCTs that are recruiting or active,
dedupes by NCT ID, drops trials we already have under engine/trials/, and
prints the candidate list to stdout. NO LLM calls — that's parse_trial.py's
job. Review the printed list, save the NCT IDs you want to keep, then:

    python scripts/parse_trial.py $(cat keep.txt | tr '\\n' ' ')

Usage:
    python scripts/discover_trials.py
    python scripts/discover_trials.py --include-completed
    python scripts/discover_trials.py --query trauma --query "spinal cord injury"
    python scripts/discover_trials.py --output candidates.txt

The default condition queries cover the territory the existing 15 trials
already exercise — severe trauma, hemorrhage, TBI, cardiac arrest, polytrauma
resuscitation. Add --query strings to widen.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

CTG_API = "https://clinicaltrials.gov/api/v2/studies"

# Curated title-substring blocklist. The CTG full-text search "trauma" /
# "traumatic brain injury" pulls in a lot of off-target studies (rehab,
# behavioral health, surgical TXA, oncology). These titles consistently
# describe trials that don't map to a prehospital/ED Patient record. Override
# with --exclude='' if you want the raw set.
DEFAULT_EXCLUDES = (
    "post-concussion",
    "post traumatic stress",
    "ptsd",
    "rehabilitation",
    "neurorehabilitation",
    "spasticity",
    "stem cell",
    "mesenchymal",
    "growth hormone",
    "transcranial direct current",
    "tdcs",
    "rtms",
    "transcranial magnetic",
    "stem-cell",
    "spine surgery",
    "plastic surgery",
    "orthopaedic",
    "orthopedic",
    "gastrointestinal surgery",
    "gist",
    "myeloma",
    "dengue",
    "uremic syndrome",
    "cancer treatment",
    "alcohol use disorder",
    "audiometric",
    "hiv",
    "covid",
    "pediatric retinal",
    "concussion symptoms",
    "post-traumatic",  # most "post-traumatic X" trials are chronic, not prehospital
    "exercise",
    "depression",
    "headache",
    "concussion recovery",
    "photophobia",
    "epilepsy prevention",  # biperiden — chronic preventive, not prehospital
    "professional football",
    "veterans",
    "service members",
    "spinal anesthesia",
)

DEFAULT_QUERIES = (
    "hemorrhagic shock",
    "traumatic brain injury",
    "polytrauma resuscitation",
    "cardiac arrest resuscitation",
    "prehospital trauma",
    "trauma whole blood",
    "trauma fibrinogen",
    "trauma tranexamic acid",
)

# Default status filter: only currently-relevant trials. Add COMPLETED via
# --include-completed if you want trials that already wrapped (useful for
# the demo's "what would the engine have done?" angle).
DEFAULT_STATUSES = ("RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION")


def _build_filter(statuses: Iterable[str], phases: Iterable[str]) -> dict[str, str]:
    advanced_parts = ["AREA[StudyType]INTERVENTIONAL"]
    if phases:
        advanced_parts.append(f"AREA[Phase]({' OR '.join(phases)})")
    return {
        "filter.overallStatus": ",".join(statuses),
        "filter.advanced": " AND ".join(advanced_parts),
    }


def _http_get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (controlled host)
        return json.loads(r.read().decode("utf-8"))


def _query_one(
    cond: str, statuses: Iterable[str], phases: Iterable[str], page_size: int
) -> list[dict[str, Any]]:
    params = {
        "query.cond": cond,
        "pageSize": str(page_size),
        "countTotal": "true",
        **_build_filter(statuses, phases),
    }
    studies: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        if page_token:
            params["pageToken"] = page_token
        url = f"{CTG_API}?{urllib.parse.urlencode(params)}"
        data = _http_get_json(url)
        studies.extend(data.get("studies", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return studies


def _summarize(study: dict[str, Any]) -> dict[str, Any]:
    ps = study.get("protocolSection", {})
    ident = ps.get("identificationModule", {})
    status_mod = ps.get("statusModule", {})
    elig = ps.get("eligibilityModule", {})
    design = ps.get("designModule", {})
    cond_mod = ps.get("conditionsModule", {})

    phases = design.get("phases") or []
    return {
        "nct_id": ident.get("nctId", ""),
        "acronym": ident.get("acronym") or "",
        "title": ident.get("briefTitle", "")[:120],
        "status": status_mod.get("overallStatus", ""),
        "phase": "/".join(p.replace("PHASE", "P") for p in phases) if phases else "",
        "conditions": ", ".join(cond_mod.get("conditions", []))[:80],
        "has_criteria": bool((elig.get("eligibilityCriteria") or "").strip()),
    }


def _existing_nct_ids(trials_dir: Path) -> set[str]:
    if not trials_dir.is_dir():
        return set()
    return {p.stem for p in trials_dir.glob("NCT*.json")}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--query",
        action="append",
        default=None,
        help="Add a condition query (repeat to add more). Defaults to a curated trauma set.",
    )
    parser.add_argument(
        "--include-completed",
        action="store_true",
        help="Also include COMPLETED trials (default: only active/recruiting)",
    )
    parser.add_argument(
        "--phase",
        action="append",
        default=None,
        help="Restrict to phases (repeat). Defaults to PHASE2, PHASE3, PHASE4.",
    )
    parser.add_argument(
        "--page-size", type=int, default=100,
        help="Results per page (max 1000; 100 is usually plenty)",
    )
    parser.add_argument(
        "--trials-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "trials",
        help="Existing trials dir (NCTs already here are skipped)",
    )
    parser.add_argument(
        "--output", type=Path, default=None,
        help="Write the NCT ID list (one per line) to this file. Stdout if omitted.",
    )
    parser.add_argument(
        "--show-skipped", action="store_true",
        help="Print trials we already have under engine/trials/",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=None,
        help="Drop trials whose title contains this substring (case-insensitive). "
             "Repeat. Default applies a curated noise-reduction list; use "
             "--exclude='' to disable defaults.",
    )
    args = parser.parse_args()

    queries = args.query or list(DEFAULT_QUERIES)
    statuses = list(DEFAULT_STATUSES)
    if args.include_completed:
        statuses.append("COMPLETED")
    phases = args.phase or ["PHASE2", "PHASE3", "PHASE4"]

    existing = _existing_nct_ids(args.trials_dir)

    # Resolve excludes: --exclude may be repeated; passing --exclude='' once
    # disables defaults. Any non-empty user-supplied excludes replace defaults
    # entirely (so the list stays predictable when curating).
    if args.exclude is None:
        excludes = [e.lower() for e in DEFAULT_EXCLUDES]
    elif args.exclude == [""]:
        excludes = []
    else:
        excludes = [e.lower() for e in args.exclude if e]

    # Dedupe: union of all per-query results, keyed by NCT ID, first hit wins.
    seen: dict[str, dict[str, Any]] = {}
    per_query_counts: dict[str, int] = {}
    for q in queries:
        try:
            studies = _query_one(q, statuses, phases, args.page_size)
        except Exception as e:  # noqa: BLE001 — surface any network error
            print(f"!! query {q!r} failed: {e}", file=sys.stderr)
            continue
        per_query_counts[q] = len(studies)
        for s in studies:
            summ = _summarize(s)
            if not summ["nct_id"]:
                continue
            seen.setdefault(summ["nct_id"], summ)

    # Split: keep candidates with eligibility criteria text and not already imported
    keep: list[dict[str, Any]] = []
    skipped_existing: list[dict[str, Any]] = []
    skipped_no_criteria: list[dict[str, Any]] = []
    skipped_excluded: list[tuple[dict[str, Any], str]] = []
    for nct, summ in sorted(seen.items()):
        if nct in existing:
            skipped_existing.append(summ)
            continue
        if not summ["has_criteria"]:
            skipped_no_criteria.append(summ)
            continue
        title_lc = summ["title"].lower()
        match = next((kw for kw in excludes if kw in title_lc), None)
        if match:
            skipped_excluded.append((summ, match))
            continue
        keep.append(summ)

    print(f"# discover_trials — {len(keep)} candidates")
    print(f"# queries: {', '.join(queries)}")
    print(f"# statuses: {', '.join(statuses)}; phases: {', '.join(phases)}")
    print(f"# per-query result counts:")
    for q, n in per_query_counts.items():
        print(f"#   {q:40s} {n}")
    print(
        f"# already imported: {len(skipped_existing)}; "
        f"missing criteria: {len(skipped_no_criteria)}; "
        f"excluded by keyword: {len(skipped_excluded)}"
    )
    print()

    if args.show_skipped and skipped_excluded:
        print("# excluded by --exclude keyword:")
        for s, kw in skipped_excluded:
            print(f"#   {s['nct_id']}  [{kw}]  {s['title']}")
        print()

    if args.show_skipped and skipped_existing:
        print("# already in engine/trials/ (skipped):")
        for s in skipped_existing:
            print(f"#   {s['nct_id']}  {s['acronym']:14s}  {s['title']}")
        print()

    print(f"{'NCT_ID':12s}  {'ACR':14s}  {'STATUS':22s}  {'PHASE':8s}  TITLE")
    print(f"{'-'*12}  {'-'*14}  {'-'*22}  {'-'*8}  -----")
    for s in keep:
        print(
            f"{s['nct_id']:12s}  {s['acronym'][:14]:14s}  {s['status']:22s}  "
            f"{s['phase'][:8]:8s}  {s['title']}"
        )

    nct_lines = "\n".join(s["nct_id"] for s in keep) + "\n"
    if args.output:
        args.output.write_text(nct_lines)
        print(f"\n# wrote {len(keep)} NCT IDs to {args.output}")
    else:
        print()
        print("# Plain NCT ID list (paste into parse_trial.py):")
        print(nct_lines, end="")


if __name__ == "__main__":
    main()
