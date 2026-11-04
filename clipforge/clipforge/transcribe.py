"""Step 2 — transcribe with faster-whisper (word timestamps + VAD), cached by media hash."""
from __future__ import annotations

import logging
from pathlib import Path

from rich.progress import BarColumn, Progress, TextColumn, TimeRemainingColumn

from .cache import read_json, write_json
from .hardware import resolve_whisper
from .models import MediaInfo, Segment, Transcript, Word

log = logging.getLogger(__name__)


class TranscribeError(RuntimeError):
    pass


def transcript_path(cfg, media: MediaInfo, model: str) -> Path:
    lang = cfg.lang or "auto"
    return Path(cfg.cache_dir) / "transcripts" / f"{media.media_hash}.{model}.{lang}.json"


def transcribe(media: MediaInfo, cfg) -> Transcript:
    wc = cfg.whisper
    model_name, device, compute_type = resolve_whisper(wc.model, wc.device, wc.compute_type)
    path = transcript_path(cfg, media, model_name)
    cached = read_json(path)
    if cached:
        log.info("Transcript cached: %s", path.name)
        return Transcript.model_validate(cached)

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise TranscribeError("faster-whisper is not installed: pip install faster-whisper") from e

    log.info("Loading whisper '%s' on %s (%s)", model_name, device, compute_type)
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:
        if device == "cuda":
            log.warning("CUDA load failed (%s); falling back to CPU int8", e)
            device, compute_type = "cpu", "int8"
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
        else:
            raise TranscribeError(f"Could not load whisper model '{model_name}': {e}") from e

    segments_iter, info = model.transcribe(
        media.audio_path,
        language=cfg.lang,
        word_timestamps=True,
        vad_filter=wc.vad,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=wc.beam_size,
        condition_on_previous_text=False,  # reduces hallucination loops on long audio
    )
    segments: list[Segment] = []
    with Progress(TextColumn("[cyan]Transcribing"), BarColumn(), TextColumn("{task.percentage:>3.0f}%"),
                  TimeRemainingColumn(), transient=True) as bar:
        task = bar.add_task("t", total=info.duration or media.duration)
        for seg in segments_iter:
            words = [
                Word(start=round(w.start, 3), end=round(w.end, 3), text=w.word.strip(), prob=round(w.probability, 3))
                for w in (seg.words or []) if w.word.strip()
            ]
            if not words:
                continue
            segments.append(Segment(id=len(segments), start=round(seg.start, 3), end=round(seg.end, 3),
                                    text=seg.text.strip(), words=words))
            bar.update(task, completed=seg.end)

    if not segments:
        raise TranscribeError("Whisper returned no speech. Is the audio silent or the language wrong?")
    tr = Transcript(language=info.language, duration=media.duration, model=model_name, segments=segments)
    write_json(path, tr.model_dump())
    log.info("Transcribed %d segments, language=%s", len(segments), tr.language)
    return tr
