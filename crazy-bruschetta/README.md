# Crazy Bruschetta — landing page + menu digitale

Sito one-page per **Crazy Bruschetta®**, bruschetteria e aperitivo gourmet in
Via Alessandro Manzoni 39/41, La Spezia.

Un solo file, nessun build step, nessun framework da installare. Apri
`index.html` in un browser e funziona.

```
crazy-bruschetta/
├── index.html            ← tutto: markup, CSS, dati del menu, JS
├── netlify.toml          ← configurazione di deploy
├── SHOT-LIST.md          ← le foto da chiedere al ristorante
├── design-system/        ← palette, contrasto, tipografia, componenti
├── link/                 ← pagina link-in-bio, 25 KB, zero JavaScript
├── assets/img/           ← immagini (oggi placeholder grigi)
│   ├── hero.jpg  hero-800.jpg  hero-1400.jpg
│   ├── interno-1..4.jpg  dehors.jpg  neon.jpg  (+ derivati -600 / -1000)
│   ├── og.jpg
│   └── piatti/<slug>.jpg   (28 piatti)
└── scripts/
    ├── make-placeholders.py  ← rigenera i placeholder grigi
    └── make-sizes.py         ← dai derivati per il srcset da una foto sola
```

---

## Online adesso

| | |
|---|---|
| Sito | https://crazy-bruschetta.vercel.app |
| Pagina link | https://crazy-bruschetta.vercel.app/link/ |
| Design system | https://crazy-bruschetta.vercel.app/design-system/ |

Anteprima su Vercel. Il progetto non è collegato a git: un build script scarica
il tarball pubblico del repo al commit indicato in `build.js` e lo estrae in
`public/`. Quindi **non si aggiorna da solo** quando pushi — per aggiornarlo
cambia `REF` in `build.js` (o passa `SITE_REF` fra le env var del progetto) e
rifai il deploy.

Per la produzione vera resta Netlify collegato al repo, che si aggiorna a ogni
push: vedi sotto.

---

## Deploy su Netlify

1. Collega questo repository al sito Netlify.
2. **Site settings → Build & deploy → Base directory**: `crazy-bruschetta`
3. Publish directory e build command li legge da `netlify.toml`. Non serve altro.

Funziona identico su GitHub Pages, Cloudflare Pages o qualsiasi hosting statico:
è HTML, CSS e immagini.

---

## Manutenzione — le cose che si toccano davvero

Tutti i punti da completare sono marcati nel codice. Per trovarli:

```bash
grep -n "DA CONFERMARE" index.html
```

### Cambiare un prezzo o una descrizione

I piatti stanno in **due posti**, di proposito:

- l'array `MENU` in fondo a `index.html` — è la **fonte dei dati**;
- le righe `<li class="dish-li">` nel corpo della pagina — è la versione statica,
  quella che resta leggibile anche se il JavaScript non parte.

Modifica il prezzo **nell'array**. Al caricamento la pagina riallinea da sola le
righe HTML e scrive in console quali sono rimaste indietro, così puoi sistemarle
con calma senza che il sito mostri mai un prezzo sbagliato.

### Marcare i 3 piatti più ordinati

In fondo a `index.html`:

```js
const BESTSELLERS = ["pistacchiosa", "tellaro", "viennese"];
```

Sono gli `s` (slug) dei piatti. Il badge "Il più ordinato" compare da solo.

### Accendere i badge veg / vegan / piccante / senza glutine

Il sistema è già pronto ma **nessun piatto ha badge**. Vanno confermati dalla
cucina, uno per uno — dagli ingredienti scritti non si deducono né gli allergeni
né le contaminazioni.

```js
{n:"Contadina", p:6, d:"Verdure miste saltate in padella, mandorle", s:"contadina", diet:["veg"]},
```

Chiavi disponibili: `veg`, `vegan`, `piccante`, `senzaglutine`.

Finché sono tutti vuoti, il filtro **Veg** del menu non nasconde il problema:
mostra un messaggio che dice di chiedere in sala, con un bottone WhatsApp.
Nel momento in cui compili anche un solo `diet`, il filtro comincia a funzionare
da solo.

### Orari

`[ORARI DA CONFERMARE]` nella sezione Info. Quando arrivano quelli veri, mettili
lì **e** aggiungi `openingHoursSpecification` al blocco JSON-LD in fondo al file
(c'è il commento che spiega dove). Oggi è volutamente assente: Google mostrerebbe
un orario inventato.

### Recensioni

I tre riquadri contengono `[ESTRATTO — INCOLLA DA GOOGLE]`. Vanno sostituiti con
recensioni **vere**, copiate da Google o TheFork, con il nome che compare lì.
I voti aggregati (4,7 su 406 e 9,5 su 272) sono reali e già in pagina.

### Sostituire le foto

Vedi `SHOT-LIST.md`. In breve: ogni foto vera prende il posto del placeholder con
lo stesso nome. Poi, per rigenerare i tagli piccoli del `srcset`:

```bash
pip install Pillow
python3 scripts/make-sizes.py            # tutte
python3 scripts/make-sizes.py hero.jpg   # solo una
```

### Dominio

Cerca `crazybruschetta.netlify.app` in `index.html` (canonical, Open Graph,
JSON-LD) e sostituiscilo con il dominio definitivo.

---

## Scelte tecniche, e perché

**Il contenuto è visibile senza JavaScript.** Nessun elemento parte da
`opacity: 0` nel CSS: le posizioni iniziali delle animazioni le imposta GSAP a
runtime. Se cade un CDN, se il JS va in errore, se qualcuno naviga con gli script
disattivati — le 28 voci del menu, i prezzi, gli orari e i contatti restano lì.
Verificato con il browser in modalità senza JS: 28 piatti e 28 prezzi visibili.

**Il design system è in un `<style>` inline, non in Tailwind.** La CDN di
Tailwind compila a runtime in JavaScript: se non carica, una pagina fatta solo di
utility resta HTML nudo. Palette, scala tipografica, righe del menu, neon e card
stanno nel CSS inline; Tailwind fa solo griglie e spaziature. Tutte le regole
usano selettori di classe, così il preflight di Tailwind — che arriva dopo, via
JS — non le sovrascrive.

**Il fondo dominante è `--blu-notte`, non `--blu-locale`.** Il rosa neon su
`#0B2634` sta a 5,14:1 (passa AA per qualsiasi testo); su `#123B54` scende a
3,88:1 e passa solo per il testo grande. Per questo `--blu-locale` è la superficie
sollevata — card, pannelli, nav — e i prezzi in rosa non scendono mai sotto
20px/800, che è la soglia "large text" di WCAG.

**Sui bottoni rosa il testo è blu notte.** Crema su rosa fa 2,64:1. È l'errore
facile da fare qui, e c'è una regola CSS con `:not(.btn)` scritta apposta per
impedire che i link ereditino il colore chiaro sui bottoni.

**Le tre coppie di token.** `--legno` / `--legno-testo`, `--verde-mural` /
`--verde-testo`, `--rosa-neon` / `--rosa-testo`. A sinistra i colori
dell'identità: filetti, bordi, leader dots, fondi dei bottoni, prezzi. A destra
le varianti per il testo piccolo, dove su `--blu-locale` gli originali si
fermano a 3,94:1, 2,36:1 e 3,88:1. Stessi colori, schiariti quel tanto che basta.

**Niente iframe di Google Maps.** Sarebbe un tracker di terze parti caricato in
home su ogni visita. Al suo posto c'è una card che apre Maps in una scheda nuova.

**Nessun tracker, nessun popup, nessun carosello automatico.** Le uniche risorse
esterne sono i font, Tailwind e GSAP.

---

## Design system

`design-system/` è una pagina viva del sistema visivo: palette, matrice di
contrasto, scala tipografica, componenti, movimento.

Non contiene una copia dei token: legge il blocco `<style>` da `../index.html`
a runtime, quindi mostra sempre il CSS che gira davvero, e i rapporti di
contrasto sono ricalcolati al caricamento invece di essere una tabella che
invecchia. Se cambi un colore e rompi un accostamento, lì diventa rosso da solo.

Serve un server locale per aprirla (`fetch` su `file://` è bloccato):

```bash
python3 -m http.server 8000     # dalla cartella crazy-bruschetta/
# http://localhost:8000/design-system/
```

## La pagina link

`link/` è la pagina da mettere nella bio di Instagram e TikTok, e dietro a un QR
sui tavoli: tutti i contatti dell'attività in un posto solo.

Ha regole diverse dal sito, perché ha un lavoro diverso — si apre da un telefono,
in mezzo alla strada, con la connessione che c'è:

- **Zero JavaScript.** Sono link, non serve.
- **Nessun CDN di framework.** Il CSS sta nel file, sono ~6 KB.
- **Un solo font, e solo per il logotipo.** Archivo servito con `&text=`, cioè
  con dentro le sole lettere di "CrazyBruschetta": **4,1 KB invece di 34,7**.
  Tutto il resto usa i font di sistema, che sono già sul telefono di chi apre il
  link e costano zero.

**24,9 KB in tutto, 4 richieste, 131 nodi DOM.** Contrasto AA su ogni nodo di
testo, a 390px e a 1440px. Palette e regole identiche al sito.

`noindex, follow`: non deve competere col sito vero nei risultati di ricerca.

## Verificato

Testato con Chromium headless a 375px e 1440px:

- contrasto calcolato sui pixel renderizzati di ogni elemento di testo della
  pagina, confrontato con la soglia WCAG corretta per dimensione e peso →
  **nessuna violazione AA**, desktop e mobile;
- senza JavaScript → 28 piatti e 28 prezzi visibili, `h1` visibile, chip filtro e
  barra sticky correttamente nascosti;
- con tutti e tre i CDN irraggiungibili → pagina completa e navigabile;
- `prefers-reduced-motion: reduce` → zero elementi nascosti, contatori al valore
  finale, neon fermo a opacità piena;
- filtri: Tutto 28 · Terra 7 · Mare 4 · Veg 0 (stato vuoto) · Dolci 3 ·
  Sotto i 7 € 12;
- nessun overflow orizzontale a 375px;
- CLS 0,013 · LCP 184 ms · 567 nodi DOM.

La scansione di contrasto gira su **ogni nodo di testo** della pagina, non su
una lista di selettori, e in quattro stati: pagina base, pannello piatto aperto,
lightbox aperta, stato vuoto del filtro Veg. La versione a lista fissa lasciava
passare quattro casi reali — nota del pannello piatto, stelle, segnaposto
`[DA CONFERMARE]`, link "Salta al menu" — tutti corretti.
