import { motion } from 'framer-motion'
import { EASE, ENTER } from '../lib/motion'

// Icone a linea sottile, disegnate con animazione del tratto.
const PATHS = {
  pin: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z'],
  tag: ['M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1 1 0 0 1 0 1.4l-8.1 8.1a1 1 0 0 1-1.4 0z', 'M8.5 8.5h.01'],
  rings: ['M9 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M15 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z'],
  check: ['M4.5 12.5l4.5 4.5L19.5 7'],
  calendar: ['M4 6.5h16v13H4z', 'M4 10.5h16', 'M8.5 4v4M15.5 4v4', 'M9 16l2.2-2.2 1.6 1.6L15.5 13'],
  coins: ['M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M14.6 9.2a3 3 0 0 0-5.2 2.8 3 3 0 0 0 5.2 2.8', 'M8.2 11.2h4.4M8.2 13h4.4'],
  loop: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z', 'M9.5 11.5l1.8 1.8 3.4-3.6'],
  chat: ['M4 5.5h11v8H8.5L5.5 16v-2.5H4z', 'M15 9.5h5v7h-1.5V19l-3-2.5H11v-3'],
  star: ['M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z'],
  wave: ['M3 15.5c2.2 0 2.2-3 4.5-3s2.2 3 4.5 3 2.3-3 4.5-3 2.3 3 4.5 3', 'M3 19.5h18', 'M3 4.5v15'],
  social: ['M5 5h14v14H5z', 'M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0', 'M16.5 7.6h.01'],
  browser: ['M3.5 5h17v14h-17z', 'M3.5 8.5h17', 'M6 6.8h.01M8 6.8h.01'],
  card: ['M3.5 6h17v12h-17z', 'M3.5 10h17', 'M7 14.5h4'],
  gift: ['M4 9.5h16v4H4z', 'M5.5 13.5h13V20h-13z', 'M12 9.5V20', 'M12 9.5S10.5 5 8.3 5.6C6.6 6 7.4 9.5 12 9.5zM12 9.5s1.5-4.5 3.7-3.9c1.7.4.9 3.9-3.7 3.9z'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 28,
  delay = 0,
  className = '',
  strokeWidth = 1.2,
  draw = true,
}: {
  name: IconName
  size?: number
  delay?: number
  className?: string
  strokeWidth?: number
  draw?: boolean
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {PATHS[name].map((d, i) => (
        <motion.path
          key={i}
          d={d}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={draw ? { pathLength: 0, opacity: 0 } : false}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.2, delay: ENTER + delay + i * 0.15, ease: EASE }}
        />
      ))}
    </svg>
  )
}
