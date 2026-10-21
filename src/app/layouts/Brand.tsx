import clsx from 'clsx'

/** Navy tile with a geometric gold "D", in the same family as The Counsel and The Harvest marks. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={clsx('size-9 shrink-0', className)} aria-hidden>
      <rect width="120" height="120" rx="28" fill="#0b2a4a" stroke="#c6a15b" strokeWidth="3" />
      <path
        fill="#c6a15b" fillRule="evenodd"
        d="M 34 30 H 62 C 84 30 94 43 94 60 C 94 77 84 90 62 90 H 34 Z M 50 45 V 75 H 61 C 73 75 78 69 78 60 C 78 51 73 45 61 45 Z"
      />
    </svg>
  )
}

/** Mark plus the serif wordmark. */
export function BrandLockup({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <BrandMark />
      <span className={clsx('font-brand text-[19px] font-semibold leading-none tracking-tight', inverted ? 'text-white' : 'text-navy')}>
        DOA B-Suite
      </span>
    </div>
  )
}
