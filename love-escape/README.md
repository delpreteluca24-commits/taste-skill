# Love Escape La Spezia — presentazione interattiva

Pitch deck cinematico (17 slide, 16:9, ottimizzato 1920×1080) per la proposta di collaborazione DP System × Love Escape.

## Presentare dal vivo

1. `dist/index.html` è un **file unico autonomo** (JS, CSS, font e immagini inclusi): aprilo con doppio click in Chrome, Edge o Safari. Funziona offline.
2. Premi **F** per lo schermo intero.
3. Naviga con le frecce.

| Tasto | Azione |
|---|---|
| → ↓ Spazio Invio PagGiù | Slide successiva |
| ← ↑ Backspace PagSu | Slide precedente |
| Home / Fine | Prima / ultima slide |
| F | Schermo intero (Esc per uscire) |
| M | Audio ambient on/off (mai automatico) |
| H | Nasconde/mostra l'interfaccia |
| Click sui bordi laterali | Precedente / successiva |
| Swipe | Navigazione touch |

Presentation mode: dopo ~3 secondi senza muovere il mouse spariscono cursore, indicatori e controlli; restano solo contatore e barra di avanzamento. L'URL tiene traccia della slide (`index.html#11` riapre il modello di guadagno).

## Sviluppo

```bash
npm install
npm run dev      # anteprima con hot reload
npm run build    # genera dist/index.html (file unico)
```

Stack: React 18 + TypeScript + Tailwind CSS + Framer Motion, Vite con `vite-plugin-singlefile`. Font: Playfair Display (titoli, numeri) + Manrope (testi), inclusi nel bundle.

```
src/
  components/   Presentation, Slide, SlideTransition, HeroSlide, ImageReveal,
                PackageCard, PriceCard, StatCard, Timeline, RevenueModel,
                ProgressBar, AnimatedNumber, Chrome, Reveal, Icons
  slides/       S01Cover … S15NextSteps (+ S13Extras, S14WhyPhase1) + index.ts (ordine, transizioni, tema)
  lib/          motion.ts (curve e tempi), parallax.tsx, sound.ts
  assets/       images.ts + images/*.webp
```

## Sostituire le immagini

Le foto attuali sono **immagini di mood generate con AI**, da sostituire con lo shooting reale della camera prima di usarle in comunicazione pubblica. Sovrascrivi i file in `src/assets/images/` mantenendo lo stesso nome (formato consigliato: WebP, 1920–2400 px di lato lungo, < 400 KB) e rilancia `npm run build`.

| File | Dove appare |
|---|---|
| `room.webp` | Cover, mockup sito, slide prodotto |
| `jacuzzi.webp` | Concept, mockup smartphone, slide prodotto |
| `prosecco.webp` | Sfondo pacchetti, slide prodotto |
| `toast.webp` | Slide prodotto |
| `gulf-night.webp` | Risultati attesi |
| `couple-window.webp` | La visione |
| `couple-gulf.webp` | Prossimi passi |

## Dati economici

Prezzi, setup e percentuali sono in un solo posto ciascuno:
- pacchetti: `slides/S04Packages.tsx`
- voci setup (totale calcolato automaticamente): `slides/S08Setup.tsx`
- modello 80/20 → 40/60: `MODEL` in `slides/S11Revenue.tsx` (le slide 12, 13 e 14 si ricalcolano da qui)
- costi degli extra: `slides/S13Extras.tsx`. Regola proposta: i costi vivi documentati degli extra (drink, cioccolatini, decorazioni, aperitivo) si detraggono dall'incasso prima della ripartizione. Il costo di €10 nell'esempio è un'ipotesi: va sostituito con il costo reale concordato.
