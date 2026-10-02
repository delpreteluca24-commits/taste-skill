# Security checklist pre-lancio (V1)

- [ ] **Auth:** Supabase Auth, magic link + password, MFA opzionale per admin; sessioni server-side (cookies httpOnly).
- [ ] **Authorization:** RLS su ogni tabella con `organization_id`; test automatici che un utente di org A non legga org B (vitest + client con JWT di due utenti).
- [ ] **Portale subappaltatore:** token ≥32 byte random, salvato hashato, scadenza 30 gg, single-purpose; rate limit per token; nessun elenco di altri subappaltatori visibile.
- [ ] **Storage:** bucket privato; nessun URL pubblico; signed URL ≤10 min; upload via signed upload URL con limiti tipo (pdf/jpg/png) e dimensione (≤15 MB); nome file normalizzato; scansione malware (V2).
- [ ] **Rate limiting:** middleware su login, portale, API (Upstash o Vercel WAF).
- [ ] **Secrets:** solo env su Vercel/Supabase; service role mai nel client; rotazione documentata.
- [ ] **Webhook Stripe:** verifica firma, idempotenza su event id, log.
- [ ] **Email:** SPF/DKIM/DMARC sul dominio; link con token monouso; nessun dato sensibile nel corpo.
- [ ] **Logging:** audit_log append-only (trigger che vieta update/delete); log applicativi senza PII in chiaro.
- [ ] **Backup:** PITR Supabase (Pro); test di restore trimestrale documentato.
- [ ] **Data deletion:** procedura tenant delete (DB + Storage) con conferma a due passi; export prima della cancellazione.
- [ ] **Dipendenze:** `npm audit` in CI; Dependabot.
- [ ] **Headers:** CSP, HSTS, X-Frame-Options via next.config.
- [ ] **Pen test leggero** prima del primo cliente con dati reali: OWASP ZAP baseline + review RLS manuale.
- [ ] **Incident response:** contatto, procedura 72 h, template comunicazione.
