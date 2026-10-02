# BUSINESS.md — Compliance OS per cantieri (nome di lavoro: "Dossier Cantiere")

Ultimo aggiornamento: 2026-10-02 · Stato: **PRE-VALIDAZIONE (Gate 0 superato: research; Gate 1 non iniziato)**

## Missione
Permettere a un'impresa edile che lavora con subappaltatori di sapere in 10 secondi: chi è verificato, cosa manca, cosa scade, cosa richiede attenzione oggi. Senza sostituire consulente sicurezza, CSE o avvocato.

## ICP (Ideal Customer Profile)
**Primario — Impresa affidataria / general contractor**
- 10–200 addetti; 3–20 cantieri attivi/anno; 5–30 subappaltatori ricorrenti.
- ATECO 41.2 (costruzione edifici), 43.x (lavori specializzati con subappalto), 42 (opere di ingegneria civile) per le piccole.
- Ha una persona che "fa la sicurezza" (impiegata amministrativa, geometra, responsabile tecnico) e un consulente RSPP esterno.
- Oggi usa: email, WhatsApp, Excel, cartelle Drive/Dropbox; a volte modulo del gestionale (TeamSystem Construction, STR Vision) non usato per questo.
- Trigger: ispezione INL/ASL subita o vicina; cantiere pubblico che chiede dossier; CSE che pretende documenti; nuovo cantiere con molti subappaltatori; sanzione patente €12k letta sui giornali di settore.
- Geografia iniziale: Nord Italia (Lombardia, Veneto, Emilia-Romagna, Piemonte) dove la densità di imprese 10–200 addetti è maggiore (**ASSUMPTION** da distribuzione Movimprese).

**Secondario (fase 2):** committenti industriali con appalti interni (art. 26), consulenti sicurezza/CSE come rivenditori, amministratori di condominio con cantieri (obbligo verifica patente, **FACT-2**).

**Non-ICP:** micro-imprese <5 addetti senza subappalti; grandi gruppi con suite HSE già in uso (Twind, Ctaima); PA.

## Problema
Quando parte un cantiere con più subappaltatori, il responsabile deve raccogliere, verificare e tenere aggiornati decine di documenti con scadenze diverse (DURC 120 gg, patente a crediti, formazione, idoneità, POS), rincorrendo i subappaltatori via email/WhatsApp, senza una prova ordinata di aver verificato. Dal 1/1/2026 la sanzione minima per subappaltatore senza patente è €12.000 e i controlli INL si concentrano sulla filiera degli appalti.

## Job-to-be-done scelto
"Quando devo far entrare un subappaltatore in cantiere (o quando arriva un controllo), voglio sapere subito se è a posto e avere il dossier pronto, senza rincorrere nessuno via email e senza scoprire a sorpresa un documento scaduto."

## Value proposition (scelta)
"Vedi in un'unica schermata quali subappaltatori sono in regola, cosa manca e cosa scade. I documenti li carica il subappaltatore da un link; i solleciti partono da soli; il dossier di cantiere è pronto in un clic."

## Pricing (ipotesi da validare — vedi docs/business/pricing.md)
| Piano | Prezzo/mese | Limiti | Note |
|---|---|---|---|
| Starter | €99 | 3 cantieri attivi, 10 subappaltatori | solo email reminder |
| Professional | €199 | 10 cantieri, 40 subappaltatori | WhatsApp reminder, export dossier, utenti illimitati |
| Pro | €399 | illimitati, multi-sede, API, registro verifiche avanzato | onboarding assistito |
| Setup fee | €299–499 | opzionale, import iniziale fatto da noi | test in pre-sale |
| Annuale | −15% | | |
Prezzo test pre-sale: **€149–199/mese**, con "founder price" bloccato 12 mesi. Il subappaltatore non paga mai.

## Business model
SaaS B2B mensile, fatturato all'impresa affidataria. Delivery automatizzata (link al subappaltatore → upload → estrazione date → scadenzario → reminder → dossier). Gross margin target >85%.

## Obiettivi
| Milestone | Target | Gate |
|---|---|---|
| 14 giorni | 300 prospect, 20 conversazioni, 8 demo, 3 pilot, 2 paganti | Gate 1–3 |
| Mese 3 | 5 clienti, retention 100% a 60 gg | Gate 4 |
| Mese 6 | 20 clienti, €3k MRR | |
| Mese 12 | 50–65 clienti, €10k MRR | Gate 5 |
| Mese 24 | 90–150 clienti, €18–30k MRR, founder ≤10 h/sett | |

## Assunzioni critiche (da verificare, in ordine di fragilità)
1. L'impresa affidataria percepisce la responsabilità (solidale e art. 90/97) abbastanza da pagare €149–199/mese. **Test:** pre-sale.
2. I subappaltatori caricano i documenti da un link senza che l'impresa debba inseguirli. **Test:** pilot concierge, misurare % upload entro 7 gg.
3. Il consulente sicurezza esterno non blocca la vendita (anzi rivende). **Test:** 3 interviste.
4. Reply rate outbound ≥4% con hook normativo (benchmark 5–6% verticali, 1,9% medio). **Test:** campagna Day 6–7.
5. Churn ≤3%/mese (uso settimanale + dati accumulati). **Test:** mesi 3–6.

## Cosa NON facciamo
Consulenza legale/sicurezza; redazione DVR/POS; verifica DURC per conto terzi su Durc On Line (serve SPID/delega); promesse di "conformità garantita"; badge hardware; gestione contabile della commessa.
