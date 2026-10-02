# Financial model — 24 mesi, 3 scenari

Script: `model.py` (eseguire `python3 model.py` per rigenerare le tabelle in `model-output.md`). Business B1 = Compliance OS. B2/B3 sono i piani alternativi del report di mercato e restano come riferimento.

## Variabili e etichette
| Variabile | Conservative | Base | Aggressive | Etichetta / fonte |
|---|---|---|---|---|
| Prospect/mese (outbound) | 200 | 300 | 400 | ASSUMPTION (capacità founder) |
| Reply rate | 3% | 5% | 6% | FACT benchmark Clientium: 1,9% medio, 5–6% verticali su scadenza normativa |
| Reply → demo | 40% | 50% | 60% | ASSUMPTION |
| Demo → paid | 20% | 25% | 33% | ASSUMPTION (B2B SMB tipico 20–30%) |
| Nuovi clienti/mese a regime | ≈5 | ≈6–8 | ≈10–16 | derivato |
| ARPU | €179 | €199 | €249 | ancorato a pricing.md |
| Churn mensile | 4% | 3% | 2% | EST da benchmark SMB SaaS <$15k ACV: 1,5–3% logo churn/mese |
| CAC (costi vivi) | €350 | €300 | €200 | EST: tool outbound + dati / clienti chiusi; esclude tempo founder |
| Gross margin | 92% | 92% | 92% | EST: variabili 8% (Stripe, email/WhatsApp, LLM, storage) |
| Costi fissi | €550/mese | €550 | €550 | EST: tool, hosting, commercialista |
| Collaboratore part-time | da M13 €1.200 | da M13 €1.200 | da M10 €1.800 | ASSUMPTION |
| Founder hours | vedi operations | | | |

## Risultati (dal modello)
| | Conservative | Base | Aggressive |
|---|---|---|---|
| Clienti M12 | 33 | ~48 | ~75 |
| MRR M12 | €5,9k | ~€9,5k | ~€18k |
| €10k MRR raggiunti | M20 | M12–13 | M8 |
| Clienti M24 | 68 | 91 | 168 |
| MRR M24 / ARR | €12,3k / €147k | €18,1k / €217k | €42k / €504k |
| P/L M24 | +€9,0k/mese | +€13,1k/mese | +€34k/mese |
| Break-even clienti (costi vivi) | 3,3 | 3,0 | 2,4 |
| Break-even incl. collaboratore | ~11 | ~10 | ~10 |
| LTV (ARPU×GM/churn) | €4.117 | €6.103 | €11.454 |
| LTV/CAC | 11,8 | 20,3 | 57 |
| CAC payback | 2,1 mesi | 1,6 mesi | 0,9 mesi |

Nota di onestà: LTV/CAC è gonfiato perché il CAC esclude il tempo del founder. Con founder valorizzato €40/h × 20 h/sett in sales nei primi 6 mesi (≈€3.500/mese) il CAC pieno base sale a ~€1.000 e LTV/CAC a ~6. Resta sano. Il vero rischio non è l'economics ma l'acquisizione: se reply rate <3% il modello conservative slitta di 6+ mesi.

## €20k MRR
Base: ~M26 (con churn 3% e 6 nuovi/mese il plateau teorico è 200 clienti ≈ €40k MRR). Aggressive: M15. Conservative: non entro 24 mesi (plateau ≈125 clienti ≈ €22k).
