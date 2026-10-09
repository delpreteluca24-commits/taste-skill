import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { EASE, ENTER } from '../lib/motion'

type Props = {
  to: number
  from?: number
  delay?: number
  duration?: number
  prefix?: string
  suffix?: string
  className?: string
  decimals?: number
}

/** Contatore animato (aggiorna il DOM direttamente: nessun re-render per frame). */
export function AnimatedNumber({ to, from = 0, delay = 0, duration = 1.6, prefix = '', suffix = '', className, decimals = 0 }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = (v: number) =>
      `${prefix}${v.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`
    if (reduce) {
      el.textContent = fmt(to)
      return
    }
    el.textContent = fmt(from)
    const controls = animate(from, to, {
      duration,
      delay: ENTER + delay,
      ease: EASE,
      onUpdate: (v) => { el.textContent = fmt(v) },
    })
    return () => controls.stop()
  }, [to, from, delay, duration, prefix, suffix, reduce, decimals])
  return (
    <span ref={ref} className={`tnum ${className ?? ''}`}>
      {`${prefix}${from.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`}
    </span>
  )
}
