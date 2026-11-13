"""Candidate-window search (score_version 2.0) over processed JSON. No raster work at query time.

Backend usage (load once at server start):
    from analysis.search import SearchEngine, UnknownIdError, InvalidInputError, DataUnavailableError
    engine = SearchEngine.load()                      # data/processed  (real corpus)
    engine = SearchEngine.load(demo=True)             # data/processed/demo  (is_demo=true fixtures)
    engine.search("mars-jezero", "terrain_general", slope_weight=None, top_k=3)  -> RankingResponse dict
    engine.compare("mars-jezero", selected_id, alternative_id, "terrain_general") -> evidence + tradeoffs
    engine.sensitivity("mars-jezero", "terrain_general")                      -> w +/- 0.10 check

Error mapping for the API: UnknownIdError -> 404, InvalidInputError -> 422, DataUnavailableError -> 503.

CLI:  python -m analysis.search --reference mars-jezero --profile slope_focus [--slope-weight 0.55] [--demo]
"""
from __future__ import annotations

import argparse
import json
import math
import numbers
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np
from pyproj import Geod
from sklearn.neighbors import NearestNeighbors

from . import config as C

METRICS = ("slope", "relief", "variation")
_GEOD = Geod(ellps="WGS84")


class SearchError(Exception):
    http_status = 500
    code = "search_error"
    retryable = False

    def envelope(self) -> dict:
        return {"error": {"code": self.code, "message": str(self), "retryable": self.retryable}}


class UnknownIdError(SearchError):
    http_status, code = 404, "not_found"


class InvalidInputError(SearchError):
    http_status, code = 422, "invalid_input"


class DataUnavailableError(SearchError):
    http_status, code, retryable = 503, "data_unavailable", True


# ---------------------------------------------------------------------------- metric
def feature_vector(metrics: dict) -> np.ndarray | None:
    """[8 histogram probabilities, relief_m, variation_m]; None if anything is missing/non-finite."""
    if not metrics:
        return None
    h, r, v = metrics.get("slope_histogram"), metrics.get("relief_p95_p05_m"), metrics.get("local_variation_m")
    if h is None or r is None or v is None or len(h) != 8:
        return None
    x = np.asarray(list(h) + [r, v], dtype=float)
    return x if np.all(np.isfinite(x)) else None


def component_distances(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    f = C.STABILIZATION_FLOOR_M
    d_slope = 0.5 * float(np.sum(np.abs(x[:8] - y[:8])))
    d_relief = abs(x[8] - y[8]) / max(abs(x[8]), abs(y[8]), f)
    d_var = abs(x[9] - y[9]) / max(abs(x[9]), abs(y[9]), f)
    return d_slope, float(d_relief), float(d_var)


def weights_for(w: float) -> dict:
    return {"slope": w, "relief": (1.0 - w) / 2.0, "variation": (1.0 - w) / 2.0}


def terrain_distance(x: np.ndarray, y: np.ndarray, w: float = 0.40) -> float:
    """Frozen weighted terrain distance D (callable metric for NearestNeighbors)."""
    ds, dr, dv = component_distances(x, y)
    return w * ds + ((1.0 - w) / 2.0) * (dr + dv)


def resolve_weight(profile, slope_weight) -> float:
    if profile not in C.PROFILES:
        raise InvalidInputError(f"unknown profile {profile!r}; expected one of {sorted(C.PROFILES)}")
    if slope_weight is None:                     # explicit None check: 0.0 is a valid weight
        return C.PROFILES[profile]
    if isinstance(slope_weight, bool) or not isinstance(slope_weight, numbers.Real):
        raise InvalidInputError("slope_weight must be a number in [0, 1]")
    w = float(slope_weight)
    if not math.isfinite(w) or w < 0.0 or w > 1.0:
        raise InvalidInputError("slope_weight must be a finite number in [0, 1]")
    return w


def geodesic_km(a: dict, b: dict) -> float:
    return _GEOD.inv(a["lon"], a["lat"], b["lon"], b["lat"])[2] / 1000.0


# ---------------------------------------------------------------------------- engine
class SearchEngine:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        try:
            self.manifest = self._read("search_manifest.json")
            cands = self._read("candidates.json")["items"]
            refs = self._read("references.json")["items"]
            parents = self._read("parents.json")["items"]
        except FileNotFoundError as exc:
            raise DataUnavailableError(f"processed corpus not available: {Path(exc.filename).name} missing") from exc
        self.corpus_version = self.manifest["corpus_version"]
        self.is_demo = bool(self.manifest.get("is_demo"))
        self.parents = {p["id"]: p for p in parents}
        self.candidates = {c["id"]: c for c in cands}
        self.references = {r["id"]: r for r in refs}
        self.planned_windows = len(cands)
        ids, X, self.excluded = [], [], []
        for c in sorted(cands, key=lambda c: c["id"]):
            x = feature_vector(c.get("metrics")) if c["analysis"]["status"] == "valid" else None
            if x is None:
                reasons = c["analysis"].get("reasons") or ["missing or non-finite metrics"]
                self.excluded.append({"candidate_id": c["id"], "reason": "; ".join(reasons)})
            else:
                ids.append(c["id"]); X.append(x)
        self.ids = ids
        self.X = np.asarray(X, dtype=float).reshape(len(X), 10)
        self._lock = threading.Lock()
        self._index_cache: dict[float, NearestNeighbors] = {}

    @classmethod
    def load(cls, data_dir: Path | None = None, demo: bool = False) -> "SearchEngine":
        return cls(data_dir or (C.DEMO_DIR if demo else C.PROCESSED_DIR))

    def _read(self, name: str) -> dict:
        with open(self.data_dir / name, encoding="utf-8") as f:
            return json.load(f)

    # -- index: brute force over the stored vectors (fit stores them; no training)
    def _index(self, w: float) -> NearestNeighbors:
        with self._lock:
            nn = self._index_cache.get(w)
            if nn is None:
                nn = NearestNeighbors(algorithm="brute", metric=terrain_distance, metric_params={"w": w})
                nn.fit(self.X)
                if len(self._index_cache) > 64:
                    self._index_cache.clear()
                self._index_cache[w] = nn
            return nn

    def reference_vector(self, reference_id: str) -> tuple[dict, np.ndarray]:
        ref = self.references.get(reference_id)
        if ref is None:
            raise UnknownIdError(f"unknown reference_id {reference_id!r}")
        x = feature_vector(ref.get("metrics")) if ref["analysis"]["status"] == "valid" else None
        if x is None:
            raise DataUnavailableError(f"reference {reference_id} is {ref['analysis']['status']}: "
                                       f"{'; '.join(ref['analysis'].get('reasons') or [])}")
        return ref, x

    def ranked(self, reference_id: str, w: float) -> list[tuple[float, str]]:
        """All valid candidates sorted by unrounded D, then candidate_id."""
        _, q = self.reference_vector(reference_id)
        if not self.ids:
            raise DataUnavailableError("no valid candidate windows in corpus")
        dist, idx = self._index(w).kneighbors(q[None, :], n_neighbors=len(self.ids))
        return sorted((float(d), self.ids[i]) for d, i in zip(dist[0], idx[0]))

    def _item(self, rank: int, D: float, cid: str, q: np.ndarray, w: float) -> dict:
        c = self.candidates[cid]
        x = self.X[self.ids.index(cid)]
        ds, dr, dv = component_distances(x, q)
        wt = weights_for(w)
        dist = {"slope": ds, "relief": dr, "variation": dv}
        contrib = {k: wt[k] * dist[k] for k in METRICS}
        score = 100.0 * (1.0 - D)
        if not (math.isfinite(score) and 0.0 <= score <= 100.0 + 1e-9):
            raise SearchError(f"score out of range for {cid}: {score}")
        return {
            "candidate_id": cid, "parent_id": c["parent_id"], "score": min(score, 100.0),
            "distances": dist,
            "source_ids": c["source_ids"], "reason_codes": reason_codes(contrib, x, q),
            "limitations": c["limitations"],
            # additive evidence fields (not in the v2.0 template; safe to ignore)
            "rank": rank, "total_distance": D, "contributions": contrib,
            "center": c["center"], "preview_url": c.get("preview_url"), "is_demo": c["analysis"]["is_demo"],
        }

    def search(self, reference_id: str, profile: str = "terrain_general", slope_weight=None, top_k: int = 3) -> dict:
        w = resolve_weight(profile, slope_weight)
        if isinstance(top_k, bool) or not isinstance(top_k, numbers.Integral) or not 1 <= top_k <= C.MAX_TOP_K:
            raise InvalidInputError(f"top_k must be an integer in 1..{C.MAX_TOP_K}")
        ref, q = self.reference_vector(reference_id)
        order = self.ranked(reference_id, w)
        selected: list[tuple[float, str]] = []
        for D, cid in order:
            center = self.candidates[cid]["center"]
            if all(geodesic_km(center, self.candidates[s]["center"]) >= C.MIN_CENTER_DISTANCE_KM for _, s in selected):
                selected.append((D, cid))
                if len(selected) == top_k:
                    break
        warnings = []
        if len(selected) < top_k:
            warnings.append(f"only {len(selected)} candidate(s) satisfy the {C.MIN_CENTER_DISTANCE_KM:g} km "
                            f"separation rule; fewer than top_k={top_k} returned")
        if self.is_demo or ref["analysis"].get("is_demo"):
            warnings.append("DEMO MODE: synthetic fixture data (is_demo=true); not scientific results")
        return {
            "schema_version": C.SCHEMA_VERSION, "reference_id": reference_id, "profile": profile,
            "score_version": C.SCORE_VERSION, "corpus_version": self.corpus_version,
            "weights": weights_for(w),
            "scope": {"planned_windows": self.planned_windows, "valid_windows": len(self.ids),
                      "returned_windows": len(selected), "min_center_distance_km": C.MIN_CENTER_DISTANCE_KM},
            "items": [self._item(i + 1, D, cid, q, w) for i, (D, cid) in enumerate(selected)],
            "excluded": list(self.excluded),
            "warnings": warnings,
        }

    def evidence(self, reference_id: str, candidate_id: str, w: float) -> list[dict]:
        ref, q = self.reference_vector(reference_id)
        c = self._valid_candidate(candidate_id)
        x = self.X[self.ids.index(candidate_id)]
        ds, dr, dv = component_distances(x, q)
        wt = weights_for(w)
        return [
            {"metric": "slope_histogram", "units": "probability per bin; bins deg " + str(C.SLOPE_BIN_EDGES_DEG),
             "target_value": ref["metrics"]["slope_histogram"], "selected_value": c["metrics"]["slope_histogram"],
             "distance": ds, "weight": wt["slope"], "contribution": wt["slope"] * ds},
            {"metric": "relief_p95_p05_m", "units": "m", "target_value": ref["metrics"]["relief_p95_p05_m"],
             "selected_value": c["metrics"]["relief_p95_p05_m"], "distance": dr, "weight": wt["relief"],
             "contribution": wt["relief"] * dr},
            {"metric": "local_variation_m", "units": "m", "target_value": ref["metrics"]["local_variation_m"],
             "selected_value": c["metrics"]["local_variation_m"], "distance": dv, "weight": wt["variation"],
             "contribution": wt["variation"] * dv},
        ]

    def _valid_candidate(self, cid: str) -> dict:
        c = self.candidates.get(cid)
        if c is None:
            raise UnknownIdError(f"unknown candidate_id {cid!r}")
        if cid not in self.ids:
            raise InvalidInputError(f"candidate {cid} is not scorable: {c['analysis'].get('reasons')}")
        return c

    def compare(self, reference_id: str, selected_id: str, alternative_id: str | None,
                profile: str = "terrain_general", slope_weight=None, display_decimals: int = 3) -> dict:
        """Server-side evidence and per-metric tradeoffs (contribution = weight * distance)."""
        w = resolve_weight(profile, slope_weight)
        ref, q = self.reference_vector(reference_id)
        sel_ev = self.evidence(reference_id, selected_id, w)
        out = {"reference_id": reference_id, "profile": profile, "weights": weights_for(w),
               "corpus_version": self.corpus_version, "score_version": C.SCORE_VERSION,
               "selected_candidate_id": selected_id, "alternative_candidate_id": alternative_id,
               "evidence": sel_ev, "tradeoffs": [], "total_distance": {}, "score": {}}
        order = {cid: (i + 1, D) for i, (D, cid) in enumerate(self.ranked(reference_id, w))}
        out["total_distance"]["selected"] = order[selected_id][1]
        out["score"]["selected"] = 100 * (1 - order[selected_id][1])
        out["corpus_rank"] = {"selected": order[selected_id][0]}
        if alternative_id is None:
            out["note"] = "single-result state: no alternative to compare"
            return out
        if alternative_id == selected_id:
            raise InvalidInputError("alternative_candidate_id must differ from selected_candidate_id")
        alt_ev = self.evidence(reference_id, alternative_id, w)
        out["total_distance"]["alternative"] = order[alternative_id][1]
        out["score"]["alternative"] = 100 * (1 - order[alternative_id][1])
        out["corpus_rank"]["alternative"] = order[alternative_id][0]
        tol = 0.5 * 10 ** (-display_decimals)
        for s, a in zip(sel_ev, alt_ev):
            diff = s["contribution"] - a["contribution"]
            closer = "tie" if abs(diff) < tol else ("selected" if diff < 0 else "alternative")
            out["tradeoffs"].append({
                "metric": s["metric"], "weight": s["weight"],
                "selected_distance": s["distance"], "alternative_distance": a["distance"],
                "selected_contribution": s["contribution"], "alternative_contribution": a["contribution"],
                "contribution_difference": diff, "closer": closer,
                "selected_value": s["selected_value"], "alternative_value": a["selected_value"],
                "target_value": s["target_value"]})
        dtot = order[selected_id][1] - order[alternative_id][1]
        out["overall_closer"] = "tie" if abs(dtot) < tol else ("selected" if dtot < 0 else "alternative")
        return out

    def sensitivity(self, reference_id: str, profile: str = "terrain_general", slope_weight=None, delta: float = 0.10) -> dict:
        """Does the top distinct candidate change at w +/- delta (clamped)? Not a confidence measure."""
        w = resolve_weight(profile, slope_weight)
        rows = []
        for wv in sorted({round(max(0.0, w - delta), 10), w, round(min(1.0, w + delta), 10)}):
            r = self.search(reference_id, profile, slope_weight=wv, top_k=1)
            rows.append({"slope_weight": wv, "top_candidate_id": r["items"][0]["candidate_id"] if r["items"] else None})
        base = next(r["top_candidate_id"] for r in rows if r["slope_weight"] == w)
        return {"reference_id": reference_id, "profile": profile, "base_slope_weight": w, "checks": rows,
                "top_changes": any(r["top_candidate_id"] != base for r in rows),
                "note": "weight-sensitivity check only; not calibrated confidence"}


def reason_codes(contrib: dict, x: np.ndarray, q: np.ndarray) -> list[str]:
    """Factual, threshold-free codes derived from the actual values."""
    ordered = sorted(METRICS, key=lambda k: (contrib[k], k))
    codes = [f"closest_metric:{ordered[0]}", f"largest_gap_metric:{ordered[-1]}"]
    for name, i in (("relief", 8), ("variation", 9)):
        codes.append(f"{name}_{'equal_to' if x[i] == q[i] else 'higher_than' if x[i] > q[i] else 'lower_than'}_reference")
    codes.append(f"dominant_slope_bin_{'same' if int(np.argmax(x[:8])) == int(np.argmax(q[:8])) else 'differs'}")
    return codes


# ---------------------------------------------------------------------------- module-level contract API
@lru_cache(maxsize=2)
def _default_engine(demo: bool) -> SearchEngine:
    return SearchEngine.load(demo=demo)


def search(reference_id: str, profile: str = "terrain_general", slope_weight=None, top_k: int = 3,
           demo: bool = False) -> dict:
    """Contract interface: search(reference_id, profile, slope_weight=None, top_k=3) -> RankingResponse."""
    return _default_engine(demo).search(reference_id, profile, slope_weight, top_k)


def main(argv=None):
    ap = argparse.ArgumentParser(description="MissionMatch v2.0 candidate-window search")
    ap.add_argument("--reference", required=True)
    ap.add_argument("--profile", default="terrain_general", choices=sorted(C.PROFILES))
    ap.add_argument("--slope-weight", type=float, default=None)
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--data-dir", type=Path, default=None)
    a = ap.parse_args(argv)
    try:
        eng = SearchEngine.load(a.data_dir, demo=a.demo)
        res = eng.search(a.reference, a.profile, a.slope_weight, a.top_k)
    except SearchError as exc:
        print(json.dumps(exc.envelope(), indent=2))
        raise SystemExit(1)
    res["excluded"] = res["excluded"][:5] + ([{"note": f"... {len(res['excluded']) - 5} more"}]
                                             if len(res["excluded"]) > 5 else [])
    for it in res["items"]:
        it.pop("limitations", None)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
