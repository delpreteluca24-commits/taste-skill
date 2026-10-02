# METRICS.md

Ultimo aggiornamento: 2026-10-02. Tutti gli "actual" sono 0: nessuna attività commerciale ancora avviata (richiede approvazione per contattare persone reali).

## Validazione (14 giorni)
| KPI | Target | Actual | Note |
|---|---|---|---|
| Interviste qualitative (Gate 1) | ≥10 | 0 | |
| Prospect in lista | 300 | 0 | lista da costruire (vedi docs/sales/prospecting.md) |
| Contattati | 300 | 0 | |
| Risposte | ≥20 (6,7%) · minimo 12 (4%) | 0 | benchmark verticale 5–6% |
| Conversazioni significative | ≥20 · kill <10 | 0 | |
| Qualificati | ≥12 | 0 | |
| Demo | ≥8 · kill <5 | 0 | |
| Pilot | ≥3 | 0 | |
| Paganti (Gate 3) | ≥2 | 0 | |
| Prezzo accettato | €149–199/mese | — | |

## Funnel (definizioni)
Prospect → Contacted (1ª email inviata) → Replied (qualsiasi risposta umana) → Qualified (ICP confermato: ≥10 addetti, subappalti, decision maker raggiunto) → Demo (call fatta) → Trial/Pilot (dati reali caricati) → Proposal (offerta inviata) → Paid (pagamento ricevuto) → Activated (≥1 cantiere, ≥3 subappaltatori, ≥1 upload) → Retained (attivo a 60 gg).

## KPI ricorrenti (da mese 1 post-vendita)
| KPI | Target | Formula |
|---|---|---|
| Response rate | ≥4% | replied / contacted |
| Qualified rate | ≥50% | qualified / replied |
| Demo rate | ≥60% | demo / qualified |
| Close rate | ≥25% | paid / demo |
| CAC | ≤€300 (costi vivi) | spesa outbound+tool / paid |
| Activation | ≥80% entro 7 gg | activated / paid |
| Time-to-value | <30 min | signup → primo invito inviato |
| Upload rate subappaltatori | ≥60% entro 7 gg | upload / inviti |
| Weekly active companies | ≥70% | org con login o azione settimanale |
| Alerts risolti/settimana | crescente | |
| Churn mensile | ≤3% | cancellazioni / clienti inizio mese |
| MRR / ARR | 10k a M12 | |
| Founder hours/sett | ≤10 a M18 | time log |

## Eventi prodotto (da implementare in V1)
signup · onboarding_started · onboarding_completed · company_created · site_created · subcontractor_added · invite_sent · document_uploaded · requirement_verified · reminder_sent · alert_resolved · report_exported · trial_started · subscription_started · cancellation.

## Esperimenti
| ID | Ipotesi | Metrica | Esito |
|---|---|---|---|
| E1 | Hook "sanzione €12.000" batte hook "dossier pronto per il CSE" | reply rate per variante (100 email ciascuna) | da eseguire |
| E2 | Titolare risponde più del responsabile tecnico | reply rate per ruolo | da eseguire |
| E3 | Setup fee €299 non riduce il close rate | close rate con/senza | da eseguire |
