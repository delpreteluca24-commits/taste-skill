import type { ComponentType } from 'react'
import type { TransitionKind } from '../components/SlideTransition'
import { S01Cover } from './S01Cover'
import { S02Concept } from './S02Concept'
import { S03Market } from './S03Market'
import { S04Packages } from './S04Packages'
import { S05Product } from './S05Product'
import { S06Direct } from './S06Direct'
import { S07System } from './S07System'
import { S08Setup } from './S08Setup'
import { S09Ongoing } from './S09Ongoing'
import { S10Loyalty } from './S10Loyalty'
import { S11Revenue } from './S11Revenue'
import { S12Example } from './S12Example'
import { S13Extras } from './S13Extras'
import { S13Results } from './S13Results'
import { S14WhyPhase1 } from './S14WhyPhase1'
import { S14Vision } from './S14Vision'
import { S15NextSteps } from './S15NextSteps'

export type SlideDef = {
  title: string
  Component: ComponentType
  transition: TransitionKind // transizione usata per ENTRARE in questa slide
  tone: 'dark' | 'light' // colore del chrome
  cinematic?: boolean // nasconde il marchio in alto
}

export const SLIDES: SlideDef[] = [
  { title: 'Cover', Component: S01Cover, transition: 'black', tone: 'dark', cinematic: true },
  { title: 'Il concept', Component: S02Concept, transition: 'mask', tone: 'dark' },
  { title: 'Il mercato', Component: S03Market, transition: 'slide', tone: 'light' },
  { title: 'I pacchetti', Component: S04Packages, transition: 'fade', tone: 'dark' },
  { title: 'Il prodotto', Component: S05Product, transition: 'black', tone: 'dark', cinematic: true },
  { title: 'Prenotazioni dirette', Component: S06Direct, transition: 'zoom', tone: 'dark' },
  { title: 'Il sistema', Component: S07System, transition: 'slide', tone: 'dark' },
  { title: 'Setup iniziale', Component: S08Setup, transition: 'mask', tone: 'light' },
  { title: 'Lavoro continuativo', Component: S09Ongoing, transition: 'fade', tone: 'dark' },
  { title: 'Fidelizzazione', Component: S10Loyalty, transition: 'slide', tone: 'light' },
  { title: 'Modello di guadagno', Component: S11Revenue, transition: 'black', tone: 'dark' },
  { title: 'Esempio reale', Component: S12Example, transition: 'mask', tone: 'light' },
  { title: 'Costi degli extra', Component: S13Extras, transition: 'slide', tone: 'dark' },
  { title: 'Perché conviene', Component: S14WhyPhase1, transition: 'fade', tone: 'light' },
  { title: 'Risultati attesi', Component: S13Results, transition: 'zoom', tone: 'dark' },
  { title: 'La visione', Component: S14Vision, transition: 'black', tone: 'dark', cinematic: true },
  { title: 'Prossimi passi', Component: S15NextSteps, transition: 'mask', tone: 'dark' },
]
