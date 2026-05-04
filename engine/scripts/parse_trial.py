"""Auto-parse a clinicaltrials.gov trial into a structured Rule JSON.

Fetches a trial from the public clinicaltrials.gov v2 API, sends the
inclusion/exclusion criteria text to Claude with our Rule schema as the
contract, validates the response with pydantic, and writes a Trial JSON to
engine/trials/.

This is the demo's force multiplier: a coordinator can paste an NCT ID and
watch it become structured rules. The schema is the constraint that keeps
the LLM honest — anything that can't fit the 8-operator vocabulary gets
listed in metadata.skipped_criteria, not silently dropped or hallucinated.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python scripts/parse_trial.py NCT05638581
    python scripts/parse_trial.py NCT05638581 NCT04217551 --overwrite
    python scripts/parse_trial.py NCT05638581 --output-dir trials --model claude-opus-4-7

Install the optional parse extras first:
    pip install -e ".[parse]"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import httpx
    from anthropic import Anthropic
    from pydantic import ValidationError
except ImportError as exc:
    sys.stderr.write(
        f"missing dependency: {exc.name!r}.\n"
        "Install the parse extras:  pip install -e \".[parse]\"\n"
    )
    sys.exit(2)

# Add parent (engine/) to path so we can import the package without install
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _load_dotenv() -> None:
    """Tiny stdlib .env loader. Looks in repo root and engine/. No deps."""
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / ".env",  # repo root
        here.parents[1] / ".env",  # engine/.env
    ]
    for candidate in candidates:
        if not candidate.is_file():
            continue
        for raw in candidate.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

from traumatrial_match.schema import (  # noqa: E402
    OPERATORS,
    PATIENT_FIELD_TYPES,
    Trial,
)

CTG_API = "https://clinicaltrials.gov/api/v2/studies/{nct_id}?format=json"

DEFAULT_MODEL = "claude-sonnet-4-6"


SYSTEM_PROMPT = """You convert clinical trial eligibility criteria into structured JSON rules for the traumatrial-match engine.

You may ONLY use these patient fields, and the value must match the field's type EXACTLY:

{fields}

You may ONLY use these operators: {operators}

For `in` and `not_in`, the value must be a non-empty list whose elements all match the field type. For all others, the value must be a scalar matching the field type. NEVER invent enum values not in the allowed list above. NEVER pass a string where an int is expected (e.g., trauma_activation_level is an int 1-3, NOT a string label).

Each rule has: field (one of the allowed fields), op (one of the allowed operators), value (typed), hard (bool: true if the criterion is a hard dealbreaker, false if it's a soft preference / nice-to-have).

If a criterion CANNOT be expressed cleanly using the allowed fields and operators (e.g., it requires a field that doesn't exist, temporal logic like "within 3 hours of injury", compound boolean trees, lab values, prior medical history not in the schema), DO NOT invent a rule for it. List it in metadata.skipped_criteria with a one-sentence explanation.

If a criterion is partially expressible, encode the part that fits and add the unencoded part to metadata.skipped_criteria.

Be conservative: hard=true ONLY when missing/violating that criterion definitely excludes the patient. Otherwise hard=false.

Avoid tautological rule pairs. If you encode "age >= X" as a hard inclusion, do NOT also add "age < X" as a hard exclusion — the inclusion already covers it.

Prefer `in` over multiple `eq`. If two clauses test the same field with the same operator (e.g., pregnancy_status eq 'pregnant' AND pregnancy_status eq 'unknown_could_be_pregnant'), MERGE them into one `in` rule.

If the trial title contains a recognized acronym in parentheses (e.g., "Foo Bar (FIT-BRAIN) Trial"), use the acronym as short_name — never the truncated full title.

Output valid JSON only — no prose, no markdown fences, no preamble."""


def _format_field_for_prompt(field: str, meta: dict) -> str:
    kind = meta["type"]
    if kind == "int":
        lo, hi = meta["range"]
        return f"- {field}: int (range {lo}-{hi})"
    if kind == "bool":
        return f"- {field}: bool (true/false only)"
    if kind == "enum":
        values = ", ".join(repr(v) for v in meta["values"])
        return f"- {field}: enum, must be one of [{values}]"
    return f"- {field}: {kind}"


USER_PROMPT_TEMPLATE = """Trial: {trial_id} ({short_name})
Title: {title}
Phase: {phase}

Inclusion/exclusion criteria from clinicaltrials.gov:

{criteria_text}

Convert this trial into JSON with this exact shape:

{{
  "trial_id": "{trial_id}",
  "short_name": "{short_name}",
  "title": "{title}",
  "requires_efic": <true|false based on whether this trial requires Exception from Informed Consent>,
  "phase": "{phase}",
  "inclusion": [
    {{"field": "<field>", "op": "<op>", "value": <value>, "hard": <bool>}},
    ...
  ],
  "exclusion": [
    {{"field": "<field>", "op": "<op>", "value": <value>, "hard": <bool>}},
    ...
  ],
  "metadata": {{
    "source": "clinicaltrials.gov",
    "skipped_criteria": [
      "Original criterion text (one-sentence reason it can't fit the schema)",
      ...
    ]
  }}
}}

Output the JSON object only. No markdown, no commentary."""


def fetch_trial(nct_id: str) -> dict[str, Any]:
    url = CTG_API.format(nct_id=nct_id)
    r = httpx.get(url, timeout=30.0)
    if r.status_code != 200:
        raise SystemExit(f"clinicaltrials.gov returned {r.status_code} for {nct_id}: {r.text[:300]}")
    return r.json()


_PARENS_RE = re.compile(r"\(([A-Z][A-Z0-9\-]{1,15}(?:\s*[A-Z0-9\-]+)?)\)")


def _short_name_from_title(title: str) -> str | None:
    """Pull an acronym from a brief title like 'Foo Bar (FIT-BRAIN) Trial'."""
    m = _PARENS_RE.search(title)
    return m.group(1) if m else None


def extract_metadata(study: dict[str, Any]) -> dict[str, Any]:
    ps = study.get("protocolSection", {})
    ident = ps.get("identificationModule", {})
    status = ps.get("statusModule", {})
    elig = ps.get("eligibilityModule", {})
    design = ps.get("designModule", {})

    phases = design.get("phases") or [design.get("phase") or "?"]
    phase = phases[0] if phases else "?"

    title = ident.get("briefTitle", "?")
    short_name = (
        ident.get("acronym")
        or _short_name_from_title(title)
        or title  # full title, the LLM is told to compress this if no acronym exists
    )

    return {
        "trial_id": ident.get("nctId", "?"),
        "short_name": short_name,
        "title": title,
        "phase": phase,
        "status": status.get("overallStatus", "?"),
        "criteria_text": elig.get("eligibilityCriteria", ""),
    }


def _build_system_prompt() -> str:
    return SYSTEM_PROMPT.format(
        fields="\n".join(
            _format_field_for_prompt(f, m) for f, m in PATIENT_FIELD_TYPES.items()
        ),
        operators=", ".join(OPERATORS),
    )


def _build_user_prompt(meta: dict[str, Any]) -> str:
    return USER_PROMPT_TEMPLATE.format(
        trial_id=meta["trial_id"],
        short_name=meta["short_name"],
        title=meta["title"],
        phase=meta["phase"],
        criteria_text=meta["criteria_text"],
    )


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.rsplit("```", 1)[0].strip()
    return text


def call_llm(
    client: Anthropic,
    model: str,
    messages: list[dict[str, str]],
    system: str,
) -> dict[str, Any]:
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0.0,
        system=system,
        messages=messages,  # type: ignore[arg-type]
    )
    text = "".join(block.text for block in resp.content if hasattr(block, "text"))
    text = _strip_fences(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"\nLLM returned invalid JSON: {e}\n--- raw response ---\n{text}\n")
        raise SystemExit(1) from e


def validate_and_write(
    payload: dict[str, Any], out_path: Path, overwrite: bool
) -> Trial:
    metadata = payload.pop("metadata", None)
    trial = Trial.model_validate(payload)
    if out_path.exists() and not overwrite:
        raise SystemExit(
            f"refusing to overwrite {out_path} (pass --overwrite or remove it first)"
        )
    out = trial.model_dump()
    if metadata:
        out["_metadata"] = metadata  # underscore-prefixed = ignored by Trial schema, kept for humans
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    return trial


MAX_LLM_ATTEMPTS = 3


def parse_one(
    nct_id: str, client: Anthropic, model: str, output_dir: Path, overwrite: bool
) -> None:
    print(f"\n=== {nct_id} ===")
    print("  fetching from clinicaltrials.gov ...")
    study = fetch_trial(nct_id)
    meta = extract_metadata(study)
    print(f"  status: {meta['status']}")
    print(f"  title:  {meta['title']}")
    if not meta["criteria_text"]:
        sys.stderr.write(f"  no eligibility criteria text returned for {nct_id}\n")
        return

    system = _build_system_prompt()
    user = _build_user_prompt(meta)
    messages: list[dict[str, str]] = [{"role": "user", "content": user}]

    payload: dict[str, Any] | None = None
    last_error: str | None = None
    for attempt in range(1, MAX_LLM_ATTEMPTS + 1):
        suffix = f" (attempt {attempt}/{MAX_LLM_ATTEMPTS})" if attempt > 1 else ""
        print(f"  asking {model} to convert criteria into rules{suffix} ...")
        candidate = call_llm(client, model, messages, system)
        try:
            metadata = candidate.get("metadata")
            Trial.model_validate({k: v for k, v in candidate.items() if k != "metadata"})
            payload = candidate
            payload["metadata"] = metadata or {}
            break
        except ValidationError as e:
            last_error = str(e)
            short = last_error.splitlines()[0] if last_error else "validation error"
            print(f"  validation failed: {short}")
            if attempt == MAX_LLM_ATTEMPTS:
                break
            messages.append({"role": "assistant", "content": json.dumps(candidate)})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "That JSON failed pydantic validation against the engine's "
                        "rule schema. The errors were:\n\n"
                        f"{last_error}\n\n"
                        "Re-emit the entire JSON object with these errors fixed. "
                        "Stay strictly within the allowed fields, types, and operators. "
                        "Output JSON only — no prose."
                    ),
                }
            )

    if payload is None:
        sys.stderr.write(
            f"\n  could not produce a valid trial JSON after {MAX_LLM_ATTEMPTS} attempts.\n"
            f"  last error:\n{last_error}\n"
        )
        raise SystemExit(1)

    out_path = output_dir / f"{nct_id}.json"
    trial = validate_and_write(payload, out_path, overwrite)

    n_inc = len(trial.inclusion)
    n_exc = len(trial.exclusion)
    n_hard_inc = sum(1 for r in trial.inclusion if r.hard)
    n_hard_exc = sum(1 for r in trial.exclusion if r.hard)
    skipped = payload.get("metadata", {}).get("skipped_criteria", [])
    print(
        f"  wrote {out_path.relative_to(output_dir.parent.parent)}: "
        f"{n_inc} inclusions ({n_hard_inc} hard) / {n_exc} exclusions ({n_hard_exc} hard) / "
        f"{len(skipped)} skipped"
    )
    if skipped:
        print("  skipped criteria (need a human eye or a schema extension):")
        for s in skipped:
            print(f"    - {s}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("nct_ids", nargs="+", help="One or more NCT IDs")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "trials",
        help="Where to write the trial JSON files (default: engine/trials/)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Anthropic model to use (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing trial JSONs",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.stderr.write(
            "ANTHROPIC_API_KEY environment variable is not set.\n"
            "Get one at https://console.anthropic.com and:\n"
            "  export ANTHROPIC_API_KEY=sk-ant-...\n"
        )
        sys.exit(2)

    client = Anthropic(api_key=api_key)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for nct_id in args.nct_ids:
        parse_one(nct_id, client, args.model, args.output_dir, args.overwrite)


if __name__ == "__main__":
    main()
