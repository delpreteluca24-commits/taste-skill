# ClipForge

Free, local, open-source alternative to Opus Clip / Ssemble.
Long video in → N vertical 9:16 clips (1080×1920, 20–60 s) out, with animated karaoke captions,
hook title, metadata (title, description, hashtags) and a viral score. No paid services.

```
URL / file ─► ingest (yt-dlp) ─► transcribe (faster-whisper, cached)
          ─► LLM picks moments (Ollama local by default) ─► snap to word/silence edges
          ─► reframe (face tracking · speaker switch/split · sports motion) ─► optional gameplay split
          ─► ffmpeg render + .ass captions (+ translated variant) + loudnorm -14 LUFS
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
clipforge run ./podcast.mp4 --speakers split --translate en
clipforge run ./stream.mp4 --mode sports
clipforge run ./talk.mp4 --gameplay ./gameplay/        # 60% talk on top, 40% muted gameplay below
clipforge status          # recent jobs
clipforge resume <job>    # resume with the job's original config

clipforge watch https://www.youtube.com/@channel      # poll RSS every 15 min, clip new uploads
clipforge watch https://www.youtube.com/@channel --once --backfill 3   # for cron / Task Scheduler
clipforge publish youtube output/<video_id>/clip_01.json [--lang en] [--privacy unlisted] [--dry-run]
```

| Flag | Default | Notes |
|---|---|---|
| `--clips/-n` | 10 | max clips to export |
| `--min / --max` | 20 / 60 | clip length in seconds |
| `--lang` | auto | also picks the matching audio track on multi-audio videos |
| `--llm` | `ollama:qwen2.5:7b` | `gemini:<model>` needs `GEMINI_API_KEY`, `groq:<model>` needs `GROQ_API_KEY` |
| `--whisper` | auto | `small` on CPU, `large-v3-turbo` on GPU |
| `--style` | karaoke | `karaoke` · `simple` · `none` |
| `--mode` | face | `face` (MediaPipe) · `sports` (optical flow) · `center` |
| `--speakers` | auto | 2 people far apart: `switch` to who talks · `split` stacked · `single` |
| `--translate` | – | e.g. `en`: also renders `clip_XX.en.mp4` with translated captions + metadata |
| `--gameplay` | – | video file or folder; bottom 40% gameplay, muted and looped |
| `--cta` | – | text shown in the last 2 s |
| `--no-hook` | – | disable the hook title in the first 3 s |

Settings live in `config.yaml` (copy `config.example.yaml`).

### Output

```
output/<video_id>/
  clip_01.mp4   1080x1920 h264 crf20, aac 128k, -14 LUFS
  clip_01.ass   captions (editable, re-burnable)
  clip_01.jpg   thumbnail
  clip_01.json  metadata: start/end, score, hook_title, title, description, hashtags, reframe layout...
  clip_01.en.*  translated variant (with --translate en)
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
- **Reframing.** Faces are detected at 5 fps (MediaPipe, full frame + side tiles for small faces in wide
  shots). The camera path is smoothed offline (Kalman + RTS smoother, no lag), with a deadzone and a max pan
  speed, then rendered by ffmpeg `sendcmd` moving the crop: no frame round-trip through Python.
  With 2 people too far apart for one vertical crop, ClipForge cuts to whoever talks (mouth-region motion,
  hysteresis, min shot length; interjections under 0.6 s are ignored) or stacks both (`--speakers split`).
  `sports` follows optical-flow motion with the camera pan removed. If detection is unavailable it falls back
  to a centre crop and says so.
- **Translation** is done per sentence (for context); each sentence keeps its original start/end and the
  translated words are spread over it, so karaoke still works.
- **Viral score** is the LLM's estimate. Use it to rank clips, not as a measured prediction.

## Watch & publish

- `watch` uses the channel's public RSS feed (no API key, no quota). On first run existing uploads are marked
  as seen (`--backfill N` clips the latest N). Shorts are skipped; failed videos (e.g. a live not finished)
  are retried up to 3 times. Stop with Ctrl+C and restart any time: state is in SQLite.
- `publish youtube` setup (once):
  1. Google Cloud Console → new project → enable **YouTube Data API v3**.
  2. OAuth consent screen (External, add yourself as test user) → Credentials → OAuth client ID → **Desktop app**
     → download as `client_secret.json` in your working dir.
  3. `pip install -e ".[publish]"`; the first `clipforge publish` opens the browser to authorize.
  Limits: one upload costs 1600 of the 10,000 daily units (~6 uploads/day, reset at midnight Pacific).
  Usage is tracked locally and blocks before exceeding it. Until Google audits your API project, uploads are
  forced to **private** — publish them from YouTube Studio. Re-running publish on the same clip is a no-op.
- TikTok / Instagram: no automatic publishing by design. Upload the mp4 and paste title/description/hashtags
  from the clip json.

## Tests

```bash
pip install -e ".[dev]"
pytest            # unit + end-to-end tests (synthetic videos, fake LLM/whisper; needs ffmpeg)
```

## Known limits

- Speaker detection is visual (mouth motion). Off-screen speakers, masks or heavy head movement confuse it;
  use `--speakers split` or `single` then.
- The short-range face model is tuned for faces closer than ~2 m; very wide shots with tiny faces may fall back
  to centre crop.
- On headless Linux MediaPipe needs `apt install libegl1 libgles2`.

## Legal

Only clip content you own or are licensed to use. Downloading from some platforms may violate their terms of
service; that is your responsibility. Gemini/Groq send the transcript to third-party servers; Ollama keeps
everything local.

Font: Montserrat (SIL Open Font License, see `clipforge/assets/fonts/OFL.txt`).
