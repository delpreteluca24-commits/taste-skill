import { motion } from 'framer-motion'
import { RevenuePhase } from '../components/RevenueModel'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

// Modello economico (non modificare senza aggiornare anche la slide 12):
// Fase 1 → 80% DP System / 20% proprietario, fino al recupero di €850 di setup.
// Fase 2 → 40% DP System / 60% proprietario.
// Base di calcolo: incasso della prenotazione meno i costi vivi documentati degli extra (slide 13).
export const MODEL = {
  phase1: { us: 80, owner: 20 },
  phase2: { us: 40, owner: 60 },
  setup: 850,
}

export function S11Revenue() {
  return (
    <Slide theme="dark">
      <Eyebrow>Modello di guadagno</Eyebrow>
      <MaskLines
        className="mt-8"
        delay={0.1}
        lineClassName="font-serif text-[72px] leading-[1.05]"
        lines={['Una collaborazione semplice, chiara', <span className="italic text-blush">e vantaggiosa per entrambi.</span>]}
      />
      <Reveal delay={0.6} className="mt-5 text-[19px] text-cream/45">
        Percentuali calcolate sull’importo di ogni prenotazione, al netto dei costi vivi degli extra.
      </Reveal>

      <div className="mt-[64px] grid grid-cols-[1fr_160px_1fr] items-start">
        <RevenuePhase
          tag="Fase 1"
          title="Recupero setup"
          us={MODEL.phase1.us}
          owner={MODEL.phase1.owner}
          delay={0.8}
          caption={`Fino al recupero degli €${MODEL.setup} di setup.`}
        />

        <div className="flex h-[300px] items-center justify-center">
          <svg width="120" height="40" viewBox="0 0 120 40" fill="none" className="overflow-visible">
            <motion.path
              d="M4 20 H112 M98 6 L114 20 L98 34"
              stroke="#E9A0A8"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.1, delay: ENTER + 2.2, ease: EASE }}
            />
          </svg>
        </div>

        <RevenuePhase
          tag="Fase 2"
          title="A regime"
          us={MODEL.phase2.us}
          owner={MODEL.phase2.owner}
          fromUs={MODEL.phase1.us}
          fromOwner={MODEL.phase1.owner}
          highlightOwner
          delay={2.6}
          caption="Dopo il recupero del setup."
        />
      </div>
    </Slide>
  )
}
