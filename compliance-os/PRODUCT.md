# PRODUCT.md — Compliance OS per cantieri

Stato: **V0 Concierge in preparazione. Nessun codice applicativo finché Gate 3 (≥2 paganti) non è superato.**

## Principio
Ogni feature deve rispondere SÌ ad almeno una domanda: aumenta revenue? retention? riduce costi? riduce rischio del cliente? riduce founder time? Altrimenti non si costruisce.

## Roadmap
| Versione | Contenuto | Condizione di ingresso |
|---|---|---|
| V0 Concierge | Google Sheet/Airtable + cartelle + reminder manuali/semi-automatici (vedi docs/product/concierge-mvp.md) | Gate 2 (≥5 aziende vogliono vedere) |
| V1 MVP | 11 feature core sotto | Gate 3 (≥2 paganti) + ≥3 pilot attivi |
| V2 Automation | estrazione date LLM, WhatsApp reminder, verifica coerenza documenti, portale subappaltatore con riuso documenti | Gate 4 (retention 60 gg) |
| V3 Advanced compliance | registro verifiche firmato, notifica preliminare helper, congruità, badge/presenze (dopo DM attuativo) | 25 clienti |
| V4 Multi-company | consulenti/CSE con più imprese clienti; committenti multi-cantiere | 50 clienti |
| V5 Enterprise | SSO, API, audit esteso | 100 clienti e richiesta esplicita |

## V1 MVP — scope (tutto il resto è fuori)
1. **Account impresa** (organization, utenti con ruolo admin/operatore/sola lettura).
2. **Dashboard** "Cosa richiede la mia attenzione oggi": contatori 🟢/🟠/🔴 per cantiere; lista azioni (documenti mancanti, in scadenza ≤30 gg, scaduti, upload da verificare).
3. **Cantieri** (nome, indirizzo, committente, date, CSE, stato).
4. **Subappaltatori** (anagrafica, P.IVA/CF, referente, email, telefono, tipo: impresa/autonomo, SOA sì/no).
5. **Invito subappaltatore**: link tokenizzato, nessun account richiesto, checklist dei documenti richiesti per quel cantiere.
6. **Upload documenti** con tipo, data emissione, data scadenza (manuale in V1; estrazione automatica in V2), stato "da verificare".
7. **Scadenze**: regole per tipo documento (DURC 120 gg; patente: verifica periodica configurabile es. 90 gg; formazione: quinquennale; idoneità: data giudizio; POS: per cantiere; CCIAA: 6 mesi configurabile).
8. **Stato** per documento e aggregato: OK / MANCANTE / IN SCADENZA / SCADUTO / DA VERIFICARE.
9. **Reminder** automatici: al subappaltatore (T−30, T−7, T0, poi settimanali) e riepilogo settimanale all'impresa.
10. **Audit trail**: chi ha caricato/verificato/cosa/quando (prova di diligenza).
11. **Export dossier** PDF per cantiere o per subappaltatore (elenco documenti, stati, date verifiche).

Checklist standard V1 (derivata da Allegato XVII + prassi; ogni voce con fonte in RESEARCH.md): visura CCIAA · DURC · DVR o autocertificazione · dichiarazione non sospensione/interdittiva (art. 14) · patente a crediti o SOA ≥ III · POS del cantiere · elenco lavoratori in cantiere + tesserini · attestati formazione per lavoratore · idoneità sanitaria per lavoratore · polizza RCT/RCO (contrattuale, opzionale) · contratto subappalto/autorizzazione committente (opzionale).

## User stories & acceptance criteria (V1)
- **US1** Come responsabile, creo un cantiere e aggiungo 5 subappaltatori in <10 minuti. *AC:* import da CSV o inserimento rapido; checklist precompilata.
- **US2** Come responsabile, invio un invito e il subappaltatore carica senza registrarsi. *AC:* link valido 30 gg, rinnovabile; upload mobile-friendly; conferma email.
- **US3** Come responsabile, vedo subito cosa manca per far entrare in cantiere il subappaltatore X. *AC:* badge stato per subappaltatore/cantiere; lista mancanti.
- **US4** Come responsabile, vengo avvisato 30 e 7 giorni prima di una scadenza. *AC:* email con link diretto; riepilogo settimanale lunedì 7:00.
- **US5** Come responsabile, durante un'ispezione esporto il dossier del cantiere. *AC:* PDF in <10 s con elenco documenti, date, stato, log verifiche.
- **US6** Come subappaltatore, riuso un documento già caricato per un altro cantiere della stessa impresa. *AC:* documento legato all'anagrafica, non al cantiere (eccetto POS).
- **US7** Come admin, so chi ha fatto cosa. *AC:* audit log immutabile, esportabile.

## Metriche di prodotto (vedi METRICS.md)
Time-to-value <30 min; % subappaltatori che caricano entro 7 gg ≥60%; weekly active companies ≥70%; alerts risolti/settimana.

## Fuori scope dichiarato (V1)
Redazione DVR/POS, firma digitale, badge hardware/controllo accessi, contabilità commessa, verifica automatica su portali INPS/INL (nessuna API pubblica), app nativa.
