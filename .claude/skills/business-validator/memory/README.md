# MEMORY — Learning Loop

Scopo: ogni analisi futura parte dalle evidenze già raccolte, non da zero. La memoria è un registro di **evidenze e decisioni**, non di opinioni.

## Struttura

```
memory/
├── README.md          ← questo file (schema e regole)
├── index.md           ← una riga per idea, letto sempre in Phase 0
└── ideas/
    └── <slug>.md      ← un file per idea
```

## index.md — formato

```
| Slug | Idea (1 frase) | Ultimo verdetto | Confidence | Max evidenza | Ultimo aggiornamento |
|------|----------------|-----------------|------------|--------------|----------------------|
```

## ideas/<slug>.md — formato

```markdown
# <Nome idea>
slug: <slug>
created: YYYY-MM-DD
status: ACTIVE | PARKED | KILLED | BUILDING

## Idea Card (ultima versione)
[Idea Card compatta con tag epistemici]

## Decision Log (append-only)
| Data | Modalità | Verdetto | Confidence | Score | Build Gate | Motivo (1 riga) |

## Fatal Assumption
- Attuale: …
- Storico: [data] … → stato

## Hypotheses
| ID | Ipotesi | Stato (APERTA/CONFERMATA/FALSIFICATA/INCONCLUSIVA) | Evidenza | Data |

## Experiments
| Data | Esperimento | Ipotesi | Campione | Risultato numerico | Soglia GO/NO-GO | Esito |

## Metrics (misurate, non stimate)
| Data | Metrica | Valore | Fonte |

## Competitors & Pricing (verificati)
| Nome | Prezzo | Fonte (URL) | Data verifica | Note |

## Customer Feedback
| Data | Cliente (anonimizzato) | Citazione breve | Livello E0–E5 |

## Pricing Tested
| Data | Prezzo | Offerta | Risultato |

## Transferable Lessons
- [lezione utile per altre idee: canale, segmento, obiezione ricorrente]
```

## Regole

1. **Append-only** per Decision Log, Experiments, Feedback. Non riscrivere la storia; correggi con una nuova riga.
2. **Solo dati misurati** in Metrics. Le stime restano nel report, non in memoria.
3. **Anonimizza** i clienti (es. "Pizzeria, La Spezia, 12 coperti") — niente nomi, telefoni, email.
4. **Competitor con fonte e data**: un prezzo senza data di verifica scade dopo 90 giorni → trattalo come `[ASSUNZIONE]`.
5. **Idee simili**: in Phase 0 cerca in `index.md` per segmento cliente e problema, non solo per nome. Le Transferable Lessons di idee KILLED sono evidenza valida per idee nuove nello stesso segmento.
6. Se l'ambiente non consente scrittura su file, mostra il blocco aggiornato a fine report e chiedi all'utente di salvarlo.
