# Architettura (da costruire SOLO dopo Gate 3)

## Stack
Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron) · Stripe (Checkout + Customer Portal + webhook) · Resend (email transazionali) · WhatsApp Business API via Twilio o Meta (V2) · Vercel (hosting EU region) · LLM solo per: estrazione data scadenza/tipo da PDF (V2), con fallback manuale; nessuna AI in UI di marketing.

## Struttura cartelle (proposta)
```
apps/web/
  app/(marketing)/            landing, pricing, legal
  app/(auth)/                 login, signup, magic link
  app/(app)/dashboard, sites, subcontractors, documents, deadlines, activity, settings
  app/portal/[token]/         upload subappaltatore senza account
  app/api/webhooks/stripe, resend
  components/ui (shadcn), components/domain
  lib/supabase (server/client), lib/stripe, lib/email, lib/rules (scadenze)
supabase/
  migrations/  seed/  functions/ (reminders, expiry-recompute, dossier-pdf)
docs/  (questa cartella)
tests/ (vitest unit, playwright e2e)
```

## Multi-tenancy
Ogni tabella di dominio ha `organization_id`. `organization_members(user_id, organization_id, role)`. RLS: policy `organization_id in (select organization_id from organization_members where user_id = auth.uid())` per select/insert/update/delete; ruoli admin/operator/viewer via `role`. Il portale subappaltatore usa un token opaco (tabella `invites`, hash del token, scadenza) servito da una route server con service role, mai RLS bypass dal client.

## Storage
Bucket privato `documents/{organization_id}/{subcontractor_id}/{document_id}.pdf`. Policy: lettura solo membri org; upload dal portale via signed upload URL generata server-side dopo validazione token; download via signed URL 10 min. Antivirus: scansione V2 (ClamAV Edge o servizio).

## Job
- `expiry-recompute` (giornaliero 05:00): aggiorna stato documenti (OK/IN SCADENZA/SCADUTO) e stato aggregato.
- `reminders` (giornaliero 07:00): invia T−30/T−7/T0/+7 ai subappaltatori; riepilogo lunedì alle imprese; log in `notifications`.
- `stripe-webhook`: subscription created/updated/deleted → `subscriptions`.
- `dossier-pdf`: on-demand, genera PDF (react-pdf o Puppeteer serverless), salva in Storage, signed URL.

## Analytics
PostHog EU (free tier) o eventi in tabella `events` → dashboard Supabase/Metabase. Eventi da METRICS.md.

## Ambienti
local (supabase start) · staging (Supabase branch) · prod. Migrazioni versionate; seed demo "Edilizia Rossi".

## Costi (EST, <100 clienti)
Supabase Pro €25 · Vercel Pro €20 · Resend €20 · Stripe 1,5%+€0,25 · LLM €20–80 · WhatsApp €0,04–0,08/msg · dominio/email €10 → €100–180/mese.
