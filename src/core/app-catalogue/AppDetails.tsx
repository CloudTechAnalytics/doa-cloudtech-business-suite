import { Check, X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components'
import type { StandaloneApp } from './apps'

/**
 * One app's details in a panel beside the list: what it does, why people use it, what it works with and its price. The App Store (inside a workspace) and the public Apps
 * page both use it, so a person sees the same thing before and after signing up; only the footer differs (Install and Remove there, Start with this app here).
 */
export function AppDetailsPanel({ app, badge, footer, onClose }: { app: StandaloneApp; badge?: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="no-print fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${app.name} details`}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-raised">
        <header className="flex items-start gap-3 border-b border-line p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: app.color }}><app.icon className="size-6" aria-hidden /></span>
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-tight">{app.name}</h2><p className="text-sm text-ink/70">{app.tagline}</p>{badge && <div className="mt-1.5">{badge}</div>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink/60 hover:bg-surface"><X className="size-5" aria-hidden /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          <p className="text-ink/80">{app.description}</p>
          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">What you can do</h3>
            <ul className="grid grid-cols-2 gap-2">{app.features.map((f) => <li key={f.label} className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-xs"><f.icon className="size-4 shrink-0 text-ink/60" aria-hidden />{f.label}</li>)}</ul></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">Why people use it</h3>
            <ul className="space-y-1.5">{app.benefits.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{b}</li>)}</ul></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">Works with</h3>
            <ul className="space-y-1.5 text-ink/80">{app.worksWith.map((w) => <li key={w}>{w}</li>)}</ul></section>
          <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/55">Price</h3><p className="text-ink/80">{app.free}</p></section>
        </div>
        <footer className="space-y-2 border-t border-line p-5">
          <div className="flex flex-wrap items-center gap-2">{footer}<Button variant="ghost" className="ml-auto" onClick={onClose}>Close</Button></div>
        </footer>
      </aside>
    </div>
  )
}
