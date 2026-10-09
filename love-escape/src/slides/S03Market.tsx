import { motion } from 'framer-motion'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

// Mappa stilizzata: proiezione semplice lon/lat → px (x = (lon-8.75)·560, y = (44.5-lat)·778).
const COAST =
  'M0,78 C40,76 70,72 101,70 C140,80 190,100 240,118 C262,126 262,146 258,156 C300,160 330,170 364,179 C400,192 440,225 482,257 C500,270 510,280 521,284 C535,295 545,305 554,311 C570,325 590,345 608,352 C616,344 616,330 606,318 C602,312 600,308 604,305 C615,306 628,316 640,325 C648,330 652,334 660,340 C668,347 672,350 680,352 C688,354 692,356 698,357 C712,360 720,362 732,368 C748,378 756,388 770,400 C784,410 790,416 798,424 C812,444 828,468 840,490 C848,520 851,560 853,620 L856,700'
const LAND = `${COAST} L900,700 L900,0 L0,0 Z`
const SPEZIA = { x: 603, y: 306 }

type Place = { name: string; x: number; y: number; dx?: number; dy?: number; anchor?: 'start' | 'end' }
type Segment = { key: string; title: string; places: Place[]; color: string; ring: boolean; delay: number; list: string[] }

const SEGMENTS: Segment[] = [
  {
    key: 'local', title: 'Mercato locale', color: '#C95C70', ring: false, delay: 1.2,
    list: ['La Spezia', 'Sarzana', 'Lerici'],
    places: [
      { name: 'Sarzana', x: 678, y: 296, dx: 16, dy: -10 },
      { name: 'Lerici', x: 652, y: 334, dx: 16, dy: 20 },
    ],
  },
  {
    key: 'regional', title: 'Mercato regionale', color: '#0D0D0D', ring: true, delay: 2.3,
    list: ['Massa-Carrara', 'Versilia', 'Genova'],
    places: [
      { name: 'Massa-Carrara', x: 768, y: 352, dx: 16, dy: -8 },
      { name: 'Versilia', x: 820, y: 455, dx: -16, dy: 6, anchor: 'end' },
      { name: 'Genova', x: 101, y: 70, dx: 0, dy: -20, anchor: 'start' },
    ],
  },
  {
    key: 'tourist', title: 'Mercato turistico', color: '#E9A0A8', ring: true, delay: 3.4,
    list: ['Italia', 'Stranieri', 'Cinque Terre'],
    places: [{ name: 'Cinque Terre', x: 521, y: 284, dx: -16, dy: 4, anchor: 'end' }],
  },
]

const arc = (x: number, y: number) => {
  const mx = (SPEZIA.x + x) / 2
  const my = (SPEZIA.y + y) / 2 - Math.min(80, Math.hypot(x - SPEZIA.x, y - SPEZIA.y) * 0.25)
  return `M${SPEZIA.x},${SPEZIA.y} Q${mx},${my} ${x},${y}`
}

export function S03Market() {
  return (
    <Slide theme="light">
      <div className="flex h-full gap-6">
        <div className="flex w-[760px] shrink-0 flex-col">
          <Eyebrow tone="light">Il mercato</Eyebrow>
          <MaskLines
            className="mt-9"
            delay={0.1}
            lineClassName="font-serif text-[96px] leading-[1] tracking-[-0.01em]"
            lines={['Un grande potenziale', <span className="italic text-rose">da sfruttare.</span>]}
          />
          <Reveal delay={0.6} className="mt-9 flex max-w-[700px] flex-col gap-4 text-[24px] leading-[1.45] text-ink/70">
            <p>Coppie locali e turisti cercano esperienze romantiche, ma spesso non vogliono spendere cifre elevate.</p>
            <p>Con un prezzo accessibile e un’offerta ben strutturata possiamo attirare pubblico ricorrente e costante.</p>
          </Reveal>

          <div className="mt-auto grid grid-cols-3 gap-8">
            {SEGMENTS.map((s) => (
              <motion.div
                key={s.key}
                className="border-t border-ink/15 pt-6"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: ENTER + s.delay - 0.2, ease: EASE }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-[10px] w-[10px] rounded-full"
                    style={s.ring ? { border: `1.5px solid ${s.color}` } : { background: s.color }}
                  />
                  <span className="text-[15px] font-semibold uppercase tracking-[0.2em]">{s.title}</span>
                </div>
                <ul className="mt-4 flex flex-col gap-1">
                  {s.list.map((p, i) => (
                    <motion.li
                      key={p}
                      className="font-serif text-[32px] leading-[1.2] text-ink/85"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.6, delay: ENTER + s.delay + i * 0.15, ease: EASE }}
                    >
                      {p}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          className="relative flex-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.4, delay: ENTER + 0.3 }}
        >
          <svg viewBox="40 0 860 700" className="absolute right-0 top-[50px] h-[707px] w-[868px] overflow-visible">
            <defs>
              <radialGradient id="landFade" cx={603} cy={306} r={560} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#0D0D0D" stopOpacity="0.09" />
                <stop offset="70%" stopColor="#0D0D0D" stopOpacity="0.035" />
                <stop offset="100%" stopColor="#0D0D0D" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="glowSpezia">
                <stop offset="0%" stopColor="#E9A0A8" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#E9A0A8" stopOpacity="0" />
              </radialGradient>
            </defs>
            <motion.path
              d={LAND}
              fill="url(#landFade)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.6, delay: ENTER + 0.9 }}
            />
            <motion.path
              d={COAST}
              fill="none"
              stroke="rgba(13,13,13,0.4)"
              strokeWidth={1.2}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.2, delay: ENTER + 0.3, ease: EASE }}
            />
            <ellipse cx={612} cy={360} rx={6} ry={3.5} fill="rgba(13,13,13,0.08)" stroke="rgba(13,13,13,0.3)" strokeWidth={0.8} />
            <text x={300} y={430} className="fill-ink/30 font-serif text-[30px] italic">Mar Ligure</text>
            <text x={780} y={190} className="fill-ink/25 text-[13px] font-semibold uppercase tracking-[0.3em]">Toscana</text>
            <text x={330} y={34} className="fill-ink/25 text-[13px] font-semibold uppercase tracking-[0.3em]">Liguria</text>

            {/* Flussi dal turismo: Italia ed estero */}
            {[
              { d: 'M603,306 C680,200 760,120 890,30', label: 'Italia', lx: 820, ly: 30 },
              { d: 'M603,306 C520,420 380,520 160,640', label: 'Stranieri', lx: 150, ly: 676 },
            ].map((f) => (
              <g key={f.label}>
                <motion.path
                  d={f.d}
                  fill="none"
                  stroke="#E9A0A8"
                  strokeWidth={1.4}
                  strokeDasharray="2 7"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.6, delay: ENTER + 3.5, ease: EASE }}
                />
                <motion.text
                  x={f.lx}
                  y={f.ly}
                  className="fill-ink/70 text-[15px] font-semibold uppercase tracking-[0.22em]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.8, delay: ENTER + 4.3 }}
                >
                  {f.label} →
                </motion.text>
              </g>
            ))}

            {SEGMENTS.map((s) =>
              s.places.map((p, i) => (
                <g key={p.name}>
                  <motion.path
                    d={arc(p.x, p.y)}
                    fill="none"
                    stroke={s.color}
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1, delay: ENTER + s.delay + i * 0.15, ease: EASE }}
                  />
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill={s.ring ? '#F5EFE8' : s.color}
                    stroke={s.color}
                    strokeWidth={1.8}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.6, delay: ENTER + s.delay + 0.5 + i * 0.15, ease: EASE }}
                    style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                  />
                  <motion.text
                    x={p.x + (p.dx ?? 14)}
                    y={p.y + (p.dy ?? 0)}
                    textAnchor={p.anchor ?? 'start'}
                    dominantBaseline="middle"
                    className="fill-ink/80 text-[15px] font-semibold uppercase tracking-[0.16em]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, delay: ENTER + s.delay + 0.6 + i * 0.15 }}
                  >
                    {p.name}
                  </motion.text>
                </g>
              )),
            )}

            {/* La Spezia: centro del sistema */}
            <motion.circle
              cx={SPEZIA.x} cy={SPEZIA.y} r={70} fill="url(#glowSpezia)"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 4, delay: ENTER + 1, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.circle
              cx={SPEZIA.x} cy={SPEZIA.y} r={9} fill="#C95C70"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.8, delay: ENTER + 1, ease: EASE }}
              style={{ transformOrigin: `${SPEZIA.x}px ${SPEZIA.y}px` }}
            />
            <motion.text
              x={SPEZIA.x - 6} y={SPEZIA.y - 34} textAnchor="middle"
              className="fill-ink font-serif text-[30px] italic"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: ENTER + 1.2 }}
            >
              La Spezia
            </motion.text>
          </svg>
        </motion.div>
      </div>
    </Slide>
  )
}
