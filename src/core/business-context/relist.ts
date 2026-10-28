/**
 * The business list, the blocked list and "accept my invitations" are asked at the same time so signing in is not a chain of round trips. Accepting an
 * invitation can add a business the first list did not have, so when it accepted any the lists are asked for again. This says whether that is needed.
 */
export function needsRelist(accepted: { data: unknown; error: unknown | null }): boolean {
  if (accepted.error) return false
  const n = Number(accepted.data)
  return Number.isFinite(n) && n > 0
}
