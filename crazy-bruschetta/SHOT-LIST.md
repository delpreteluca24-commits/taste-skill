# Shot list — foto da chiedere a Crazy Bruschetta

Tutte le immagini oggi in `assets/img/` sono **placeholder grigi**: hanno il nome
e le proporzioni definitive, ma vanno buttate. Ogni foto vera sostituisce il file
con lo **stesso identico nome**, e la pagina si aggiorna senza toccare il codice.

## Come mandarle

- **Una sola foto per riga di questo elenco**, alla risoluzione più alta che avete
  (dal telefono va benissimo: gli iPhone e gli Android recenti fanno 3000+ px).
- Formato **JPEG**. Niente HEIC, niente screenshot, niente foto girate storte.
- **Non ritagliare**: al taglio ci pensiamo noi. Serve solo che il soggetto stia
  al centro e ci sia un po' di aria intorno.
- Mandatele su WhatsApp **come documento**, non come foto normale: altrimenti
  WhatsApp le comprime e si perde metà della qualità.

I file `-600`, `-1000`, `-800`, `-1400` che vedete nella cartella li generiamo noi
dall'originale con `python3 scripts/make-sizes.py`. Non servono a voi.

---

## 1. Foto principali (obbligatorie)

| File | Orientamento | Proporzione | Cosa serve |
|---|---|---|---|
| `hero.jpg` | orizzontale | 3:2 | **La foto più importante della pagina.** Sala piena, di sera, luci accese, il neon rosa visibile. Sopra ci va il titolo, quindi lasciate spazio vuoto a sinistra o in basso. Niente flash. |
| `og.jpg` | orizzontale | 1,91:1 | L'anteprima che compare quando si condivide il link su WhatsApp, Facebook, Instagram. Un vassoio di bruschette al metro visto dall'alto è la scelta giusta. |

## 2. Il locale (galleria)

| File | Orientamento | Proporzione | Cosa serve |
|---|---|---|---|
| `interno-1.jpg` | orizzontale | 3:2 | La sala vista d'insieme: pareti blu, tavoli, legno chiaro del bancone. |
| `interno-2.jpg` | **verticale** | 3:4 | Il murale tropicale verde, inquadrato in verticale per prenderlo tutto. |
| `interno-3.jpg` | orizzontale | 3:2 | Il vassoio lungo appena servito al tavolo, con le mani che si allungano. |
| `interno-4.jpg` | **verticale** | 3:4 | Il bancone in legno chiaro con i calici pronti per l'aperitivo. |
| `dehors.jpg` | orizzontale | 3:2 | Il dehors dalla strada: tavolini, sedie in metallo nero, insegna. Meglio all'ora dell'aperitivo. |
| `neon.jpg` | **verticale** | 3:4 | L'insegna al neon rosa "Crazy in Love" sulla parete blu, da vicino, al buio. |

> Le tre verticali servono davvero: la galleria è a colonne sfalsate e se sono
> tutte orizzontali viene fuori una griglia piatta.

## 3. Foto dei piatti

Compaiono **solo quando uno tocca il piatto nel menu**, quindi non è un dramma se
all'inizio ne mancano. Dove manca la foto, il pannello si apre lo stesso senza
immagine.

**Formato per tutte: orizzontale, proporzione 4:3, piatto inquadrato dall'alto
o a 45°, luce naturale, sfondo il tavolo del locale.**

### Priorità alta — fatele per prime (le più ordinate e le più fotogeniche)

| File | Piatto |
|---|---|
| `piatti/pistacchiosa.jpg` | Pistacchiosa |
| `piatti/tellaro.jpg` | Tellaro |
| `piatti/vesuvio.jpg` | Vesuvio |
| `piatti/spezzina.jpg` | Spezzina |
| `piatti/monterosso.jpg` | Monterosso |
| `piatti/norma.jpg` | Norma |
| `piatti/boscaiola.jpg` | Boscaiola |
| `piatti/tagliere-speciale.jpg` | Tagliere speciale x2 |
| `piatti/cremoso-al-pistacchio.jpg` | Cremoso al pistacchio |
| `piatti/hamburger.jpg` | Hamburger con insalata e patatine |

### Il resto, con calma

| File | Piatto |
|---|---|
| `piatti/tagliere-della-casa.jpg` | Tagliere della casa x2 |
| `piatti/semplice.jpg` | Semplice |
| `piatti/cotto-e-fiordilatte.jpg` | Cotto e fiordilatte |
| `piatti/crudo-e-stracchino.jpg` | Crudo e stracchino |
| `piatti/viennese.jpg` | Viennese |
| `piatti/ligure.jpg` | Ligure |
| `piatti/diavola.jpg` | Diavola |
| `piatti/contadina.jpg` | Contadina |
| `piatti/fit.jpg` | Fit |
| `piatti/nerano.jpg` | Nerano |
| `piatti/gorgo-speck.jpg` | Gorgo speck |
| `piatti/delicata.jpg` | Delicata |
| `piatti/tortino-al-cioccolato.jpg` | Tortino al cioccolato |
| `piatti/bruschetta-nutella.jpg` | Bruschetta nutella e granella di nocciole |
| `piatti/gnocchetti-al-pesto.jpg` | Gnocchetti al pesto |
| `piatti/caprese.jpg` | Caprese |
| `piatti/bresaola-rucola-pomodorini-grana.jpg` | Bresaola, rucola, pomodorini e grana |
| `piatti/lasagna-al-ragu.jpg` | Lasagna al ragù bolognese |

---

## Riepilogo

- **2** foto principali
- **6** foto del locale (di cui **3 verticali**)
- **28** foto piatto (10 urgenti, 18 quando capita)

---

## Da chiedere insieme alle foto

Cose che nel sito sono ancora segnaposto e che nessuno può inventare al posto vostro.
Nel codice le trovate tutte cercando `DA CONFERMARE`.

1. **Orari di apertura** — giorno per giorno, incluso il giorno di chiusura. Le fonti
   online si contraddicono, quindi il sito oggi scrive `[ORARI DA CONFERMARE]` e il
   dato non è nemmeno nel codice per Google.
2. **Metodi di pagamento** accettati (contanti, carte, bancomat, buoni pasto, Satispay…).
3. **P.IVA e ragione sociale** per il footer.
4. **Tre recensioni** da mettere in home: copiate e incollate da Google o TheFork,
   con il nome che compare lì. Non le scriviamo noi: sono frasi di persone vere.
5. **Piatti veg e vegan**, e **senza glutine** — quali lo sono davvero, confermati
   dalla cucina. Non li deduciamo dagli ingredienti: sugli allergeni non si tira a
   indovinare. Finché non arriva la lista, il filtro "Veg" del menu mostra un
   messaggio che invita a chiedere in sala.
6. **I 3 piatti più ordinati**, per il badge "Il più ordinato".
7. **Data di aggiornamento dei prezzi** (quella che va in fondo al menu).
8. Il **menu in PDF**, se ne esiste una versione da scaricare.
9. Il **dominio definitivo** del sito.
