"""Data types shared across pipeline steps."""
from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Word(BaseModel):
    start: float
    end: float
    text: str
    prob: float = 1.0


class Segment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: list[Word] = []


class Transcript(BaseModel):
    language: str
    duration: float
    model: str
    segments: list[Segment]

    def words(self) -> list[Word]:
        return [w for s in self.segments for w in s.words]


class MediaInfo(BaseModel):
    video_id: str
    title: str
    source: str  # original url or path
    url: Optional[str] = None
    path: str  # local video file
    audio_path: str  # 16 kHz mono wav
    media_hash: str
    duration: float
    width: int
    height: int


# --- LLM contract -----------------------------------------------------------

class LLMClip(BaseModel):
    """What the LLM must return per clip. Boundaries are segment ids, not seconds."""

    start_seg: int = Field(ge=0)
    end_seg: int = Field(ge=0)
    score: int = Field(ge=0, le=100)
    hook_title: str = Field(min_length=1, max_length=120)
    reason: str = ""
    title: str = Field(min_length=1, max_length=150)
    description: str = ""
    hashtags: list[str] = []

    @field_validator("hashtags")
    @classmethod
    def _norm_tags(cls, tags: list[str]) -> list[str]:
        out: list[str] = []
        for t in tags:
            t = re.sub(r"[^\w]", "", t.strip().lstrip("#"), flags=re.UNICODE)
            if t and f"#{t}" not in out:
                out.append(f"#{t}")
        return out[:10]

    @field_validator("hook_title", "title")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip().strip('"').strip()

    @model_validator(mode="after")
    def _order(self) -> "LLMClip":
        if self.end_seg < self.start_seg:
            raise ValueError(f"end_seg ({self.end_seg}) < start_seg ({self.start_seg})")
        return self


class LLMResponse(BaseModel):
    clips: list[LLMClip]


# --- Selected clips -----------------------------------------------------------

class ClipCandidate(BaseModel):
    start: float
    end: float
    score: int
    hook_title: str
    reason: str = ""
    title: str
    description: str = ""
    hashtags: list[str] = []

    @property
    def duration(self) -> float:
        return self.end - self.start
