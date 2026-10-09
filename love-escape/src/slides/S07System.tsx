import { motion } from 'framer-motion'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

// Diagramma in coordinate fisse (lo stage è sempre 1920×1080).
const CX = 470
const SOURCES = ['Instagram', 'TikTok', 'Facebook', 'Ads']
const SRC_X = [130, 360, 580, 810]
const SRC_Y = 36
const HUB_Y = 170
const CHAIN = ['Prenotazione', 'Esperienza', 'Recensione', 'UGC', 'Referral', 'Nuovo cliente']
const CHAIN_Y0 = 290
const STEP = 96
const CHAIN_DELAY = 1.5
const CHAIN_GAP = 0.32

const chainY = (i: number) => CHAIN_Y0 + i * STEP
const lastY = chainY(CHAIN.length - 1)
const LOOP = `M${CX + 120},${lastY} H880 Q910,${lastY} 910,${lastY - 30} V${HUB_Y + 30} Q910,${HUB_Y} 880,${HUB_Y} H${CX + 175}`
const LOOP_DELAY = CHAIN_DELAY + CHAIN.length * CHAIN_GAP + 0.2

function Node({ y, children, delay, variant = 'plain' }: { y: number; children: string; delay: number; variant?: 'plain' | 'hub' | 'end' }) {
  const cls =
    variant === 'hub'
      ? 'h-[72px] w-[350px] border-blush/70 bg-ink font-serif text-[34px] tracking-[0.12em] text-white shadow-[0_0_50px_-8px_rgba(233,160,168,.45)]'
      : variant === 'end'
        ? 'h-[52px] w-[240px] border-rose bg-rose text-[15px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_10px_40px_-10px_rgba(201,92,112,.8)]'
        : 'h-[52px] w-[240px] border-white/15 bg-coal text-[15px] font-semibold uppercase tracking-[0.2em] text-cream/85'
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: CX, top: y }}>
      <motion.div
        className={`flex items-center justify-center rounded-full border ${cls}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: ENTER + delay, ease: EASE }}
      >
        {children}
      </motion.div>
    </div>
  )
}

export function S07System() {
  return (
    <Slide theme="dark">
      <div className="flex h-full">
        <div className="flex w-[700px] shrink-0 flex-col">
          <Eyebrow>Il sistema</Eyebrow>
          <MaskLines
            className="mt-9"
            delay={0.1}
            lineClassName="font-serif text-[80px] leading-[1.05]"
            lines={['Un sistema,', <span className="italic text-blush">non semplicemente</span>, 'pubblicità.']}
          />
          <Reveal delay={0.8} className="mt-auto max-w-[520px] text-[25px] leading-[1.5] text-cream/65">
            Ogni coppia soddisfatta genera contenuti, recensioni e nuove prenotazioni.
            <span className="mt-4 block font-serif text-[30px] italic text-cream/90">Il ciclo si alimenta da solo.</span>
          </Reveal>
        </div>

        <div className="relative flex-1">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 964 820" preserveAspectRatio="xMinYMin meet">
            <defs>
              <marker id="arrowPink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#E9A0A8" />
              </marker>
            </defs>
            {SRC_X.map((x, i) => (
              <motion.path
                key={i}
                d={`M${x},${SRC_Y + 26} C${x},${SRC_Y + 80} ${CX},${HUB_Y - 90} ${CX},${HUB_Y - 36}`}
                fill="none"
                stroke="rgba(233,160,168,.45)"
                strokeWidth={1.2}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, delay: ENTER + 0.6 + i * 0.1, ease: EASE }}
              />
            ))}
            {[HUB_Y, ...CHAIN.slice(0, -1).map((_, i) => chainY(i))].map((y, i) => {
              const from = i === 0 ? HUB_Y + 36 : y + 26
              const to = chainY(i) - 26
              return (
                <motion.line
                  key={i}
                  x1={CX} x2={CX} y1={from} y2={to}
                  stroke="rgba(245,239,232,.25)"
                  strokeWidth={1.2}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.35, delay: ENTER + CHAIN_DELAY - 0.2 + i * CHAIN_GAP, ease: 'easeOut' }}
                />
              )
            })}
            <motion.path
              d={LOOP}
              fill="none"
              stroke="#E9A0A8"
              strokeWidth={1.4}
              markerEnd="url(#arrowPink)"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.6, delay: ENTER + LOOP_DELAY, ease: EASE }}
            />
            {/* luce che percorre il ciclo */}
            <motion.circle
              r={4}
              fill="#E9A0A8"
              style={{ filter: 'drop-shadow(0 0 6px #E9A0A8)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: ENTER + LOOP_DELAY + 1.6, duration: 0.6 }}
            >
              <animateMotion dur="4.5s" repeatCount="indefinite" path={LOOP} />
            </motion.circle>
            <motion.text
              x={940}
              y={(HUB_Y + lastY) / 2}
              textAnchor="middle"
              transform={`rotate(90 940 ${(HUB_Y + lastY) / 2})`}
              className="fill-blush text-[14px] font-semibold uppercase tracking-[0.3em]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: ENTER + LOOP_DELAY + 1, duration: 0.8 }}
            >
              Il ciclo ricomincia
            </motion.text>
          </svg>

          {SOURCES.map((s, i) => (
            <div key={s} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: SRC_X[i], top: SRC_Y }}>
              <motion.div
                className="flex h-[52px] w-[190px] items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-[15px] font-semibold uppercase tracking-[0.2em] text-cream/80"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: ENTER + 0.3 + i * 0.1, ease: EASE }}
              >
                {s}
              </motion.div>
            </div>
          ))}
          <Node y={HUB_Y} delay={1.1} variant="hub">LOVE ESCAPE</Node>
          {CHAIN.map((c, i) => (
            <Node key={c} y={chainY(i)} delay={CHAIN_DELAY + i * CHAIN_GAP} variant={i === CHAIN.length - 1 ? 'end' : 'plain'}>
              {c}
            </Node>
          ))}
        </div>
      </div>
    </Slide>
  )
}
