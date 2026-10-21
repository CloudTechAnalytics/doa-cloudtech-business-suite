import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Card, EmptyState, Spinner } from '@/shared/components'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
}

/** Consistent table with server-side pagination controls, loading and empty states. */
export function DataTable<T>({ columns, rows, rowKey, loading, total, page, pageSize, onPage, onRowClick, emptyTitle, emptyHint }: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  total: number
  page: number
  pageSize: number
  onPage: (page: number) => void
  onRowClick?: (row: T) => void
  emptyTitle: string
  emptyHint?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (loading && rows.length === 0) return <Spinner />
  if (!loading && total === 0) return <EmptyState title={emptyTitle} description={emptyHint} />
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs font-semibold text-ink/70">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={clsx('p-3', c.align === 'right' && 'text-right')}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map((r) => (
            <tr key={rowKey(r)} className={clsx(onRowClick && 'cursor-pointer hover:bg-surface')} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => <td key={c.key} className={clsx('p-3', c.align === 'right' && 'text-right tabular')}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-ink/10 p-3 text-xs text-ink/70">
        <span>{total} record{total === 1 ? '' : 's'} · page {page + 1} of {pages}</span>
        <span className="flex gap-1">
          <Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
        </span>
      </div>
    </Card>
  )
}
