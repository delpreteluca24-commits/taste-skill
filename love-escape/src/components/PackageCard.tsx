import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'
import { AnimatedNumber } from './AnimatedNumber'
import { Icon } from './Icons'

type Props = {
  name: string
  price: number
  features: string[]
  featured?: boolean
  badge?: string
  delay?: number
}

/** Card pacchetto: prezzo con contatore, lista inclusi; la card "featured" è crema con glow rosa. */
export function PackageCard({ name, price, features, featured, badge, delay = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1, delay: ENTER + delay, ease: EASE }}
      whileHover={{ y: -8, transition: { duration: 0.5, ease: EASE } }}
      className={`relative flex flex-col rounded-[22px] px-11 pb-11 pt-10 ${
        featured
          ? 'glow bg-cream text-ink'
          : 'border border-white/[0.12] bg-white/[0.035] text-cream backdrop-blur-md transition-colors duration-500 hover:border-white/25'
      }`}
    >
      {badge && (
        <motion.span
          className="label absolute -top-[15px] left-11 rounded-full bg-rose px-4 py-[7px] !text-[11px] text-white shadow-[0_8px_30px_-6px_rgba(201,92,112,.7)]"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: ENTER + delay + 1.2, ease: EASE }}
        >
          {badge}
        </motion.span>
      )}
      <div className={`label !text-[14px] ${featured ? 'text-rose' : 'text-blush'}`}>{name}</div>
      <div className="mt-6 flex items-baseline gap-3">
        <AnimatedNumber to={price} prefix="€" delay={delay + 0.3} duration={1.8} className="font-serif text-[104px] leading-[0.9]" />
        <span className={`text-[20px] ${featured ? 'text-ink/55' : 'text-cream/50'}`}>/ notte</span>
      </div>
      <div className={`my-7 h-px ${featured ? 'bg-ink/12' : 'bg-white/10'}`} />
      <ul className="flex flex-col gap-[14px]">
        {features.map((f, i) => (
          <motion.li
            key={f}
            className="flex items-center gap-4 text-[21px] leading-tight"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: ENTER + delay + 0.6 + i * 0.1, ease: EASE }}
          >
            <Icon name="check" size={20} strokeWidth={1.6} className={featured ? 'text-rose' : 'text-blush'} delay={delay + 0.6 + i * 0.1} />
            <span className={featured ? 'text-ink/85' : 'text-cream/85'}>{f}</span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}
