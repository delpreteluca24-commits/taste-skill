import { motion } from 'framer-motion'
import { IMG } from '../assets/images'
import type { IconName } from '../components/Icons'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { StatCard } from '../components/StatCard'
import { EASE } from '../lib/motion'

const GOALS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'calendar', title: 'Più prenotazioni', sub: 'anche nei mesi invernali' },
  { icon: 'coins', title: 'Maggiore guadagno', sub: 'per entrambi' },
  { icon: 'loop', title: 'Clienti fidelizzati', sub: 'che scelgono di tornare' },
  { icon: 'chat', title: 'Passaparola', sub: 'che porta nuove coppie' },
  { icon: 'star', title: 'Posizionamento unico', sub: 'a La Spezia' },
  { icon: 'wave', title: 'Occupazione più costante', sub: 'durante l’anno' },
]

export function S13Results() {
  return (
    <Slide theme="dark" padded={false}>
      <motion.img
        src={IMG.gulfNight}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0, scale: 1.06 }}
        animate={{ opacity: 0.3, scale: 1 }}
        transition={{ duration: 2.4, ease: EASE }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/85 to-ink" />

      <div className="absolute inset-0 px-[128px] pb-[132px] pt-[128px]">
        <div className="flex items-end justify-between">
          <div>
            <Eyebrow>Risultati attesi</Eyebrow>
            <MaskLines className="mt-8" delay={0.1} lineClassName="font-serif text-[88px] leading-none" lines={['Cosa vogliamo ottenere.']} />
          </div>
          <Reveal delay={2.2} className="mb-2 max-w-[440px] text-right text-[18px] leading-snug text-cream/50">
            Obiettivi condivisi, non risultati garantiti.
            <br />
            Li misuriamo insieme, mese dopo mese.
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-3 gap-6">
          {GOALS.map((g, i) => (
            <StatCard key={g.title} icon={g.icon} title={g.title} sub={g.sub} delay={0.5 + i * 0.12} />
          ))}
        </div>
      </div>
    </Slide>
  )
}
