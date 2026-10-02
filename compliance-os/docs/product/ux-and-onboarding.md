# UX e onboarding

## Principio
Utente non tecnico, spesso da cantiere su telefono. Una domanda sopra tutto: **"Cosa richiede la mia attenzione oggi?"**

## Navigazione (V1)
Dashboard · Cantieri · Subappaltatori · Documenti · Scadenze · Attività (audit) · Impostazioni.

## Dashboard
- Riga 1: tre contatori grandi — 🟢 Regolari · 🟠 Attenzione · 🔴 Problemi (cantieri).
- Riga 2: lista "Oggi": [🔴 DURC scaduto · Impermeabilizzazioni Costa · C2 · Sollecita] [🟠 Scade tra 9 gg · DURC · Termoidraulica Verdi · C1] [🔵 Da verificare · POS · Pitture Conti · C3 · Verifica].
- Riga 3: cantieri con barra stato e "prossima scadenza".
- Azioni a un clic: Sollecita · Verifica · Esporta dossier · Invita subappaltatore.

## Pagina subappaltatore
Intestazione con stato aggregato; tabella documenti (tipo, file, emesso, scade, stato, verificato da/quando); cantieri collegati; lavoratori (se gestiti); pulsante "Invia link upload".

## Portale subappaltatore (senza account)
Link → pagina con logo impresa, lista documenti richiesti con stato, pulsante upload per ciascuno, campo data scadenza (precompilato se estratto), conferma. Funziona da telefono. Lingua: italiano semplice; in V2 anche rumeno/albanese (**ASSUMPTION**: quota rilevante di subappaltatori stranieri; Unioncamere: 678k imprese di stranieri, boom al Nord nelle costruzioni, FACT-2).

## Onboarding (Time-to-value <30 min)
1. Registrazione (email + password o magic link) — 1 min.
2. Impresa: ragione sociale, P.IVA, logo opzionale — 2 min.
3. Primo cantiere — 2 min.
4. Subappaltatori: incolla da Excel (ragione sociale, email, telefono, P.IVA) — 5 min.
5. Checklist: standard preselezionata, togli/aggiungi — 3 min.
6. Inviti: anteprima email, invia a tutti — 2 min.
7. Dashboard: stato "in attesa upload" e cosa succede dopo — fine.
Wizard con progress bar; dati demo "Edilizia Rossi" disponibili con un clic per esplorare.

## Stati e colori
OK verde · IN SCADENZA arancione (≤30 gg configurabile) · SCADUTO rosso · MANCANTE rosso · DA VERIFICARE blu. Mai solo colore: sempre icona + testo (accessibilità).

## Copy di sicurezza (sempre visibile in checklist)
"La checklist è una base di partenza derivata da Allegato XVII D.Lgs 81/2008 e dalla disciplina della patente a crediti. Non sostituisce la valutazione del tuo consulente o del coordinatore. Fonte accanto a ogni voce."
