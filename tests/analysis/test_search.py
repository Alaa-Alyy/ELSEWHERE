import json
import math

import numpy as np
import pytest

from analysis import config as C
from analysis.search import (DataUnavailableError, InvalidInputError, SearchEngine, UnknownIdError,
                             component_distances, geodesic_km, terrain_distance)
from analysis.validate_outputs import validate

from p1_corpus import make_corpus


def vec(h, r, v):
    return np.asarray(list(h) + [r, v], float)


def test_identical_vectors_score_100_and_zero_features_are_finite():
    x = vec([0.5, 0.5, 0, 0, 0, 0, 0, 0], 120.0, 3.0)
    assert terrain_distance(x, x, 0.4) == 0.0
    z = vec([1, 0, 0, 0, 0, 0, 0, 0], 0.0, 0.0)
    assert component_distances(z, z) == (0.0, 0.0, 0.0)
    d = terrain_distance(z, vec([0, 0, 0, 0, 0, 0, 0, 1], 0.5, 0.0), 0.4)
    assert math.isfinite(d) and 0 <= d <= 1


def test_distance_formula_matches_spec():
    a = vec([0.2, 0.3, 0.5, 0, 0, 0, 0, 0], 200.0, 4.0)
    b = vec([0.1, 0.1, 0.4, 0.4, 0, 0, 0, 0], 100.0, 0.5)
    ds, dr, dv = component_distances(a, b)
    assert ds == pytest.approx(0.5 * (0.1 + 0.2 + 0.1 + 0.4))
    assert dr == pytest.approx(100 / 200) and dv == pytest.approx(3.5 / 4.0)
    assert terrain_distance(a, b, 0.7) == pytest.approx(0.7 * ds + 0.15 * (dr + dv))
    # one-metre floor: tiny values do not explode
    assert component_distances(vec([1] + [0] * 7, 0.2, 0.0), vec([1] + [0] * 7, 0.0, 0.1))[1:] == \
        pytest.approx((0.2, 0.1))


def test_search_contract_and_ranges(corpus_dir):
    eng = SearchEngine(corpus_dir)
    res = eng.search("mars-jezero", "terrain_general")
    assert res["schema_version"] == "2.0" and res["score_version"] == "2.0"
    assert res["weights"] == {"slope": 0.4, "relief": 0.3, "variation": 0.3}
    assert res["corpus_version"].startswith("sha256:")
    assert 1 <= len(res["items"]) <= 3
    assert res["scope"]["valid_windows"] == len(eng.ids) < res["scope"]["planned_windows"] == 162
    for it in res["items"]:
        assert 0 <= it["score"] <= 100
    excluded_ids = {e["candidate_id"] for e in res["excluded"]}
    assert excluded_ids and not excluded_ids & {it["candidate_id"] for it in res["items"]}
    assert all(e["reason"] for e in res["excluded"])


def test_retrieval_agrees_with_independent_brute_force(corpus_dir):
    eng = SearchEngine(corpus_dir)
    cands = json.loads((corpus_dir / "candidates.json").read_text())["items"]
    ref = json.loads((corpus_dir / "references.json").read_text())["items"][0]
    q = vec(ref["metrics"]["slope_histogram"], ref["metrics"]["relief_p95_p05_m"], ref["metrics"]["local_variation_m"])
    for w in (0.0, 0.4, 0.7, 1.0):
        brute = []
        for c in cands:
            if c["analysis"]["status"] != "valid":
                continue
            m = c["metrics"]
            x = vec(m["slope_histogram"], m["relief_p95_p05_m"], m["local_variation_m"])
            ds = 0.5 * sum(abs(a - b) for a, b in zip(x[:8], q[:8]))
            dr = abs(x[8] - q[8]) / max(abs(x[8]), abs(q[8]), 1.0)
            dv = abs(x[9] - q[9]) / max(abs(x[9]), abs(q[9]), 1.0)
            brute.append((w * ds + (1 - w) / 2 * (dr + dv), c["id"]))
        # independent float paths may differ in the last bits; compare at 1e-12 with id tie-break
        brute.sort(key=lambda t: (round(t[0], 12), t[1]))
        got = eng.ranked("mars-jezero", w)
        assert [c for _, c in sorted(got, key=lambda t: (round(t[0], 12), t[1]))] == [c for _, c in brute]
        assert all(got[i][0] <= got[i + 1][0] for i in range(len(got) - 1))
        assert np.allclose([d for d, _ in got], sorted(d for d, _ in brute), atol=1e-12)


def test_spatial_diversity(corpus_dir):
    eng = SearchEngine(corpus_dir)
    for prof in C.PROFILES:
        items = eng.search("mars-jezero", prof)["items"]
        cs = [eng.candidates[i["candidate_id"]]["center"] for i in items]
        for i in range(len(cs)):
            for j in range(i):
                assert geodesic_km(cs[i], cs[j]) >= 20.0


def test_greedy_selection_is_first_feasible_in_order(corpus_dir):
    eng = SearchEngine(corpus_dir)
    order = eng.ranked("mars-jezero", 0.4)
    assert eng.search("mars-jezero", "terrain_general", top_k=1)["items"][0]["candidate_id"] == order[0][1]


def test_weights_recompute_and_zero_weight_is_not_missing(corpus_dir):
    eng = SearchEngine(corpus_dir)
    a = eng.search("mars-jezero", "terrain_general", slope_weight=0.0)
    assert a["weights"] == {"slope": 0.0, "relief": 0.5, "variation": 0.5}
    b = eng.search("mars-jezero", "terrain_general", slope_weight=None)
    assert b["weights"]["slope"] == 0.4
    c = eng.search("mars-jezero", "slope_focus")
    assert c["weights"]["slope"] == 0.7
    for res, w in ((a, 0.0), (c, 0.7)):
        top = res["items"][0]
        assert top["total_distance"] == pytest.approx(
            w * top["distances"]["slope"] + (1 - w) / 2 * (top["distances"]["relief"] + top["distances"]["variation"]))
    s = eng.sensitivity("mars-jezero", "terrain_general")
    assert [r["slope_weight"] for r in s["checks"]] == pytest.approx([0.3, 0.4, 0.5])


@pytest.mark.parametrize("kw", [{"slope_weight": 1.5}, {"slope_weight": -0.1}, {"slope_weight": float("nan")},
                                {"slope_weight": True}, {"slope_weight": "0.4"}, {"top_k": 0}, {"top_k": 4},
                                {"profile": "fastest"}])
def test_invalid_inputs(corpus_dir, kw):
    eng = SearchEngine(corpus_dir)
    args = {"profile": "terrain_general", **kw}
    with pytest.raises(InvalidInputError):
        eng.search("mars-jezero", **args)


def test_unknown_and_pending_references(corpus_dir):
    eng = SearchEngine(corpus_dir)
    with pytest.raises(UnknownIdError):
        eng.search("venus-x", "terrain_general")
    with pytest.raises(DataUnavailableError) as e:
        eng.search("moon-south-pole-sector", "terrain_general")
    assert e.value.envelope()["error"]["code"] == "data_unavailable"


def test_compare_tradeoffs(corpus_dir):
    eng = SearchEngine(corpus_dir)
    items = eng.search("mars-jezero", "terrain_general")["items"]
    cmp = eng.compare("mars-jezero", items[0]["candidate_id"], items[1]["candidate_id"], "terrain_general")
    assert len(cmp["tradeoffs"]) == 3
    for t in cmp["tradeoffs"]:
        assert t["selected_contribution"] == pytest.approx(t["weight"] * t["selected_distance"])
    assert cmp["overall_closer"] in ("selected", "tie")
    single = eng.compare("mars-jezero", items[0]["candidate_id"], None)
    assert single["tradeoffs"] == [] and "single-result" in single["note"]
    with pytest.raises(UnknownIdError):
        eng.compare("mars-jezero", "earth-nowhere-r00-c00", None)


def test_fewer_results_is_honest(tmp_path):
    make_corpus(tmp_path)
    eng = SearchEngine(tmp_path)
    keep = eng.ids[:2] if geodesic_km(eng.candidates[eng.ids[0]]["center"],
                                      eng.candidates[eng.ids[1]]["center"]) < 20 else eng.ids[:1]
    eng.ids = keep
    eng.X = eng.X[:len(keep)]
    eng._index_cache.clear()
    res = eng.search("mars-jezero", "terrain_general")
    assert len(res["items"]) == 1 and any("fewer than top_k" in w for w in res["warnings"])


def test_reproducible_ids_metrics_order(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    sa, sb = make_corpus(a), make_corpus(b)
    assert sa["corpus_version"] == sb["corpus_version"]
    assert (a / "candidates.json").read_text() == (b / "candidates.json").read_text()
    assert SearchEngine(a).search("mars-jezero", "slope_focus") == SearchEngine(b).search("mars-jezero", "slope_focus")


def test_validate_outputs_passes(corpus_dir):
    assert validate(corpus_dir, demo=True) == []
