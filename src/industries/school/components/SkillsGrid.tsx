import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, Notice, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { fullName } from './schoolUi'
import { loadRatings, loadTraits, saveRatings } from '../services/schoolApi'
import type { SStudent } from '../services/schoolApi'

const SCALE = [['', '–'], ['5', '5 Excellent'], ['4', '4 Very good'], ['3', '3 Good'], ['2', '2 Fair'], ['1', '1 Poor']] as const

/** Ratings for the affective and psychomotor skills, one row per student for the chosen term. The class teacher fills this in; it prints on the report card. */
export function SkillsGrid({ businessId, termId, roster, canEdit }: { businessId: string; termId: string; roster: SStudent[]; canEdit: boolean }) {
  const traits = useAsync(() => loadTraits(businessId), [businessId])
  const ratings = useAsync(() => loadRatings(businessId).catch(() => []), [businessId])
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null)
  if (traits.loading || ratings.loading) return <Spinner />
  const list = traits.data ?? []
  if (!list.length) return <Card><EmptyState title="No skills set up" description="Add the skills to rate under School Settings." /></Card>
  const current = (studentId: string, traitId: string) => edits[studentId]?.[traitId] ?? String((ratings.data ?? []).find((r) => r.studentId === studentId && r.termId === termId && r.traitId === traitId)?.rating ?? '')
  const dirty = Object.keys(edits).filter((id) => roster.some((x) => x.id === id))
  async function save() {
    setBusy(true); setError(null); setOk(null)
    for (const id of dirty) {
      const err = await saveRatings(businessId, id, termId, Object.entries(edits[id]).map(([traitId, v]) => ({ traitId, rating: v === '' ? null : Number(v) })))
      if (err) { setBusy(false); return setError(`${fullName(roster.find((x) => x.id === id)!)}: ${err}`) }
    }
    await ratings.refresh(); setEdits({}); setBusy(false); setOk('Ratings saved.')
  }
  return (
    <Card className="p-0">
      <div className="border-b border-line p-3 text-sm text-ink/70">Rate each skill from 1 (poor) to 5 (excellent). These print on the report card.</div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="sticky left-0 bg-surface p-3">Student</th>{list.map((t) => <th key={t.id} className="min-w-28 p-2"><span className="block text-[10px] font-normal uppercase text-ink/50">{t.domain === 'affective' ? 'Affective' : 'Psychomotor'}</span>{t.name}</th>)}</tr></thead>
        <tbody className="divide-y divide-ink/10">{roster.map((x) => <tr key={x.id}><td className="sticky left-0 bg-white p-3 font-medium">{fullName(x)}</td>
          {list.map((t) => <td key={t.id} className="p-1.5"><select aria-label={`${t.name} for ${fullName(x)}`} disabled={!canEdit} value={current(x.id, t.id)} onChange={(e) => setEdits((p) => ({ ...p, [x.id]: { ...(p[x.id] ?? {}), [t.id]: e.target.value } }))} className="w-full rounded-md border border-line bg-white px-1.5 py-1 text-sm">{SCALE.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></td>)}</tr>)}</tbody>
      </table></div>
      <div className="space-y-2 border-t border-line p-3">
        {error && <ErrorState title="Not saved" message={error} />}{ok && <Notice>{ok}</Notice>}
        {canEdit && <div className="flex justify-end"><Button disabled={!dirty.length} loading={busy} onClick={() => void save()}>Save ratings{dirty.length ? ` (${dirty.length} student${dirty.length === 1 ? '' : 's'})` : ''}</Button></div>}
      </div>
    </Card>
  )
}
