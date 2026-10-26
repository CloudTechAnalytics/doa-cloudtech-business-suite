import { useState } from 'react'

/** A person's picture, or their initials when they have none (or the picture cannot be loaded). Round, with a fixed size set by the caller. */
export function Avatar({ url, initials, className = 'size-8 text-xs' }: { url?: string | null; initials: string; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null)
  return url && broken !== url
    ? <img src={url} alt="" onError={() => setBroken(url)} className={`shrink-0 rounded-full object-cover ${className}`} />
    : <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-brand font-bold text-white ${className}`}>{initials}</span>
}
