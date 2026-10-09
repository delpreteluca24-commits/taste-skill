import { IMG } from '../assets/images'
import { ImageReveal } from '../components/ImageReveal'
import { Eyebrow, MaskLines, Reveal } from '../components/Reveal'
import { Slide } from '../components/Slide'
import { Timeline } from '../components/Timeline'

const STEPS = [
  { title: 'Conferma accordo' },
  { title: 'Creazione sito + contenuti', sub: '1–2 settimane' },
  { title: 'Lancio marketing' },
  { title: 'Prime prenotazioni' },
  { title: 'Analisi risultati' },
  { title: 'Ottimizzazione e crescita' },
]

export function S15NextSteps() {
  return (
    <Slide theme="dark">
      <div className="flex h-[470px] gap-16">
        <div className="flex flex-1 flex-col">
          <Eyebrow>Prossimi passi</Eyebrow>
          <MaskLines className="mt-6" delay={0.1} lineClassName="font-serif text-[150px] leading-[1] tracking-[-0.02em]" lines={['Partiamo.']} />
          <Reveal delay={0.7} className="mt-auto max-w-[560px] text-[25px] leading-[1.45] text-cream/65">
            Il primo passo è semplice: confermiamo l’accordo e iniziamo a costruire.
          </Reveal>
        </div>
        <ImageReveal
          src={IMG.coupleGulf}
          alt="Coppia sul Golfo dei Poeti al tramonto"
          className="w-[820px] rounded-[22px]"
          from="right"
          delay={0.2}
          overlay="linear-gradient(0deg, rgba(13,13,13,.85) 0%, rgba(13,13,13,0) 60%)"
        />
      </div>
      <Reveal delay={2.8} className="pointer-events-none absolute right-[180px] top-[440px] text-right">
        <div className="font-serif text-[60px] leading-[1.02] text-white">
          Una notte.
          <br />
          <span className="italic text-blush">Solo voi due.</span>
        </div>
      </Reveal>

      <div className="mt-[90px]">
        <Timeline steps={STEPS} delay={0.9} />
      </div>
    </Slide>
  )
}
