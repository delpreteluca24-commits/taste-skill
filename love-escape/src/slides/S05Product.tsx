import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { IMG } from '../assets/images'
import { EASE, ENTER } from '../lib/motion'
import { useParallax } from '../lib/parallax'

const FRAMES = [
  { src: IMG.room, alt: 'Camera con petali di rosa' },
  { src: IMG.jacuzzi, alt: 'Idromassaggio a lume di candela' },
  { src: IMG.prosecco, alt: 'Welcome drink e cioccolatini' },
  { src: IMG.toast, alt: 'Brindisi di coppia' },
]
const TAGS = ['Camera', 'Idromassaggio', 'Petali', 'Candele', 'Welcome drink']

// Fasi testo: 0 = "Non vendiamo una camera." · 1 = "Vendiamo un’esperienza." · 2 = riga finale.
export function S05Product() {
  const [frame, setFrame] = useState(0)
  const [step, setStep] = useState(0)
  const p = useParallax(16)

  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 3400)
    const t1 = window.setTimeout(() => setStep(1), (ENTER + 2.2) * 1000)
    const t2 = window.setTimeout(() => setStep(2), (ENTER + 3.9) * 1000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink text-cream">
      <motion.div className="absolute -inset-8" style={{ x: p.x, y: p.y }}>
        <AnimatePresence initial={false}>
          <motion.img
            key={frame}
            src={FRAMES[frame].src}
            alt={FRAMES[frame].alt}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1.02, filter: 'blur(0px)' }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 1.6 }, scale: { duration: 5, ease: 'linear' }, filter: { duration: 1.4 } }}
          />
        </AnimatePresence>
      </motion.div>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(13,13,13,.62) 0%, rgba(13,13,13,.78) 55%, rgba(13,13,13,.94) 100%)' }}
      />

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="absolute font-serif"
          initial={{ opacity: 0, filter: 'blur(16px)', y: 0, scale: 1 }}
          animate={
            step === 0
              ? { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 }
              : { opacity: 0.5, filter: 'blur(0px)', y: -190, scale: 0.42 }
          }
          transition={{ duration: step === 0 ? 1.4 : 1.3, delay: step === 0 ? ENTER + 0.3 : 0, ease: EASE }}
        >
          <span className="block whitespace-nowrap text-[110px] leading-none">Non vendiamo una camera.</span>
        </motion.div>

        <AnimatePresence>
          {step >= 1 && (
            <motion.div
              className="absolute text-center font-serif"
              initial={{ opacity: 0, filter: 'blur(18px)', letterSpacing: '0.08em' }}
              animate={{ opacity: 1, filter: 'blur(0px)', letterSpacing: '-0.01em' }}
              transition={{ duration: 1.6, ease: EASE }}
            >
              <span className="block whitespace-nowrap text-[128px] italic leading-none text-white">
                Vendiamo un’<span className="text-blush">esperienza.</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {step >= 2 && (
            <motion.p
              className="absolute top-[640px] text-center text-[30px] tracking-[0.04em] text-cream/80"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: EASE }}
            >
              Una notte che le persone vogliono ricordare.
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-[132px] left-0 right-0 flex justify-center gap-10">
        {TAGS.map((t, i) => (
          <motion.span
            key={t}
            className="label flex items-center gap-10 !text-[13px] text-cream/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: ENTER + 4.4 + i * 0.12 }}
          >
            {i > 0 && <span className="h-[4px] w-[4px] rounded-full bg-rose" />}
            {t}
          </motion.span>
        ))}
      </div>
    </div>
  )
}
