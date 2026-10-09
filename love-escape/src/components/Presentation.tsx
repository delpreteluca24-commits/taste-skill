import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SLIDES } from '../slides'
import { ParallaxProvider } from '../lib/parallax'
import { startAmbient, stopAmbient } from '../lib/sound'
import { Chrome } from './Chrome'
import { slideVariants, type TransitionCustom } from './SlideTransition'

const W = 1920
const H = 1080
const LOCK_MS = 650
const IDLE_MS = 2600

const clamp = (i: number) => Math.max(0, Math.min(SLIDES.length - 1, i))
const fromHash = () => {
  const n = parseInt(window.location.hash.replace('#', ''), 10)
  return Number.isFinite(n) ? clamp(n - 1) : 0
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void }

export function Presentation() {
  const [{ index, dir }, setNav] = useState<{ index: number; dir: 1 | -1 }>(() => ({ index: fromHash(), dir: 1 }))
  const [scale, setScale] = useState(1)
  const [portrait, setPortrait] = useState(false)
  const [idle, setIdle] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const [soundOn, setSoundOn] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const lastNav = useRef(0)
  const idleTimer = useRef<number>()
  const touch = useRef<{ x: number; y: number } | null>(null)

  const go = useCallback((target: number) => {
    const now = performance.now()
    if (now - lastNav.current < LOCK_MS) return
    setNav((cur) => {
      const next = clamp(target)
      if (next === cur.index) return cur
      lastNav.current = now
      return { index: next, dir: next > cur.index ? 1 : -1 }
    })
    setShowHint(false)
  }, [])
  const next = useCallback(() => go(index + 1), [go, index])
  const prev = useCallback(() => go(index - 1), [go, index])

  // Stage 1920×1080 scalato per adattarsi a qualsiasi schermo (letterbox nero).
  useLayoutEffect(() => {
    const fit = () => {
      setScale(Math.min(window.innerWidth / W, window.innerHeight / H))
      setPortrait(window.innerHeight > window.innerWidth)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    try {
      history.replaceState(null, '', `#${index + 1}`)
    } catch {
      /* alcuni contesti (iframe sandbox) non permettono di aggiornare l'URL */
    }
  }, [index])

  const toggleFullscreen = useCallback(() => {
    const d = document as FsDoc
    const el = document.documentElement as FsEl
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        if (d.exitFullscreen) d.exitFullscreen().catch(() => {})
        else d.webkitExitFullscreen?.()
      } else if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {})
      } else {
        el.webkitRequestFullscreen?.()
      }
    } catch {
      /* fullscreen non disponibile (es. iPhone): la presentazione resta usabile */
    }
  }, [])

  useEffect(() => {
    const onFs = () => {
      const d = document as FsDoc
      setIsFs(Boolean(d.fullscreenElement || d.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
    }
  }, [])

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      if (on) stopAmbient()
      else void startAmbient()
      return !on
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          e.preventDefault()
          next()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          e.preventDefault()
          prev()
          break
        case 'Home':
          go(0)
          break
        case 'End':
          go(SLIDES.length - 1)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'h':
        case 'H':
          setHidden((h) => !h)
          break
        case 'm':
        case 'M':
          toggleSound()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, go, toggleFullscreen, toggleSound])

  // Presentation mode: dopo qualche secondo senza movimento il cursore e i controlli spariscono.
  const wake = useCallback(() => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  useEffect(() => {
    wake()
    return () => window.clearTimeout(idleTimer.current)
  }, [wake])

  const slide = SLIDES[index]
  const Comp = slide.Component
  const custom: TransitionCustom = { kind: slide.transition, dir }

  return (
    <MotionConfig reducedMotion="user">
      <ParallaxProvider>
        <div
          className={`fixed inset-0 overflow-hidden bg-ink ${idle ? 'hide-cursor' : ''}`}
          onPointerMove={wake}
          onTouchStart={(e) => {
            const t = e.touches[0]
            touch.current = { x: t.clientX, y: t.clientY }
          }}
          onTouchEnd={(e) => {
            const s = touch.current
            const t = e.changedTouches[0]
            touch.current = null
            if (!s) return
            const dx = t.clientX - s.x
            const dy = t.clientY - s.y
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)()
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 overflow-hidden bg-ink"
            style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center' }}
          >
            <AnimatePresence initial custom={custom}>
              <motion.div
                key={index}
                custom={custom}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="absolute inset-0"
                style={{ willChange: 'transform, opacity' }}
              >
                <Comp />
              </motion.div>
            </AnimatePresence>

            <div className="grain" />

            {/* Click laterali */}
            <button aria-label="Slide precedente" onClick={prev} className="group absolute left-0 top-[120px] z-40 h-[calc(100%-240px)] w-[112px] cursor-w-resize">
              <span className={`absolute left-10 top-1/2 -translate-y-1/2 text-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-60 ${slide.tone === 'light' ? 'text-ink' : 'text-cream'}`}>‹</span>
            </button>
            <button aria-label="Slide successiva" onClick={next} className="group absolute right-0 top-[120px] z-40 h-[calc(100%-240px)] w-[112px] cursor-e-resize">
              <span className={`absolute right-10 top-1/2 -translate-y-1/2 text-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-60 ${slide.tone === 'light' ? 'text-ink' : 'text-cream'}`}>›</span>
            </button>

            <Chrome
              index={index}
              total={SLIDES.length}
              title={slide.title}
              tone={slide.tone}
              minimal={Boolean(slide.cinematic)}
              idle={idle}
              hidden={hidden}
              showHint={showHint && index === 0}
              soundOn={soundOn}
              isFullscreen={isFs}
              onGo={go}
              onToggleSound={toggleSound}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>
          {portrait && (
            <div className="label pointer-events-none absolute bottom-8 left-0 right-0 text-center !text-[11px] text-cream/50">
              Ruota il dispositivo per la visione completa
            </div>
          )}
        </div>
      </ParallaxProvider>
    </MotionConfig>
  )
}
