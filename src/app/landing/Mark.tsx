import type { ReactNode } from 'react'

/** A keyword highlighted in the brand amber, like "one platform" in the hero. Inside a Reveal it draws in as the section appears. */
export function Mark({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`relative whitespace-nowrap ${className}`}>
      <span aria-hidden className="mark-scroll absolute -inset-x-1.5 inset-y-0.5 -z-0 -rotate-1 rounded-lg bg-amber" />
      <span className="relative">{children}</span>
    </span>
  )
}
