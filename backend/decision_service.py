"""Deterministic Mission Decision Brief. Works with no AI. Never trusts browser scores."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .data_repository import DataRepository
from .search_adapter import InvalidInputError, SearchAdapter, UnknownIdError

SCHEMA_VERSION = PIPELINE_VERSION = SCORE_VERSION = "2.0"

# Reviewed, profile-matched templates. Explicitly proposed, never executed.
PROPOSED_TESTS = {
    "terrain_general": {
        "title": "Regional terrain-planning diversity comparison",
        "summary": ("Proposed, not executed: run the same traverse-planning and scheduling exercise in the selected "
                    "window and in the alternative, and compare how the kilometre-scale slope distribution, relief "
                    "and local height variation change the plans relative to the reference."),
        "steps": [
            "Confirm access, permits and safety for the selected window.",
            "Survey metre-scale slopes and obstacles on site; the 1000 m analysis cannot see them.",
            "Run identical planning exercises in both windows and record the differences.",
        ],
        "requires_field_validation": True,
    },
    "slope_focus": {
        "title": "Regional slope-handling comparison",
        "summary": ("Proposed, not executed: compare mobility and operations planning for the slope classes that "
                    "dominate the reference, using the selected window as the Earth stand-in."),
        "steps": [
            "Confirm access, permits and safety for the selected window.",
            "Measure on-site slopes at metre scale to check the kilometre-scale distribution.",
            "Plan slope-handling tests only after field validation.",
        ],
        "requires_field_validation": True,
    },
}

MISSING_DIMENSIONS = [
    "Terrain elevation only: soil/regolith properties, temperature, illumination, water/ice, biology, gravity, "
    "radiation, atmosphere, site access and permits are not established by this analysis.",
    "Statistics are computed at 1000 m resolution over 20 km windows; small obstacles, rocks and metre-scale "
    "slopes are not represented.",
    "Result is the closest available window within a limited corpus of 3 Earth parent regions, "
    "not a global best analog and not a safe-route or landing assessment.",
    "Heuristic terrain similarity index; not a probability and not field validation.",
]

EVIDENCE_KEYS = ("metric", "units", "target_value", "selected_value", "distance")
TRADEOFF_KEYS = ("metric", "weight", "selected_distance", "alternative_distance",
                 "selected_contribution", "alternative_contribution", "contribution_difference", "closer")


def canonical_hash(obj: dict) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _dedupe(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def displayed_ids(search: SearchAdapter, reference_id: str, profile: str, slope_weight) -> tuple[dict, list[str]]:
    ranking = search.search(reference_id, profile, slope_weight, 3)
    return ranking, [i["candidate_id"] for i in ranking["items"]]


def validate_selection(repo: DataRepository, ids: list[str], selected: str | None, alternative: str | None) -> None:
    for cid in (selected, alternative):
        if cid is not None and cid not in repo.candidates:
            raise UnknownIdError(f"unknown candidate_id {cid!r}")
    if selected is not None and selected not in ids:
        raise InvalidInputError(f"{selected} is not among the current distinct results for these settings")
    if alternative is not None:
        if alternative == selected:
            raise InvalidInputError("alternative_candidate_id must differ from selected_candidate_id")
        if alternative not in ids:
            raise InvalidInputError(f"{alternative} is not among the current distinct results for these settings")


def build_decision(repo: DataRepository, search: SearchAdapter, req) -> dict:
    if req.reference_id not in repo.references:
        raise UnknownIdError(f"unknown reference_id {req.reference_id!r}")
    ranking, ids = displayed_ids(search, req.reference_id, req.profile, req.slope_weight)
    validate_selection(repo, ids, req.selected_candidate_id, req.alternative_candidate_id)
    cmp = search.compare(req.reference_id, req.selected_candidate_id, req.alternative_candidate_id,
                         req.profile, req.slope_weight)

    ref = repo.references[req.reference_id]
    sel = repo.candidates[req.selected_candidate_id]
    alt = repo.candidates.get(req.alternative_candidate_id) if req.alternative_candidate_id else None
    limitations = _dedupe([
        *(["DEMO FIXTURE decision: synthetic values, not a scientific result."] if repo.demo else []),
        *MISSING_DIMENSIONS,
        *ref.get("limitations", []),
        *sel.get("limitations", []),
        *(alt.get("limitations", []) if alt else []),
    ])
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "reference_id": req.reference_id,
        "profile": req.profile,
        "selected_candidate_id": req.selected_candidate_id,
        "alternative_candidate_id": req.alternative_candidate_id,
        "weights": cmp["weights"],
        "pipeline_version": PIPELINE_VERSION,
        "score_version": SCORE_VERSION,
        "corpus_version": cmp["corpus_version"],
        "evidence": [{k: e[k] for k in EVIDENCE_KEYS} | {"weight": e["weight"], "contribution": e["contribution"]}
                     for e in cmp["evidence"]],
        "tradeoffs": [{k: t[k] for k in TRADEOFF_KEYS} for t in cmp["tradeoffs"]],
        "limitations": limitations,
        "proposed_test": PROPOSED_TESTS[req.profile],
        "source_ids": _dedupe([*ref.get("source_ids", []), *sel.get("source_ids", []),
                               *(alt.get("source_ids", []) if alt else [])]),
        "search_scope": {"parents": search.parents_count(),
                         "planned_windows": ranking["scope"]["planned_windows"],
                         "valid_windows": ranking["scope"]["valid_windows"]},
        "selected_score": cmp["score"]["selected"],
        "alternative_score": cmp["score"].get("alternative"),
        "selected_corpus_rank": cmp["corpus_rank"]["selected"],
        "overall_closer": cmp.get("overall_closer"),
        "is_demo": repo.demo,
    }
    return {
        **snapshot,
        "decision_id": canonical_hash(snapshot),
        "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
