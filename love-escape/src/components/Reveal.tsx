import { motion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'
import { EASE, ENTER, T } from '../lib/motion'

type RevealProps = HTMLMotionProps<'div'> & {
  delay?: number
  y?: number
  blur?: boolean
  duration?: number
}

/** Ingresso standard: opacity 0→1, translateY 30px→0 (opzionale blur→nitido). */
export function Reveal({ delay = 0, y = 30, blur = false, duration = 0.9, children, ...rest }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: blur ? 'blur(12px)' : 'blur(0px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration, delay: ENTER + delay, ease: EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/** Testo rivelato riga per riga dietro una maschera (titoli). */
export function MaskLines({
  lines,
  delay = 0,
  className = '',
  lineClassName = '',
  stagger = 0.12,
}: {
  lines: ReactNode[]
  delay?: number
  className?: string
  lineClassName?: string
  stagger?: number
}) {
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em] -mb-[0.08em]">
          <motion.span
            className={`block ${lineClassName}`}
            initial={{ y: '105%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 1.15, delay: ENTER + delay + i * stagger, ease: EASE }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </div>
  )
}

/** Micro-label con trattino rosa: "02 — Il concept". */
export function Eyebrow({ children, delay = 0, tone = 'dark' }: { children: ReactNode; delay?: number; tone?: 'dark' | 'light' }) {
  return (
    <motion.div
      className={`label flex items-center gap-4 ${tone === 'light' ? 'text-ink/60' : 'text-cream/60'}`}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: T.micro, delay: ENTER + delay, ease: EASE }}
    >
      <motion.span
        className="block h-px bg-rose"
        initial={{ width: 0 }}
        animate={{ width: 40 }}
        transition={{ duration: 0.7, delay: ENTER + delay + 0.1, ease: EASE }}
      />
      {children}
    </motion.div>
  )
}
