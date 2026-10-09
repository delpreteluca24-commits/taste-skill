import { motion } from 'framer-motion'
import { EASE, EASE_IN_OUT, ENTER } from '../lib/motion'
import { useParallax } from '../lib/parallax'

type Props = {
  src: string
  alt: string
  className?: string
  delay?: number
  from?: 'left' | 'right' | 'bottom'
  parallax?: number
  overlay?: string
  position?: string
}

/** Fotografia rivelata da una maschera + scale 1.12→1, poi Ken Burns lentissimo. */
export function ImageReveal({ src, alt, className = '', delay = 0, from = 'right', parallax = 10, overlay, position = 'center' }: Props) {
  const p = useParallax(parallax)
  const start =
    from === 'left' ? 'inset(0% 100% 0% 0%)' : from === 'bottom' ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 0% 100%)'
  return (
    <motion.div
      className={`overflow-hidden ${className.includes('absolute') ? '' : 'relative'} ${className}`}
      initial={{ clipPath: start }}
      animate={{ clipPath: 'inset(0% 0% 0% 0%)' }}
      transition={{ duration: 1.3, delay: ENTER + delay, ease: EASE_IN_OUT }}
    >
      <motion.div className="absolute -inset-6" style={{ x: p.x, y: p.y }}>
        <motion.div
          className="h-full w-full"
          initial={{ scale: 1.14 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.2, delay: ENTER + delay, ease: EASE }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            decoding="async"
            className="kenburns h-full w-full object-cover"
            style={{ objectPosition: position }}
          />
        </motion.div>
      </motion.div>
      {overlay && <div className="pointer-events-none absolute inset-0" style={{ background: overlay }} />}
    </motion.div>
  )
}
