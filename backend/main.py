"""MissionMatch v2.0 FastAPI service.

Run from the repository root:
    python -m uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .chat_service import ChatService, ChatUnavailable
from .config import Settings
from .data_repository import DataRepository
from .decision_service import build_decision
from .schemas import ChatRequest, DecisionRequest
from .search_adapter import SearchAdapter, SearchError, UnknownIdError

SCHEMA_VERSION = "2.0"
RANKING_PARAMS = {"reference_id", "profile", "slope_weight", "top_k"}

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("missionmatch.api")


def error(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "retryable": retryable}})


def create_app(settings: Settings | None = None, chat_client=None) -> FastAPI:
    settings = settings or Settings.from_env()
    repo = DataRepository(settings)
    search = SearchAdapter(settings)
    chat = ChatService(settings, client=chat_client)

    app = FastAPI(title="MissionMatch API", version="2.0.0")
    app.state.settings, app.state.repo, app.state.search, app.state.chat = settings, repo, search, chat
    log.info("mode=%s corpus=%s search_ready=%s chat=%s", "DEMO_FIXTURES" if settings.demo_fixtures else "real",
             settings.corpus_dir, search.ready, chat.available)

    app.add_middleware(
        CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Accept"], allow_credentials=False,
    )

    # ---------------------------------------------------------------- errors -> standard envelope
    @app.exception_handler(SearchError)
    async def _search_error(_: Request, exc: SearchError):
        return error(exc.http_status, exc.code, str(exc), exc.retryable)

    @app.exception_handler(ChatUnavailable)
    async def _chat_error(_: Request, exc: ChatUnavailable):
        return error(503, "chat_unavailable", str(exc), exc.retryable)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p not in ("body", "query"))
        return error(422, "invalid_input", f"{where}: {first.get('msg', 'invalid input')}".strip(": "))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, f"http_{exc.status_code}")
        return error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        log.exception("unhandled error")
        return error(500, "internal_error", "Unexpected server error", True)

    # ---------------------------------------------------------------- read endpoints
    @app.get("/api/health")
    def health():
        data_ready = (not settings.demo_fixtures and search.ready and repo.corpus_present
                      and repo.references_valid and not repo.problems)
        return {"status": "ok", "schema_version": SCHEMA_VERSION, "data_ready": data_ready,
                "chat_available": chat.available, "demo_mode": settings.demo_fixtures,
                "corpus_version": search.corpus_version, "problems": repo.problems[:5]}

    @app.get("/api/references")
    def references():
        return {"schema_version": SCHEMA_VERSION, "items": list(repo.references.values())}

    @app.get("/api/parents")
    def parents():
        return {"schema_version": SCHEMA_VERSION, "items": list(repo.parents.values())}

    @app.get("/api/sources")
    def sources():
        return {"schema_version": SCHEMA_VERSION, "items": list(repo.sources.values())}

    @app.get("/api/candidates/{candidate_id}")
    def candidate(candidate_id: str):
        c = repo.candidates.get(candidate_id)
        if c is None:
            raise UnknownIdError(f"unknown candidate_id {candidate_id!r}")
        return {"schema_version": SCHEMA_VERSION, "item": c, "sources": repo.sources_for(c.get("source_ids", []))}

    @app.get("/api/rankings")
    def rankings(
        request: Request,
        reference_id: str = Query(..., max_length=80),
        profile: str = Query(...),
        slope_weight: Optional[float] = Query(None, ge=0.0, le=1.0, allow_inf_nan=False),
        top_k: int = Query(3, ge=1, le=3),
    ):
        extra = set(request.query_params) - RANKING_PARAMS
        if extra:
            return error(422, "invalid_input", f"unsupported parameter(s): {', '.join(sorted(extra))}")
        if reference_id not in repo.references:
            raise UnknownIdError(f"unknown reference_id {reference_id!r}")
        return search.search(reference_id, profile, slope_weight, top_k)

    # ---------------------------------------------------------------- decision + chat
    @app.post("/api/decision")
    def decision(req: DecisionRequest):
        return build_decision(repo, search, req)

    @app.post("/api/chat")
    def chat_endpoint(req: ChatRequest, request: Request):
        if not chat.check_rate(request.client.host if request.client else "unknown"):
            return error(429, "rate_limited", "Too many chat requests; please wait a minute.", True)
        return chat.answer(repo, search, req)

    # ---------------------------------------------------------------- previews (approved folder only)
    previews = settings.corpus_dir / "previews"
    if previews.is_dir():
        app.mount("/assets/previews", StaticFiles(directory=previews), name="previews")

    return app


app = create_app()
