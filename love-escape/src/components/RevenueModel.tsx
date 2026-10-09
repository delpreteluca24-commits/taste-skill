import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'
import { AnimatedNumber } from './AnimatedNumber'

type Phase = {
  tag: string
  title: string
  us: number
  owner: number
  fromUs?: number
  fromOwner?: number
  caption: string
  highlightOwner?: boolean
  delay?: number
}

/** Una fase del modello di guadagno: due percentuali enormi + barra di ripartizione. */
export function RevenuePhase({ tag, title, us, owner, fromUs, fromOwner, caption, highlightOwner, delay = 0 }: Phase) {
  const startUs = fromUs ?? 0
  const startOwner = fromOwner ?? 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1, delay: ENTER + delay, ease: EASE }}
      className="flex flex-col"
    >
      <div className="flex items-baseline gap-5">
        <span className="label text-blush">{tag}</span>
        <span className="font-serif text-[40px] italic leading-none text-cream/80">{title}</span>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <AnimatedNumber
            from={startUs}
            to={us}
            suffix="%"
            delay={delay + 0.4}
            duration={1.8}
            className="block font-serif text-[184px] leading-[0.82] tracking-[-0.03em] text-cream"
          />
          <div className="label mt-6 !text-[14px] text-cream/55">A noi · DP System</div>
        </div>
        <div>
          <AnimatedNumber
            from={startOwner}
            to={owner}
            suffix="%"
            delay={delay + 0.4}
            duration={1.8}
            className={`block font-serif text-[184px] leading-[0.82] tracking-[-0.03em] ${highlightOwner ? 'text-blush' : 'text-cream'}`}
          />
          <div className={`label mt-6 !text-[14px] ${highlightOwner ? 'text-blush' : 'text-cream/55'}`}>Al proprietario</div>
        </div>
      </div>

      <div className="mt-10 flex h-[8px] w-full gap-[4px]">
        <motion.div
          className="h-full rounded-full bg-cream/80"
          initial={{ flexGrow: fromUs ?? 50 }}
          animate={{ flexGrow: us }}
          transition={{ duration: 1.8, delay: ENTER + delay + 0.4, ease: EASE }}
        />
        <motion.div
          className={`h-full rounded-full ${highlightOwner ? 'bg-blush shadow-[0_0_18px_rgba(233,160,168,.6)]' : 'bg-rose'}`}
          initial={{ flexGrow: fromOwner ?? 50 }}
          animate={{ flexGrow: owner }}
          transition={{ duration: 1.8, delay: ENTER + delay + 0.4, ease: EASE }}
        />
      </div>

      <p className="mt-8 text-[24px] leading-snug text-cream/70">{caption}</p>
    </motion.div>
  )
}
