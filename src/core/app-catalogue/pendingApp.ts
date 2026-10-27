import { STANDALONE_APPS } from './apps'
import type { StandaloneApp } from './apps'

const KEY = 'doa.pendingApp'

/**
 * Which app a visitor clicked on the public site (for example POS). It is kept in this browser while they sign in or create an account, which may include
 * a trip to their email to confirm, so afterwards they land in that app's start page instead of the list of businesses. It holds no credentials.
 */
export function rememberApp(id: string | null): void {
  try { if (id && STANDALONE_APPS.some((a) => a.id === id)) localStorage.setItem(KEY, id) } catch { /* storage unavailable */ }
}

export function pendingApp(): StandaloneApp | null {
  try { const id = localStorage.getItem(KEY); return STANDALONE_APPS.find((a) => a.id === id) ?? null } catch { return null }
}

export function clearPendingApp(): void {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

/** Where to go after signing in or creating an account. */
export const afterAuthPath = (): string => { const a = pendingApp(); return a ? `/start/${a.id}` : '/businesses' }
