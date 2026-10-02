# DECISIONS.md — registro decisioni

Formato: data · problema · opzioni · decisione · motivazione · conseguenza.

## D-001 · 2026-10-01 · Scelta dell'opportunità
- **Problema:** quale business B2B italiano validare.
- **Opzioni:** 27 categorie analizzate (docs/research/00-market-report-2026-10-01.md).
- **Decisione:** compliance documentale subappaltatori per imprese edili (score 74/100).
- **Motivazione:** pressione normativa reale 2026 (DL 159/2025), mercato frammentato, WTP dimostrata, concorrenti non self-service, canale outbound misurabile.
- **Conseguenza:** piano B = raccolta documenti per commercialisti; piano C = post-vendita fotovoltaico.

## D-002 · 2026-10-02 · Dove vive il progetto
- **Problema:** il repo `taste-skill` è un fork di un progetto OSS di skill frontend; non è la casa del business.
- **Opzioni:** (a) docs nel repo attuale su branch dedicato; (b) nuovo repo GitHub; (c) solo scratchpad.
- **Decisione:** (a) temporaneamente, branch `compliance-os`, cartella `compliance-os/`; richiesta all'owner di creare repo dedicato `compliance-os` (azione che richiede approvazione).
- **Conseguenza:** al via libera, `git subtree split` della cartella nel nuovo repo; nessun codice applicativo nel repo taste-skill.

## D-003 · 2026-10-02 · Nessun codice prima di Gate 3
- **Problema:** tentazione di costruire il SaaS subito.
- **Decisione:** V0 concierge con strumenti no-code; codice solo dopo ≥2 paganti.
- **Motivazione:** principio REVENUE > FEATURES; costo di 3 mesi di sviluppo senza evidenze.
- **Conseguenza:** la landing è un'eccezione (materiale di validazione, HTML statico).

## D-004 · 2026-10-02 · Posizionamento
- **Decisione:** "Compliance OS per cantieri", mai "sostituto del consulente"; il consulente sicurezza è canale, non concorrente.
- **Conseguenza:** copy senza claim legali; ogni requisito mostra la fonte; disclaimer in landing e prodotto.

## D-005 · 2026-10-02 · Verifiche su portali pubblici
- **Problema:** Durc On Line e portale patente richiedono SPID/CNS/CIE o delega.
- **Decisione:** V1 non interroga portali; il subappaltatore carica il PDF, il sistema estrae/registra date. Valutare in V3 delega esplicita per consulenti.
- **Conseguenza:** nessun rischio di accesso improprio; onboarding più semplice.

## D-006 · 2026-10-02 · Prezzo di test
- **Decisione:** pre-sale a €149–199/mese + setup €299 opzionale; founder price 12 mesi.
- **Motivazione:** sotto i prezzi "a preventivo" degli incumbent, sopra la soglia €100 dei vincoli business.
- **Conseguenza:** da rivedere dopo 10 interviste e 3 pilot.

## D-007 · 2026-10-02 · Stack (se validato)
- **Decisione:** Next.js + TypeScript + Tailwind + shadcn/ui; Supabase (Postgres, Auth, Storage, RLS); Stripe; Resend; cron Supabase/Vercel; LLM solo per estrazione date/classificazione documenti.
- **Motivazione:** stack richiesto dall'owner; costo quasi nullo sotto 100 clienti; RLS nativa per multi-tenant.

## D-008 · 2026-10-02 · Approvazione owner e canale di acquisizione
- **Problema:** l'owner ha approvato tutte le azioni in sospeso e propone di contattare i clienti solo via email di massa.
- **Opzioni:** (a) email di massa e attesa; (b) email mirate a basso volume + telefono + partner consulenti/CSE.
- **Decisione:** (b). Email 30–40/giorno per casella su dominio secondario con warm-up; telefono come canale principale; consulenti sicurezza come canale di leva.
- **Motivazione:** deliverability di un dominio nuovo, rischio art. 130 Codice Privacy sulle email non richieste di massa, titolari edili raggiungibili soprattutto al telefono.
- **Conseguenza:** playbook in docs/sales/go-to-market-playbook.md. Le azioni su account dell'owner (dominio, caselle, Stripe, invii) le esegue l'owner: la sessione non ha accesso a quei servizi.
