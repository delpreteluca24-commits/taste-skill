# ESEMPIO — esecuzione FULL

> File di riferimento, non caricato automaticamente. Mostra il livello di rigore atteso.
> In questo esempio la web research NON è stata eseguita: tutti i dati di mercato sono marcati `[ASSUNZIONE]` o `[MANCANTE]`. In un run reale vanno verificati.

**Input utente:**
> Valida questa idea: SaaS per ristoranti che permette di modificare il menu tramite WhatsApp usando AI.

---

## Phase 0 — Idea Card (estratto)

```
BUSINESS IDEA: Menu via WhatsApp AI
Slug: menu-whatsapp-ai · Idee correlate in memoria: nessuna

Idea in una frase: Aiutiamo ristoratori ad aggiornare il menu digitale mandando un messaggio WhatsApp, a €P/mese.

Problema:      aggiornare il menu digitale (QR, sito) è scomodo [ASSUNZIONE]
Cliente:       titolare di ristorante indipendente [ASSUNZIONE] — dimensione/geografia [MANCANTE — ALTO]
Soluzione:     bot WhatsApp che interpreta il messaggio e aggiorna il menu digitale [DATO-UTENTE]
Pricing:       [MANCANTE — ALTO]
Acquisition:   [MANCANTE — ALTO]
Delivery:      SaaS + API WhatsApp Business [DATO-UTENTE]
Competitors:   piattaforme menu QR, gestionali, Google Business Profile [ASSUNZIONE — da verificare]
Founder adv.:  [MANCANTE — MEDIO]
Critical Unknowns: frequenza reale di modifica del menu; dove il menu deve essere aggiornato (1 o N canali)
```

Gap analysis: mancano pricing, canale, founder advantage. *Chi paga* e *cosa compra* sono identificabili → nessuna domanda, si procede con assunzioni dichiarate.

---

## Report

```
═══════════════════════════════════════
BUSINESS VALIDATION REPORT — Menu via WhatsApp AI
2026-10-22 · FULL · web research: NO
═══════════════════════════════════════

1. EXECUTIVE VERDICT
   🟡 MODIFY
   Confidence: 55%
   One-line reason: "Modificare il menu" è probabilmente un evento troppo raro per sostenere un
   abbonamento; il dolore plausibile è tenere allineati PIÙ canali (piatto del giorno, orari,
   disponibilità) — testare quello, venduto come servizio.
   Idea modificata: "Mandi un WhatsApp, aggiorniamo menu, piatto del giorno e orari su Google,
   sito, QR e delivery. €39/mese, fatto da noi."
   Score: 49/100 · Evidence coverage: 0% (nessuna dimensione a peso 3 con evidenza ≥E2)

2. BUSINESS MODEL
   Problema:      aggiornare menu digitale è scomodo [ASSUNZIONE]
   Cliente:       titolare ristorante indipendente [ASSUNZIONE]
   Soluzione:     bot WhatsApp + AI che aggiorna il menu [DATO-UTENTE]
   Pricing:       €19–69/mese (scenari) [ASSUNZIONE]
   Acquisition:   outreach diretto locale [ASSUNZIONE]
   Revenue Model: abbonamento mensile
   Cost Model:    API WhatsApp + LLM + hosting + tempo founder [ASSUNZIONE]
   Dati mancanti critici: frequenza modifiche, WTP, canale

3. SUPPORTER — Best plausible case
   Tesi: i ristoratori vivono su WhatsApp; ogni interfaccia "da gestionale" è attrito. Il valore
   non è il menu, è non dover aprire 4 pannelli diversi quando cambia qualcosa.
   Top 5 motivi:
   1. WhatsApp è già il canale operativo del ristoratore [OPINIONE]
   2. Menu/orari errati su Google costano clienti [IPOTESI]
   3. Piatto del giorno = trigger quotidiano, non occasionale [IPOTESI]
   4. Erogabile manualmente da subito (founder riceve il WhatsApp e aggiorna a mano) [FATTO: nessuna tecnologia richiesta per il pilota]
   5. Costo marginale basso → margine lordo alto [STIMA]
   MVP minimo: numero WhatsApp + founder che aggiorna a mano Google Business Profile e menu QR. €0, 1 giorno.
   Percorsi:
   €1k/mese  = 26 × €39 (lordi) — outreach diretto in 1 città — 3–5 mesi [STIMA]
   €5k/mese  = 128 × €39 — serve automazione reale + 1 canale scalabile (partner: fornitori, commercialisti di settore) [STIMA]
   €10k/mese = 256 × €39 o upsell (recensioni, post social) — serve team vendita o partnership [STIMA]
   Condizioni necessarie: aggiornamenti ≥1/settimana; dolore multi-canale reale; disponibilità a €30+/mese.
   Variante migliore: servizio "presenza digitale gestita via WhatsApp" (menu + orari + post + risposte recensioni).

4. SKEPTIC — Kill list
| # | Problema                                              | Sev | Tipo       | Test                                       | Costo | Tempo | Conferma se                | Distrugge se              |
|---|-------------------------------------------------------|-----|------------|--------------------------------------------|-------|-------|----------------------------|---------------------------|
| 1 | Il menu cambia poche volte l'anno → nessun motivo di abbonarsi | 5 | ipotetico | 10 interviste: "quando hai cambiato il menu l'ultima volta? cosa hai fatto?" | €0 | 2gg | ≥5/10 aggiornano ≥1/sett | ≤2/10 aggiornano ≥1/mese |
| 2 | WTP bassa: "lo fa mio nipote gratis"                 | 4   | ipotetico  | Proposta pilota pagato €39 dopo call       | €0    | 5gg   | ≥2 pagamenti su 10 call     | 0 su 10 call              |
| 3 | Feature già inclusa in piattaforme menu QR/gestionali | 4 | ipotetico | Mappare 10 competitor e loro funzioni      | €0    | 1g    | nessuno aggiorna multi-canale via chat | ≥2 lo fanno già, a ≤€20 |
| 4 | AI commoditization: Google/Meta abilitano update via chat | 4 | ipotetico | Verifica roadmap/feature attuali         | €0    | 2h    | assente                    | già disponibile           |
| 5 | CAC alto: ristoratori difficili da raggiungere, poco tempo | 4 | ipotetico | Outreach 50 contatti                     | €0    | 3gg   | ≥5 call                    | ≤1 call                   |
| 6 | Dipendenza da API WhatsApp Business (costi, policy)   | 3   | ipotetico  | Leggere pricing/policy BSP                 | €0    | 2h    | costo <€3/cliente/mese      | policy vieta il caso d'uso |
| 7 | Errori AI su prezzi/allergeni → rischio legale        | 3   | ipotetico  | Conferma umana obbligatoria nel flusso     | €0    | —     | flusso con conferma accettato | cliente rifiuta il passaggio extra |
| 8 | Churn alto (ristoranti chiudono/cambiano spesso)      | 3   | ipotetico  | Dato da fonte camerale sul turnover        | €0    | 2h    | —                          | —                         |
| 9 | Integrazioni con N piattaforme = complessità tecnica  | 3   | ipotetico  | Pilota manuale prima di integrare          | €0    | —     | —                          | —                         |
|10 | Dipendenza dal founder nel modello manuale            | 2   | ipotetico  | Misurare minuti/cliente/settimana nel pilota | €0  | 7gg   | <20 min                    | >60 min                   |
   Vera alternativa attuale: non aggiornare, o chiedere a un parente/dipendente.

   FATAL ASSUMPTION: "I ristoratori modificano informazioni online (menu, piatto del giorno,
   orari, disponibilità) almeno una volta a settimana e oggi questo costa loro abbastanza da
   pagare ≥€30/mese per delegarlo."

5. INVESTOR
   Scenari (tutte ASSUNZIONI, nessun dato misurato):
   | Assunzione       | WORST | BASE | BEST |
   | Prezzo €/mese    | 19    | 39   | 69   |
   | Margine lordo    | 75%   | 85%  | 90%  |
   | Churn mensile    | 8%    | 5%   | 3%   |
   | CAC €            | 400   | 200  | 100  |  (= ore outreach × €20 ÷ clienti)
   | Costi fissi €/m  | 50    | 50   | 50   |

   | Output                     | WORST | BASE | BEST  |
   | LTV € (ARPA×MG÷churn)      | 178   | 663  | 2.070 |
   | LTV/CAC                    | 0,4   | 3,3  | 20,7  |
   | Payback mesi (CAC÷(ARPA×MG))| 28   | 6    | 1,6   |
   | Clienti per break-even     | 4     | 2    | 1     |
   | Clienti per €1k contrib./m | 71    | 31   | 17    |

   Assunzione più sensibile: churn × prezzo (insieme determinano se LTV/CAC passa da 0,4 a >3).
   Score: 49/100 · Evidence coverage: 0%
   Red flags: Willingness To Pay = 3.
   ⚠ Lo score è una sintesi ordinale di giudizi, non una misura: qui riflette solo assunzioni.

6. JUDGE
   Decision: 🟡 MODIFY
   Reason: Supporter e Skeptic concordano che il pilota è erogabile a mano a costo zero (supportato).
   Il caso positivo dipende interamente dalla frequenza di aggiornamento (solo ipotesi). Il rischio #1
   è severità 5 ma ipotetico e testabile in 2 giorni → non giustifica KILL. L'idea "modifica menu"
   isolata è debole; la variante multi-canale ha un trigger più frequente → MODIFY.
   Conflitto: Supporter "trigger quotidiano" vs Skeptic "evento raro"
     → assunzione: esiste un contenuto che cambia ogni settimana
     → dato risolutivo: frequenza aggiornamenti dichiarata + verificata su Google/Instagram del locale
     → test: guardare gli ultimi 30 giorni di post/aggiornamenti di 30 ristoranti (gratis, 2h) + 10 interviste.
   Capital Allocation Test (30gg, €1.000): NO a 30 giorni pieni; YES ai 7 giorni del piano sotto
   (costo ≈ €0 + ~25 ore). I 30 giorni si sbloccano solo con ≥2 piloti pagati.

7. FATAL ASSUMPTION
   Aggiornamenti ≥1/settimana + disponibilità a pagare ≥€30/mese per delegarli.
   Se falsa: nessun motivo ricorrente di pagare → al massimo un servizio una tantum.

8. BIGGEST UNKNOWNS
   1. Frequenza reale di aggiornamento — ALTO
   2. WTP per delega — ALTO
   3. Funzioni già offerte da piattaforme esistenti — ALTO
   4. Canale con CAC sostenibile — MEDIO
   5. Minuti di lavoro manuale per cliente — MEDIO

9. VALIDATION EXPERIMENTS
| # | Ipotesi | Esperimento | Impact | € | Ore | Tempo | Metrica | GO se | KILL se |
| 1 | Frequenza | Audit 30 profili Google/IG ultimi 30gg | H | 0 | 2 | 1g | % locali con ≥4 update/mese | ≥30% | <10% |
| 2 | Dolore | 10 interviste sul problema | H | 0 | 6 | 2g | n. con workaround attivo | ≥5/10 | ≤2/10 |
| 3 | WTP | Pilota manuale pagato €39 primo mese | H | 0 | 6 | 3g | pagamenti | ≥2/10 call | 0/10 |
| 4 | Concorrenza | Mappa 10 competitor | M | 0 | 3 | 1g | n. con update via chat | 0–1 | ≥2 a ≤€20 |
| 5 | Canale | Outreach 50 locali | M | 0 | 8 | 3g | call prenotate | ≥5 | ≤1 |

10. 7-DAY VALIDATION PLAN
   DAY 1 — Lista 50 locali + audit frequenza su 30 · Output: foglio · GO ≥30% con ≥4 update/mese · NO-GO <10%
   DAY 2 — 10 interviste sul problema (non sulla soluzione) · GO ≥5 workaround attivi · NO-GO ≤2
   DAY 3 — One-pager + numero WhatsApp dedicato (no codice) · Output: link · NO-GO: richiede >1 giorno
   DAY 4 — Outreach 50 locali (porta a porta + WhatsApp) · GO ≥12 risposte · NO-GO ≤3
   DAY 5 — Call di qualificazione · GO ≥5 call con decisore · NO-GO ≤1
   DAY 6 — Offerta pilota €39 primo mese, pagamento anticipato · GO ≥2 pagati · NO-GO 0
   DAY 7 — Analisi + /business-validator update

11. BUILD GATE
   DO NOT BUILD YET
   [ ] Problema validato   [ ] Cliente identificato   [ ] WTP plausibile
   [ ] Canale plausibile   [ ] Unit economics (solo assunzioni)   [ ] Fatal assumption testata
   Test necessario prima di costruire: pilota manuale con ≥2 pagamenti (Experiment #3).

12. NEXT ACTION
   Oggi: apri Google Maps, seleziona 30 ristoranti della tua città e conta gli aggiornamenti
   (post, orari, menu) degli ultimi 30 giorni in un foglio. 2 ore.
═══════════════════════════════════════
```

## Esempio successivo — UPDATE

> /business-validator update — Ho contattato 50 ristoranti. 12 hanno risposto, 5 hanno fatto una call e 2 hanno accettato una demo.

```
UPDATE REPORT — menu-whatsapp-ai
Evidence delta: primo dato comportamentale; livello massimo E2 (demo gratuita ≠ intenzione d'acquisto)
Funnel: 50 → 12 risposte (24%) → 5 call (10%) → 2 demo (4%) → 0 pagamenti
Hypotheses:
  Canale (≥12 risposte su 50) → CONFERMATA (soglia esatta)
  Call con decisore (≥5)      → CONFERMATA (soglia esatta)
  WTP (≥2 pagamenti)          → NON TESTATA: l'offerta a pagamento non è stata fatta
Score: 49 → 50 (Distribution 4→5, evidenza E2: +3 punti pesati su 250)
Verdict: 🟡 MODIFY → 🟡 MODIFY (Confidence 55% → 60%)
Build Gate: DO NOT BUILD YET — manca WTP
Next action: nelle 2 demo, chiudere con proposta pilota €39 pagato in anticipo. Non fare altre demo gratuite.
```
