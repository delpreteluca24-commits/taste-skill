# Demo account "Edilizia Rossi SRL" (dati fittizi)

Impresa: Edilizia Rossi SRL, Brescia, 45 addetti, 3 cantieri attivi, 15 subappaltatori.

## Cantieri
| Cantiere | Tipo | Stato dossier |
|---|---|---|
| C1 Residenza Le Vigne (Brescia) | privato, 12 unità, €1,4M | 🟠 2 documenti in scadenza |
| C2 Scuola primaria Via Roma (Rezzato) | pubblico, SAL mensili | 🔴 1 subappaltatore senza patente caricata, 1 DURC scaduto |
| C3 Capannone Logistica Nord (Montichiari) | privato, €600k | 🟢 regolare |

## Subappaltatori (15)
| # | Ragione sociale | Mestiere | Cantieri | Stato | Dettaglio |
|---|---|---|---|---|---|
| 1 | Impianti Bianchi Srl | elettrico | C1, C2 | 🟢 | tutto OK |
| 2 | Termoidraulica Verdi Snc | idraulico | C1 | 🟠 | DURC scade tra 9 gg |
| 3 | F.lli Neri Ponteggi | ponteggi | C1, C2, C3 | 🟢 | |
| 4 | Cartongessi Russo | cartongesso | C1 | 🔴 | formazione preposto scaduta |
| 5 | Scavi Moretti Srl | scavi | C3 | 🟢 | |
| 6 | Ferro & Cemento Sas | ferraioli | C2 | 🔴 | patente a crediti non caricata |
| 7 | Serramenti Alpi | infissi | C1 | 🟠 | visura CCIAA > 6 mesi |
| 8 | Impermeabilizzazioni Costa | coperture | C2 | 🔴 | DURC scaduto da 4 gg |
| 9 | Elettro Sud di Esposito | elettrico | C3 | 🟢 | |
| 10 | Pavimenti Gallo | pavimenti | C1 | 🟢 | |
| 11 | Pitture Conti | tinteggiatura | C1, C3 | 🟠 | POS C3 da verificare |
| 12 | Marco Ferrari (autonomo) | muratore | C1 | 🟢 | |
| 13 | Isolamenti Termici Srl | cappotto | C1 | 🟢 | |
| 14 | Demolizioni Riva | demolizioni | C2 | 🟢 | SOA classe III (esente patente) |
| 15 | Carpenteria Metallica Lupo | carpenteria | C3 | 🟠 | idoneità sanitaria 2 lavoratori scade tra 20 gg |

Totali dashboard: 🟢 9 · 🟠 4 · 🔴 3 (uno con due problemi) · documenti totali 112 · mancanti 3 · in scadenza 5 · scaduti 2 · da verificare 1.

## Sequenza demo (≤10 min)
1. (1 min) Problema: "Ferro & Cemento entra lunedì in C2. È a posto?"
2. (1 min) Import: mostro l'Excel di partenza → subappaltatori caricati.
3. (2 min) Dashboard: "cosa richiede attenzione oggi" → i 3 rossi.
4. (1 min) Documento mancante: Ferro & Cemento, patente → invio reminder con un clic → mostro cosa riceve il subappaltatore (link, lista, upload da telefono).
5. (1 min) Documento in scadenza: Termoidraulica Verdi, DURC a 9 gg → reminder già partito a T−30 e T−7 (log).
6. (1 min) Reminder automatici: regole T−30/T−7/T0 + riepilogo lunedì.
7. (1 min) Audit trail: chi ha verificato cosa e quando.
8. (1 min) Report: export dossier C2 in PDF → "questo è ciò che mostri all'ispettore".
9. (1 min) Prezzo e prossimo passo: pilot 30 gg a €149/mese founder price, setup incluso.

Il demo account in V0 è una base Airtable con questi dati; in V1 è un tenant seed.
