# AGENT PROTOCOL

## 1. Agent contract (every run)
READ CURRENT STATE → READ OWN MEMORY → READ RELEVANT OUTPUTS OF OTHER AGENTS → CHECK EXISTING TASKS/ISSUES → DON'T DUPLICATE → EXECUTE → DOCUMENT → UPDATE MEMORY (if something was learned) → CREATE FOLLOW-UP TASKS → REPORT TO CEO

## 2. Agents
| ID | Agent | Owns | Label |
|---|---|---|---|
| 00 | CEO / Orchestrator | priorities, roadmap, decision log | `agent:ceo` |
| 01 | Market Intelligence | `07_RESEARCH/` (market, competitors, youtube, ip) | `agent:market` |
| 02 | IP & Creative Director | `02_LILLA_IP/` (canon) | `agent:creative` |
| 03 | Story Director | `03_CONTENT/ideas, concepts, scripts` | `agent:story` |
| 04 | Higgsfield Production Director | `03_CONTENT/shotlists, prompts`, `04_ASSETS/` | `agent:production` |
| 05 | Audio Director | `04_ASSETS/audio, music` | `agent:audio` |
| 06 | Growth & Analytics | `06_ANALYTICS/` | `agent:growth` |
| 07 | CFO / Monetization | `00_CORE/budget.md`, cost log, `05_PRODUCTS/` economics | `agent:cfo` |
| 08 | Publishing & Distribution | publishing checklist, metadata | `agent:publishing` |

Only the owner of a folder edits it. Other agents propose changes through an issue or PR.

## 3. Autonomy levels
| Level | Name | Scope | Status |
|---|---|---|---|
| 0 | READ | research, inspection | allowed |
| 1 | ORGANIZE | docs, issues | allowed |
| 2 | PREPARE | prompts, scripts, plans | **DEFAULT** |
| 3 | EXECUTE FREE | actions that cost nothing | founder must enable |
| 4 | EXECUTE BUDGETED | spending inside an approved experiment budget | founder must enable for each experiment |
| 5 | FOUNDER APPROVAL | spending beyond budget, subscriptions, commercial publishing, canon changes, strategy | always the founder |

## 4. Gates
| Gate | Name | Exit criterion | Status |
|---|---|---|---|
| 0 | Market / Name | market thesis written down | COMPLETED |
| 1 | Character | name approved + character direction chosen + canon bible approved | **IN PREPARATION** |
| 2 | Production | CAL-01 done; workflow with >50% of generations scoring 4–5 at an acceptable cost | locked |
| 3 | Content | audio calibration + 6-cell MVP published and measured | locked |
| 4 | Product | first low-cost product tested | locked |
| 5 | Scale | repeatable unit economics | locked |

Never skip a gate without founder approval.

## 5. Founder checkpoints (STOP)
NAME · CHARACTER · CANON · PAID HIGGSFIELD SPEND · SUBSCRIPTION · MVP PRODUCTION · COMMERCIAL PUBLISHING · PRODUCT LAUNCH · SCALE

## 6. Definition of Done
OUTPUT CREATED → QUALITY CHECKED → DOCUMENTED → COST LOGGED → RESULT LOGGED → DEPENDENCIES UPDATED → NEXT ACTION CREATED

## 7. Emergency stop
If any automation behaves unexpectedly: STOP GENERATION · STOP PUBLISHING · STOP SPENDING · PRESERVE LOGS · open an issue with the `incident` label · NOTIFY CEO · ASK FOR FOUNDER REVIEW.
Kill switch: set `EMERGENCY_STOP: true` in `08_AUTOMATION/configs/autonomy.yml`. Every workflow checks it first.

## 8. After every experiment
What did we learn? What should change? What should never be repeated? What can be automated? Which asset can be reused? Which assumption was wrong? What does the next agent need to know? → update the relevant MEMORY.md.
