"""JSON loaders for patients and trials.

Trials and patients are stored as JSON files alongside the package so the OSS
distribution can ship a baseline corpus that anyone can run, edit, and extend.
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from traumatrial_match.schema import Patient, Trial

PathLike = Union[str, Path]


def load_patient(path: PathLike) -> Patient:
    return Patient.model_validate_json(Path(path).read_text())


def load_trial(path: PathLike) -> Trial:
    return Trial.model_validate_json(Path(path).read_text())


def load_patients(directory: PathLike) -> list[Patient]:
    return [load_patient(p) for p in sorted(Path(directory).glob("*.json"))]


def load_trials(directory: PathLike) -> list[Trial]:
    return [load_trial(p) for p in sorted(Path(directory).glob("*.json"))]
