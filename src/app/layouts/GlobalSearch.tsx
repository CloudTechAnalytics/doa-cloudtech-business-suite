import { ArrowRight, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchRecords } from '@/app/search/recordSearch'
import type { RecordHit } from '@/app/search/recordSearch'
import { searchPages } from '@/app/navigation/crumbs'
import type { PageHit } from '@/app/navigation/crumbs'
import { useDebounced } from '@/shared/hooks/useDebounced'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'

type Row = { key: string; label: string; sub: string; group: string; to: string }

/** With nothing typed yet: the actions people reach for most, then the main pages. */
export function suggestions(pages: PageHit[]): Row[] {
  const row = (p: PageHit, group: string): Row => ({ key: `s:${group}:${p.to}:${p.label}`, label: p.label, sub: p.group === 'Record' ? '' : p.group, group, to: p.to })
  return [
    ...pages.filter((p) => p.group === 'Record').slice(0, 4).map((p) => row(p, 'Create')),
    ...pages.filter((p) => p.group !== 'Record' && p.group !== 'Settings and people' && !p.label.includes(':')).slice(0, 6).map((p) => row(p, 'Go to')),
  ]
}

/**
 * The search in the top bar. Ctrl+K (Cmd+K, or "/") opens it from anywhere. Typing finds pages straight away and, after a short pause, customers, leads, deals,
 * invoices and products from the apps that are on. Arrow keys move, Enter opens, Escape closes.
 */
export function GlobalSearch({ businessId, industry, usable, pages }: { businessId: string; industry: IndustryCode; usable: ReadonlySet<ModuleCode>; pages: PageHit[] }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<{ for: string; rows: RecordHit[] } | null>(null)
  const [at, setAt] = useState(0)
  const nav = useNavigate()
  // The set of apps is rebuilt on every render of the shell; search again only when it really changes.
  const usableKey = [...usable].sort().join(',')
  const usableRef = useRef(usable)
  useEffect(() => { usableRef.current = usable })
  const input = useRef<HTMLInputElement>(null)
  const query = useDebounced(term, 250)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) queueMicrotask(() => input.current?.focus()) }, [open])
  useEffect(() => {
    if (!open || query.trim().length < 2) return
    let live = true
    void searchRecords(businessId, industry, usableRef.current, query).then((rows) => { if (live) setFound({ for: query, rows }) })
    return () => { live = false }
  }, [open, query, businessId, industry, usableKey])

  const typed = term.trim().length > 0
  const rows: Row[] = useMemo(() => {
    if (!typed) return suggestions(pages)
    const pg = searchPages(pages, term).map((p): Row => ({ key: `p:${p.to}:${p.label}`, label: p.label, sub: p.group, group: 'Pages', to: p.to }))
    const rec = found && found.for === query && query.trim().length >= 2 ? found.rows.map((r): Row => ({ key: r.key, label: r.label, sub: r.sub, group: `${r.kind}s`, to: r.to })) : []
    return [...pg, ...rec]
  }, [typed, pages, term, found, query])
  const waiting = term.trim().length >= 2 && (query !== term || found?.for !== query)
  const close = () => { setOpen(false); setTerm(''); setAt(0); setFound(null) }
  const go = (r: Row | undefined) => { if (!r) return; close(); nav(r.to) }

  return (
    <>
      <div className="flex flex-none justify-start sm:min-w-0 sm:flex-1 sm:pr-3">
      <button type="button" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)"
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-sm text-ink/55 transition hover:border-ink/25 hover:text-ink sm:w-full sm:max-w-xl sm:px-3">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate text-left sm:inline">Search</span>
        <kbd className="hidden rounded bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink/50 lg:inline">Ctrl K</kbd>
      </button>
      </div>
      {open && (
        <div className="no-print fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" onClick={close} />
          <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-white shadow-raised">
            <div className="flex items-center gap-3 px-4">
              <Search className="size-5 shrink-0 text-ink/40" aria-hidden />
              <input ref={input} value={term} onChange={(e) => { setTerm(e.target.value); setAt(0) }} placeholder="Search customers, invoices, products, pages…" aria-label="Search" role="combobox" aria-expanded aria-controls="global-search-results" autoComplete="off" spellCheck={false} style={{ outline: "none" }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') close()
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, rows.length - 1)) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)) }
                  else if (e.key === 'Enter') { e.preventDefault(); go(rows[at]) }
                }}
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink/40 focus:outline-none focus-visible:outline-none" />
              {waiting && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Searching" />}
            </div>
            <ul id="global-search-results" role="listbox" className="max-h-[52vh] overflow-y-auto border-t border-line pb-2">
              {rows.map((r, i) => (
                <li key={r.key} role="option" aria-selected={i === at}>
                  {(i === 0 || rows[i - 1].group !== r.group) && <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink/45">{r.group}</p>}
                  <button type="button" onMouseEnter={() => setAt(i)} onClick={() => go(r)} className={`mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${i === at ? 'bg-accent-soft' : ''}`}>
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.label}</span>{r.sub && <span className="ml-2 text-xs text-ink/55">{r.sub}</span>}</span>
                    {i === at && <ArrowRight className="size-4 shrink-0 text-accent" aria-hidden />}
                  </button>
                </li>
              ))}
              {!rows.length && <li className="px-4 py-8 text-center text-sm text-ink/55">{waiting ? 'Searching…' : `Nothing found for “${term.trim()}”.`}</li>}
            </ul>
            <p className="hidden items-center gap-4 border-t border-line bg-surface px-4 py-2 text-[11px] text-ink/50 sm:flex"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></p>
          </div>
        </div>
      )}
    </>
  )
}
