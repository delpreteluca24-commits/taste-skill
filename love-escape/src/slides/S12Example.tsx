import { motion } from 'framer-motion'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'
import { MODEL } from './S11Revenue'

const BOOKING = 70
const split = (pct: number) => Math.round((BOOKING * pct) / 100)
const P1_US = split(MODEL.phase1.us) // 56
const P1_OWNER = split(MODEL.phase1.owner) // 14
const P2_US = split(MODEL.phase2.us) // 28
const P2_OWNER = split(MODEL.phase2.owner) // 42
const NIGHTS = Math.ceil(MODEL.setup / P1_US) // 16

const ROWS = [
  { who: 'Noi', role: 'DP System', p1: P1_US, p2: P2_US, owner: false },
  { who: 'Tu', role: 'Proprietario', p1: P1_OWNER, p2: P2_OWNER, owner: true },
]

export function S12Example() {
  return (
    <Slide theme="light">
      <div className="flex gap-[110px]">
        <div className="w-[640px] shrink-0">
          <Eyebrow tone="light">Esempio reale</Eyebrow>
          <MaskLines
            className="mt-8"
            delay={0.1}
            lineClassName="font-serif text-[96px] leading-[1]"
            lines={['Facciamo', <span className="italic text-rose">un esempio.</span>]}
          />
          <Reveal delay={0.6} className="mt-14">
            <div className="label !text-[14px] text-ink/50">Prenotazione · pacchetto Escape</div>
            <AnimatedNumber to={BOOKING} prefix="€" delay={0.7} className="mt-3 block font-serif text-[190px] leading-[0.85]" />
          </Reveal>
        </div>

        <motion.div
          className="mt-[30px] flex-1 overflow-hidden rounded-[22px] bg-white shadow-[0_40px_80px_-40px_rgba(13,13,13,.35)] ring-1 ring-ink/[0.06]"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: ENTER + 0.8, ease: EASE }}
        >
          <div className="grid grid-cols-[1.3fr_1fr_1fr] border-b border-ink/10 px-10 py-6">
            <span />
            <span className="label !text-[13px] text-ink/50">Fase 1 · 80/20</span>
            <span className="label !text-[13px] text-ink/50">Fase 2 · 40/60</span>
          </div>
          {ROWS.map((r, i) => (
            <motion.div
              key={r.who}
              className={`grid grid-cols-[1.3fr_1fr_1fr] items-baseline px-10 py-8 ${i === 0 ? 'border-b border-ink/10' : 'bg-rose/[0.05]'}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: ENTER + 1.1 + i * 0.3, ease: EASE }}
            >
              <div>
                <div className={`font-serif text-[44px] leading-none ${r.owner ? 'italic text-rose' : ''}`}>{r.who}</div>
                <div className="label mt-2 !text-[12px] text-ink/45">{r.role}</div>
              </div>
              <AnimatedNumber to={r.p1} prefix="€" delay={1.3 + i * 0.3} className="font-serif text-[76px] leading-none" />
              <AnimatedNumber
                to={r.p2}
                prefix="€"
                delay={1.6 + i * 0.3}
                className={`font-serif text-[76px] leading-none ${r.owner ? 'text-rose' : ''}`}
              />
            </motion.div>
          ))}
        </motion.div>
      </div>

      <Reveal delay={2.2} className="absolute bottom-[140px] left-[128px] right-[128px]">
        <div className="flex items-end justify-between">
          <p className="text-[26px] leading-snug text-ink/80">
            Il setup iniziale da €{MODEL.setup} viene recuperato attraverso la prima fase.
          </p>
          <p className="text-[18px] text-ink/45">
            Con prenotazioni da €{BOOKING}: €{P1_US} a notte · circa {NIGHTS} prenotazioni
          </p>
        </div>
        <div className="mt-7 flex items-center gap-6">
          <span className="font-serif text-[30px] text-ink/60">€0</span>
          <div className="relative h-[10px] flex-1 overflow-hidden rounded-full bg-ink/[0.07]">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose to-blush"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 3.2, delay: ENTER + 2.6, ease: [0.45, 0, 0.2, 1] }}
            />
            {Array.from({ length: NIGHTS - 1 }, (_, i) => (
              <span
                key={i}
                className="absolute inset-y-0 w-[2px] bg-cream"
                style={{ left: `${(((i + 1) * P1_US) / MODEL.setup) * 100}%` }}
              />
            ))}
          </div>
          <AnimatedNumber to={MODEL.setup} prefix="€" delay={2.6} duration={3.2} className="w-[120px] font-serif text-[30px] text-ink" />
          <span className="label whitespace-nowrap !text-[12px] text-rose">→ Fase 2</span>
        </div>
      </Reveal>
    </Slide>
  )
}
