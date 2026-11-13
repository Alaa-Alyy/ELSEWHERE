"""Settings from environment / backend/.env. Relative paths resolve against the repository root."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

try:  # optional: load backend/.env for local runs (never committed)
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / "backend" / ".env", override=False)
except ImportError:  # pragma: no cover
    pass


def _path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    p = Path(value)
    return p if p.is_absolute() else (REPO_ROOT / p).resolve()


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173"


@dataclass
class Settings:
    demo_fixtures: bool = False
    data_dir: Path = REPO_ROOT / "data" / "processed"
    sources_dir: Path = REPO_ROOT / "data" / "sources"
    allowed_origins: list[str] = field(default_factory=lambda: DEFAULT_ORIGINS.split(","))
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    chat_timeout_seconds: float = 25.0
    chat_rate_limit_per_minute: int = 20

    @property
    def corpus_dir(self) -> Path:
        """Processed corpus actually served: demo/ subfolder in fixture mode."""
        return self.data_dir / "demo" if self.demo_fixtures else self.data_dir

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ
        return cls(
            demo_fixtures=_bool(e.get("DEMO_FIXTURES"), False),
            data_dir=_path(e.get("DATA_DIR"), REPO_ROOT / "data" / "processed"),
            sources_dir=_path(e.get("SOURCES_DIR"), REPO_ROOT / "data" / "sources"),
            allowed_origins=[o.strip() for o in e.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
            openai_api_key=e.get("OPENAI_API_KEY") or None,
            openai_model=e.get("OPENAI_MODEL", "gpt-4.1-mini"),
            chat_timeout_seconds=float(e.get("CHAT_TIMEOUT_SECONDS", "25")),
            chat_rate_limit_per_minute=int(e.get("CHAT_RATE_LIMIT_PER_MINUTE", "20")),
        )
