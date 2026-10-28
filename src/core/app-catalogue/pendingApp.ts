import { STANDALONE_APPS } from './apps'
import type { StandaloneApp } from './apps'

const KEY = 'doa.pendingApp'
/** A choice made on the public site is only remembered for a day: long enough to sign up and confirm an email, not long enough to follow someone around for weeks. */
const LIFETIME_MS = 24 * 60 * 60 * 1000

/**
 * Which app a visitor clicked on the public site (for example POS). It is kept in this browser while they sign in or create an account, which may include
 * a trip to their email to confirm, so afterwards they land in that app's start page instead of the list of businesses. It holds no credentials.
 */
export function rememberApp(id: string | null, now = Date.now()): void {
  try { if (id && STANDALONE_APPS.some((a) => a.id === id)) localStorage.setItem(KEY, JSON.stringify({ id, at: now })) } catch { /* storage unavailable */ }
}

export function pendingApp(now = Date.now()): StandaloneApp | null {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null
    let saved: { id?: string; at?: number } | null = null
    try { saved = JSON.parse(raw) as { id?: string; at?: number } } catch { /* an older, plain value */ }
    if (!saved || typeof saved.at !== 'number' || now - saved.at > LIFETIME_MS) { localStorage.removeItem(KEY); return null }
    return STANDALONE_APPS.find((a) => a.id === saved!.id) ?? null
  } catch { return null }
}

export function clearPendingApp(): void {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

/** Where to go after creating an account, or after signing in from an app's own link: that app's start page, when one was chosen. */
export const afterAuthPath = (): string => { const a = pendingApp(); return a ? `/start/${a.id}` : '/businesses' }

/**
 * Where to go after signing in. Someone who simply signs in (the usual case: a returning owner or a member of staff) goes to their businesses; an app chosen on the
 * public site is acted on only when they came from that app's own link this time, and a stale choice is forgotten, so it cannot hijack a later sign-in.
 */
export function afterSignInPath(cameFromAppLink: boolean): string {
  if (cameFromAppLink) return afterAuthPath()
  clearPendingApp()
  return '/businesses'
}
