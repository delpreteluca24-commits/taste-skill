# Design system — Crazy Bruschetta

Pagina viva del sistema visivo del sito: palette, matrice di contrasto,
scala tipografica, componenti, movimento.

## Come si apre

Serve un server locale — `fetch` su `file://` è bloccato dai browser, e questa
pagina legge il CSS dal sito.

```bash
cd crazy-bruschetta
python3 -m http.server 8000
# poi apri http://localhost:8000/design-system/
```

Se la apri con doppio clic la pagina te lo dice, con il comando da lanciare.
Online funziona senza fare niente: è la stessa origine del sito.

## Non è documentazione. È il CSS del sito.

La differenza è tutta qui: **questa pagina non contiene una copia dei token.**
All'apertura fa `fetch('../index.html')`, estrae il blocco `<style>` e se lo
inietta. Quello che vedi è, letteralmente, il CSS che gira in produzione.

Conseguenza pratica: **non può divergere.** Un design system scritto a mano
racconta com'era il sito il giorno in cui qualcuno lo ha aggiornato l'ultima
volta. Questo racconta com'è adesso, o non si apre.

Il corollario è che `index.html` resta un file solo, come da specifica: nessuna
estrazione, nessun file condiviso da tenere in sincrono.

## La matrice di contrasto si calcola da sola

I rapporti WCAG 2.1 non sono scritti nel markup: vengono calcolati al
caricamento, sui valori veri dei token letti da `getComputedStyle`, componendo
le trasparenze sul fondo prima del confronto. Ogni colore è testato contro
quattro fondi reali: `--blu-notte`, `--blu-locale`, il footer `#081E29` e il
rosa dei bottoni.

Se qualcuno cambia un token e rompe un accostamento, la riga diventa
**No** o **Solo grande** senza che nessuno debba ricordarsi di aggiornare
niente.

Non è teoria: aggiungendo la matrice sono saltati fuori quattro problemi reali
già in pagina, che il test automatico precedente non aveva visto perché
guardava una lista fissa di selettori invece di ogni nodo di testo.

| Cosa | Rapporto | Fix |
|---|---|---|
| Nota nel pannello piatto in `--testo-mute` su card | 4,33:1 | → `--testo-soft`, 6,11:1 |
| Stelle a 13px in `--rosa-neon` su card | 3,88:1 | → nuovo `--rosa-testo`, 5,51:1 |
| Segnaposto `[DA CONFERMARE]` in `--legno` su card | 3,94:1 | → `--legno-testo`, 5,55:1 |
| Link "Salta al menu" su fondo rosa | 2,64:1 | `.page a:not(.btn):not(.skip)` |

L'ultimo è lo stesso errore di specificità già corretto sui bottoni: una regola
generica sui link che vince su una specifica e ci riporta il colore chiaro
sopra un fondo rosa. È il tipo di bug che nessuno vede a occhio, perché il
testo *sembra* leggibile.

## Le tre coppie di token

Il sistema ha una regola strutturale che vale la pena conoscere prima di
toccare un colore:

```
--legno        #C08A55   →  --legno-testo   #D8A97A
--verde-mural  #2E7D5B   →  --verde-testo   #7FC8A3
--rosa-neon    #FF4FA3   →  --rosa-testo    #FF8CC4
```

A sinistra i colori dell'identità: filetti, bordi, leader dots, fondi dei
bottoni, prezzi (che sono sempre ≥ 20px/800, quindi "testo grande" per WCAG).
A destra le varianti per il testo piccolo, dove gli originali su `--blu-locale`
si fermano rispettivamente a 3,94:1, 2,36:1 e 3,88:1.

Non sono colori nuovi: sono lo stesso colore schiarito quel tanto che basta.
La pagina resta legno, verde e rosa.

## Cosa c'è dentro

1. **Palette** — 9 swatch con hex e ruolo
2. **Matrice di contrasto** — 38 accostamenti calcolati dal vivo
3. **Regole d'uso** — le cinque che non si negoziano
4. **Tipografia** — i due font e la scala, con i `clamp()` risolti alla
   larghezza attuale della finestra (ridimensiona e guardali muoversi)
5. **Neon** — l'effetto isolato, con il flicker rigiocabile
6. **Componenti** — bottoni, chip, badge, card, citazione, servizi, con il
   markup di produzione
7. **Riga menu** — il componente più usato del sito, 28 istanze
8. **Spazi, raggi, misure** — i token risolti
9. **Movimento** — durate, easing, e la regola che il contenuto non dipende
   dal JavaScript

## Se aggiungi un token

1. Aggiungilo in `:root` dentro `../index.html`.
2. Aggiungilo agli array `PALETTE` e `FOREGROUNDS` in fondo a questo
   `index.html` — sono due righe.
3. Ricarica: swatch e matrice si costruiscono da soli.
