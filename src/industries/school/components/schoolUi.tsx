import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Card } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { toCsv } from '@/industries/retail/csv'
import { loadStructure, stageOk } from '../services/schoolApi'
import type { SClass, SStudent, STerm } from '../services/schoolApi'

/** The school's structure (sessions, terms, classes, subjects, grades) plus what the signed-in person may do. */
export function useSchool() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const structure = useAsync(() => loadStructure(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const s = structure.data
  const kind = s?.settings?.schoolType ?? null
  // A secondary school never shows nursery or primary classes or their subjects, and so on for the other kinds.
  const visibleClasses = (s?.classes ?? []).filter((c) => stageOk(kind, c.stage))
  const visibleIds = new Set(visibleClasses.map((c) => c.id))
  const visibleSubjects = (s?.subjects ?? []).filter((sub) => { const used = (s?.classSubjects ?? []).filter((cs) => cs.subjectId === sub.id); return !used.length || used.some((cs) => visibleIds.has(cs.classId)) })
  const currentTerm: STerm | null = s?.terms.find((t) => t.current) ?? s?.terms[0] ?? null
  return {
    active, businessId, structure, s, can, currentTerm, kind, visibleClasses, visibleSubjects,
    classes: (s?.classes ?? []).filter((c) => c.active),
    className: (id: string | null) => s?.classes.find((c) => c.id === id)?.name ?? '–',
    subjectName: (id: string) => s?.subjects.find((x) => x.id === id)?.name ?? 'Subject',
    termName: (id: string) => s?.terms.find((t) => t.id === id)?.name ?? 'Term',
  }
}
export type SchoolCtx = ReturnType<typeof useSchool>

export const fullName = (st: Pick<SStudent, 'first' | 'middle' | 'last'>) => `${st.first} ${st.middle ? `${st.middle} ` : ''}${st.last}`
export const classLabel = (classes: SClass[], id: string | null) => classes.find((c) => c.id === id)?.name ?? '–'
export const today = () => new Date().toISOString().slice(0, 10)

export function Stat({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: 'warn' | 'good' | 'bad' }) {
  return (
    <Card className="h-full">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/60">{title}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink/60">{note}</p>}
    </Card>
  )
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href)
}

export function NoSetup({ children }: { children?: React.ReactNode }) {
  return <Card><p className="text-sm text-ink/80">{children ?? 'The school has no classes, terms or grading yet. Open School Settings and use "Start from the standard structure" to set them up, then come back here.'}</p></Card>
}

export const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const
