# ClipForge

Free, local, open-source alternative to Opus Clip / Ssemble.
Long video in → N vertical 9:16 clips (1080×1920, 20–60 s) out, with animated karaoke captions,
hook title, metadata (title, description, hashtags) and a viral score. No paid services.

```
URL / file ─► ingest (yt-dlp) ─► transcribe (faster-whisper, cached)
          ─► LLM picks moments (Ollama local by default) ─► snap to word/silence edges
          ─► 9:16 crop ─► ffmpeg render + .ass captions + loudnorm -14 LUFS
          ─► output/<video_id>/ clip_XX.mp4 · clip_XX.json · report.html
```

## Install (5 commands)

Requirements: **Python 3.10–3.12**, **ffmpeg with libass**, **Ollama** (or a free Gemini/Groq key).

**macOS**
```bash
brew install python@3.11 ffmpeg ollama
git clone <repo> && cd clipforge
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
ollama serve & ollama pull qwen2.5:7b
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt install -y python3.11-venv ffmpeg && curl -fsSL https://ollama.com/install.sh | sh
git clone <repo> && cd clipforge
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
ollama pull qwen2.5:7b
```

**Windows (PowerShell)**
```powershell
winget install Python.Python.3.11 Gyan.FFmpeg Ollama.Ollama
git clone <repo>; cd clipforge
py -3.11 -m venv .venv; .venv\Scripts\Activate.ps1
pip install -e .
ollama pull qwen2.5:7b
```

Then check everything: `clipforge doctor`

> No system ffmpeg? `pip install imageio-ffmpeg` gives a static build (with libass) that ClipForge picks up automatically.
> NVIDIA GPU: faster-whisper uses CUDA automatically if cuBLAS + cuDNN 9 are installed; otherwise it falls back to CPU.

## Usage

```bash
clipforge run "https://www.youtube.com/watch?v=..." --clips 10 --min 20 --max 60 --lang it
clipforge run ./podcast.mp4 --llm gemini:gemini-2.5-flash --style simple --cta "Seguimi per la parte 2"
clipforge status          # recent jobs
clipforge resume <job>    # resume with the job's original config
```

| Flag | Default | Notes |
|---|---|---|
| `--clips/-n` | 10 | max clips to export |
| `--min / --max` | 20 / 60 | clip length in seconds |
| `--lang` | auto | also picks the matching audio track on multi-audio videos |
| `--llm` | `ollama:qwen2.5:7b` | `gemini:<model>` needs `GEMINI_API_KEY`, `groq:<model>` needs `GROQ_API_KEY` |
| `--whisper` | auto | `small` on CPU, `large-v3-turbo` on GPU |
| `--style` | karaoke | `karaoke` · `simple` · `none` |
| `--cta` | – | text shown in the last 2 s |
| `--no-hook` | – | disable the hook title in the first 3 s |

Settings live in `config.yaml` (copy `config.example.yaml`).

### Output

```
output/<video_id>/
  clip_01.mp4   1080x1920 h264 crf20, aac 128k, -14 LUFS
  clip_01.ass   captions (editable, re-burnable)
  clip_01.jpg   thumbnail
  clip_01.json  metadata: start/end, score, hook_title, title, description, hashtags...
  report.html   previews sorted by score
```

Upload is manual: every clip has its metadata ready to paste into TikTok / Shorts / Reels.

## How it works

- **Idempotent + resumable.** Downloads, audio, transcripts (keyed by file hash + model) and LLM picks are
  cached under `~/.cache/clipforge`. Job/step/clip state lives in SQLite. Re-running the same command after a
  crash skips finished steps and already rendered clips.
- **LLM returns segment ids, not seconds.** The transcript is sent as numbered segments; the model answers with
  `start_seg`/`end_seg`. Seconds come from Whisper's timestamps, so the model can't hallucinate them.
  The answer is validated with pydantic (Ollama gets the JSON schema as structured output); invalid output is
  retried with the error message.
- **Snapping.** Clips skip leading fillers ("allora", "ehm", "so", "um"...), end on a full sentence, respect
  min/max, never overlap, and are padded into surrounding silence.
- **Viral score** is the LLM's estimate. Use it to rank clips, not as a measured prediction.

## Tests

```bash
pip install -e ".[dev]"
pytest            # unit tests + an end-to-end render with a synthetic video (needs ffmpeg)
```

## Roadmap (phase 2)

Face tracking (MediaPipe + smoothing) · sports mode (optical flow) · 2-speaker split · gameplay split ·
subtitle translation · `watch` (channel RSS) · `publish youtube` (Data API v3; unaudited API projects upload as
private and ~6 uploads/day fit the default quota).

## Legal

Only clip content you own or are licensed to use. Downloading from some platforms may violate their terms of
service; that is your responsibility. Gemini/Groq send the transcript to third-party servers; Ollama keeps
everything local.

Font: Montserrat (SIL Open Font License, see `clipforge/assets/fonts/OFL.txt`).
