# Tool stack — minimum cost, maximum quality
Owner: CFO (07) + CEO (00) · Last checked: 2026-09-29 · Prices are **ESTIMATE** from secondary sources: re-check the official page **before paying** (rule: `CLAUDE.md`).

## Principle
Pay only when a gate needs it. One tool per job. Monthly plans only (credits expire every month; no annual plans before Gate 3). **Cancel the renewal the day you subscribe**, and resubscribe only when the next batch is approved.

## 1. Free foundations (€0) — set up now
| Tool | Job | Who sets it up | When |
|---|---|---|---|
| GitHub private repo `studio-os` | OS, memory, issues, Actions (free minutes on private repos: ESTIMATE ~2,000/month) | Founder (FD-002) | **now** |
| Claude (current plan) | All 11 agents: research, stories, prompts, code, QC | — | now |
| Environment network allowlist | Let Claude check tmdn.org, euipo.europa.eu, branddb.wipo.int, rdap.org, youtube.com, wikipedia.org | Founder: environment → Edit → Network access | now |
| Environment setup script | `apt-get install -y ffmpeg && pip install jsonschema pytest` so Claude can edit and test videos | Founder (or Claude writes it) | Gate 2 |
| Google Drive (15 GB free) + connector | Store heavy binaries (the repo keeps an index) | Founder connects it | Gate 2 |
| ffmpeg | Deterministic editing, Shorts crop, loudness, subtitles | Claude | Gate 2 |
| DaVinci Resolve (free) | Optional manual finishing by the founder | Founder | optional |
| Canva free / Figma free | Thumbnails, printables layout | Founder / Claude | Gate 3 |
| YouTube Audio Library | Licensed music and SFX for YouTube, €0 | Audio agent | Gate 3 |
| Freesound (CC0 filter only) | Extra SFX, public domain | Audio agent | Gate 3 |
| YouTube Brand Account + Google Cloud project (OAuth) | Channel, Data API (private uploads), Analytics API | Founder | Gate 3 |

## 2. Paid — only when the gate opens (FD-005)
| Job | Recommended | Price (ESTIMATE) | Alternative | Why / risk |
|---|---|---|---|---|
| Image + video generation (CAL-01, MVP) | **One** of: Higgsfield entry plan | ~$9–19/mo, commercial use on paid plans only; plans vary by region | Kling Standard ~$8.80–10/mo, 660 credits (5 s 720p ≈ 30 credits → ~110 s/month) | CAL-01 picks the generator; the free tiers have **no commercial rights** |
| Character sounds, SFX, narrator (AUD-01 B) | ElevenLabs Starter | ~$5/mo, commercial license, SFX 200 credits each | free SFX (Audio Library / CC0) | Only if free SFX isn't enough |
| Theme song | **Human composer, work-for-hire, you own it** | quote needed (UNKNOWN) | Suno Pro ~$10/mo | Suno's 2025 terms: commercial *license*, "generally not the owner" → weak for a song we want to register and sell. Use Suno only for mock-ups |
| Trademark | EUIPO filing | ≈ €850 for the 1st class + €50 for the 2nd + €150 each from the 3rd (official fees; verify) | national IT filing (cheaper) | **After** traction, not with the €300 |

## 3. Month-by-month cost plan (ESTIMATE)
| Phase | Tools paid | € |
|---|---|---|
| Gate 1 (weeks 0–2) | none (studies with free tiers + Claude) | 0–10 |
| Gate 2 CAL-01 | 1 month of 1 generator | 10–20 |
| Gate 3 MVP | 1–2 months of the generator + optional ElevenLabs | 20–60 |
| **Total to the end of MVP** | | **≈ €30–90 of the €210 spendable** |

## 4. Deliberately NOT buying
Stock subscriptions, SEO tools (vidIQ/TubeBuddy paid), multiple generators at once, annual plans, auto-refill, paid "YouTube automation" tools, unofficial or third-party MCPs when an official API exists.

## Sources (checked 2026-09-29)
- Higgsfield: [creatify](https://creatify.ai/blog/higgsfield-pricing-(2026)-plans-and-what-you-ll-actually-pay), [layer3labs](https://www.layer3labs.io/guides/higgsfield-ai-pricing)
- Kling: [layer3labs](https://www.layer3labs.io/guides/kling-ai-pricing), [kling.ai dev pricing](https://kling.ai/dev/pricing)
- ElevenLabs: [bigvu](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/), [elevenlabs.io](https://elevenlabs.io/pricing/api)
- Suno: [Suno Help – rights](https://help.suno.com/en/categories/550145-rights-ownership), [mystats.music](https://mystats.music/blog/suno-ai-legal-guide-2026)
- EUIPO fees: [euipo.europa.eu](https://www.euipo.europa.eu/en/trade-marks/before-applying/fees-payable-direct-filing)
