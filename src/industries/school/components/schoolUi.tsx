import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Card } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { toCsv } from '@/industries/retail/csv'
import { loadStaff, loadStructure, stageOk } from '../services/schoolApi'
import type { SClass, SStudent, STerm, SubjectLevel } from '../services/schoolApi'

/** The school's structure (sessions, terms, classes, subjects, grades) plus what the signed-in person may do. */
export function useSchool() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const structure = useAsync(() => loadStructure(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const s = structure.data
  // A teacher (someone who teaches but cannot see the whole school) works only with the classes and subjects assigned to them.
  const isTeacher = can('school.teach') && !can('school.read')
  const mine = useAsync(() => (isTeacher && businessId ? loadStaff(businessId).catch(() => ({ staff: [], assignments: [] })) : Promise.resolve(null)), [businessId, isTeacher])
  const myAssignments = isTeacher ? (mine.data?.assignments ?? []).filter((a) => (mine.data?.staff ?? []).some((x) => x.id === a.staffId)) : null
  const myClassIds = myAssignments ? new Set(myAssignments.map((a) => a.classId)) : null
  const kind = s?.settings?.schoolType ?? null
  // A secondary school never shows nursery or primary classes or their subjects, and so on for the other kinds.
  const visibleClasses = (s?.classes ?? []).filter((c) => stageOk(kind, c.stage))
  const visibleIds = new Set(visibleClasses.map((c) => c.id))
  // Subjects offered at this kind of school: those taught at its levels, or (for a subject with no level set) those that a visible class takes or that nobody takes yet.
  const allowed = levelsOf(kind)
  const visibleSubjects = (s?.subjects ?? []).filter((sub) => { if (sub.levels.length) return sub.levels.some((l) => allowed.includes(l)); const used = (s?.classSubjects ?? []).filter((cs) => cs.subjectId === sub.id); return !used.length || used.some((cs) => visibleIds.has(cs.classId)) })
  const currentTerm: STerm | null = s?.terms.find((t) => t.current) ?? s?.terms[0] ?? null
  return {
    active, businessId, structure, s, can, currentTerm, kind, visibleClasses, visibleSubjects,
    isTeacher, myAssignments,
    /** Classes to choose from: every active class, or for a teacher only the ones assigned to them. */
    classes: (s?.classes ?? []).filter((c) => c.active && (!myClassIds || myClassIds.has(c.id))),
    /** The subjects a teacher may work on in a class, or null for someone who is not restricted. */
    mySubjectsIn: (classId: string): string[] | null => (myAssignments ? [...new Set(myAssignments.filter((a) => a.classId === classId && a.subjectId).map((a) => a.subjectId!))] : null),
    className: (id: string | null) => s?.classes.find((c) => c.id === id)?.name ?? '–',
    subjectName: (id: string) => s?.subjects.find((x) => x.id === id)?.name ?? 'Subject',
    termName: (id: string) => s?.terms.find((t) => t.id === id)?.name ?? 'Term',
  }
}
export type SchoolCtx = ReturnType<typeof useSchool>

/** The levels of teaching a kind of school has: a secondary school has junior and senior secondary and nothing below. */
export const levelsOf = (kind: string | null): SubjectLevel[] => (kind === 'nursery' ? ['nursery'] : kind === 'primary' ? ['primary'] : kind === 'secondary' ? ['jss', 'sss'] : ['nursery', 'primary', 'jss', 'sss'])
export const LEVEL_NAMES: Record<SubjectLevel, string> = { nursery: 'Nursery', primary: 'Primary', jss: 'Junior secondary', sss: 'Senior secondary' }
/** Which level of teaching a class is at. Senior secondary starts at level 12 (SS 1). */
export const classLevel = (c: Pick<SClass, 'stage' | 'levelOrder'>): SubjectLevel => (c.stage === 'nursery' ? 'nursery' : c.stage === 'primary' ? 'primary' : c.levelOrder <= 11 ? 'jss' : 'sss')

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
