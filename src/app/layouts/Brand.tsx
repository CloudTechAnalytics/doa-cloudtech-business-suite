import clsx from 'clsx'

/** Rounded navy tile with a white "D". */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('size-8 shrink-0', className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill="#071b33" />
      <path fill="#ffffff" fillRule="evenodd" d="M12 10h8.5c6 0 9.5 3.6 9.5 10s-3.5 10-9.5 10H12V10Zm5 4.6v10.8h3.3c3.1 0 4.7-2 4.7-5.4s-1.6-5.4-4.7-5.4H17Z" />
    </svg>
  )
}

export function BrandLockup({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className={clsx('text-[17px] font-semibold leading-none tracking-tight', light ? 'text-white' : 'text-ink')}>DOA B-Suite</span>
    </div>
  )
}
