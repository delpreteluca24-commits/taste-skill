import { motion } from 'framer-motion'
import { IMG } from '../assets/images'
import { ImageReveal } from '../components/ImageReveal'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

const PILLARS = [
  { name: 'Marketing', hint: 'social e campagne mirate' },
  { name: 'Contenuti', hint: 'foto, video, reel' },
  { name: 'Prenotazioni dirette', hint: 'dal sito, senza OTA' },
  { name: 'Fidelizzazione', hint: 'clienti che ritornano' },
]

export function S02Concept() {
  return (
    <Slide theme="dark" padded={false}>
      <ImageReveal
        src={IMG.jacuzzi}
        alt="Idromassaggio con petali di rosa e candele"
        className="absolute bottom-0 right-0 top-0 w-[780px]"
        from="right"
        delay={0.05}
        overlay="linear-gradient(90deg, rgba(13,13,13,1) 0%, rgba(13,13,13,0) 30%), linear-gradient(0deg, rgba(13,13,13,.5) 0%, rgba(13,13,13,0) 40%)"
      />

      <div className="absolute left-[128px] top-[128px] w-[1000px]">
        <Eyebrow>Il concept</Eyebrow>
        <MaskLines
          className="mt-10"
          delay={0.15}
          lineClassName="font-serif text-[112px] leading-[1] tracking-[-0.01em]"
          lines={['Più prenotazioni.', 'Più visibilità.', <span className="italic text-blush">Più guadagni.</span>]}
        />
        <Reveal delay={0.9} className="mt-10 max-w-[640px] text-[27px] leading-[1.45] text-cream/70">
          Trasformiamo una semplice camera in un’esperienza romantica completa.
        </Reveal>
      </div>

      <div className="absolute bottom-[140px] left-[128px] flex flex-col">
        {PILLARS.map((p, i) => (
          <motion.div
            key={p.name}
            className="flex items-baseline gap-6"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: ENTER + 1.4 + i * 0.35, ease: EASE }}
          >
            <span className="w-[26px] font-serif text-[40px] leading-[1.25] text-rose">{i === 0 ? '' : '+'}</span>
            <span className="text-[24px] font-semibold uppercase tracking-[0.22em] text-cream">{p.name}</span>
            <span className="font-serif text-[26px] italic text-cream/45">{p.hint}</span>
          </motion.div>
        ))}
      </div>
    </Slide>
  )
}
