# Privacy / GDPR — checklist da far validare a un professionista

**Questo documento non dichiara conformità.** Va validato da un consulente privacy/avvocato prima di trattare dati reali. Nessun dato personale reale viene trattato finché l'owner non approva (vedi FASE 28 del mandato).

## Dati trattati (previsti)
| Categoria | Esempi | Interessati | Base giuridica (ipotesi) | Sensibilità |
|---|---|---|---|---|
| Dati aziendali | ragione sociale, P.IVA, CCIAA, DURC, patente, SOA | imprese (non personali, salvo ditte individuali) | contratto | bassa |
| Dati di contatto | nome, email, telefono referenti | referenti impresa cliente e subappaltatori | legittimo interesse / contratto | media |
| Dati lavoratori | nominativi in POS/tesserini, attestati formazione, **giudizi di idoneità sanitaria** | lavoratori dei subappaltatori | obbligo legale del datore/affidataria (art. 90/97/Allegato XVII) — **da confermare** | **alta**: l'idoneità è dato relativo alla salute (art. 9 GDPR) anche se solo "idoneo/non idoneo" — valutare di trattare solo data e esito senza diagnosi |
| Log | IP, azioni, timestamp | utenti | legittimo interesse | bassa |

## Ruoli (ipotesi)
- Impresa cliente = **Titolare** dei dati dei propri subappaltatori/lavoratori raccolti per obblighi di legge.
- Noi = **Responsabile del trattamento** (art. 28) → serve **DPA** allegato ai termini.
- Subappaltatore che carica = fornisce dati come titolare dei propri lavoratori; va informato (informativa nella pagina di upload).
- Sub-responsabili: Supabase (hosting DB/Storage, regione EU), Vercel (hosting app), Stripe (pagamenti), Resend (email), provider WhatsApp (Meta/Twilio), provider LLM per estrazione (valutare: zero-retention, EU; in alternativa OCR locale).

## Checklist
- [ ] Registro trattamenti (art. 30).
- [ ] Informativa clienti, informativa subappaltatori (pagina upload), informativa lavoratori (via subappaltatore).
- [ ] DPA standard + elenco sub-responsabili + notifica modifiche.
- [ ] Data residency EU (Supabase eu-central o eu-west; Vercel region EU).
- [ ] Minimizzazione: giudizio idoneità solo esito+data; nessun certificato medico; attestati formazione con dati minimi.
- [ ] Retention: documenti conservati per durata contratto + X anni (responsabilità solidale 2 anni, art. 29 D.Lgs 276/2003; sanzioni amministrative 5 anni) → proposta default 5 anni, configurabile; cancellazione a fine contratto su richiesta entro 30 gg.
- [ ] Diritto di accesso/export: export completo per tenant (ZIP + CSV).
- [ ] Cancellazione: soft delete 30 gg, poi hard delete inclusi file in Storage e backup rotation.
- [ ] Access logs e audit trail accessibili al titolare.
- [ ] Cifratura at rest (Supabase default) e in transito; signed URL a scadenza breve (≤15 min) per i file.
- [ ] Valutazione d'impatto (DPIA): probabilmente necessaria per dati salute su larga scala → chiedere al consulente.
- [ ] DPO: non obbligatorio per PMI salvo trattamento su larga scala di dati particolari → chiedere.
- [ ] Termini di servizio con esclusione di consulenza legale e limitazione di responsabilità.
- [ ] Procedura data breach (72 h).
- [ ] Marketing/outbound: base giuridica legittimo interesse B2B su contatti aziendali; opt-out in ogni email; nessun invio a PEC per marketing; rispetto art. 130 Codice Privacy e linee guida Garante (B2B email a indirizzi aziendali generici o di ruolo, con opt-out) — **da confermare con il consulente prima della campagna**.

## Costi stimati (EST, da approvare)
Consulenza privacy iniziale €500–1.500 una tantum; template DPA/ToS €300–800. Alternativa fase 0: template gratuiti + revisione professionale prima del primo cliente con dati reali.
