import clsx from 'clsx'

/**
 * The DOA wordmark: three round letters, "d" and "a" in deep teal and the "o" in amber. Each letter is a ring (a circle drawn with a thick
 * stroke) and, for "d" and "a", a straight stem, so the loading screen can animate them one at a time.
 */
export const LOGO_TEAL = '#0b4f5c'
export const LOGO_AMBER = '#f5a800'
const W = 9 // stroke width
const R = 12.5 // ring radius to the middle of the stroke

export function LogoLetters({ className, teal = LOGO_TEAL, amber = LOGO_AMBER }: { className?: { d?: string; o?: string; a?: string }; teal?: string; amber?: string }) {
  return (
    <>
      <g className={className?.d} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle cx="17" cy="29" r={R} fill="none" stroke={teal} strokeWidth={W} />
        <rect x="25" y="1" width={W} height="45" fill={teal} />
      </g>
      <g className={className?.o} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle cx="55" cy="29" r={R} fill="none" stroke={amber} strokeWidth={W} />
      </g>
      <g className={className?.a} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle cx="93" cy="29" r={R} fill="none" stroke={teal} strokeWidth={W} />
        <rect x="101" y="12" width={W} height="34" fill={teal} />
      </g>
    </>
  )
}

/** The wordmark on its own. Pass `light` on a dark background, where the teal letters turn white. */
export function Wordmark({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 110 48" role="img" aria-label="DOA" className={clsx('h-6 w-auto shrink-0', className)}>
      <LogoLetters teal={light ? '#ffffff' : LOGO_TEAL} />
    </svg>
  )
}

/** The square icon (browser tab, small spots): the amber "o" on a teal tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('size-8 shrink-0', className)} aria-hidden>
      <rect width="40" height="40" rx="11" fill={LOGO_TEAL} />
      <circle cx="20" cy="20" r="8.5" fill="none" stroke={LOGO_AMBER} strokeWidth="6" />
    </svg>
  )
}

export function BrandLockup({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <div className={clsx('group flex items-center', className)}>
      <Wordmark light={light} className="h-6 transition-transform duration-300 group-hover:scale-105" />
    </div>
  )
}
