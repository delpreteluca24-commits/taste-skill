import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'

type Ctx = { mx: MotionValue<number>; my: MotionValue<number> }
const ParallaxCtx = createContext<Ctx | null>(null)

// Un solo listener per tutta la presentazione: posizione del mouse normalizzata -1..1.
export function ParallaxProvider({ children }: { children: ReactNode }) {
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const mx = useSpring(rx, { stiffness: 40, damping: 20, mass: 1 })
  const my = useSpring(ry, { stiffness: 40, damping: 20, mass: 1 })
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      rx.set((e.clientX / window.innerWidth) * 2 - 1)
      ry.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [rx, ry])
  return <ParallaxCtx.Provider value={{ mx, my }}>{children}</ParallaxCtx.Provider>
}

/** Spostamento in px (molto leggero) da applicare a un layer. Valori negativi = direzione opposta. */
export function useParallax(strength = 12) {
  const ctx = useContext(ParallaxCtx)
  const fallback = useMotionValue(0)
  const x = useTransform(ctx?.mx ?? fallback, (v) => v * -strength)
  const y = useTransform(ctx?.my ?? fallback, (v) => v * -strength)
  return { x, y }
}
