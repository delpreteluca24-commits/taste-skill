import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Eyebrow, MaskLines } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

function Mechanism({ tag, children, text, delay }: { tag: string; children: ReactNode; text: string; delay: number }) {
  return (
    <motion.div
      className="flex flex-col rounded-[20px] bg-white p-9 shadow-[0_30px_60px_-35px_rgba(13,13,13,.35)] ring-1 ring-ink/[0.06]"
      initial={{ opacity: 0, y: 36 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: ENTER + delay, ease: EASE }}
      whileHover={{ y: -6, transition: { duration: 0.5, ease: EASE } }}
    >
      <div className="label !text-[13px] text-rose">{tag}</div>
      <div className="mt-5 flex min-h-[76px] items-end">{children}</div>
      <p className="mt-4 text-[20px] leading-[1.45] text-ink/65">{text}</p>
    </motion.div>
  )
}

const CYCLE = ['Cliente', 'Esperienza', 'Recensione', 'Referral', 'Nuovo cliente']
const C = 280
const RR = 205

export function S10Loyalty() {
  const pts = CYCLE.map((_, i) => {
    const a = (-90 + i * 72) * (Math.PI / 180)
    return { x: C + RR * Math.cos(a), y: C + RR * Math.sin(a), a }
  })
  const arcPath = (i: number) => {
    const a0 = (-90 + i * 72 + 12) * (Math.PI / 180)
    const a1 = (-90 + (i + 1) * 72 - 12) * (Math.PI / 180)
    return `M${C + RR * Math.cos(a0)},${C + RR * Math.sin(a0)} A${RR},${RR} 0 0 1 ${C + RR * Math.cos(a1)},${C + RR * Math.sin(a1)}`
  }

  return (
    <Slide theme="light">
      <Eyebrow tone="light">Fidelizzazione</Eyebrow>
      <MaskLines
        className="mt-8"
        delay={0.1}
        lineClassName="font-serif text-[80px] leading-[1.02]"
        lines={['Ogni cliente può diventare', <span className="italic text-rose">un nuovo cliente.</span>]}
      />

      <div className="mt-12 flex gap-16">
        <div className="grid w-[1000px] shrink-0 grid-cols-2 gap-6">
          <Mechanism tag="First Love" delay={0.6} text="Sulla prima prenotazione, su date selezionate.">
            <span className="font-serif text-[76px] leading-[0.9]">€59</span>
          </Mechanism>
          <Mechanism
            tag="Love Pass"
            delay={0.75}
            text="Invita un’altra coppia: il nuovo cliente riceve €10 di sconto, chi invita riceve €10 di credito."
          >
            <span className="font-serif text-[76px] leading-[0.9]">
              €10 <span className="text-rose">+</span> €10
            </span>
          </Mechanism>
          <Mechanism tag="Ricompense progressive" delay={0.9} text="Più amici inviti, più bonus ricevi.">
            <div className="flex items-end gap-[10px]">
              {[22, 36, 52, 70].map((h, i) => (
                <motion.span
                  key={i}
                  className="block w-[22px] rounded-[4px] bg-gradient-to-t from-rose to-blush"
                  initial={{ height: 0 }}
                  animate={{ height: h }}
                  transition={{ duration: 0.8, delay: ENTER + 1.3 + i * 0.15, ease: EASE }}
                />
              ))}
            </div>
          </Mechanism>
          <Mechanism tag="Omaggi speciali" delay={1.05} text="Piccoli gesti che trasformano una notte in un ricordo.">
            <div className="flex flex-wrap gap-2">
              {['Drink', 'Cioccolatini', 'Decorazioni', 'Sorprese'].map((t, i) => (
                <motion.span
                  key={t}
                  className="rounded-full border border-ink/15 px-4 py-2 text-[17px] text-ink/80"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: ENTER + 1.4 + i * 0.1, ease: EASE }}
                >
                  {t}
                </motion.span>
              ))}
            </div>
          </Mechanism>
        </div>

        <div className="relative -mt-[70px] h-[560px] w-[560px]">
          <svg viewBox="0 0 560 560" className="absolute inset-0 overflow-visible">
            <defs>
              <marker id="arrowRose" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#C95C70" />
              </marker>
            </defs>
            <circle cx={C} cy={C} r={RR} fill="none" stroke="rgba(13,13,13,.07)" strokeWidth={1} />
            {CYCLE.map((_, i) => (
              <motion.path
                key={i}
                d={arcPath(i)}
                fill="none"
                stroke="#C95C70"
                strokeWidth={1.4}
                markerEnd="url(#arrowRose)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: ENTER + 1.6 + i * 0.4, ease: 'easeOut' }}
              />
            ))}
            {pts.map((p, i) => (
              <motion.circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === 0 || i === 4 ? 9 : 6}
                fill={i === 4 ? '#C95C70' : '#F5EFE8'}
                stroke="#C95C70"
                strokeWidth={1.6}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, delay: ENTER + 1.4 + i * 0.4, ease: EASE }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              />
            ))}
          </svg>
          {pts.map((p, i) => {
            const right = Math.cos(p.a) > 0.2
            const left = Math.cos(p.a) < -0.2
            return (
              <motion.div
                key={CYCLE[i]}
                className="absolute whitespace-nowrap text-[15px] font-semibold uppercase tracking-[0.18em] text-ink/80"
                style={{
                  left: p.x + (right ? 22 : left ? -22 : 0),
                  top: p.y + (i === 0 ? -34 : Math.sin(p.a) > 0.5 ? 22 : 0),
                  transform: `translate(${right ? '0' : left ? '-100%' : '-50%'}, -50%)`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: ENTER + 1.5 + i * 0.4 }}
              >
                {CYCLE[i]}
              </motion.div>
            )
          })}
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: ENTER + 3.6 }}
          >
            <span className="font-serif text-[46px] italic leading-none text-ink">Passaparola</span>
            <span className="label mt-3 !text-[12px] text-ink/45">che si ripete</span>
          </motion.div>
        </div>
      </div>
    </Slide>
  )
}
