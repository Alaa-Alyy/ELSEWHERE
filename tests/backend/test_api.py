import json

from fastapi.testclient import TestClient

from analysis.search import SearchEngine
from backend.config import Settings
from backend.main import create_app

from backend_helpers import PROCESSED, SOURCES, FakeChatClient, demo_settings

REQ = {"reference_id": "mars-jezero", "profile": "terrain_general"}


# ------------------------------------------------------------------ fixture mode
def test_health_demo_is_not_data_ready(demo_client):
    h = demo_client.get("/api/health").json()
    assert h["status"] == "ok" and h["schema_version"] == "2.0"
    assert h["data_ready"] is False and h["demo_mode"] is True
    assert h["chat_available"] is False


def test_read_endpoints_envelopes(demo_client):
    refs = demo_client.get("/api/references").json()
    assert refs["schema_version"] == "2.0"
    assert {r["id"] for r in refs["items"]} == {"mars-jezero", "moon-south-pole-sector"}
    assert len(demo_client.get("/api/parents").json()["items"]) == 3
    cid = "earth-khaybar-r00-c00"
    c = demo_client.get(f"/api/candidates/{cid}").json()
    assert c["item"]["id"] == cid and c["item"]["footprint"]["type"] == "Polygon"
    src_ids = {s["id"] for s in demo_client.get("/api/sources").json()["items"]}
    assert set(c["item"]["source_ids"]) <= src_ids


def test_rankings_equal_person1_search(demo_client):
    eng = SearchEngine.load(demo=True)
    for w in (None, 0.0, 0.55, 1.0):
        params = dict(REQ) | ({} if w is None else {"slope_weight": w})
        api = demo_client.get("/api/rankings", params=params).json()
        direct = eng.search("mars-jezero", "terrain_general", w, 3)
        assert api == json.loads(json.dumps(direct))


def test_slope_weight_zero_is_honored(demo_client):
    r = demo_client.get("/api/rankings", params=REQ | {"slope_weight": 0}).json()
    assert r["weights"] == {"slope": 0.0, "relief": 0.5, "variation": 0.5}
    d = demo_client.get("/api/rankings", params=REQ).json()
    assert d["weights"]["slope"] == 0.4


def test_error_codes(demo_client):
    def err(r, status):
        assert r.status_code == status, r.text
        e = r.json()["error"]
        assert set(e) == {"code", "message", "retryable"}
        return e
    err(demo_client.get("/api/rankings", params={"reference_id": "nope", "profile": "terrain_general"}), 404)
    err(demo_client.get("/api/candidates/earth-nope-r00-c00"), 404)
    err(demo_client.get("/api/rankings", params={"reference_id": "mars-jezero", "profile": "bad"}), 422)
    err(demo_client.get("/api/rankings", params=REQ | {"slope_weight": 1.5}), 422)
    err(demo_client.get("/api/rankings", params=REQ | {"slope_weight": "nan"}), 422)
    err(demo_client.get("/api/rankings", params=REQ | {"top_k": 4}), 422)
    err(demo_client.get("/api/rankings", params=REQ | {"score": 99}), 422)


# ------------------------------------------------------------------ decision
def _decision(client, ranking, **over):
    ids = [i["candidate_id"] for i in ranking["items"]]
    body = REQ | {"slope_weight": None, "selected_candidate_id": ids[1], "alternative_candidate_id": ids[0]} | over
    return client.post("/api/decision", json=body)


def test_decision_record(demo_client, ranking):
    r = _decision(demo_client, ranking)
    assert r.status_code == 200, r.text
    d = r.json()
    ids = [i["candidate_id"] for i in ranking["items"]]
    assert d["selected_candidate_id"] == ids[1]       # non-rank-one choice preserved
    assert d["corpus_version"] == ranking["corpus_version"]
    assert d["weights"] == ranking["weights"]
    assert {e["metric"] for e in d["evidence"]} == {"slope_histogram", "relief_p95_p05_m", "local_variation_m"}
    for t in d["tradeoffs"]:
        assert abs(t["selected_contribution"] - t["weight"] * t["selected_distance"]) < 1e-12
    assert d["proposed_test"]["requires_field_validation"] is True
    assert d["search_scope"] == {"parents": 3, "planned_windows": 243, "valid_windows": ranking["scope"]["valid_windows"]}
    assert d["decision_id"].startswith("sha256:")


def test_decision_id_stable_and_settings_sensitive(demo_client, ranking):
    a, b = _decision(demo_client, ranking).json(), _decision(demo_client, ranking).json()
    assert a["decision_id"] == b["decision_id"]
    c = _decision(demo_client, ranking, alternative_candidate_id=None).json()
    assert c["decision_id"] != a["decision_id"] and c["tradeoffs"] == []


def test_decision_rejects_tampered_scores_and_bad_ids(demo_client, ranking):
    assert _decision(demo_client, ranking, score=100).status_code == 422
    assert _decision(demo_client, ranking, selected_candidate_id="earth-khaybar-r99-c99").status_code == 404
    sel = ranking["items"][1]["candidate_id"]
    assert _decision(demo_client, ranking, alternative_candidate_id=sel).status_code == 422
    # valid candidate that is not among the current displayed results
    shown = {i["candidate_id"] for i in ranking["items"]}
    other = next(c for c in ("earth-death-valley-r04-c04", "earth-khaybar-r04-c04") if c not in shown)
    assert _decision(demo_client, ranking, selected_candidate_id=other, alternative_candidate_id=None).status_code == 422


# ------------------------------------------------------------------ real mode
def test_real_mode_not_ready_without_corpus(tmp_path):
    (tmp_path / "processed").mkdir()
    app = create_app(Settings(demo_fixtures=False, data_dir=tmp_path / "processed", sources_dir=SOURCES))
    c = TestClient(app)
    assert c.get("/api/health").json()["data_ready"] is False
    r = c.get("/api/rankings", params=REQ)
    assert r.status_code in (404, 503)
    assert c.get("/api/sources").status_code == 200


def test_real_mode_refuses_demo_corpus(fake_real_dir):
    c = TestClient(create_app(Settings(demo_fixtures=False, data_dir=fake_real_dir, sources_dir=SOURCES)))
    h = c.get("/api/health").json()
    assert h["data_ready"] is False
    assert c.get("/api/references").json()["items"] == []      # no is_demo records leak into real mode
    assert c.get("/api/rankings", params=REQ).status_code in (404, 503)


def test_real_references_served_in_real_mode():
    c = TestClient(create_app(Settings(demo_fixtures=False, data_dir=PROCESSED, sources_dir=SOURCES)))
    refs = c.get("/api/references").json()["items"]
    assert refs and all(r["analysis"]["is_demo"] is False for r in refs)


# ------------------------------------------------------------------ CORS
def test_cors_allowlist(demo_client):
    for origin in ("http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173"):
        r = demo_client.get("/api/health", headers={"Origin": origin})
        assert r.headers.get("access-control-allow-origin") == origin
    r = demo_client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_previews_only_from_approved_folder(demo_client, ranking):
    url = demo_client.get(f"/api/candidates/{ranking['items'][0]['candidate_id']}").json()["item"]["preview_url"]
    assert demo_client.get(url).status_code == 200
    assert demo_client.get("/assets/previews/../candidates.json").status_code == 404
    assert demo_client.get("/assets/previews/..%2Fcandidates.json").status_code == 404


# ------------------------------------------------------------------ chat
def _chat(client, ranking, **over):
    ids = [i["candidate_id"] for i in ranking["items"]]
    body = REQ | {"message": "Why not the alternative?", "slope_weight": None,
                  "selected_candidate_id": ids[0], "alternative_candidate_id": ids[1], "history": []} | over
    return client.post("/api/chat", json=body)


def test_chat_missing_key_is_readable_503_and_decision_still_works(demo_client, ranking):
    r = _chat(demo_client, ranking)
    assert r.status_code == 503 and r.json()["error"]["code"] == "chat_unavailable"
    assert _decision(demo_client, ranking).status_code == 200


def test_chat_grounded_and_ids_filtered(ranking):
    ids = [i["candidate_id"] for i in ranking["items"]]
    fake = FakeChatClient(json.dumps({
        "answer": "Selected is closer on slope.", "candidate_ids": [ids[0], "earth-invented-r00-c00"],
        "source_ids": ["demo-synthetic-mars-jezero", "made-up-source"], "limitations": ["no soil data"]}))
    c = TestClient(create_app(demo_settings(openai_api_key=None), chat_client=fake))
    r = _chat(c, ranking)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["candidate_ids"] == [ids[0]]
    assert out["source_ids"] == ["demo-synthetic-mars-jezero"]
    sent = fake.calls[0]
    assert sent["model"] == "gpt-4.1-mini"
    ctx = sent["messages"][1]["content"]
    assert ids[0] in ctx and ids[1] in ctx and "tradeoffs" in ctx      # both real records in context
    assert sent["messages"][-1]["content"] == "Why not the alternative?"


def test_chat_upstream_failure_and_bad_output(ranking):
    for fake in (FakeChatClient(exc=TimeoutError("slow")), FakeChatClient("not json")):
        c = TestClient(create_app(demo_settings(), chat_client=fake))
        r = _chat(c, ranking)
        assert r.status_code == 503 and r.json()["error"]["retryable"] is True


def test_chat_uses_strict_schema_and_one_fallback(ranking):
    class Flaky(FakeChatClient):
        """First call times out (primary model overloaded), second call answers."""

        def _create(self, **kw):
            if not self.calls:
                self.calls.append(kw)
                raise TimeoutError("primary overloaded")
            return super()._create(**kw)

    fake = Flaky('{"answer":"ok","candidate_ids":[],"source_ids":[],"limitations":[]}')
    c = TestClient(create_app(demo_settings(llm_fallback_model="backup-model"), chat_client=fake))
    r = _chat(c, ranking)
    assert r.status_code == 200, r.text
    assert [k["model"] for k in fake.calls] == ["gpt-4.1-mini", "backup-model"]
    assert fake.calls[0]["response_format"]["type"] == "json_schema"
    assert fake.calls[0]["timeout"] + fake.calls[1]["timeout"] <= 25.0


def test_chat_input_limits(ranking):
    c = TestClient(create_app(demo_settings(), chat_client=FakeChatClient('{"answer":"ok"}')))
    assert _chat(c, ranking, message="x" * 2001).status_code == 422
    assert _chat(c, ranking, history=[{"role": "user", "content": "hi"}] * 7).status_code == 422
    assert _chat(c, ranking, message="   ").status_code == 422
    assert _chat(c, ranking, selected_candidate_id="earth-khaybar-r99-c99").status_code == 404


def test_chat_rate_limit(ranking):
    c = TestClient(create_app(demo_settings(chat_rate_limit_per_minute=2), chat_client=FakeChatClient('{"answer":"ok"}')))
    codes = [_chat(c, ranking).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
