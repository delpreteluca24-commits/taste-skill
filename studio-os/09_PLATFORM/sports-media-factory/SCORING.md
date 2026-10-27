# Opportunity Score — Rubric v0.1

> **Status:** PROPOSAL (FD-015). Weights are the founder's (master prompt). Anchors, gates and tier thresholds are HYPOTHESES to calibrate after ≥ 20 published Shorts.
> Used by: Radar (agents 01–02), CEO selection, Analytics calibration (agent 10).

## 1. Formula (founder's, unchanged)
```
OPPORTUNITY SCORE (0–100) = 10 × ( 0.20·Trend + 0.15·Timeliness + 0.15·Curiosity + 0.10·Audience
                                 + 0.10·CompetitionGap + 0.15·Originality
                                 + 0.05·Production + 0.05·Rights + 0.05·Monetization )
```
Each sub-score is an integer **0–10** with a **one-sentence written reason** (no reason → the sub-score counts as 0).
Weights sum to 1.00. Score is rounded to the nearest integer.

## 2. Anchors (0 / 5 / 10)
| Sub-score | 0 | 5 | 10 |
|---|---|---|---|
| **Trend** | no measurable interest | interest rising in one signal (pageviews or search or YouTube velocity) | rising in ≥ 2 independent signals, accelerating in the last 24 h |
| **Timeliness** | > 7 days old, nothing new | happened 24–72 h ago, or scheduled > 14 days out | happening now / < 24 h, or a scheduled moment ≤ 14 days out with a known stake |
| **Curiosity** | nothing unexpected | one surprising element (number, rule, reversal) | open loop a viewer cannot resolve without watching (record, "first since…", hidden rule) |
| **Audience** | sport/topic irrelevant to the target market | relevant to a niche of the target market | mass-relevant to the target market (e.g. an Italian athlete for an Italian channel) |
| **Competition gap** | angle already covered by large channels in the target language | covered, but generically | no strong piece with this angle in the target language |
| **Originality** | re-upload / compilation | commentary on a known story | our own data, rule explainer or record framing nobody has made |
| **Production** | needs footage or assets we can't get | ≤ 2 h with templates | ≤ 40 min with existing templates |
| **Rights** | RED | YELLOW | GREEN |
| **Monetization** | brand-unsafe or ad-unfriendly | neutral | advertiser-friendly, series potential, sponsor-adjacent |

## 3. Hard gates (applied after scoring; override the tier)
| Gate | Rule | Result |
|---|---|---|
| G1 Rights | Rights light = RED for the *planned format* | **IGNORE** (re-plan a GREEN format and re-score as a new opportunity) |
| G2 Facts | The core claim (the hook number/record/result) is not confirmed by an official or primary source | **HOLD** until confirmed |
| G3 Brand | Not explainable in the brand format (number / rule / record behind the moment) | **IGNORE** |
| G4 Safety | Speculation on intent, health, crime or private life of a person; tragedy without editorial value | **IGNORE** |

## 4. Why the gates are needed (evidence from the pilot, 2026-10-07)
Scoring a *re-upload of the Medvedev incident footage* with the prompt's formula:
Trend 9 · Timeliness 5 · Curiosity 8 · Audience 6 · Competition 2 · Originality 1 · Production 10 · Rights 0 · Monetization 0 → **52**.
The same clip one day earlier (Timeliness 9) → **58 → B-TIER**. A RED, zero-originality compilation would be "producible" by score alone. With G1 it is IGNORE whatever the score. Rights at 5% weight cannot enforce "RED must not be produced".

## 5. Tiers (HYPOTHESIS, calibrate)
| Tier | Score | Action |
|---|---|---|
| **S** | ≥ 75 | produce today; pre-build if the moment is scheduled |
| **A** | 65–74 | produce if capacity allows (max 1 Short/day in pilot) |
| **B** | 55–64 | backlog; re-score tomorrow |
| **IGNORE** | < 55 or gate G1/G3/G4 | log only |
| **HOLD** | gate G2 | re-check facts, then re-score |

## 6. Calibration (agent 10)
- Freeze sub-scores at selection time (prediction ledger). Collect outcomes at 24 h / 7 d / 28 d.
- After ≥ 20 Shorts: Spearman ρ(score, 7-day views) and ρ(score, avg % viewed). Per sub-score correlation.
- If ρ ≤ 0: the rubric is noise → founder review. If a sub-score has ~0 correlation for 2 reviews in a row → propose lowering its weight.
- Any weight change = new `scoring_models` version via PR, founder-approved. Past scores are never rewritten.
