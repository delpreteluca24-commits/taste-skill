import { motion } from 'framer-motion'
import { IMG } from '../assets/images'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { PackageCard } from '../components/PackageCard'
import { Eyebrow, MaskLines } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

export function S04Packages() {
  return (
    <Slide theme="dark" padded={false}>
      <motion.img
        src={IMG.prosecco}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0, scale: 1.08 }}
        animate={{ opacity: 0.22, scale: 1 }}
        transition={{ duration: 2.2, ease: EASE }}
        style={{ filter: 'blur(6px) saturate(.9)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/80 to-ink" />

      <div className="absolute inset-0 px-[128px] pb-[132px] pt-[120px]">
        <div className="flex items-end justify-between">
          <div>
            <Eyebrow>Pacchetti</Eyebrow>
            <MaskLines className="mt-7" delay={0.1} lineClassName="font-serif text-[88px] leading-none" lines={['I nostri pacchetti']} />
          </div>
        </div>

        <div className="mt-[52px] grid grid-cols-3 items-stretch gap-8">
          <PackageCard
            name="Escape"
            price={70}
            delay={0.35}
            features={['Camera privata', 'Idromassaggio', 'Atmosfera romantica']}
          />
          <PackageCard
            name="Love Escape"
            price={89}
            delay={0.5}
            featured
            badge="Più scelto"
            features={['Camera privata', 'Idromassaggio', 'Welcome drink', 'Cioccolatini', 'Romantic surprise']}
          />
          <PackageCard
            name="Love Escape Premium"
            price={119}
            delay={0.65}
            features={['Tutto il pacchetto Love Escape', 'Decorazione romantica', 'Aperitivo', 'Extra personalizzati']}
          />
        </div>

        <motion.div
          className="mt-9 flex items-center gap-10 border-y border-white/10 py-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: ENTER + 1.6, ease: EASE }}
        >
          <span className="label !text-[14px] text-blush">Prima esperienza</span>
          <AnimatedNumber to={59} prefix="€" delay={1.7} duration={1.4} className="font-serif text-[60px] leading-none text-cream" />
          <span className="h-8 w-px bg-white/15" />
          <span className="text-[22px] text-cream/65">Solo per nuovi clienti e date selezionate.</span>
        </motion.div>
      </div>
    </Slide>
  )
}
