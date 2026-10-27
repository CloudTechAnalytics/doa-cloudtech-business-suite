import { Spinner } from '@/shared/components'
import { useSchool } from '../components/schoolUi'
import { MontessoriProgress } from './MontessoriProgress'
import { SchoolResultsPage } from './SchoolResultsPage'

/** Results for most schools; for a Montessori school the same menu entry opens Progress & Reports, because there are no exams to mark. */
export function SchoolResultsRoute() {
  const ctx = useSchool()
  if (ctx.structure.loading && !ctx.s) return <Spinner />
  return ctx.isMontessori ? <MontessoriProgress /> : <SchoolResultsPage />
}
