"""Backfill provenance fields onto pre-existing trial JSONs.

Trial files imported before provenance tracking existed have no
imported_at / parser_version / schema_version / source_* fields. This script
fills in the locally-derivable ones (imported_at = file mtime, parser_version
= "0", schema_version = current) and leaves source_* fields null so that
the first run of `check_freshness.py` records the baseline.

Idempotent: running it again only fills missing fields; it never overwrites
provenance already on a trial.

Usage:
    python scripts/backfill_provenance.py
    python scripts/backfill_provenance.py --output-dir trials --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traumatrial_match.schema import SCHEMA_VERSION  # noqa: E402

# Trials predating PARSER_VERSION="1" are stamped "0" so freshness checks can
# distinguish "parsed before we tracked this" from "parsed by a real version."
LEGACY_PARSER_VERSION = "0"


def _mtime_iso(path: Path) -> str:
    ts = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def backfill_one(path: Path, dry_run: bool) -> tuple[bool, list[str]]:
    """Returns (changed, list of fields filled)."""
    data = json.loads(path.read_text())
    md = data.setdefault("_metadata", {})
    filled: list[str] = []

    defaults = {
        "source": "clinicaltrials.gov",
        "imported_at": _mtime_iso(path),
        "parser_version": LEGACY_PARSER_VERSION,
        "schema_version": SCHEMA_VERSION,
        "source_url": f"https://clinicaltrials.gov/study/{data.get('trial_id', path.stem)}",
    }
    for key, value in defaults.items():
        if md.get(key) in (None, ""):
            md[key] = value
            filled.append(key)

    # Source state we can't know without a network call — leave explicit nulls
    # so check_freshness.py knows to treat the next fetch as the baseline.
    for key in ("source_last_update_posted", "source_overall_status", "source_criteria_sha256"):
        if key not in md:
            md[key] = None
            filled.append(key)

    if not filled:
        return False, []

    if not dry_run:
        path.write_text(json.dumps(data, indent=2) + "\n")
    return True, filled


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "trials",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = sorted(args.output_dir.glob("NCT*.json"))
    if not files:
        print(f"no trial files found under {args.output_dir}")
        return

    n_changed = 0
    for path in files:
        changed, filled = backfill_one(path, args.dry_run)
        if changed:
            n_changed += 1
            verb = "would fill" if args.dry_run else "filled"
            print(f"  {path.name}: {verb} {', '.join(filled)}")
        else:
            print(f"  {path.name}: already has provenance, skipped")

    suffix = " (dry run)" if args.dry_run else ""
    print(f"\n{n_changed}/{len(files)} trial files updated{suffix}.")


if __name__ == "__main__":
    main()
