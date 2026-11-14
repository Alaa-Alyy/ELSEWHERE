"""Pydantic v2 request models (strict: unknown fields such as client scores are rejected)."""
from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Profile = Literal["terrain_general", "slope_focus"]
ID_PATTERN = r"^[a-z0-9][a-z0-9-]{1,80}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _finite_weight(v):
    if v is None:
        return v
    if isinstance(v, bool) or not math.isfinite(float(v)) or not 0.0 <= float(v) <= 1.0:
        raise ValueError("slope_weight must be a finite number in [0, 1]")
    return float(v)


Mode = Literal["curated", "global"]


class _DiscoveryFields(_Strict):
    """Additive v2 fields for discovery mode (ignored in curated mode)."""
    mode: Mode = "curated"
    top_k: Optional[int] = Field(default=None, ge=1, le=10)
    min_center_distance_km: Optional[float] = Field(default=None, ge=20, le=2000, allow_inf_nan=False)
    exclude_known: Optional[bool] = None


class PinRequest(_Strict):
    body: Literal["mars", "moon"]
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-360, le=360, allow_inf_nan=False)


class DecisionRequest(_DiscoveryFields):
    reference_id: str = Field(pattern=ID_PATTERN)
    profile: Profile
    slope_weight: Optional[float] = None
    selected_candidate_id: str = Field(pattern=ID_PATTERN)
    alternative_candidate_id: Optional[str] = Field(default=None, pattern=ID_PATTERN)

    @field_validator("slope_weight")
    @classmethod
    def _weight(cls, v):
        return _finite_weight(v)


class ChatTurn(_Strict):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(_DiscoveryFields):
    message: str = Field(min_length=1, max_length=2000)
    reference_id: str = Field(pattern=ID_PATTERN)
    profile: Profile
    slope_weight: Optional[float] = None
    selected_candidate_id: Optional[str] = Field(default=None, pattern=ID_PATTERN)
    alternative_candidate_id: Optional[str] = Field(default=None, pattern=ID_PATTERN)
    history: list[ChatTurn] = Field(default_factory=list, max_length=6)

    @field_validator("slope_weight")
    @classmethod
    def _weight(cls, v):
        return _finite_weight(v)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be blank")
        return v


class ChatResponse(BaseModel):
    answer: str
    candidate_ids: list[str] = []
    source_ids: list[str] = []
    limitations: list[str] = []
