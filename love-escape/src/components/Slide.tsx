import type { ReactNode } from 'react'

export type SlideTheme = 'dark' | 'coal' | 'light' | 'photo'

const BG: Record<SlideTheme, string> = {
  dark: 'bg-ink text-cream',
  coal: 'bg-coal text-cream',
  light: 'bg-cream text-ink',
  photo: 'bg-ink text-cream',
}

/** Contenitore standard 1920×1080 con margini di sicurezza per il chrome. */
export function Slide({ theme = 'dark', children, className = '', padded = true }: {
  theme?: SlideTheme
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={`absolute inset-0 overflow-hidden ${BG[theme]} ${className}`}>
      {padded ? <div className="absolute inset-0 px-[128px] pb-[132px] pt-[128px]">{children}</div> : children}
    </div>
  )
}
