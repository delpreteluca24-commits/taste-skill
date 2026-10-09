import { motion } from 'framer-motion'
import { IMG } from '../assets/images'
import { Icon, type IconName } from '../components/Icons'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { EASE, ENTER } from '../lib/motion'

const FLOW: { label: string; icon: IconName }[] = [
  { label: 'Social', icon: 'social' },
  { label: 'Landing page', icon: 'browser' },
  { label: 'Disponibilità', icon: 'calendar' },
  { label: 'Prenotazione', icon: 'heart' },
  { label: 'Pagamento', icon: 'card' },
]

function Laptop() {
  return (
    <div className="w-[760px]">
      <div className="rounded-t-[18px] border border-white/15 bg-[#0a0a0a] p-[10px] shadow-[0_60px_120px_-40px_rgba(0,0,0,.9)]">
        <div className="relative h-[430px] overflow-hidden rounded-[8px] bg-ink">
          <img src={IMG.room} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/50 to-transparent" />
          <div className="absolute left-8 right-8 top-6 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.3em] text-cream/80">
            <span>Love Escape</span>
            <span className="flex gap-6 text-cream/50"><span>Esperienza</span><span>Pacchetti</span><span>Contatti</span></span>
          </div>
          <div className="absolute left-8 top-[120px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-blush">La Spezia</div>
            <div className="mt-3 font-serif text-[50px] leading-[0.95] text-white">
              Una notte.<br /><span className="italic">Solo voi due.</span>
            </div>
            <div className="mt-6 inline-block rounded-full bg-rose px-5 py-[9px] text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
              Verifica disponibilità
            </div>
          </div>
          <div className="absolute bottom-6 left-8 right-8 flex items-center gap-6 rounded-[12px] border border-white/15 bg-ink/60 px-6 py-4 text-cream backdrop-blur-md">
            <div><div className="text-[9px] uppercase tracking-[0.25em] text-cream/50">Check-in</div><div className="text-[14px]">Sab 13 feb</div></div>
            <div className="h-6 w-px bg-white/15" />
            <div><div className="text-[9px] uppercase tracking-[0.25em] text-cream/50">Check-out</div><div className="text-[14px]">Dom 14 feb</div></div>
            <div className="h-6 w-px bg-white/15" />
            <div><div className="text-[9px] uppercase tracking-[0.25em] text-cream/50">Pacchetto</div><div className="text-[14px]">Love Escape · €89</div></div>
            <div className="ml-auto rounded-full bg-cream px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink">Prenota</div>
          </div>
        </div>
      </div>
      <div className="mx-auto h-[14px] w-[840px] -translate-x-[40px] rounded-b-[14px] bg-gradient-to-b from-[#2a2a2a] to-[#111]" />
    </div>
  )
}

function Phone() {
  const days = Array.from({ length: 28 }, (_, i) => i + 1)
  return (
    <div className="w-[224px] rounded-[36px] border border-white/20 bg-[#0a0a0a] p-[8px] shadow-[0_50px_100px_-30px_rgba(0,0,0,.95)]">
      <div className="relative h-[452px] overflow-hidden rounded-[29px] bg-coal">
        <div className="absolute left-1/2 top-2 z-10 h-[18px] w-[70px] -translate-x-1/2 rounded-full bg-black" />
        <div className="relative h-[170px]">
          <img src={IMG.jacuzzi} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-coal to-transparent" />
          <div className="absolute bottom-3 left-4 font-serif text-[22px] leading-none text-white">Love Escape</div>
        </div>
        <div className="px-4">
          <div className="text-[8px] font-semibold uppercase tracking-[0.25em] text-cream/50">Febbraio</div>
          <div className="mt-2 grid grid-cols-7 gap-[5px] text-center text-[9px] text-cream/70">
            {days.map((d) => (
              <span
                key={d}
                className={`rounded-full py-[3px] ${d === 13 ? 'bg-rose text-white' : d === 14 ? 'bg-rose/40 text-white' : ''}`}
              >
                {d}
              </span>
            ))}
          </div>
          <div className="mt-4 rounded-[10px] border border-white/10 p-3">
            <div className="flex justify-between text-[10px] text-cream/60"><span>Love Escape</span><span>1 notte</span></div>
            <div className="mt-1 font-serif text-[24px] text-white">€89</div>
          </div>
          <div className="mt-3 rounded-full bg-rose py-[9px] text-center text-[9px] font-semibold uppercase tracking-[0.2em] text-white">
            Prenota e paga
          </div>
        </div>
      </div>
    </div>
  )
}

export function S06Direct() {
  return (
    <Slide theme="coal">
      <div className="flex h-full">
        <div className="flex w-[640px] shrink-0 flex-col">
          <Eyebrow>Prenotazioni dirette</Eyebrow>
          <MaskLines
            className="mt-9"
            delay={0.1}
            lineClassName="font-serif text-[88px] leading-[1.02]"
            lines={['Il cliente', 'prenota', <span className="italic text-blush">direttamente.</span>]}
          />

          <Reveal delay={1.9} className="mt-auto">
            <div className="flex items-baseline gap-5">
              <span className="font-serif text-[118px] leading-[0.8] text-white">Zero</span>
              <span className="text-[22px] font-semibold uppercase leading-tight tracking-[0.16em] text-blush">
                Commissioni<br />OTA
              </span>
            </div>
            <p className="mt-6 max-w-[540px] text-[23px] leading-[1.45] text-cream/75">
              Nessuna commissione Airbnb o Booking sulle prenotazioni effettuate direttamente dal sito.
            </p>
            <p className="mt-4 text-[16px] leading-snug text-cream/40">
              Le eventuali commissioni del metodo di pagamento sono separate.
            </p>
          </Reveal>
        </div>

        <div className="relative flex-1">
          <motion.div
            className="absolute left-0 top-0"
            initial={{ opacity: 0, y: 60, rotateX: 8 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 1.3, delay: ENTER + 0.3, ease: EASE }}
            style={{ transformPerspective: 1600 }}
          >
            <Laptop />
          </motion.div>
          <motion.div
            className="absolute right-0 top-[150px]"
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.3, delay: ENTER + 0.65, ease: EASE }}
          >
            <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 2 }}>
              <Phone />
            </motion.div>
          </motion.div>

          {/* Flusso */}
          <div className="absolute bottom-0 left-0 right-0">
            <div className="relative flex justify-between">
              <motion.div
                className="absolute left-[75px] right-[75px] top-[30px] h-px origin-left bg-gradient-to-r from-blush/70 to-rose"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 2, delay: ENTER + 1.0, ease: EASE }}
              />
              {FLOW.map((f, i) => (
                <motion.div
                  key={f.label}
                  className="relative flex w-[150px] flex-col items-center"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: ENTER + 1.0 + i * 0.32, ease: EASE }}
                >
                  <span
                    className={`flex h-[60px] w-[60px] items-center justify-center rounded-full border ${
                      i === FLOW.length - 1 ? 'border-rose bg-rose text-white' : 'border-white/20 bg-coal text-blush'
                    }`}
                  >
                    <Icon name={f.icon} size={24} delay={1.0 + i * 0.32} />
                  </span>
                  <span className="mt-4 whitespace-nowrap text-[15px] font-semibold uppercase tracking-[0.16em] text-cream/80">{f.label}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Slide>
  )
}
