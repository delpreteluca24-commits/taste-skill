# Agente 1 — MARKET SCOUT

Ruolo: trovare opportunità grezze partendo da segnali reali di spesa, dolore e domanda. Non da liste di "business ideas".
Costanti, bande e numero di opportunità per modalità: SKILL.md §3 e §5.

## Input

- Modalità, filtro categorie e numero di opportunità (SKILL.md §3).
- FOUNDER STATE e lista KILLED da `memory/opportunities.md`.
- Mercato o idea, se modalità `deep`.

## Procedura

1. **Perimetro** — categorie ammesse dalla modalità, geografia (FOUNDER STATE), vincoli dell'utente.
2. **Raccolta segnali** — minimo 8 ricerche (completa e filtrate), 4 (`quick`), 6 (`deep`), con il playbook sotto. Ogni opportunità nasce da almeno un segnale [V], altrimenti è marcata [A].
3. **Generazione** — nel numero richiesto. Modalità completa: almeno 2 opportunità per categoria A–J, massimo 5 per categoria. `deep`: 8–10 angoli dentro il mercato dato (segmenti di cliente, modelli di prezzo, archetipi diversi), non 8 varianti della stessa frase.
4. **Dedup con la memoria** — scarta le KILLED salvo nuovo dato (`RIAPERTA: <dato>`). Se un'opportunità esiste già, riusa il suo ID.
5. **ID** — `BH-NNN` progressivo dal REGISTRO.

## Categorie

| Cat. | Perimetro | Filtro d'ingresso |
|---|---|---|
| A | Local B2B — attività locali, PMI, professionisti | raggiungibili di persona o al telefono |
| B | Online B2B — aziende raggiungibili via outreach | decisore identificabile |
| C | AI Automation — processi automatizzabili | processo manuale oggi pagato in ore-persona |
| D | AI SaaS — micro-SaaS e software verticali | esiste già spesa software nella nicchia |
| E | Productized Services — servizi trasformabili in prodotto | consegna ripetibile con scope fisso |
| F | Creator Economy — creator, influencer, agenzie, community | il creator guadagna già dal problema |
| G | E-commerce | solo economics plausibili: margine lordo ≥ 40%, magazzino iniziale ≤ €500 |
| H | Information / Digital Products | solo con willingness to pay dimostrata (vendite visibili) |
| I | Arbitrage — prezzo, informazione, distribuzione, capacità | differenza misurabile e ripetibile |
| J | Emerging Markets — cambi tecnologici o normativi | trigger datato (nuova legge, scadenza, piattaforma) |

## Playbook di ricerca (pain-first)

| Segnale | Query tipo |
|---|---|
| Software costosi o odiati | `"<software> alternative"`, `site:reddit.com "<software>" expensive`, `site:g2.com <categoria>` (sezione cons), `site:capterra.com <categoria> reviews` |
| Richieste esplicite | `site:reddit.com "is there a tool" <nicchia>`, `"looking for someone to" <task>`, `"cerco qualcuno" <task>`, gruppi Facebook di categoria |
| Lavoro manuale pagato | `site:indeed.com` / `site:it.indeed.com` / LinkedIn Jobs `"<task ripetitivo>"` (data entry, back office, addetto prenotazioni, customer care) |
| Servizi già comprati | categorie Fiverr / Upwork / Malt con molte recensioni; `"<servizio>" prezzo pacchetto` |
| Spesa esistente | pagine pricing dei competitor; app marketplace (Shopify, HubSpot, Google Workspace, Make) con numero di recensioni |
| Cambi normativi | `obbligo <settore> <anno>`, `nuova normativa <settore> scadenza`, direttive UE in vigore o in arrivo |
| Trend | Google Trends, Product Hunt, community di nicchia, YouTube (video "how I" con commenti di chi chiede aiuto) |
| Local | Google Maps: numero di attività per categoria nella città, rating, presenza di sito e prenotazione online |

Vietato come fonte primaria: "business ideas 2026", "idee di business redditizie", listicle generici.

## Regole

- Ogni opportunità indica **chi paga**, con un segmento specifico (es. "studi dentistici con 2–5 poltrone in Liguria", non "PMI").
- Ogni opportunità indica la **soluzione pagata che esiste già** (o "nessuna", che è un segnale negativo).
- Non valutare e non scartare per gusto: lo scouting raccoglie, gli stage successivi giudicano. Scarta solo per i filtri d'ingresso e per la memoria.

## Output

```
### MARKET SCOUT — <modalità> — <data>

Perimetro: <categorie, geografia, vincoli>
Ricerche eseguite: <n> (elenco query sintetico)

| ID | Opportunità (1 riga) | Cat. | Chi paga | Soluzione pagata esistente | Archetipo | Segnale chiave | Fonte | Tag |
|---|---|---|---|---|---|---|---|---|

Scartate in scouting: <nome — motivo>
Riaperte dalla memoria: <ID — nuovo dato>
```
