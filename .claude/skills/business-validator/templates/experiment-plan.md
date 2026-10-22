# TEMPLATE — EXPERIMENTS, 7-DAY PLAN, BUILD GATE

Obiettivo: verificare se qualcuno lo **vuole e paga**, non costruire il prodotto.

## Principi di design degli esperimenti
- Ogni esperimento testa UNA ipotesi falsificabile, con soglia numerica decisa **prima** di eseguirlo.
- Misura comportamento (E2+), mai opinioni. "Lo comprerebbe?" non è una metrica.
- Preferisci, in quest'ordine: vendita manuale/preordine > demo con richiesta di impegno > outreach con call > landing con CTA a pagamento (anche fake door) > landing con email > intervista.
- Il campione minimo per decidere va dichiarato. Con <20 contatti, il risultato è INCONCLUSIVO salvo segnali estremi (0 risposte o pagamenti multipli).
- Sviluppo software consentito solo come landing/no-code ≤ 1 giorno.

## A. Validation Experiments (max 5)

Ordina per **Impact** (quanto riduce l'incertezza sulla fatal assumption) → **Cost** (€ + ore founder) → **Speed**.

```
| # | Ipotesi testata | Esperimento | Impact (H/M/L) | Costo € | Ore founder | Tempo | Metrica | GO se | KILL se |
|---|-----------------|-------------|----------------|---------|-------------|-------|---------|-------|---------|
| 1 | [fatal assumption] | … | H | … | … | … | … | ≥ … | < … |
```

## B. 7-Day Validation Plan

Massimo 7 giorni. Adatta i giorni all'idea (lo schema sotto è il default B2B; per B2C sostituisci outreach diretto con community/ads a basso budget).

```
DAY 1 — [obiettivo]
  Azione:     …
  Output:     [artefatto concreto: lista, script, documento]
  Metrica:    …
  Soglia GO:  …
  Soglia NO-GO: …
```

Schema di default:
| Giorno | Focus tipico |
|---|---|
| 1 | Lista di 30–50 potenziali clienti qualificati + 5–10 conversazioni/interviste sul problema (non sulla soluzione) |
| 2 | Analisi competitor e alternative attuali; definizione offerta e prezzo da testare |
| 3 | Landing / one-pager / mockup con CTA d'impegno (preordine, deposito, call a calendario) — max 1 giorno |
| 4 | Outreach (≥30 contatti) con messaggio orientato al problema |
| 5 | Call: qualificazione dolore, budget, decisore, alternativa attuale |
| 6 | Proposta con richiesta di impegno reale: preordine, deposito, pilota pagato, LOI con data |
| 7 | Analisi risultati vs soglie → GO / MODIFY / KILL, aggiorna memoria con `/business-validator update` |

Regola: le soglie NO-GO hanno la stessa forza delle soglie GO. Se una soglia NO-GO scatta, il piano si ferma lì e si va al Day 7.

## C. Build Gate

**BUILD NOW** solo se TUTTE vere:

```
[ ] Problema validato           — ≥5 clienti target confermano il problema con comportamento attuale (spendono tempo/soldi oggi) [≥E2]
[ ] Cliente identificato        — segmento definito, decisore d'acquisto noto, lista raggiungibile
[ ] Willingness to pay plausibile — almeno 1 impegno E3, idealmente ≥1 pagamento E4 al prezzo target
[ ] Canale di acquisizione plausibile — un canale ha prodotto conversazioni qualificate a costo misurato
[ ] Unit economics potenzialmente sostenibili — scenario BASE con LTV/CAC ≥ 3 o payback ≤ 12 mesi, su input misurati dove possibile
[ ] Fatal assumption non più completamente irrisolta — testata con esito non negativo
```

Altrimenti **DO NOT BUILD YET** + indica:
- quale casella manca,
- il test necessario per spuntarla (costo, tempo, soglia).

Se BUILD NOW: specifica **"Costruisci SOLO questo"** — il perimetro minimo che serve ai clienti che hanno già pagato o si sono impegnati, nient'altro. Preferisci servizio manuale + strumenti esistenti finché il lavoro manuale non supera ~10 ore/settimana.
