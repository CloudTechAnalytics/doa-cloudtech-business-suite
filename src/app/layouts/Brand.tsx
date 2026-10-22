import clsx from 'clsx'

/**
 * The DOA mark: a "D" cut into two interlocking blocks, a white stem and an amber bowl, on a navy tile.
 * The pieces are separate paths so the loading screen can slide them together.
 */
export const STEM_PATH = 'M9 9h8v22H9z'
export const BOWL_PATH = 'M19.5 9H22c5.5 0 9 4.4 9 11s-3.5 11-9 11h-2.5v-6.5H22c2 0 3-1.8 3-4.5s-1-4.5-3-4.5h-2.5z'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('size-8 shrink-0', className)} aria-hidden>
      <rect width="40" height="40" rx="11" fill="#071b33" />
      <path fill="#ffffff" d={STEM_PATH} />
      <path fill="#fbb130" d={BOWL_PATH} />
    </svg>
  )
}

export function BrandLockup({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <div className={clsx('group flex items-center gap-2.5', className)}>
      <BrandMark className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
      <span className={clsx('text-[19px] font-extrabold leading-none tracking-tight', light ? 'text-white' : 'text-ink')}>DOA</span>
    </div>
  )
}
