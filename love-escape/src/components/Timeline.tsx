import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'

type Step = { title: string; sub?: string }

/** Timeline orizzontale: la linea si disegna e gli step compaiono in sequenza. Il primo step pulsa (è il prossimo passo). */
export function Timeline({ steps, delay = 0, stepDelay = 0.28 }: { steps: Step[]; delay?: number; stepDelay?: number }) {
  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-[9px] h-px bg-white/10" />
      <motion.div
        className="absolute left-0 top-[9px] h-px origin-left bg-gradient-to-r from-rose via-blush to-blush/30"
        style={{ right: 0 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: steps.length * stepDelay + 0.6, delay: ENTER + delay, ease: EASE }}
      />
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <motion.div
            key={s.title}
            className="pr-8"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: ENTER + delay + 0.2 + i * stepDelay, ease: EASE }}
          >
            <span className="relative block h-[19px] w-[19px]">
              {i === 0 && <span className="absolute inset-0 animate-ping rounded-full bg-rose/50" style={{ animationDuration: '2.4s' }} />}
              <span className={`absolute inset-[4px] rounded-full ${i === 0 ? 'bg-rose' : 'border border-blush/70 bg-ink'}`} />
            </span>
            <div className="mt-7 font-serif text-[46px] leading-none text-blush tnum">{String(i + 1).padStart(2, '0')}</div>
            <div className="mt-4 text-[20px] font-semibold uppercase leading-snug tracking-[0.1em] text-cream">{s.title}</div>
            {s.sub && <div className="mt-2 font-serif text-[26px] italic text-cream/55">{s.sub}</div>}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
