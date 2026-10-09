import type { Variants } from 'framer-motion'
import { EASE, EASE_IN_OUT, T } from '../lib/motion'

export type TransitionKind = 'fade' | 'slide' | 'zoom' | 'black' | 'mask'
export type TransitionCustom = { kind: TransitionKind; dir: 1 | -1 }

const d = T.transition

// La transizione è decisa dalla slide in ENTRATA e applicata a entrambe le slide
// (AnimatePresence passa lo stesso `custom` anche a quella in uscita).
export const slideVariants: Variants = {
  enter: ({ kind, dir }: TransitionCustom) => {
    switch (kind) {
      case 'slide':
        return { x: dir > 0 ? '100%' : '-100%', opacity: 1, scale: 1, zIndex: 2 }
      case 'zoom':
        return { opacity: 0, scale: 1.12, x: 0, zIndex: 2 }
      case 'mask':
        return {
          clipPath: dir > 0 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)',
          opacity: 1, x: 0, scale: 1, zIndex: 2,
        }
      case 'black':
      case 'fade':
      default:
        return { opacity: 0, x: 0, scale: 1, zIndex: 2 }
    }
  },
  center: ({ kind }: TransitionCustom) => {
    const base = { x: 0, opacity: 1, scale: 1, zIndex: 2 }
    switch (kind) {
      case 'slide':
        return { ...base, transition: { duration: 1.0, ease: EASE_IN_OUT } }
      case 'zoom':
        return { ...base, transition: { duration: 1.1, ease: EASE } }
      case 'mask':
        return { ...base, clipPath: 'inset(0% 0% 0% 0%)', transition: { duration: 1.05, ease: EASE_IN_OUT } }
      case 'black':
        return { ...base, transition: { duration: 0.75, delay: 0.5, ease: 'easeOut' } }
      default:
        return { ...base, transition: { duration: d, ease: 'easeInOut' } }
    }
  },
  exit: ({ kind, dir }: TransitionCustom) => {
    switch (kind) {
      case 'slide':
        return { x: dir > 0 ? '-28%' : '28%', opacity: 0.25, zIndex: 1, transition: { duration: 1.0, ease: EASE_IN_OUT } }
      case 'zoom':
        return { opacity: 0, scale: 0.95, zIndex: 1, transition: { duration: 0.8, ease: EASE } }
      case 'mask':
        return { scale: 0.96, opacity: 0.4, zIndex: 1, transition: { duration: 1.05, ease: EASE_IN_OUT } }
      case 'black':
        return { opacity: 0, zIndex: 1, transition: { duration: 0.5, ease: 'easeIn' } }
      default:
        return { opacity: 0, zIndex: 1, transition: { duration: d, ease: 'easeInOut' } }
    }
  },
}
