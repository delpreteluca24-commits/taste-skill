# Automazione e agenti

## Mappa automazione (target ≥90% delle attività ripetitive a V2)
| Area | V0 | V1 | V2 |
|---|---|---|---|
| Lead list | manuale | semi (scraping portali appalti + arricchimento) | semi |
| Outbound | manuale (invio con approvazione) | tool sequenze (lemlist/Instantly, approvazione owner) | auto con regole |
| Qualificazione | manuale | form 3 domande + score | score + routing |
| Scheduling | Cal.com | Cal.com | Cal.com |
| Demo | live | live + video self-service | video + trial con dati demo |
| Pagamento | link Stripe | Checkout | Checkout + portal |
| Onboarding | founder | wizard | wizard + import assistito |
| Reminder scadenze | founder (email template) | cron email | cron email+WhatsApp |
| Estrazione date | founder | manuale utente | LLM/OCR + conferma |
| Dossier | Google Docs | PDF generato | PDF + registro firmato |
| Supporto | email | email + KB | KB + chatbot + escalation |
| Billing/dunning | manuale | Stripe | Stripe |
| Reporting cliente | manuale | riepilogo settimanale auto | + report mensile |
| Analytics | sheet | eventi + dashboard | alert su churn risk |

## Agenti (solo quelli utili ora)
| Agente | Input | Output | Responsabilità | Limiti | Strumenti |
|---|---|---|---|---|---|
| RESEARCH | norme, circolari, competitor | aggiornamenti RESEARCH.md e competitors.md con fonti | tenere la matrice requisiti corretta | mai consulenza; sempre fonte primaria | web search, fetch |
| SALES-OPS | criteri ICP, fonti pubbliche | lista prospect in CSV, bozze email | preparare, non inviare | nessun invio/contatto senza approvazione; niente dati personali oltre email di ruolo | web, sheet |
| CEO | metriche, gate | decisioni in DECISIONS.md, report STATUS | decidere stop/go sui gate | non spende, non firma | docs |
| ENGINEERING (dopo Gate 3) | PRODUCT.md, architecture | codice testato, migrazioni, PR | V1 | piccoli incrementi, test, lint, build | repo |
| QA/SECURITY (dopo Gate 3) | PR | report test RLS, checklist | sicurezza multi-tenant | blocca merge se RLS fallisce | test, ZAP |
| CUSTOMER-SUCCESS (dopo primo cliente) | eventi prodotto | onboarding, report 30 gg, segnali churn | retention | non promette feature | email, KB |
| ANALYTICS (dopo primo cliente) | eventi, CRM | METRICS.md aggiornato | KPI | — | SQL |
Non creati: Product agent (coincide con CEO fino a 10 clienti), Marketing agent (nessun inbound prima di 25 clienti).

## Founder time (EST)
| Fase | Sales | Dev | Support | Ops | Marketing | Admin | Totale h/sett | Cosa resta al founder |
|---|---|---|---|---|---|---|---|---|
| 0–10 clienti | 15 | 15 | 3 | 4 | 4 | 2 | 40–45 | tutto |
| 10–50 | 10 | 10 | 4 | 3 | 4 | 2 | 30–35 | demo, roadmap, onboarding complessi |
| 50–100 | 6 | 6 | 2 | 2 | 3 | 1 | 18–22 (part-time CS da 80) | demo grandi, prodotto, numeri |
| 100–250 | 3 | 3 | 1 | 1 | 2 | 1 | 10–12 | decisioni, pricing, partnership, revisione metriche settimanale |
Target ≤10 h/sett realistico dal mese 15–18 con: CS part-time (onboarding+supporto), outbound in sequenze automatiche con SDR freelance a provvigione, prodotto stabile. Resta al founder: 1 h metriche, 2 h demo selezionate, 2 h prodotto/priorità, 2 h partnership, 1 h admin, 2 h buffer.
