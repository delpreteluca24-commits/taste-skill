# Go-to-market playbook — come arrivare ai clienti

Aggiornato 2026-10-02. Owner ha approvato il piano (DECISIONS D-008).

## 0. Correzione all'idea "tante email e aspetto"
L'email di massa da sola non funziona in questa nicchia, per tre motivi:
1. **Deliverability.** Un dominio nuovo che invia centinaia di email al giorno finisce in spam in pochi giorni e si brucia. Limite sano: 30–50 email/giorno per casella, dopo 2 settimane di warm-up.
2. **Privacy.** In Italia l'email commerciale non richiesta è un'area a rischio (art. 130 Codice Privacy, prassi del Garante). Più è "di massa", più è rischiosa. Più è personalizzata, a indirizzi aziendali di ruolo, con opt-out, meno lo è. Farlo confermare a un consulente privacy prima dello scale.
3. **Il cliente.** Il titolare di un'impresa edile legge poco l'email e risponde al telefono. Le email servono a preparare la telefonata, non a sostituirla.

Regola: **email + telefono + partner**, a volumi bassi e mirati, misurando tutto.

## 1. Fase A — Prime conversazioni (settimane 1–2)
Obiettivo: 10 interviste (Gate 1), 5 aziende che vogliono vedere il prodotto (Gate 2).
- **Rete calda (giorni 1–3):** elenca 30 persone che conosci nell'edilizia: geometri, ingegneri, commercialisti di imprese edili, fornitori di materiali, amici con un'impresa. Chiedi 15 minuti "per capire come gestiscono i subappaltatori" e una presentazione a 2 imprese ciascuno. Non vendere niente.
- **Consulenti sicurezza e CSE (giorni 2–5):** sono il canale più efficiente. Un consulente segue 20–80 imprese e ha lo stesso problema moltiplicato. Chiama 20 studi di sicurezza della tua provincia. Offri l'uso gratuito per i loro clienti pilota in cambio di presentazioni.
- **Telefonate a freddo (giorni 3–10):** 20 chiamate al giorno a imprese dalla lista. Script in outbound-copy.md. Obiettivo: parlare con chi si occupa dei documenti.

## 2. Fase B — Email mirate (setup settimana 1, invio da settimana 3)
- **Infrastruttura:** dominio secondario (es. dossiercantiere-mail.it), 2 caselle Google Workspace, SPF/DKIM/DMARC, warm-up 14 giorni. Costo ~€15–20/mese per casella + dominio.
- **Lista:** 300 imprese per ondata da aggiudicazioni di appalti pubblici (portali regionali, ANAC), elenchi delle associazioni, siti aziendali. Solo indirizzi aziendali di ruolo (info@, ufficiotecnico@, amministrazione@). Mai PEC.
- **Messaggio:** 1 frase personalizzata per azienda (es. il cantiere che hanno vinto), ≤90 parole, un CTA, opt-out.
- **Volume:** 30–40/giorno per casella → ~300 a settimana con 2 caselle.
- **Sequenza:** email giorno 0 → telefonata giorno 2 a chi ha aperto o al numero del sito → follow-up email giorno 4 → ultimo giorno 8.
- **Test:** variante A (sanzione €12.000) contro variante B (tempo/CSE), 150 contatti ciascuna.

## 3. Fase C — Demo e prevendita (settimane 3–5)
- Demo 20 minuti con lo script. Usa i numeri del cliente.
- Chiudi con il pilot: €149/mese founder price, 30 giorni, pagamento anticipato con link Stripe. **Il pagamento è il test, non il "mi interessa".**
- Chi dice "interessante, risentiamoci" senza pagare conta come no.

## 4. Fase D — Consegna concierge (settimane 4–8)
Gestisci i primi 3–5 clienti a mano (concierge-mvp.md). Misura: % subappaltatori che caricano entro 7 giorni, ore tue per cliente, rinnovo al giorno 30. Raccogli una testimonianza e due presentazioni da ogni cliente soddisfatto.

## 5. Fase E — Software e canali ripetibili (mesi 3–12)
Solo dopo ≥2 paganti: costruisci V1. Poi tre canali in parallelo:
1. **Outbound** a 600 contatti/mese (email + telefono).
2. **Partner consulenti/CSE:** 20% di commissione ricorrente o account gratuito multi-cliente. Obiettivo: 10 consulenti attivi.
3. **Rete dei subappaltatori:** ogni subappaltatore che carica documenti è spesso anche impresa affidataria. Banner nella pagina di upload.
Più, da mese 6: webinar con associazioni territoriali (ANCE, CNA Costruzioni, Confartigianato Edilizia) e contenuti SEO sulle scadenze normative.

## 6. Matematica del funnel (ASSUMPTION da verificare)
| Passaggio | Tasso | Su 300 contatti |
|---|---|---|
| Risposta o conversazione (email+telefono) | 7% | 21 |
| Demo | 40% | 8 |
| Pagamento | 25% | 2 |

Per 50 clienti (€10k MRR) servono ~7.500 contatti con il solo outbound, cioè ~600/mese per 12 mesi. È fattibile ma pesante: per questo i partner contano. 10 consulenti che portano 3 clienti ciascuno valgono 30 clienti.

## 7. Cosa misurare ogni venerdì
Contattati · risposte · conversazioni · demo · pilot pagati · upload rate dei subappaltatori · ore founder. Aggiornare METRICS.md.

## 8. Stop
Dopo 300 contatti qualificati: <10 conversazioni, <5 demo o zero pagamenti → fermarsi e rivedere ICP, messaggio, prezzo, canale (kill criteria in validation-plan-14-days.md).
