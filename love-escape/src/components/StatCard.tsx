import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'
import { Icon, type IconName } from './Icons'

/** Card obiettivo: icona animata + titolo + riga di contesto. Nessun numero inventato. */
export function StatCard({ icon, title, sub, delay = 0 }: { icon: IconName; title: string; sub: string; delay?: number }) {
  return (
    <motion.div
      className="group relative flex min-h-[300px] flex-col justify-between rounded-[20px] border border-white/10 bg-white/[0.03] p-10 backdrop-blur-md transition-colors duration-500 hover:border-blush/40"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: ENTER + delay, ease: EASE }}
      whileHover={{ y: -6, transition: { duration: 0.5, ease: EASE } }}
    >
      <div className="flex h-[62px] w-[62px] items-center justify-center rounded-full border border-blush/30 text-blush transition-shadow duration-500 group-hover:shadow-[0_0_30px_rgba(233,160,168,.35)]">
        <Icon name={icon} size={30} delay={delay + 0.3} />
      </div>
      <div className="mt-10">
        <div className="text-[23px] font-semibold uppercase leading-snug tracking-[0.12em] text-cream">{title}</div>
        <div className="mt-2 font-serif text-[30px] italic leading-tight text-cream/60">{sub}</div>
      </div>
    </motion.div>
  )
}
