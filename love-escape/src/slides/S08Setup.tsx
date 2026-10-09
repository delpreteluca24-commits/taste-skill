import { PriceCard, PriceRow } from '../components/PriceCard'
import { Eyebrow, MaskLines } from '../components/Reveal'
import { Slide } from '../components/Slide'

export const SETUP_ITEMS = [
  { name: 'Sito web / Landing', price: 300 },
  { name: 'Shooting fotografico + video', price: 200 },
  { name: 'Branding + creatività', price: 100 },
  { name: 'Tracking + automazioni', price: 100 },
  { name: 'Strategia + lancio', price: 150 },
]
export const SETUP_TOTAL = SETUP_ITEMS.reduce((s, i) => s + i.price, 0) // 850

export function S08Setup() {
  return (
    <Slide theme="light">
      <div className="flex h-full gap-[100px]">
        <div className="flex w-[860px] shrink-0 flex-col">
          <Eyebrow tone="light">Setup iniziale</Eyebrow>
          <MaskLines
            className="mt-9"
            delay={0.1}
            lineClassName="font-serif text-[84px] leading-[1.02]"
            lines={['Cosa costruiamo per', <span className="italic text-rose">lanciare il progetto.</span>]}
          />
          <div className="mt-auto">
            {SETUP_ITEMS.map((it, i) => (
              <PriceRow key={it.name} name={it.name} price={it.price} delay={0.7 + i * 0.28} />
            ))}
          </div>
        </div>
        <div className="flex-1">
          <PriceCard
            label="Setup iniziale"
            total={SETUP_TOTAL}
            delay={2.1}
            caption="Valore complessivo del lavoro necessario per costruire il sistema."
            note="Viene recuperato attraverso le prenotazioni della Fase 1."
            parts={SETUP_ITEMS.map((i) => ({ name: i.name, value: i.price }))}
          />
        </div>
      </div>
    </Slide>
  )
}
