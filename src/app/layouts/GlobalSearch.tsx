import { CornerDownLeft, FileText, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchRecords } from '@/app/search/recordSearch'
import type { RecordHit } from '@/app/search/recordSearch'
import { searchPages } from '@/app/navigation/crumbs'
import type { PageHit } from '@/app/navigation/crumbs'
import { useDebounced } from '@/shared/hooks/useDebounced'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'

type Row = { key: string; label: string; sub: string; tag: string; to: string }

/**
 * The search box in the top bar. Press Ctrl+K (or Cmd+K, or "/") from anywhere. It finds pages and actions straight away and, after a pause in typing, records
 * (customers, leads, deals, invoices, products) from the apps that are on. Arrow keys move, Enter opens, Escape closes.
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

  const pageRows: Row[] = useMemo(() => searchPages(pages, term).map((p) => ({ key: `p:${p.to}:${p.label}`, label: p.label, sub: p.group, tag: 'Page', to: p.to })), [pages, term])
  const recordRows: Row[] = found && found.for === query && query.trim().length >= 2 ? found.rows.map((r) => ({ key: r.key, label: r.label, sub: r.sub, tag: r.kind, to: r.to })) : []
  const rows = [...pageRows, ...recordRows]
  const waiting = term.trim().length >= 2 && (query !== term || found?.for !== query)
  const close = () => { setOpen(false); setTerm(''); setAt(0); setFound(null) }
  const go = (r: Row | undefined) => { if (!r) return; close(); nav(r.to) }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" title="Search pages and records (Ctrl+K)"
        className="flex h-8 items-center gap-2 rounded-full bg-canvas px-2.5 text-sm text-ink/60 hover:bg-line sm:w-48 lg:w-64 sm:px-3">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate text-left sm:inline">Search…</span>
        <kbd className="hidden rounded border border-line bg-white px-1 text-[10px] font-medium text-ink/50 lg:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-raised">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 shrink-0 text-ink/50" aria-hidden />
              <input ref={input} value={term} onChange={(e) => { setTerm(e.target.value); setAt(0) }} placeholder="Search pages, customers, deals, invoices, products…" aria-label="Search" role="combobox" aria-expanded aria-controls="global-search-results"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') close()
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, rows.length - 1)) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)) }
                  else if (e.key === 'Enter') { e.preventDefault(); go(rows[at]) }
                }}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink/50">Esc</kbd>
            </div>
            <ul id="global-search-results" role="listbox" className="max-h-[55vh] overflow-y-auto py-1 text-sm">
              {rows.map((r, i) => (
                <li key={r.key} role="option" aria-selected={i === at}>
                  <button type="button" onMouseEnter={() => setAt(i)} onClick={() => go(r)} className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === at ? 'bg-surface' : ''}`}>
                    <FileText className="size-4 shrink-0 text-ink/40" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.label}</span>{r.sub && <span className="block truncate text-xs text-ink/60">{r.sub}</span>}</span>
                    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink/60">{r.tag}</span>
                    {i === at && <CornerDownLeft className="size-3.5 shrink-0 text-ink/40" aria-hidden />}
                  </button>
                </li>
              ))}
              {!rows.length && <li className="px-3 py-6 text-center text-ink/60">{term.trim().length < 2 ? 'Type at least two letters. Try a customer, an invoice number or a product.' : waiting ? 'Searching…' : 'Nothing found.'}</li>}
              {rows.length > 0 && waiting && <li className="px-3 py-2 text-xs text-ink/50">Looking for records…</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
