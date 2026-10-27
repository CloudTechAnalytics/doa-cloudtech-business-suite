/**
 * Facts about who runs DOA that the public pages state (Terms, Privacy, Contact, footer). One place, so a change of name or address is one edit.
 * VITE_SUPPORT_EMAIL can override the address without a code change (set it in Vercel).
 */
export const SITE = {
  company: 'DOA Business Suite',
  product: 'DOA',
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || 'doabusinesssuite@gmail.com',
  /** The date the Terms and Privacy pages were last changed; update it whenever their wording changes. */
  legalUpdated: '27 October 2026',
  country: 'Nigeria',
} as const

export const mailto = (subject?: string, body?: string) => {
  const q = [subject ? `subject=${encodeURIComponent(subject)}` : '', body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&')
  return `mailto:${SITE.supportEmail}${q ? `?${q}` : ''}`
}
