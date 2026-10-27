/**
 * Small helps around the confirmation email. A mistyped address (gmial.com) that bounces hurts the sender's reputation, which is what sends later emails to spam, so the
 * sign-up form asks once before sending to an address that looks like a typo of a well-known mail service. After sending, the screen links straight to the person's inbox.
 */

const KNOWN = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com', 'yahoo.co.uk', 'googlemail.com', 'ymail.com', 'proton.me', 'protonmail.com', 'zoho.com']

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** A corrected address when the domain looks like a slip of a well-known one (gmial.com, gmail.con, hotmial.com), or null when it looks fine. Never changes the part before the @. */
export function suggestEmail(email: string): string | null {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(email.trim())
  if (!m) return null
  const domain = m[2].toLowerCase()
  if (KNOWN.includes(domain)) return null
  let best: { d: string; n: number } | null = null
  for (const k of KNOWN) {
    const n = distance(domain, k)
    // One slip for most, two for a longer domain; a domain far from every known one is left alone (it is probably a company address).
    if (n >= 1 && n <= (k.length >= 9 ? 2 : 1) && (!best || n < best.n)) best = { d: k, n }
  }
  return best ? `${m[1]}@${best.d}` : null
}

/** Where to open the inbox for an address, for the mail services most people use. Null for anything else (a company address, for example). */
export function inboxLink(email: string): { name: string; url: string } | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { name: 'Gmail', url: 'https://mail.google.com/' }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return { name: 'Outlook', url: 'https://outlook.live.com/mail/' }
  if (['yahoo.com', 'yahoo.co.uk', 'ymail.com'].includes(domain)) return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com/' }
  if (['icloud.com', 'me.com'].includes(domain)) return { name: 'iCloud Mail', url: 'https://www.icloud.com/mail' }
  if (domain === 'proton.me' || domain === 'protonmail.com') return { name: 'Proton Mail', url: 'https://mail.proton.me/' }
  if (domain === 'zoho.com') return { name: 'Zoho Mail', url: 'https://mail.zoho.com/' }
  return null
}
