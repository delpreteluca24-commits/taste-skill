import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { EASE } from '../lib/motion'
import { useParallax } from '../lib/parallax'

type Props = {
  src: string
  alt: string
  overlay?: string
  children?: ReactNode
  position?: string
  dim?: number
}

/** Slide a tutto schermo con fotografia: blur→nitido, scale 1.08→1, parallax leggero. */
export function HeroSlide({ src, alt, overlay, children, position = 'center', dim = 0 }: Props) {
  const p = useParallax(14)
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink">
      <motion.div className="absolute -inset-8" style={{ x: p.x, y: p.y }}>
        <motion.img
          src={src}
          alt={alt}
          draggable={false}
          className="kenburns h-full w-full object-cover"
          style={{ objectPosition: position }}
          initial={{ opacity: 0, scale: 1.08, filter: 'blur(14px)' }}
          animate={{ opacity: 1 - dim, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.6, ease: EASE }}
        />
      </motion.div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            overlay ??
            'linear-gradient(90deg, rgba(13,13,13,.86) 0%, rgba(13,13,13,.45) 45%, rgba(13,13,13,.05) 75%), linear-gradient(0deg, rgba(13,13,13,.85) 0%, rgba(13,13,13,0) 45%)',
        }}
      />
      <div className="relative h-full w-full">{children}</div>
    </div>
  )
}
