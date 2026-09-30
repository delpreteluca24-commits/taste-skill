"""ClipForge CLI."""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

app = typer.Typer(add_completion=False, help="ClipForge: long video -> vertical viral clips, 100% local.")
console = Console()


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format="%(message)s", datefmt="%X",
                        handlers=[RichHandler(console=console, show_path=False, markup=False)], force=True)
    for noisy in ("httpx", "faster_whisper"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@app.command()
def run(
    source: str = typer.Argument(..., help="URL (YouTube/Vimeo/Twitch/Kick...) or local video file"),
    clips: Optional[int] = typer.Option(None, "--clips", "-n", help="Number of clips"),
    min_s: Optional[float] = typer.Option(None, "--min", help="Min clip length (s)"),
    max_s: Optional[float] = typer.Option(None, "--max", help="Max clip length (s)"),
    lang: Optional[str] = typer.Option(None, "--lang", help="Source language (it, en...). Default: autodetect"),
    llm: Optional[str] = typer.Option(None, "--llm", help="ollama:qwen2.5:7b | gemini:<model> | groq:<model>"),
    style: Optional[str] = typer.Option(None, "--style", help="karaoke | simple | none"),
    mode: Optional[str] = typer.Option(None, "--mode", help="center (face|sports: phase 2)"),
    whisper_model: Optional[str] = typer.Option(None, "--whisper", help="tiny|base|small|medium|large-v3|large-v3-turbo|auto"),
    cta: Optional[str] = typer.Option(None, "--cta", help="Call-to-action text for the last 2s"),
    no_hook: bool = typer.Option(False, "--no-hook", help="Disable the hook title overlay"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    config: Optional[Path] = typer.Option(None, "--config", "-c", help="config.yaml path"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Clip a video end to end. Re-running the same command resumes an interrupted job."""
    _setup_logging(verbose)
    from .config import load_config
    from .pipeline import run as run_pipeline

    overrides = {
        "lang": lang, "mode": mode, "output_dir": output,
        "clips": {"count": clips, "min_s": min_s, "max_s": max_s},
        "llm": {"provider": llm},
        "whisper": {"model": whisper_model},
        "captions": {"style": style, "cta_text": cta, "hook": False if no_hook else None},
    }
    try:
        cfg = load_config(config, overrides)
        report = run_pipeline(source, cfg)
    except KeyboardInterrupt:
        console.print("[yellow]Interrupted. Run the same command again to resume.[/]")
        raise typer.Exit(130)
    except Exception as e:
        if verbose:
            console.print_exception()
        console.print(f"[bold red]Error:[/] {e}")
        raise typer.Exit(1)
    console.print(f"[bold green]Done.[/] Report: {report.resolve()}")


@app.command()
def status(config: Optional[Path] = typer.Option(None, "--config", "-c"), limit: int = 20) -> None:
    """List recent jobs."""
    from .config import load_config
    from .db import DB

    db = DB(load_config(config).database)
    t = Table("job", "status", "video", "clips", "updated", "error")
    for j in db.list_jobs(limit):
        t.add_row(j["id"][:8], j["status"], j["video_id"], str(j["n_clips"]), j["updated_at"], (j["error"] or "")[:60])
    console.print(t)


@app.command()
def resume(job_id: str, verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Resume a job with the exact config it was started with."""
    _setup_logging(verbose)
    from .config import Config, load_config
    from .db import DB
    from .pipeline import run as run_pipeline

    db = DB(load_config(None).database)
    job = db.get_job(job_id)
    db.close()
    if not job:
        console.print(f"[red]No job {job_id}[/]")
        raise typer.Exit(1)
    cfg = Config.model_validate(json.loads(job["config_json"]))
    try:
        report = run_pipeline(job["source"], cfg)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {e}")
        raise typer.Exit(1)
    console.print(f"[bold green]Done.[/] Report: {report.resolve()}")


@app.command()
def doctor(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
    """Check ffmpeg, libass, whisper, yt-dlp, GPU and the LLM provider."""
    from . import ffmpeg
    from .config import load_config
    from .hardware import cuda_available, resolve_whisper

    cfg = load_config(config)
    ffmpeg.set_ffmpeg_path(cfg.ffmpeg_path)
    ok = True

    def check(name: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= passed
        console.print(f"{'[green]OK  [/]' if passed else '[red]FAIL[/]'} {name} {detail}")

    try:
        check("ffmpeg", True, ffmpeg.ffmpeg_bin())
        check("ffmpeg libass (ass filter)", ffmpeg.has_filter("ass"), "needed for subtitles")
        check("ffmpeg loudnorm", ffmpeg.has_filter("loudnorm"))
    except ffmpeg.FFmpegError as e:
        check("ffmpeg", False, str(e))
    for mod in ("faster_whisper", "yt_dlp"):
        try:
            __import__(mod)
            check(mod, True)
        except ImportError:
            check(mod, False, f"pip install {mod.replace('_', '-')}")
    model, device, ct = resolve_whisper(cfg.whisper.model, cfg.whisper.device, cfg.whisper.compute_type)
    check("GPU (CUDA)", True, f"{'yes' if cuda_available() else 'no, CPU mode'} -> whisper {model} on {device}/{ct}")
    check("font", (cfg.captions.fonts_dir / "Montserrat-ExtraBold.ttf").exists(), str(cfg.captions.fonts_dir))
    if cfg.llm.provider.startswith("ollama"):
        import httpx

        model_name = cfg.llm.provider.partition(":")[2]
        try:
            tags = httpx.get(f"{cfg.llm.ollama_host}/api/tags", timeout=5).json()
            names = {m["name"] for m in tags.get("models", [])}
            check("ollama", True, cfg.llm.ollama_host)
            check(f"ollama model {model_name}", model_name in names or f"{model_name}:latest" in names,
                  f"run: ollama pull {model_name}")
        except Exception:
            check("ollama", False, f"not reachable at {cfg.llm.ollama_host}: run `ollama serve`")
    raise typer.Exit(0 if ok else 1)


@app.command()
def watch(channel_url: str) -> None:
    """(phase 2) Poll a YouTube channel RSS and clip new uploads."""
    console.print("[yellow]`watch` arrives in phase 2.[/]")
    raise typer.Exit(2)


@app.command()
def publish(platform: str, clip_json: Path) -> None:
    """(phase 2) Upload a clip (YouTube Data API v3)."""
    console.print("[yellow]`publish` arrives in phase 2.[/]")
    raise typer.Exit(2)


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
