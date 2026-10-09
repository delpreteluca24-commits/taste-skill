import { motion } from 'framer-motion'
import { EASE } from '../lib/motion'

/** Barra di avanzamento discreta in cima allo schermo. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="absolute left-0 right-0 top-0 z-50 h-[2px] bg-white/[0.06]">
      <motion.div
        className="h-full origin-left bg-gradient-to-r from-rose to-blush"
        initial={false}
        animate={{ scaleX: value }}
        transition={{ duration: 0.9, ease: EASE }}
        style={{ boxShadow: '0 0 12px rgba(233,160,168,.6)' }}
      />
    </div>
  )
}
