import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../lib/motion'
import { ProgressBar } from './ProgressBar'

type Props = {
  index: number
  total: number
  title: string
  tone: 'dark' | 'light'
  minimal: boolean
  idle: boolean
  hidden: boolean
  showHint: boolean
  soundOn: boolean
  isFullscreen: boolean
  onGo: (i: number) => void
  onToggleSound: () => void
  onToggleFullscreen: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Interfaccia della presentazione: contatore, indicatori, progress, audio e fullscreen. */
export function Chrome(p: Props) {
  const ink = p.tone === 'light'
  const text = ink ? 'text-ink' : 'text-cream'
  const muted = ink ? 'text-ink/55' : 'text-cream/55'
  const line = ink ? 'bg-ink/20' : 'bg-cream/25'
  const fade = { transition: 'color .8s ease, opacity .8s ease' }

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-50"
      animate={{ opacity: p.hidden ? 0 : 1 }}
      transition={{ duration: 0.6 }}
    >
      <ProgressBar value={(p.index + 1) / p.total} />

      {/* Marchio in alto */}
      <motion.div
        className={`absolute left-16 right-16 top-[50px] flex items-center justify-between ${text}`}
        style={fade}
        animate={{ opacity: p.minimal ? 0 : 1, y: p.minimal ? -8 : 0 }}
        transition={{ duration: 0.8, ease: EASE }}
      >
        <div className="label flex items-center gap-3 !text-[13px]">
          <span>Love Escape</span>
          <span className="h-[5px] w-[5px] rounded-full bg-rose shadow-[0_0_10px_rgba(233,160,168,.9)]" />
          <span className={muted} style={fade}>La Spezia</span>
        </div>
        <div className={`label !text-[13px] ${muted}`} style={fade}>
          Proposta di collaborazione · DP System
        </div>
      </motion.div>

      {/* Contatore 01 / 15 con linea verticale */}
      <div className={`absolute bottom-[46px] left-16 flex items-end gap-5 ${text}`} style={fade}>
        <div className="flex items-baseline gap-2 font-serif">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={p.index}
              className="tnum text-[34px] leading-none"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              {pad(p.index + 1)}
            </motion.span>
          </AnimatePresence>
          <span className={`tnum text-[18px] ${muted}`} style={fade}>/ {pad(p.total)}</span>
        </div>
        <span className={`mb-[3px] h-[30px] w-px ${line}`} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={p.title}
            className={`label mb-[4px] !text-[12px] ${muted}`}
            style={fade}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.4 }}
          >
            {p.title}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Indicatori slide */}
      <motion.div
        className="pointer-events-auto absolute bottom-[52px] left-1/2 flex -translate-x-1/2 items-center gap-[7px]"
        animate={{ opacity: p.idle ? 0 : 1 }}
        transition={{ duration: 0.8 }}
      >
        {Array.from({ length: p.total }, (_, i) => (
          <button
            key={i}
            aria-label={`Vai alla slide ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); p.onGo(i) }}
            className="group flex h-6 items-center"
          >
            <motion.span
              className="block h-[2px] rounded-full"
              animate={{
                width: i === p.index ? 34 : 12,
                backgroundColor: i === p.index ? '#E9A0A8' : ink ? 'rgba(13,13,13,.22)' : 'rgba(245,239,232,.28)',
              }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </button>
        ))}
      </motion.div>

      <AnimatePresence>
        {p.showHint && (
          <motion.div
            className={`label absolute right-16 top-[50px] whitespace-nowrap !text-[12px] ${muted}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, delay: 2.6 }}
          >
            ← → per navigare &nbsp;·&nbsp; F schermo intero
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controlli */}
      <motion.div
        className={`pointer-events-auto absolute bottom-[44px] right-16 flex items-center gap-7 ${text}`}
        style={fade}
        animate={{ opacity: p.idle ? 0 : 1 }}
        transition={{ duration: 0.8 }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); p.onToggleSound() }}
          className="label flex items-center gap-3 !text-[12px] opacity-70 transition-opacity hover:opacity-100"
          aria-pressed={p.soundOn}
        >
          <span className="flex h-3 items-end gap-[2px]">
            {[0, 1, 2, 3].map((b) => (
              <motion.span
                key={b}
                className="block w-[2px] rounded-full bg-current"
                animate={p.soundOn ? { height: [4, 12, 6, 10, 4] } : { height: 3 }}
                transition={p.soundOn ? { duration: 1.4 + b * 0.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
              />
            ))}
          </span>
          Sound {p.soundOn ? 'on' : 'off'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); p.onToggleFullscreen() }}
          className="label flex items-center gap-3 !text-[12px] opacity-70 transition-opacity hover:opacity-100"
          aria-label="Schermo intero (F)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            {p.isFullscreen ? (
              <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" />
            ) : (
              <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" />
            )}
          </svg>
          {p.isFullscreen ? 'Esc' : 'F'}
        </button>
      </motion.div>
    </motion.div>
  )
}
