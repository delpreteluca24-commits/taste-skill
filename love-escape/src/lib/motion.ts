// Sistema di motion condiviso: curve e tempi coerenti in tutta la presentazione.
export const EASE = [0.22, 1, 0.36, 1] as const // uscita morbida, "cinematica"
export const EASE_IN_OUT = [0.76, 0, 0.24, 1] as const

export const T = {
  transition: 0.95, // cambio slide (600–1000ms)
  micro: 0.55, // micro-animazioni (300–700ms)
  hero: 1.4, // hero (1000–1600ms)
  stagger: 0.1,
}

// Ritardo base dei contenuti: partono mentre la transizione di slide si chiude.
export const ENTER = 0.45

export const euro = (n: number) => `€${Math.round(n).toLocaleString('it-IT')}`
