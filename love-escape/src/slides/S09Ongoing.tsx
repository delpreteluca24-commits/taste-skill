import { motion } from 'framer-motion'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

// Pista ad anello (loop infinito) in coordinate dello stage.
const L = 380
const R = 1540
const TOP = 500
const RAD = 170
const BOT = TOP + RAD * 2
const TRACK = `M${L},${TOP} H${R} A${RAD},${RAD} 0 0 1 ${R},${BOT} H${L} A${RAD},${RAD} 0 0 1 ${L},${TOP} Z`
const STRAIGHT = R - L
const ARC = Math.PI * RAD
const TOTAL = STRAIGHT * 2 + ARC * 2
const DRAW = 4.6
const BASE = 0.9

type Service = { title: string; sub?: string; x: number; side: 'top' | 'bottom' }
const SERVICES: Service[] = [
  { title: 'Strategia marketing e posizionamento', x: 380, side: 'top' },
  { title: 'Produzione contenuti', sub: 'foto / video / reel / stories', x: 670, side: 'top' },
  { title: 'Gestione Instagram, TikTok e Facebook', x: 960, side: 'top' },
  { title: 'Campagne pubblicitarie mirate', x: 1250, side: 'top' },
  { title: 'Gestione sito e prenotazioni', x: 1540, side: 'top' },
  { title: 'Customer care', x: 1460, side: 'bottom' },
  { title: 'Programma referral e fidelizzazione', x: 1113, side: 'bottom' },
  { title: 'Analisi risultati', x: 767, side: 'bottom' },
  { title: 'Ottimizzazione continua', x: 420, side: 'bottom' },
]
const dist = (s: Service) => (s.side === 'top' ? s.x - L : STRAIGHT + ARC + (R - s.x))
const at = (s: Service) => BASE + (DRAW * dist(s)) / TOTAL

export function S09Ongoing() {
  return (
    <Slide theme="dark" padded={false}>
      <div className="absolute left-[128px] top-[128px]">
        <Eyebrow>Il nostro lavoro continuativo</Eyebrow>
        <MaskLines
          className="mt-8"
          delay={0.1}
          lineClassName="font-serif text-[84px] leading-[1.02]"
          lines={['Tu ti occupi dell’accoglienza.', <span className="italic text-blush">Noi del resto.</span>]}
        />
      </div>

      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1920 1080">
        <path d={TRACK} fill="none" stroke="rgba(245,239,232,.08)" strokeWidth={1.2} />
        <motion.path
          d={TRACK}
          fill="none"
          stroke="url(#trackGrad)"
          strokeWidth={1.6}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: DRAW, delay: ENTER + BASE, ease: 'linear' }}
        />
        <defs>
          <linearGradient id="trackGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="#C95C70" />
            <stop offset="100%" stopColor="#E9A0A8" />
          </linearGradient>
        </defs>
        <motion.circle
          r={5}
          fill="#E9A0A8"
          style={{ filter: 'drop-shadow(0 0 8px #E9A0A8)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: ENTER + BASE + DRAW, duration: 0.8 }}
        >
          <animateMotion dur="14s" repeatCount="indefinite" path={TRACK} />
        </motion.circle>
        {SERVICES.map((s, i) => (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.side === 'top' ? TOP : BOT}
            r={7}
            fill="#0D0D0D"
            stroke="#E9A0A8"
            strokeWidth={1.6}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: ENTER + at(s), ease: EASE }}
            style={{ transformOrigin: `${s.x}px ${s.side === 'top' ? TOP : BOT}px` }}
          />
        ))}
      </svg>

      {SERVICES.map((s) => (
        <div
          key={s.title}
          className={`absolute w-[250px] -translate-x-1/2 text-center ${s.side === 'top' ? '-translate-y-full' : ''}`}
          style={{ left: s.x, top: s.side === 'top' ? TOP - 26 : BOT + 26 }}
        >
          <motion.div
            initial={{ opacity: 0, y: s.side === 'top' ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: ENTER + at(s) + 0.05, ease: EASE }}
          >
            <div className="text-[19px] font-medium leading-snug text-cream/90">{s.title}</div>
            {s.sub && <div className="mt-1 font-serif text-[20px] italic text-cream/50">{s.sub}</div>}
          </motion.div>
        </div>
      ))}

      <Reveal delay={1.4} className="absolute left-0 right-0 text-center" style={{ top: TOP + RAD - 46 }}>
        <div className="font-serif text-[64px] italic leading-none text-white">Ogni mese.</div>
        <div className="label mt-5 !text-[13px] text-cream/50">Un ciclo continuo, misurato e ottimizzato</div>
      </Reveal>
    </Slide>
  )
}
