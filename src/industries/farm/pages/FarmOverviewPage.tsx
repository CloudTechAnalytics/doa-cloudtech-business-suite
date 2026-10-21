import { Navigate } from 'react-router-dom'

/** The Dashboard now shows the farm overview; this route stays so old links and the required module keep working. */
export function FarmOverviewPage() {
  return <Navigate to="/app/dashboard" replace />
}
