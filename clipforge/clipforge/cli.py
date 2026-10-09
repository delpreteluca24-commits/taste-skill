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


def _overrides(clips, min_s, max_s, lang, llm, mode, speakers, translate, gameplay, output) -> dict:
    return {
        "lang": lang, "mode": mode, "translate": translate, "output_dir": output,
        "clips": {"count": clips, "min_s": min_s, "max_s": max_s},
        "llm": {"provider": llm},
        "reframe": {"speakers": speakers},
        "gameplay": {"path": gameplay},
    }


@app.command()
def run(
    source: str = typer.Argument(..., help="URL (YouTube/Vimeo/Twitch/Kick...) or local video file"),
    clips: Optional[int] = typer.Option(None, "--clips", "-n", help="Number of clips"),
    min_s: Optional[float] = typer.Option(None, "--min", help="Min clip length (s)"),
    max_s: Optional[float] = typer.Option(None, "--max", help="Max clip length (s)"),
    lang: Optional[str] = typer.Option(None, "--lang", help="Source language (it, en...). Default: autodetect"),
    llm: Optional[str] = typer.Option(None, "--llm", help="ollama:qwen2.5:7b | gemini:<model> | groq:<model>"),
    style: Optional[str] = typer.Option(None, "--style", help="karaoke | simple | none"),
    mode: Optional[str] = typer.Option(None, "--mode", help="face (default) | sports | center"),
    speakers: Optional[str] = typer.Option(None, "--speakers", help="2 people on screen: auto|switch|split|single"),
    translate: Optional[str] = typer.Option(None, "--translate", help="Also render translated captions (en, es...)"),
    gameplay: Optional[Path] = typer.Option(None, "--gameplay", help="Gameplay video or folder: 60/40 split, muted"),
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

    overrides = _overrides(clips, min_s, max_s, lang, llm, mode, speakers, translate, gameplay, output)
    overrides["whisper"] = {"model": whisper_model}
    overrides["captions"] = {"style": style, "cta_text": cta, "hook": False if no_hook else None}
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
    for mod, pkg in (("mediapipe", "mediapipe"), ("cv2", "opencv-python-headless")):
        try:
            __import__(mod)
            if mod == "mediapipe":
                from mediapipe.tasks.python import vision  # noqa: F401  (loads native libs)
            check(f"{mod} (face/sports reframe)", True)
        except ImportError:
            check(f"{mod} (face/sports reframe)", False, f"pip install {pkg}; --mode center works without it")
        except OSError as e:
            check(f"{mod} (face/sports reframe)", False, f"{e}; Linux: apt install libegl1 libgles2")
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
def watch(
    channel_url: str = typer.Argument(..., help="YouTube channel URL (/@handle, /channel/UC..., /c/name)"),
    backfill: int = typer.Option(0, "--backfill", help="Also clip the N most recent existing uploads"),
    once: bool = typer.Option(False, "--once", help="Poll once and exit (for cron / Task Scheduler)"),
    interval: Optional[float] = typer.Option(None, "--interval", help="Minutes between polls (default 15)"),
    clips: Optional[int] = typer.Option(None, "--clips", "-n"),
    min_s: Optional[float] = typer.Option(None, "--min"),
    max_s: Optional[float] = typer.Option(None, "--max"),
    lang: Optional[str] = typer.Option(None, "--lang"),
    llm: Optional[str] = typer.Option(None, "--llm"),
    mode: Optional[str] = typer.Option(None, "--mode"),
    speakers: Optional[str] = typer.Option(None, "--speakers"),
    translate: Optional[str] = typer.Option(None, "--translate"),
    gameplay: Optional[Path] = typer.Option(None, "--gameplay"),
    output: Optional[Path] = typer.Option(None, "--output", "-o"),
    config: Optional[Path] = typer.Option(None, "--config", "-c"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Poll a YouTube channel's RSS every 15 min and clip new uploads (Ctrl+C to stop)."""
    _setup_logging(verbose)
    from .config import load_config
    from .pipeline import run as run_pipeline
    from .watch import WatchError
    from .watch import watch as watch_channel

    overrides = _overrides(clips, min_s, max_s, lang, llm, mode, speakers, translate, gameplay, output)
    overrides["watch"] = {"interval_min": interval}
    try:
        cfg = load_config(config, overrides)
        watch_channel(channel_url, cfg, lambda url: run_pipeline(url, cfg), backfill=backfill, once=once)
    except KeyboardInterrupt:
        console.print("[yellow]Watcher stopped.[/]")
    except WatchError as e:
        console.print(f"[bold red]Error:[/] {e}")
        raise typer.Exit(1)


@app.command()
def publish(
    platform: str = typer.Argument(..., help="youtube (TikTok/Instagram: upload manually with the exported metadata)"),
    clip_json: Path = typer.Argument(..., help="output/<video_id>/clip_XX.json"),
    variant: str = typer.Option("", "--lang", help="Upload the translated variant (e.g. en) instead"),
    privacy: Optional[str] = typer.Option(None, "--privacy", help="private (default) | unlisted | public"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be uploaded, no API call"),
    config: Optional[Path] = typer.Option(None, "--config", "-c"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Upload a clip as a YouTube Short (Data API v3, OAuth, quota-aware)."""
    _setup_logging(verbose)
    if platform.lower() != "youtube":
        console.print("[red]Only `youtube` is supported. TikTok/Instagram: upload the mp4 + json metadata manually.[/]")
        raise typer.Exit(2)
    from .config import load_config
    from .publish.youtube import PublishError, publish as publish_youtube

    try:
        cfg = load_config(config, {"publish": {"privacy": privacy}})
        publish_youtube(clip_json, cfg, variant=variant, dry_run=dry_run)
    except (PublishError, FileNotFoundError) as e:
        console.print(f"[bold red]Error:[/] {e}")
        raise typer.Exit(1)


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
