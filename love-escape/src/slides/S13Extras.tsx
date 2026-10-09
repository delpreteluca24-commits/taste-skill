import { motion } from 'framer-motion'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { Icon, type IconName } from '../components/Icons'
import { Eyebrow, MaskLines } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'
import { MODEL } from './S11Revenue'

// Esempio illustrativo: il costo reale degli extra si definisce insieme al proprietario.
const PRICE = 89
const EXTRA_COST = 10 // ipotesi per l'esempio (drink + cioccolatini + sorpresa)
const BASE = PRICE - EXTRA_COST
const share = (pct: number) => (BASE * pct) / 100

const PRINCIPLES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'gift', title: 'Prima si coprono gli extra', text: 'Drink, cioccolatini, decorazioni e aperitivo: il costo vivo si toglie dall’incasso.' },
  { icon: 'coins', title: 'Poi si divide il resto', text: 'La base netta si ripartisce 80/20 in Fase 1 e 40/60 in Fase 2.' },
  { icon: 'check', title: 'Tutto documentato', text: 'Ogni spesa con scontrino, visibile a entrambi. Nessuno paga gli extra di tasca propria.' },
]

function Bar({ label, value, from, to, tone, delay, sign }: { label: string; value: number; from: number; to: number; tone: string; delay: number; sign?: string }) {
  return (
    <div className="grid grid-cols-[230px_1fr_120px] items-center gap-6">
      <span className="text-[15px] font-semibold uppercase tracking-[0.16em] text-cream/70">{label}</span>
      <div className="relative h-[14px] rounded-full bg-white/[0.06]">
        <motion.div
          className={`absolute inset-y-0 rounded-full ${tone}`}
          style={{ left: `${from * 100}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${(to - from) * 100}%` }}
          transition={{ duration: 1.1, delay: ENTER + delay, ease: EASE }}
        />
      </div>
      <span className="text-right font-serif text-[40px] leading-none text-cream">
        {sign}
        <AnimatedNumber to={value} prefix="€" delay={delay} duration={1.1} />
      </span>
    </div>
  )
}

function Split({ phase, us, owner, delay, highlight }: { phase: string; us: number; owner: number; delay: number; highlight?: boolean }) {
  return (
    <motion.div
      className="rounded-[16px] border border-white/10 p-7"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: ENTER + delay, ease: EASE }}
    >
      <div className="label !text-[12px] text-blush">{phase}</div>
      <div className="mt-5 flex items-end justify-between">
        <div>
          <div className="label !text-[11px] text-cream/45">Noi · DP System</div>
          <AnimatedNumber to={share(us)} prefix="€" decimals={2} delay={delay + 0.2} className="mt-2 block font-serif text-[46px] leading-none text-cream" />
        </div>
        <div className="text-right">
          <div className={`label !text-[11px] ${highlight ? 'text-blush' : 'text-cream/45'}`}>Tu · Proprietario</div>
          <AnimatedNumber
            to={share(owner)}
            prefix="€"
            decimals={2}
            delay={delay + 0.2}
            className={`mt-2 block font-serif text-[46px] leading-none ${highlight ? 'text-blush' : 'text-cream'}`}
          />
        </div>
      </div>
    </motion.div>
  )
}

export function S13Extras() {
  return (
    <Slide theme="coal">
      <div className="flex h-full gap-[90px]">
        <div className="flex w-[640px] shrink-0 flex-col">
          <Eyebrow>Costi degli extra</Eyebrow>
          <MaskLines
            className="mt-8"
            delay={0.1}
            lineClassName="font-serif text-[80px] leading-[1.05]"
            lines={['Extra chiari', <span className="italic text-blush">fin dall’inizio.</span>]}
          />
          <div className="mt-auto flex flex-col gap-8">
            {PRINCIPLES.map((p, i) => (
              <motion.div
                key={p.title}
                className="flex gap-6"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: ENTER + 0.6 + i * 0.25, ease: EASE }}
              >
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-blush/35 text-blush">
                  <Icon name={p.icon} size={24} delay={0.6 + i * 0.25} />
                </span>
                <div>
                  <div className="text-[20px] font-semibold uppercase tracking-[0.12em] text-cream">{p.title}</div>
                  <p className="mt-1 text-[20px] leading-[1.45] text-cream/60">{p.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          className="flex flex-1 flex-col justify-between rounded-[24px] border border-white/10 bg-ink/60 p-12"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: ENTER + 0.4, ease: EASE }}
        >
          <div className="flex items-baseline justify-between">
            <span className="label !text-[13px] text-cream/50">Esempio · pacchetto Love Escape</span>
            <span className="font-serif text-[22px] italic text-cream/40">costo extra ipotetico</span>
          </div>

          <div className="flex flex-col gap-9">
            <Bar label="Prenotazione" value={PRICE} from={0} to={1} tone="bg-cream/80" delay={0.9} />
            <Bar label="− Costo extra" value={EXTRA_COST} from={BASE / PRICE} to={1} tone="bg-rose" delay={1.5} sign="−" />
            <Bar label="= Base da dividere" value={BASE} from={0} to={BASE / PRICE} tone="bg-blush" delay={2.1} />
          </div>

          <div>
          <div className="grid grid-cols-2 gap-5">
            <Split phase={`Fase 1 · ${MODEL.phase1.us}/${MODEL.phase1.owner}`} us={MODEL.phase1.us} owner={MODEL.phase1.owner} delay={2.7} />
            <Split phase={`Fase 2 · ${MODEL.phase2.us}/${MODEL.phase2.owner}`} us={MODEL.phase2.us} owner={MODEL.phase2.owner} delay={3.0} highlight />
          </div>
          <motion.p
            className="mt-6 text-[17px] text-cream/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: ENTER + 3.4 }}
          >
            Il pacchetto Escape da €70 non ha extra: lì la base resta €70.
          </motion.p>
          </div>
        </motion.div>
      </div>
    </Slide>
  )
}
