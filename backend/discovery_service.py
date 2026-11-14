"""Discovery mode service: Moon/Mars pins + global Earth search, decision and chat context."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from analysis.search import InvalidInputError, UnknownIdError, resolve_weight, weights_for

from discovery.global_search import GlobalIndex, GlobalUnavailable
from discovery.pins import PinError, measure_pin
from discovery.sources import SourceUnavailable

from .decision_service import EVIDENCE_KEYS, MISSING_DIMENSIONS, PROPOSED_TESTS, canonical_hash

log = logging.getLogger("missionmatch.discovery")
PIN_RE = re.compile(r"^pin-(mars|moon)-(\d+p\d+)([ns])-(\d+p\d+)([ew])$")

GLOBAL_LIMITATIONS = [
    "Global discovery uses NASA SRTMGL30 (~1 km) over Earth land 56S-60N; local height variation reads "
    "~20% lower than with SRTMGL1 30 m data in our Khaybar comparison, so variation distances are biased.",
    "Being outside our short list of well-known analog sites is not a claim of first discovery.",
]


class DiscoveryUnavailable(RuntimeError):
    pass


class DiscoveryService:
    def __init__(self, repo):
        self.repo = repo
        self.index: GlobalIndex | None = None
        self.error: str | None = None
        try:
            self.index = GlobalIndex()
        except GlobalUnavailable as exc:
            self.error = str(exc)
            log.warning("global discovery unavailable: %s", exc)

    @property
    def ready(self) -> bool:
        return self.index is not None

    def _index(self) -> GlobalIndex:
        if self.index is None:
            raise DiscoveryUnavailable(self.error or "global corpus not loaded")
        return self.index

    # --------------------------------------------------------------- references
    def pin(self, body: str, lat: float, lon: float) -> dict:
        try:
            return measure_pin(body, lat, lon)
        except PinError as exc:
            raise InvalidInputError(str(exc))
        except SourceUnavailable as exc:
            raise DiscoveryUnavailable(str(exc))

    def reference(self, reference_id: str) -> dict:
        if reference_id in self.repo.references:
            return self.repo.references[reference_id]
        m = PIN_RE.match(reference_id)
        if not m:
            raise UnknownIdError(f"unknown reference_id {reference_id!r}")
        body, la, ns, lo, ew = m.groups()
        lat = float(la.replace("p", ".")) * (1 if ns == "n" else -1)
        lon = float(lo.replace("p", ".")) * (1 if ew == "e" else -1)
        return self.pin(body, lat, lon)

    # --------------------------------------------------------------- search
    def discover(self, reference_id: str, profile: str, slope_weight, top_k: int,
                 min_km: float, exclude_known: bool) -> dict:
        ref = self.reference(reference_id)
        out = self._index().search(ref, profile, slope_weight, top_k, min_km, exclude_known)
        out["warnings"] = out["warnings"] + GLOBAL_LIMITATIONS
        return out

    def candidate(self, cid: str) -> dict:
        idx = self._index()
        try:
            i = idx.index_of(cid)
        except KeyError:
            raise UnknownIdError(f"unknown global candidate_id {cid!r}")
        rec = idx.record(i)
        return {"schema_version": "2.0", "item": rec, "sources": self.repo.sources_for(rec["source_ids"])}

    def _displayed(self, req) -> tuple[dict, dict, list[str]]:
        ref = self.reference(req.reference_id)
        ranking = self._index().search(ref, req.profile, req.slope_weight, req.top_k or 5,
                                       req.min_center_distance_km or 100.0, bool(req.exclude_known))
        return ref, ranking, [i["candidate_id"] for i in ranking["items"]]

    @staticmethod
    def _check(ids, selected, alternative):
        for cid in (selected, alternative):
            if cid is not None and cid not in ids:
                raise InvalidInputError(f"{cid} is not among the current displayed global results")
        if alternative is not None and alternative == selected:
            raise InvalidInputError("alternative_candidate_id must differ from selected_candidate_id")

    def compare(self, req) -> tuple[dict, dict, dict]:
        ref, ranking, ids = self._displayed(req)
        self._check(ids, req.selected_candidate_id, req.alternative_candidate_id)
        by_id = {i["candidate_id"]: i for i in ranking["items"]}
        w = resolve_weight(req.profile, req.slope_weight)
        wt = weights_for(w)
        idx = self._index()
        recs = {cid: idx.record(idx.index_of(cid)) for cid in (req.selected_candidate_id, req.alternative_candidate_id) if cid}
        units = {"slope": ("slope_histogram", "probability per slope bin"), "relief": ("relief_p95_p05_m", "m"),
                 "variation": ("local_variation_m", "m")}
        sel = by_id[req.selected_candidate_id] if req.selected_candidate_id else None
        alt = by_id.get(req.alternative_candidate_id) if req.alternative_candidate_id else None
        evidence, tradeoffs = [], []
        if sel:
            for k, (field, u) in units.items():
                evidence.append({"metric": field, "units": u, "target_value": ref["metrics"][field],
                                 "selected_value": recs[sel["candidate_id"]]["metrics"][field],
                                 "distance": sel["distances"][k], "weight": wt[k], "contribution": wt[k] * sel["distances"][k]})
                if alt:
                    s, a = wt[k] * sel["distances"][k], wt[k] * alt["distances"][k]
                    tradeoffs.append({"metric": field, "weight": wt[k], "selected_distance": sel["distances"][k],
                                      "alternative_distance": alt["distances"][k], "selected_contribution": s,
                                      "alternative_contribution": a, "contribution_difference": s - a,
                                      "closer": "tie" if abs(s - a) < 5e-4 else ("selected" if s < a else "alternative")})
        return ref, ranking, {"evidence": evidence, "tradeoffs": tradeoffs, "weights": wt, "recs": recs,
                              "sel": sel, "alt": alt}

    def decision(self, req) -> dict:
        ref, ranking, c = self.compare(req)
        sel_rec = c["recs"][req.selected_candidate_id]
        alt_rec = c["recs"].get(req.alternative_candidate_id) if req.alternative_candidate_id else None
        limitations = list(dict.fromkeys([*MISSING_DIMENSIONS, *GLOBAL_LIMITATIONS, *ref.get("limitations", []),
                                          *sel_rec["limitations"]]))
        snapshot = {
            "schema_version": "2.0", "mode": "global", "reference_id": req.reference_id, "profile": req.profile,
            "selected_candidate_id": req.selected_candidate_id,
            "alternative_candidate_id": req.alternative_candidate_id,
            "weights": c["weights"], "pipeline_version": "2.0", "score_version": "2.0",
            "corpus_version": ranking["corpus_version"],
            "reference": {"id": ref["id"], "body": ref["body"], "center": ref["center"], "name": ref.get("name")},
            "evidence": [{k: e[k] for k in EVIDENCE_KEYS} | {"weight": e["weight"], "contribution": e["contribution"]}
                         for e in c["evidence"]],
            "tradeoffs": c["tradeoffs"],
            "limitations": limitations,
            "proposed_test": PROPOSED_TESTS[req.profile],
            "source_ids": list(dict.fromkeys([*ref.get("source_ids", []), *sel_rec["source_ids"],
                                              *(alt_rec["source_ids"] if alt_rec else [])])),
            "search_scope": {"parents": None, "planned_windows": ranking["scope"]["planned_windows"],
                             "valid_windows": ranking["scope"]["valid_windows"],
                             "coverage": ranking["scope"]["coverage"],
                             "min_center_distance_km": ranking["scope"]["min_center_distance_km"]},
            "selected_center": sel_rec["center"],
            "selected_known_analog": sel_rec["known_analog"],
            "selected_score": c["sel"]["score"],
            "alternative_score": c["alt"]["score"] if c["alt"] else None,
            "is_demo": False,
        }
        return {**snapshot, "decision_id": canonical_hash(snapshot),
                "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")}

    def chat_context(self, req) -> dict:
        ref, ranking, c = self.compare(req)
        return {
            "mode": "global discovery over Earth land",
            "reference": {"id": ref["id"], "body": ref["body"], "name": ref.get("name"), "center": ref["center"],
                          "metrics": ref["metrics"], "source_ids": ref.get("source_ids", [])},
            "settings": {"profile": req.profile, "weights": c["weights"], "corpus_version": ranking["corpus_version"]},
            "search_scope": ranking["scope"],
            "displayed_results": [{k: i[k] for k in ("candidate_id", "score", "distances", "contributions",
                                                     "source_ids", "center", "known_analog")} for i in ranking["items"]],
            "selected_candidate_id": req.selected_candidate_id, "alternative_candidate_id": req.alternative_candidate_id,
            "evidence": c["evidence"], "tradeoffs": c["tradeoffs"],
            "limitations": MISSING_DIMENSIONS + GLOBAL_LIMITATIONS, "is_demo": False,
        }
