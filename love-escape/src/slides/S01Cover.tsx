import { motion } from 'framer-motion'
import { IMG } from '../assets/images'
import { HeroSlide } from '../components/HeroSlide'
import { Icon, type IconName } from '../components/Icons'
import { MaskLines, Reveal } from '../components/Reveal'
import { EASE, ENTER } from '../lib/motion'

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: 'pin', label: 'Centro La Spezia' },
  { icon: 'heart', label: 'Esperienza romantica' },
  { icon: 'tag', label: 'Prezzo accessibile' },
  { icon: 'rings', label: 'Ideale per coppie' },
]

// Sequenza: fotografia → titolo → "La Spezia" → payoff → icone.
export function S01Cover() {
  return (
    <HeroSlide
      src={IMG.room}
      alt="Camera romantica con petali di rosa e luce di candela"
      position="center 60%"
      overlay="linear-gradient(90deg, rgba(13,13,13,.88) 0%, rgba(13,13,13,.55) 40%, rgba(13,13,13,.1) 75%), linear-gradient(0deg, rgba(13,13,13,.9) 0%, rgba(13,13,13,0) 50%), linear-gradient(180deg, rgba(13,13,13,.5) 0%, rgba(13,13,13,0) 25%)"
    >
      <div className="absolute left-[128px] top-[110px]">
        <Reveal delay={2.4} y={10}>
          <div className="label flex items-center gap-4 !text-[14px] text-cream/70">
            <span className="h-[5px] w-[5px] rounded-full bg-rose shadow-[0_0_12px_rgba(233,160,168,.9)]" />
            Proposta di collaborazione
          </div>
        </Reveal>
      </div>

      <div className="absolute bottom-[300px] left-[120px]">
        <MaskLines
          lines={['Love Escape']}
          delay={0.7}
          lineClassName="font-serif text-[176px] uppercase leading-[0.9] tracking-[0.04em] text-white"
        />
        <Reveal delay={1.5} blur y={16} className="ml-2 mt-4">
          <span className="font-serif text-[80px] italic leading-none text-blush">La Spezia</span>
        </Reveal>
        <Reveal delay={2.1} y={16} className="ml-2 mt-10">
          <span className="font-serif text-[40px] italic text-cream/90">“Una notte. Solo voi due.”</span>
        </Reveal>
      </div>

      <div className="absolute bottom-[130px] left-[128px] right-[128px] flex items-center gap-14">
        <motion.span
          className="h-px bg-white/25"
          initial={{ width: 0 }}
          animate={{ width: 90 }}
          transition={{ duration: 1, delay: ENTER + 2.6, ease: EASE }}
        />
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.label}
            className="flex items-center gap-4 text-cream/85"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: ENTER + 2.7 + i * 0.12, ease: EASE }}
          >
            <Icon name={f.icon} size={26} className="text-blush" delay={2.7 + i * 0.12} />
            <span className="text-[19px] font-medium tracking-[0.06em]">{f.label}</span>
          </motion.div>
        ))}
      </div>
    </HeroSlide>
  )
}
