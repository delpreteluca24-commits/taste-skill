import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'
import { MODEL } from './S11Revenue'

const NIGHTS = Math.ceil(MODEL.setup / ((70 * MODEL.phase1.us) / 100)) // 16 prenotazioni da €70

function Reason({ figure, title, text, delay }: { figure: ReactNode; title: string; text: string; delay: number }) {
  return (
    <motion.div
      className="flex flex-col rounded-[20px] bg-white p-10 shadow-[0_30px_60px_-35px_rgba(13,13,13,.35)] ring-1 ring-ink/[0.06]"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: ENTER + delay, ease: EASE }}
      whileHover={{ y: -6, transition: { duration: 0.5, ease: EASE } }}
    >
      <div className="font-serif text-[118px] leading-[0.9] text-ink">{figure}</div>
      <div className="mt-8 text-[20px] font-semibold uppercase tracking-[0.12em] text-ink">{title}</div>
      <p className="mt-3 text-[21px] leading-[1.45] text-ink/60">{text}</p>
    </motion.div>
  )
}

export function S14WhyPhase1() {
  return (
    <Slide theme="light">
      <Eyebrow tone="light">La Fase 1, spiegata bene</Eyebrow>
      <MaskLines
        className="mt-8"
        delay={0.1}
        lineClassName="font-serif text-[80px] leading-[1.05]"
        lines={['Perché la Fase 1', <span className="italic text-rose">conviene anche a te.</span>]}
      />

      <div className="mt-12 grid grid-cols-3 gap-7">
        <Reason
          delay={0.5}
          figure="€0"
          title="Investimento iniziale"
          text={`Il setup da €${MODEL.setup} lo anticipiamo noi: sito, shooting, branding, automazioni e lancio.`}
        />
        <Reason
          delay={0.7}
          figure={<AnimatedNumber to={NIGHTS} prefix="≈" delay={0.9} duration={1.4} />}
          title="Prenotazioni, poi finisce"
          text="Con prenotazioni da €70 la Fase 1 si chiude dopo circa 16 notti. Con i pacchetti più alti, anche prima."
        />
        <Reason
          delay={0.9}
          figure={
            <span className="text-rose">
              <AnimatedNumber from={MODEL.phase1.owner} to={MODEL.phase2.owner} suffix="%" delay={1.2} duration={1.8} />
            </span>
          }
          title="Da lì in poi, tuo"
          text="Recuperato il setup, il 60% di ogni prenotazione resta a te per tutta la collaborazione."
        />
      </div>

      <Reveal delay={1.8} className="mt-10 flex items-center gap-8 border-t border-ink/12 pt-8">
        <motion.span
          className="block h-[2px] shrink-0 bg-rose"
          initial={{ width: 0 }}
          animate={{ width: 64 }}
          transition={{ duration: 0.9, delay: ENTER + 1.9, ease: EASE }}
        />
        <p className="text-[26px] leading-snug text-ink/80">
          <span className="font-serif text-[34px] italic text-ink">Il rischio iniziale è nostro.</span>{' '}
          Se le prenotazioni tardano, siamo noi i primi a non rientrare: per questo abbiamo tutto l’interesse a riempire la camera.
        </p>
      </Reveal>
    </Slide>
  )
}
