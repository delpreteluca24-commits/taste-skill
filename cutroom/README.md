# Cutroom — AI social video editor

Upload 2+ clips → one vertical **9:16** short, edited like a social media editor would: dead air and false
starts cut, face-aware reframing, word-timed animated captions, purposeful zooms, motion graphics and SFX —
then refine it by **chat** ("rendi l'hook più forte", "massimo 30 secondi") with undo/redo and versions.

Every automatic decision is stored on the element with a **reason** (visible in the inspector). Effects come
after content: hook → retention → story → clarity → rhythm.

```
UPLOAD → NORMALIZE (ffmpeg) → MEDIA ANALYSIS → TRANSCRIPTION (Whisper, word timing) → SEMANTIC ANALYSIS
→ EDIT DECISION LIST → TIMELINE → PREVIEW (Remotion Player) → CHAT → TIMELINE PATCH (ops) → QC → RENDER (MP4)
```

Architecture, data model, agents, roadmap, Supabase schema/RLS for the SaaS phase: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements

- Node.js ≥ 20, **ffmpeg + ffprobe** on PATH
- ~1 GB disk for dependencies; the first analysis downloads the Whisper model from Hugging Face (`Xenova/whisper-small`, ≈ 250 MB)
- First export downloads Chrome Headless Shell for Remotion (automatic), unless `CUTROOM_BROWSER` points to a Chromium

## Run

```bash
cd cutroom
npm install
npm run dev          # API on :5174 + editor on http://localhost:5173
# production
npm run build && npm start   # everything on http://localhost:5174
```

Workflow in the app: **Upload → Analisi → AI Edit → Preview → Chat → Fine tune → Export**.

## Configuration (env)

| Variable | Default | Notes |
|---|---|---|
| `CUTROOM_LANGUAGE` | `it` | spoken language (`en`, `es`, … or `auto`) |
| `CUTROOM_WHISPER_MODEL` | `Xenova/whisper-small` | any transformers.js Whisper ONNX export with word timestamps (larger = better Italian, slower); models without word alignment fall back to segment timing |
| `CUTROOM_STT` | `local` (`groq` if `GROQ_API_KEY` set) | `local` · `groq` (whisper-large-v3-turbo, fast) · `openai` — remote adapters not tested in the build environment (no keys) |
| `GROQ_API_KEY` / `OPENAI_API_KEY` | – | only for remote transcription |
| `ANTHROPIC_API_KEY` | – | enables Claude for chat intent (`claude-opus-5-5`, structured outputs, server-side fallback); without it the built-in IT/EN interpreter is used |
| `CUTROOM_DATA` | `./data` | projects, media, versions, renders (git-ignored) |
| `CUTROOM_MODELS_DIR` | – | offline model directory for transformers.js |
| `CUTROOM_PREVIEW_CODEC` | `h264` | `vp9` for browsers without H.264 (open-source Chromium) |
| `CUTROOM_BROWSER` | auto | Chromium/headless-shell path for rendering |

## Chat commands (examples)

`Taglia i primi 5 secondi` · `Taglia questa parte` (selection with Shift+drag on the ruler, or the shot under the
playhead) · `Rendi il video più dinamico` · `Rendi più dinamico il minuto iniziale` · `Fai i sottotitoli più grandi` ·
`Metti più zoom` · `Togli tutti gli effetti` · `Rendi lo stile più premium` · `Metti una grafica quando parlo dei
1.000 euro` · `Fai durare il video massimo 30 secondi` · `Rendi l'hook più forte` · `Usa meno SFX` ·
`Metti una CTA finale "PRENOTA ORA"` · `Fai una versione più aggressiva` · `annulla`.

**Channel intro.** `Non saltare mai la intro "we uagliù cià", è lo slogan del canale` makes the opening greeting the
channel slogan: never cut, animated big words, and its audio is the **untouched original** (no denoise, no gating).
The take is saved once in `data/brand/intro.mp4` and prepended to every new project, so the intro is identical in
every video.

**Precise edits (ops API / LLM).** Beyond chat rules, `POST /api/projects/:id/ops` accepts: `set_selects` (keep only
the chosen moments of a clip, e.g. each ingredient going on the pizza; a zoom-punch transition joins them),
`add_insert` (a gag clip such as a rooster call dropped in after a source instant, with whip in/out; mark the clip
with `PATCH /api/projects/:id/media/:mediaId {"use":"insert"}` so it is not part of the story), `add_source_zoom`
(punch-in on a point of the frame, e.g. the ingredient plate), `add_graphic` with `src` (a tag pinned to a source
moment), `keep_source` (bring back a passage) and `set_word_text` (fix a caption word).

Each message becomes typed operations (`src/core/ops.ts`) applied incrementally to the current timeline; the
result is a **proposal** you preview, then **Applica / Annulla / Prova un'altra versione**. Applied changes are
versions (Version 1 Originale, Version 2 Auto Edit, …): undo, redo, or jump to any version.

## Presets

Viral · Premium · Minimal · Podcast · Educational · Storytelling · Fast Paced · Cinematic — each sets pause length,
padding, cold open, B-roll length, zoom density/scale, graphics/SFX density, transitions, caption style, grade
and the default duration budget (`src/core/presets.ts`). Switching preset keeps your cuts and edits.

## Tests

```bash
npm test         # 58 tests: engine/agents, chat interpreter on the spec commands, history, QC, score, ffmpeg pipeline
npm run typecheck
```

## What is measured vs estimated

- **Content Retention Score** = observable signals (hook timing, shot length, residual pauses, visual change per
  4 s, caption speed, words/min, payoff position, CTA). It is **not** a virality prediction.
- Loudness target −14 LUFS / −1 dBTP and the 3-minute Shorts limit are platform conventions: re-check before relying on them.

## Known limits (Phase 1)

- Quality of cuts and captions depends on the transcript: `whisper-base` mis-hears dialect and kitchen noise;
  use `whisper-small` (default) or larger, or Groq. Hallucination loops, chunk-overlap duplicates and words in
  silence are filtered (`src/core/agents/transcriptClean.ts`).
- Without `ANTHROPIC_API_KEY`, semantic roles (hook/payoff/CTA) and chat intents use rules (IT/EN), not an LLM.
- B-roll is kept in narrative order; semantic B-roll overlay on matching phrases is Phase 2.
- No music library is bundled (licensing): upload your own track, it is ducked under speech automatically.
- Render speed on 4 CPU: ≈ 5 s per output second at 1080p (TEST RESULT 2026-10-01). Remotion is free for teams of
  up to 3 people; larger companies need a license.
- Local single-user app: no auth. Never expose port 5174 publicly.

## Layout

```
src/core      pure TypeScript edit engine (timeline model, agents, ops, interpreter, history, QC, score)
src/remotion  the composition shared by the Player preview and the final render
src/server    Fastify API, ffmpeg analysis, Whisper worker, face detection, jobs, render
src/web       React editor (Vite + Tailwind)
scripts       SFX synthesizer (ffmpeg, no third-party audio), dev runner
```
