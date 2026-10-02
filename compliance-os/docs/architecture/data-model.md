# Data model (V1) — bozza

```
organizations(id, name, vat_number, plan, stripe_customer_id, created_at)
organization_members(organization_id, user_id, role[admin|operator|viewer], created_at)
sites(id, organization_id, name, address, client_name, start_date, end_date, status[active|closed], cse_name, created_at)
subcontractors(id, organization_id, name, vat_number, type[company|freelancer], contact_name, email, phone, soa_class, notes, created_at)
site_subcontractors(site_id, subcontractor_id, entered_at, exited_at)
requirement_types(id, organization_id NULL=global, code, label, source_ref, scope[subcontractor|site|worker], validity_rule jsonb, required_default bool)
   -- es. DURC: {"kind":"fixed_days","days":120} ; CCIAA: {"kind":"fixed_days","days":180} ; PATENTE: {"kind":"recheck_days","days":90} ; FORMAZIONE: {"kind":"years","years":5} ; POS: {"kind":"per_site"} ; IDONEITA: {"kind":"explicit_date"}
site_requirements(site_id, requirement_type_id, required bool)   -- checklist per cantiere
workers(id, subcontractor_id, full_name, role, created_at)        -- opzionale V1.5
documents(id, organization_id, subcontractor_id, site_id NULL, worker_id NULL, requirement_type_id, storage_path, issued_at, expires_at, status[missing|pending_review|ok|expiring|expired], verified_by, verified_at, uploaded_via[portal|staff], created_at)
invites(id, organization_id, subcontractor_id, site_id NULL, token_hash, expires_at, used_at, created_at)
notifications(id, organization_id, subcontractor_id, document_id NULL, channel[email|whatsapp], template, sent_at, status)
audit_log(id, organization_id, actor_type[user|subcontractor|system], actor_id, action, entity, entity_id, payload jsonb, created_at)   -- append-only
subscriptions(organization_id, stripe_subscription_id, status, plan, current_period_end)
events(id, organization_id, user_id, name, props jsonb, created_at)   -- analytics
```

Stato aggregato subappaltatore per cantiere = peggiore tra i documenti richiesti dalla checklist di quel cantiere (missing/expired → rosso; expiring/pending_review → arancione; tutti ok → verde). Calcolato da view materializzata o funzione SQL, ricalcolato dal job giornaliero e on-write.

Indici: (organization_id, status) su documents; (organization_id, expires_at); token_hash unique su invites.
