"""Grounded chat over server-side evidence. Explains; never scores. Fails closed with a readable 503."""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque

from .data_repository import DataRepository
from .decision_service import MISSING_DIMENSIONS, displayed_ids, validate_selection
from .prompts import SYSTEM_PROMPT
from .search_adapter import SearchAdapter, UnknownIdError

log = logging.getLogger("missionmatch.chat")


ANSWER_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "missionmatch_chat_answer",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["answer", "candidate_ids", "source_ids", "limitations"],
            "properties": {
                "answer": {"type": "string"},
                "candidate_ids": {"type": "array", "items": {"type": "string"}},
                "source_ids": {"type": "array", "items": {"type": "string"}},
                "limitations": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}


class ChatUnavailable(Exception):
    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


def _round(x, nd=4):
    if isinstance(x, float):
        return round(x, nd)
    if isinstance(x, list):
        return [_round(v, nd) for v in x]
    if isinstance(x, dict):
        return {k: _round(v, nd) for k, v in x.items()}
    return x


class ChatService:
    def __init__(self, settings, client=None):
        self.settings = settings
        self._client = client
        self._lock = threading.Lock()
        self._hits: dict[str, deque] = {}
        if self._client is None and settings.openai_api_key:
            try:
                from openai import OpenAI

                self._client = OpenAI(api_key=settings.openai_api_key, base_url=settings.llm_base_url,
                                      timeout=settings.chat_timeout_seconds, max_retries=1)
            except Exception as exc:  # pragma: no cover
                log.warning("OpenAI client unavailable: %s", type(exc).__name__)

    @property
    def available(self) -> bool:
        return self._client is not None

    def check_rate(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.settings.chat_rate_limit_per_minute:
                return False
            q.append(now)
            return True

    # ------------------------------------------------------------------ context
    def build_context(self, repo: DataRepository, search: SearchAdapter, req) -> dict:
        if req.reference_id not in repo.references:
            raise UnknownIdError(f"unknown reference_id {req.reference_id!r}")
        ranking, ids = displayed_ids(search, req.reference_id, req.profile, req.slope_weight)
        validate_selection(repo, ids, req.selected_candidate_id, req.alternative_candidate_id)
        ref = repo.references[req.reference_id]
        ctx = {
            "reference": {"id": ref["id"], "name": ref.get("name"), "metrics": ref.get("metrics"),
                          "source_ids": ref.get("source_ids", [])},
            "settings": {"profile": req.profile, "weights": ranking["weights"],
                         "corpus_version": ranking["corpus_version"]},
            "search_scope": ranking["scope"],
            "displayed_results": [
                {"candidate_id": i["candidate_id"], "parent_id": i["parent_id"], "score": i["score"],
                 "distances": i["distances"], "contributions": i.get("contributions"), "source_ids": i["source_ids"]}
                for i in ranking["items"]],
            "limitations": MISSING_DIMENSIONS,
            "is_demo": repo.demo,
        }
        if req.selected_candidate_id:
            cmp = search.compare(req.reference_id, req.selected_candidate_id, req.alternative_candidate_id,
                                 req.profile, req.slope_weight)
            ctx["selected_candidate_id"] = req.selected_candidate_id
            ctx["alternative_candidate_id"] = req.alternative_candidate_id
            ctx["evidence"] = cmp["evidence"]
            ctx["tradeoffs"] = cmp["tradeoffs"]
            ctx["overall_closer"] = cmp.get("overall_closer")
        try:
            ctx["slope_sensitivity"] = search.sensitivity(req.reference_id, req.profile, req.slope_weight)
        except Exception:  # sensitivity is optional context
            pass
        return _round(ctx)

    @staticmethod
    def allowed_ids(ctx: dict) -> tuple[set, set]:
        cands = {r["candidate_id"] for r in ctx["displayed_results"]}
        srcs = set(ctx["reference"]["source_ids"]) | {s for r in ctx["displayed_results"] for s in r["source_ids"]}
        return cands, srcs

    # ------------------------------------------------------------------ call
    def answer(self, repo: DataRepository, search: SearchAdapter, req) -> dict:
        if not self.available:
            raise ChatUnavailable("The explanation assistant is not configured on this server.", retryable=False)
        ctx = self.build_context(repo, search, req)
        messages = [{"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "system", "content": "CONTEXT (trusted evidence, JSON):\n" + json.dumps(ctx, ensure_ascii=False)}]
        for turn in req.history[-6:]:
            messages.append({"role": turn.role, "content": turn.content[:2000]})
        messages.append({"role": "user", "content": req.message})
        models = [self.settings.openai_model]
        if self.settings.llm_fallback_model and self.settings.llm_fallback_model not in models:
            models.append(self.settings.llm_fallback_model)  # bounded: at most one retry
        raw = None
        per_call_timeout = self.settings.chat_timeout_seconds / len(models)  # total stays within budget
        for model in models:
            try:
                resp = self._client.chat.completions.create(
                    # generous budget: reasoning models spend tokens before the visible JSON answer
                    model=model, messages=messages, temperature=0.2, max_tokens=2500,
                    response_format=ANSWER_SCHEMA, timeout=per_call_timeout,
                )
                raw = resp.choices[0].message.content or ""
                break
            except Exception as exc:
                log.warning("chat upstream failed on %s: %s", model, type(exc).__name__)
        if raw is None:
            raise ChatUnavailable("The explanation assistant is temporarily unavailable. Evidence and decision still work.")
        try:
            data = json.loads(raw)
            answer = str(data["answer"]).strip()
        except Exception:
            raise ChatUnavailable("The assistant returned an invalid answer. Please retry.")
        if not answer:
            raise ChatUnavailable("The assistant returned an empty answer. Please retry.")
        cands, srcs = self.allowed_ids(ctx)
        return {
            "answer": answer[:4000],
            "candidate_ids": [c for c in data.get("candidate_ids", []) if isinstance(c, str) and c in cands],
            "source_ids": [s for s in data.get("source_ids", []) if isinstance(s, str) and s in srcs],
            "limitations": [str(x)[:300] for x in data.get("limitations", []) if isinstance(x, str)][:6],
        }
