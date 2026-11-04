# Avvio in locale (uso personale)

Guida passo-passo per far girare Sports Media OS sul tuo computer. Niente deploy, niente dominio: tutto resta su `localhost`.

Tempo stimato la prima volta: 20–30 minuti (gran parte è il download delle immagini Docker).

## 1. Cosa installare (una volta sola)

| Programma | Versione | Dove |
|---|---|---|
| Git | qualsiasi recente | git-scm.com |
| Node.js | **≥ 20.9** (consigliato 22 LTS) | nodejs.org |
| Docker Desktop | recente, **avviato** (icona della balena attiva) | docker.com/products/docker-desktop |

Su Windows: Docker Desktop con backend WSL 2 (è l'opzione predefinita). Usa PowerShell o il terminale di VS Code.

Controllo:
```bash
node -v        # v20.9 o superiore
docker info    # deve rispondere senza errori
```

## 2. Scarica il progetto
```bash
git clone https://github.com/delpreteluca24-commits/taste-skill.git
cd taste-skill
git checkout claude/lilla-studio-os-bootstrap-now61j
cd sports-media-os
npm ci
```

## 3. Avvia il database locale (Supabase in Docker)
```bash
npm run db:start
```
La prima volta scarica le immagini (qualche GB). Alla fine applica da solo tutte le migrazioni.

Poi leggi le chiavi locali:
```bash
npx supabase status -o env
```

## 4. Configura `.env.local`
```bash
cp .env.example .env.local        # Windows PowerShell: copy .env.example .env.local
```
Apri `.env.local` e compila:

| Variabile | Valore |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` dall'output di `supabase status` (di solito `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` (o `ANON_KEY` su CLI vecchie) |
| `SUPABASE_SECRET_KEY` | `SECRET_KEY` (o `SERVICE_ROLE_KEY`) |
| `ANTHROPIC_API_KEY` | la tua chiave da console.anthropic.com — **serve per scoring AI, ricerca, hook, script, fact-check** |

Senza `ANTHROPIC_API_KEY` l'app funziona (radar, punteggio deterministico, rights, kanban) ma i pulsanti AI restano disattivati.
Costi AI: per default usa modelli economici per discovery/scoring e modelli più capaci per ricerca/script/fact-check; i dettagli e il registro dei consumi sono in `docs/AI_COST_CONTROL.md` e in **Settings → AI**. Imposta un limite di spesa sulla console Anthropic prima di iniziare.

`.env.local` non va mai committato (è già in `.gitignore`).

## 5. Crea il tuo account (proprietario)
La registrazione pubblica è disattivata di proposito.
```bash
npm run create-owner -- --email tua@email.it --password 'una-password-lunga' --name "Luca"
```
Lo stesso comando, rilanciato, reimposta la password.

## 6. Avvia (due terminali)
**Terminale 1 — l'app:**
```bash
npm run dev
```
Apri http://localhost:3000 ed entra con l'account del punto 5.

**Terminale 2 — il worker** (esegue i job in coda: fetch delle fonti, scoring AI, trend, ricerca, hook, script, fact-check):
```bash
npm run worker
```
Se il worker non gira, i job restano "in coda" e sembra che l'app non faccia nulla.

## 7. Primo utilizzo (flusso consigliato)
1. **Welcome** → crea il primo progetto (es. "Sport IT").
2. **Settings** → controlla soglie di punteggio, modelli AI, lingua; l'auto-publish è spento e deve restare spento.
3. **Radar → Connectors** → aggiungi 3–5 fonti RSS/Atom o JSON di testate e siti ufficiali che segui. Il worker le scarica e deduplica.
4. **Opportunities** → leggi lo score spiegato, lancia lo scoring AI, approva solo S/A-tier.
5. **Research** (ricerca + fact-check) → **Rights** → finché fatti e diritti non sono verdi, la produzione è bloccata dal database (è voluto).
6. **Hook Studio / Script Studio** → genera, scegli, modifica.
7. **Content (Kanban)** → segui lo stato fino all'export. Video, editor e pubblicazione arrivano dal Milestone 3 in poi: per ora il montaggio si fa a mano (es. con Cutroom in `/cutroom`).

## 8. Spegnere / riavviare
```bash
# Ctrl+C nei due terminali, poi:
npm run db:stop          # i dati restano salvati nel volume Docker
npm run db:start         # la volta dopo è veloce
```
`npm run db:reset` **cancella tutti i dati** e riapplica le migrazioni: usalo solo se vuoi ripartire da zero.

## 9. Problemi comuni
| Sintomo | Causa / soluzione |
|---|---|
| `failed to connect to the docker API` | Docker Desktop non è avviato |
| `429 Too Many Requests` durante `db:start` | limite di download di Docker Hub: fai `docker login` (account gratuito) e riprova |
| Porte 54321/54322/3000 occupate | chiudi l'altra istanza o `npx supabase stop --all` |
| Login rifiutato | rilancia `create-owner` con la stessa email per reimpostare la password |
| Pulsanti AI grigi | manca `ANTHROPIC_API_KEY` in `.env.local` → riavvia `npm run dev` e `npm run worker` |
| Job fermi "in coda" | il worker (terminale 2) non è avviato |

## 10. Verifica che tutto funzioni (facoltativo)
```bash
npm run check        # lint + typecheck + test unitari
npm run test:db      # test su database (RLS, blocchi diritti/fatti, coda job) — richiede db:start
```

Stato verificato il 2026-10-16 in ambiente cloud: `npm ci`, `npm run check` (627 test unitari OK) e `npm run build` OK. `test:db` ed E2E non eseguibili lì (download immagini Docker bloccato dal rate limit): da lanciare sul tuo PC.
