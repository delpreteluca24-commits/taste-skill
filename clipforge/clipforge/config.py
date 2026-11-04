"""Configuration: config.yaml + CLI overrides, validated with pydantic."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal, Optional

import yaml
from pydantic import BaseModel, Field, model_validator

FONTS_DIR = Path(__file__).parent / "assets" / "fonts"


class WhisperConfig(BaseModel):
    model: str = "auto"  # auto -> large-v3-turbo on GPU, small on CPU
    device: Literal["auto", "cpu", "cuda"] = "auto"
    compute_type: str = "auto"  # auto -> float16 on GPU, int8 on CPU
    beam_size: int = 5
    vad: bool = True


class LLMConfig(BaseModel):
    provider: str = "ollama:qwen2.5:7b"  # <provider>:<model>
    ollama_host: str = "http://localhost:11434"
    temperature: float = 0.3
    timeout_s: float = 600
    max_retries: int = 2
    num_ctx: int = 16384
    window_s: float = 480  # transcript window sent per LLM call
    overlap_s: float = 60


class ClipsConfig(BaseModel):
    count: int = Field(10, ge=1, le=100)
    min_s: float = Field(20, gt=0)
    max_s: float = Field(60, gt=0)

    @model_validator(mode="after")
    def _check(self) -> "ClipsConfig":
        if self.min_s >= self.max_s:
            raise ValueError("clips.min_s must be < clips.max_s")
        return self


class CaptionsConfig(BaseModel):
    style: Literal["karaoke", "simple", "none"] = "karaoke"
    font: str = "Montserrat ExtraBold"
    fonts_dir: Path = FONTS_DIR
    font_size: int = 84
    max_words: int = Field(3, ge=1, le=8)
    uppercase: bool = True
    text_color: str = "#FFFFFF"
    highlight_color: str = "#FFE600"
    outline: float = 6
    margin_v: int = 560  # px from bottom: keeps captions above TikTok/Reels UI
    hook: bool = True
    hook_duration_s: float = 3.0
    hook_margin_v: int = 280  # px from top: below the platform top bar
    cta_text: Optional[str] = None
    cta_duration_s: float = 2.0


class RenderConfig(BaseModel):
    width: int = 1080
    height: int = 1920
    crf: int = 20
    preset: str = "medium"
    audio_bitrate: str = "128k"
    lufs: float = -14.0
    true_peak: float = -1.5
    lra: float = 11.0


class ReframeConfig(BaseModel):
    analysis_fps: float = Field(5.0, gt=0, le=30)
    analysis_width: int = 640  # frames are downscaled to this width for detection
    min_face_conf: float = 0.5
    speakers: Literal["auto", "switch", "split", "single"] = "auto"  # 2 people on screen
    min_shot_s: float = 1.5  # minimum time on one speaker before switching
    deadzone: float = 0.08  # fraction of crop width the subject can move before the camera follows
    max_speed: float = 0.5  # max camera pan speed, fraction of source width per second
    face_model_url: str = (
        "https://storage.googleapis.com/mediapipe-models/face_detector/"
        "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
    )


class GameplayConfig(BaseModel):
    path: Optional[Path] = None  # file or folder of gameplay videos
    top_ratio: float = Field(0.6, gt=0.3, lt=0.9)


class WatchConfig(BaseModel):
    interval_min: float = Field(15, ge=1)
    max_attempts: int = 3


class PublishConfig(BaseModel):
    client_secret: Path = Path("client_secret.json")  # OAuth desktop client from Google Cloud Console
    privacy: Literal["private", "unlisted", "public"] = "private"
    category_id: str = "22"  # People & Blogs
    daily_quota: int = 10000
    upload_cost: int = 1600  # videos.insert quota units


class Config(BaseModel):
    lang: Optional[str] = None  # None = autodetect
    mode: Literal["center", "face", "sports"] = "face"
    translate: Optional[str] = None  # target language for a second, translated render
    output_dir: Path = Path("output")
    cache_dir: Path = Field(default_factory=lambda: Path.home() / ".cache" / "clipforge")
    db_path: Optional[Path] = None
    ffmpeg_path: Optional[str] = None
    max_download_height: int = 1080
    whisper: WhisperConfig = WhisperConfig()
    llm: LLMConfig = LLMConfig()
    clips: ClipsConfig = ClipsConfig()
    captions: CaptionsConfig = CaptionsConfig()
    render: RenderConfig = RenderConfig()
    reframe: ReframeConfig = ReframeConfig()
    gameplay: GameplayConfig = GameplayConfig()
    watch: WatchConfig = WatchConfig()
    publish: PublishConfig = PublishConfig()

    @property
    def database(self) -> Path:
        return Path(self.db_path) if self.db_path else self.cache_dir / "clipforge.db"

    def output_hash(self) -> str:
        """Hash of every setting that changes the produced clips (not paths)."""
        payload = self.model_dump(
            mode="json",
            include={"lang", "mode", "translate", "whisper", "llm", "clips", "captions", "render", "reframe",
                     "gameplay"},
            exclude={"captions": {"fonts_dir"}, "llm": {"ollama_host", "timeout_s"}},
        )
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _prune(d: dict) -> dict:
    """Drop None values (unset CLI flags) recursively, and dicts left empty."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            v = _prune(v)
            if v:
                out[k] = v
        elif v is not None:
            out[k] = v
    return out


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in _prune(over).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: Optional[Path] = None, overrides: Optional[dict] = None) -> Config:
    data: dict = {}
    candidate = path or (Path("config.yaml") if Path("config.yaml").exists() else None)
    if candidate:
        if not Path(candidate).exists():
            raise FileNotFoundError(f"Config file not found: {candidate}")
        data = yaml.safe_load(Path(candidate).read_text(encoding="utf-8")) or {}
    if overrides:
        data = _deep_merge(data, overrides)
    cfg = Config.model_validate(data)
    cfg.cache_dir = Path(cfg.cache_dir).expanduser()
    return cfg
