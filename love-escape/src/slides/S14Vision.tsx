import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { IMG } from '../assets/images'
import { HeroSlide } from '../components/HeroSlide'
import { EASE, ENTER } from '../lib/motion'

export function S14Vision() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t1 = window.setTimeout(() => setStep(1), (ENTER + 3.2) * 1000)
    const t2 = window.setTimeout(() => setStep(2), (ENTER + 5.6) * 1000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return (
    <HeroSlide
      src={IMG.coupleWindow}
      alt="Coppia abbracciata davanti alla finestra al tramonto"
      overlay="radial-gradient(ellipse at center, rgba(13,13,13,.55) 0%, rgba(13,13,13,.7) 50%, rgba(13,13,13,.92) 100%)"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <AnimatePresence mode="wait">
          {step === 0 ? (
            <motion.h2
              key="a"
              className="font-serif text-[120px] leading-[1.02] text-white"
              initial={{ opacity: 0, filter: 'blur(16px)', y: 20 }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              exit={{ opacity: 0, filter: 'blur(14px)', y: -20 }}
              transition={{ duration: 1.3, delay: step === 0 ? ENTER + 0.5 : 0, ease: EASE }}
            >
              Non vogliamo riempire
              <br />
              una camera.
            </motion.h2>
          ) : (
            <motion.h2
              key="b"
              className="font-serif text-[104px] leading-[1.05] text-white"
              initial={{ opacity: 0, filter: 'blur(16px)', y: 20 }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              transition={{ duration: 1.4, ease: EASE }}
            >
              Vogliamo costruire
              <br />
              <span className="italic text-blush">un’esperienza</span> che le persone
              <br />
              scelgono.
            </motion.h2>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {step === 2 && (
            <motion.div
              className="mt-16 flex flex-col items-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: EASE }}
            >
              <motion.span
                className="mb-8 block h-px bg-rose"
                initial={{ width: 0 }}
                animate={{ width: 80 }}
                transition={{ duration: 1, ease: EASE }}
              />
              <span className="font-serif text-[46px] uppercase tracking-[0.3em] text-white">Love Escape</span>
              <span className="label mt-3 !text-[14px] !tracking-[0.6em] text-blush">La Spezia</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </HeroSlide>
  )
}
