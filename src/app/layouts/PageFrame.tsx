import type { ReactNode } from 'react'

/** Minimal centred frame for pages shown before a business exists (e.g. first onboarding). */
export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl p-4 sm:p-6">{children}</div>
}
