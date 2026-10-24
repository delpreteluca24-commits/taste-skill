# Avvio in cloud (senza PC acceso)

Stato al 2026-10-24:

| Pezzo | Stato |
|---|---|
| Supabase progetto `sports-media-os` (ref `wifkhmmbfmucwipupecr`, Francoforte, piano Free) | ✅ creato |
| Schema database (tutte le migrazioni) | ✅ applicato |
| Account proprietario `unichornofm@gmail.com` (ruolo owner) | ✅ creato — password iniziale comunicata in chat, cambiala al primo accesso |
| Worker | ✅ non serve più: i job girano dentro l'app (`/api/jobs/drain`) |
| Vercel progetto `sports-media-os` (deploy di produzione, URL `https://sports-media-os-delpreteluca24-commits-projects.vercel.app`, protetto da login Vercel) | ✅ online |
| Variabili Vercel: URL Supabase, publishable key, CRON_SECRET | ✅ impostate |
| Variabili Vercel: `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY` | ✅ impostate |
| AI attiva | ⏳ la chiave Anthropic è di tipo utente (`sk-ant-usr-…`): serve `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`) **oppure** una chiave di workspace `sk-ant-api03-…` → poi **Redeploy**. Il banner in alto nell'app lo segnala finché manca |
| Ricerca automatica | ✅ ogni giorno alle 06:00 UTC (e a ogni apertura dell'app): fonti → trend → fino a 10 opportunità/giorno create da sole |
| Senza AI | ✅ tutto usabile a mano: punteggi euristici, script a mano, hook e titoli scritti da te, miniatura (titolo) scritta da te |

## Passi rimasti (li fai tu, una volta sola)

### 1. Prendi le chiavi Supabase
Supabase → progetto **sports-media-os** → **Project Settings → API Keys**:
- `Publishable key` (inizia con `sb_publishable_`)
- `Secret key` (inizia con `sb_secret_`) — **non condividerla con nessuno, nemmeno in chat**

### 2. Crea il progetto su Vercel
1. vercel.com → **Add New → Project** → importa `delpreteluca24-commits/taste-skill`.
2. **Root Directory:** `sports-media-os` · Framework: Next.js (rilevato da solo).
3. **Environment Variables** (tutte):

| Nome | Valore |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wifkhmmbfmucwipupecr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la publishable key |
| `SUPABASE_SECRET_KEY` | la secret key |
| `ANTHROPIC_API_KEY` | la tua chiave Anthropic (imposta un limite di spesa sulla console) |
| `CRON_SECRET` | una stringa casuale lunga (es. generata da un password manager) |

4. **Deploy.** Il primo deploy usa il branch `main`, che non contiene l'app: se fallisce è normale.
5. **Settings → Git → Production Branch** → `claude/lilla-studio-os-bootstrap-now61j` → poi **Deployments → Redeploy**.

### 3. Chiudi le registrazioni
Supabase → **Authentication → Sign In / Providers** → disattiva **Allow new users to sign up**.
Così l'unico account resta il tuo.

### 4. Usa l'app
Apri l'URL Vercel → login con la tua email → cambia password → **Welcome** (crea progetto) → **Radar → Connectors** (aggiungi 3–5 feed RSS) → **Opportunities**.

I job AI partono da soli quando sei nell'app; ogni mattina alle 06:00 UTC un cron aggiorna le fonti.

## Note
- Privacy: l'app richiede login; per renderla invisibile anche come pagina di login, su Vercel attiva **Settings → Deployment Protection → Vercel Authentication** anche per la produzione (se il piano lo consente).
- La funzione Supabase `bootstrap` è disattivata (risponde 410): puoi eliminarla da **Edge Functions**.
- Limiti piano Free: Supabase mette in pausa il progetto dopo ~7 giorni senza uso; si riattiva dal dashboard.
