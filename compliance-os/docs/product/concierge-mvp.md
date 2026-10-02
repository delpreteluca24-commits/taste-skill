# V0 — Concierge MVP (nessun codice)

Obiettivo: dimostrare valore a 3 pilot in 7 giorni dall'accettazione, con strumenti no-code gratuiti, misurando upload rate e tempo risparmiato.

## Strumenti (tutti gratuiti o già disponibili; nessuna spesa senza approvazione)
- **Airtable free** (o Google Sheets): base `Dossier Cantiere` con tabelle Organizations, Sites, Subcontractors, Requirements, Documents, Events.
- **Google Drive** (cartella per cliente → cantiere → subappaltatore) con link di upload: Google Form "Carica documenti" per subappaltatore (campi: tipo, file, data scadenza) oppure Dropbox File Request.
- **Reminder:** Gmail + template + calendario; in V0 i solleciti li manda il founder su regola fissa (T−30, T−7, T0), loggati in Events.
- **Dossier:** Google Docs template → PDF.
- **Dashboard cliente:** vista Airtable condivisa in sola lettura (o Sheet) con stato per subappaltatore/cantiere.

## Flusso
1. Kick-off 30 min: cliente invia elenco cantieri e subappaltatori (Excel) + checklist concordata (standard Allegato XVII).
2. Founder configura base e cartelle (≤1 h/cliente).
3. Inviti: email ai subappaltatori con link Form/File Request + lista documenti richiesti (template in docs/customer-success/templates.md).
4. Ogni upload: founder registra tipo, scadenza, stato in Airtable (≤5 min/documento). Da V1 lo fa il sistema.
5. Lunedì: riepilogo settimanale al cliente (stato + azioni).
6. Scadenze: solleciti ai subappaltatori secondo regola.
7. Fine pilot (30 gg): dossier PDF per cantiere + report "ore risparmiate, documenti raccolti, scadenze evitate".

## Metriche del pilot
upload entro 7 gg ≥60% · documenti mancanti all'inizio vs a 30 gg · ore founder per cliente (target ≤3 h/mese dopo setup) · disponibilità a pagare a fine pilot.

## Limiti dichiarati al cliente
Strumento in versione iniziale; nessuna consulenza; i documenti restano di proprietà del cliente; cancellazione a richiesta; dati personali dei lavoratori (idoneità, formazione) solo se strettamente necessari (vedi docs/legal/gdpr-checklist.md: da validare prima di gestire dati reali — **richiede approvazione owner**).
