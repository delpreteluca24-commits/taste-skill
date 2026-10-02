# ICP e costruzione lista prospect (300)

## Criteri (ICP primario)
- Italia, priorità Lombardia / Veneto / Emilia-Romagna / Piemonte.
- ATECO 41.20 (costruzione di edifici residenziali e non), 42.x, 43.x con evidenza di subappalto.
- 10–200 addetti (classe addetti Registro Imprese).
- Segnali: sito con "general contractor", "chiavi in mano", "appalti pubblici", "SOA" (anche classe I–II: hanno subappaltatori ma non sono esenti patente), lavori pubblici su ANAC/portali regionali, cantieri visibili su LinkedIn.
- Decision maker: titolare/amministratore; influencer: responsabile tecnico, ufficio gare, RSPP.

## Fonti (senza spesa / con spesa)
| Fonte | Costo | Cosa dà | Note |
|---|---|---|---|
| Registro Imprese / InfoCamere (elenchi) | a pagamento (≈€0,20–0,50/record) | ragione sociale, ATECO, addetti, PEC, indirizzo | **richiede approvazione spesa** |
| ANAC / portali appalti regionali (aggiudicazioni) | gratis | imprese che vincono appalti pubblici 150k–5M (hanno subappalti) | ottimo filtro qualità |
| Elenchi ANCE territoriali / CNA / Confartigianato (soci pubblici) | gratis | nomi e siti | |
| Mappa realizzatori / albi fornitori Comuni | gratis | | |
| LinkedIn Sales Navigator | €99/mese | decision maker | **approvazione** |
| Siti aziendali | gratis | email generica (info@), telefono | email di ruolo preferibile per ePrivacy |
| Apollo/Lusha | a pagamento | email nominative | preferire email aziendali di ruolo; verificare base giuridica |

## Schema CSV (docs/sales/prospects-template.csv)
azienda · citta · provincia · regione · sito · email · telefono · pec · ateco · dimensione_addetti · settore · decision_maker_nome · decision_maker_ruolo · linkedin · cantieri_stimati · fonte · stato · ultimo_contatto · prossimo_followup · risultato · note

Stati: prospect · contacted · replied · qualified · demo · trial · proposal · paid · activated · retained · lost · do_not_contact.

## Processo (Day 5, ~6 h)
1. Estrarre 150 aggiudicatari da portali appalti regionali (gratis) + 150 da elenchi associazioni/siti (gratis).
2. Arricchire con sito, email di ruolo, telefono (manuale/semi-automatico).
3. Qualificare per addetti (sito "chi siamo", LinkedIn, visura light se approvata).
4. Inserire in CRM (Google Sheet V0; HubSpot free o Notion in V1).

**Nessun contatto reale viene inserito o contattato prima dell'approvazione dell'owner (FASE 28).**
