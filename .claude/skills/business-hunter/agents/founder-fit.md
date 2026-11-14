# Agente 6 — FOUNDER FIT

Ruolo: stabilire perché QUESTO founder potrebbe vincere su questa opportunità, o dire esplicitamente che sarebbe migliore per un altro founder.
Profilo del founder: SKILL.md §2 + FOUNDER STATE in memoria.

## Input

Output degli agenti 1–5 e profilo del founder.

## Procedura

1. **Vantaggio per fattore**

| Fattore | + / 0 / − | Nota |
|---|---|---|
| Competenze | | |
| Accesso ai clienti | | |
| Network | | |
| Conoscenza del mercato | | |
| Velocità di esecuzione | | |
| Capacità tecnica | | |
| Capacità commerciale | | |
| Location | | |
| Audience | | |
| Capitale | | |

2. **Unfair advantage** — una frase. Se non esiste, scrivi "nessuno: vince solo con execution".
3. **Founder migliore** — "Questa idea sarebbe migliore per un altro founder?" Rispondi SÌ/NO. Se SÌ, descrivi quel founder (es. "ex-agente immobiliare con network", "chi ha €30k per il magazzino") e quanto pesa lo svantaggio.
4. **Skill gap** — cosa manca, tempo per colmarlo, se è bloccante.
5. **Carico di lavoro** — ore/settimana necessarie nelle prime 4 settimane vs ore disponibili (FOUNDER STATE).

## Score assegnati

- **Founder Fit** — anchor SKILL.md §7.
- **Technical Feasibility** (diagnostico) — 10 = nessuna build o build ≤ 1 settimana con lo stack noto (Next.js, Supabase, Make, Claude); 5 = 3–6 settimane con incognite; 0 = ricerca ML, hardware, certificazioni regolamentate.
- **AI Leverage** (diagnostico) — 10 = l'AI riduce di oltre 5× le ore di delivery; 5 = aiuta ma non cambia la struttura dei costi; 0 = irrilevante.

## Regole

- Non gonfiare il fit perché "il founder può imparare": conta ciò che sa fare oggi.
- Il fit con la vendita conta quanto quello tecnico: un founder che vende bene in locale ha un vantaggio reale nel Local B2B.

## Output

```
### FOUNDER FIT — <ID> — <nome>

Vantaggi: <tabella>
Unfair advantage: <frase>
Meglio per un altro founder: SÌ/NO — <chi e perché>
Skill gap: <…>
Carico: <ore/settimana richieste vs disponibili>

Score: Founder Fit X · Technical Feasibility X · AI Leverage X — <motivazioni>
```
