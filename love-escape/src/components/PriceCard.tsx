import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'
import { AnimatedNumber } from './AnimatedNumber'

/** Riga di listino (servizio + prezzo) che entra singolarmente. */
export function PriceRow({ name, detail, price, delay = 0 }: { name: string; detail?: string; price: number; delay?: number }) {
  return (
    <motion.div
      className="group flex items-end justify-between gap-8 border-b border-ink/12 pb-5 pt-5"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: ENTER + delay, ease: EASE }}
    >
      <div>
        <div className="text-[23px] font-semibold uppercase tracking-[0.12em]">{name}</div>
        {detail && <div className="mt-1 text-[18px] text-ink/50">{detail}</div>}
      </div>
      <div className="font-serif text-[54px] leading-none transition-colors duration-500 group-hover:text-rose">
        €{price}
      </div>
    </motion.div>
  )
}

/** Totale grande in card scura, con barra di composizione proporzionale. */
export function PriceCard({
  label,
  total,
  caption,
  note,
  parts,
  delay = 0,
}: {
  label: string
  total: number
  caption: string
  note?: string
  parts: { name: string; value: number }[]
  delay?: number
}) {
  const shades = ['#C95C70', '#D97585', '#E9A0A8', '#EFBDC3', '#F5D9DC']
  return (
    <motion.div
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-[24px] bg-ink p-14 text-cream shadow-[0_50px_100px_-40px_rgba(13,13,13,.55)]"
      initial={{ opacity: 0, scale: 0.96, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 1.1, delay: ENTER + delay, ease: EASE }}
    >
      <div className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full bg-rose/20 blur-[100px]" />
      <div className="label relative text-blush">{label}</div>
      <div className="relative">
        <AnimatedNumber to={total} prefix="€" delay={delay + 0.5} duration={2} className="block font-serif text-[190px] leading-[0.9] tracking-[-0.02em]" />
        <div className="mt-10 flex h-[6px] w-full gap-[3px] overflow-hidden rounded-full">
          {parts.map((p, i) => (
            <motion.div
              key={p.name}
              className="h-full rounded-full"
              style={{ background: shades[i % shades.length] }}
              initial={{ flexGrow: 0.0001, opacity: 0 }}
              animate={{ flexGrow: p.value, opacity: 1 }}
              transition={{ duration: 1.2, delay: ENTER + delay + 0.6 + i * 0.12, ease: EASE }}
            />
          ))}
        </div>
        <p className="mt-8 max-w-[520px] text-[24px] leading-[1.45] text-cream/75">{caption}</p>
        {note && <p className="mt-4 max-w-[520px] text-[18px] leading-[1.5] text-cream/45">{note}</p>}
      </div>
    </motion.div>
  )
}
