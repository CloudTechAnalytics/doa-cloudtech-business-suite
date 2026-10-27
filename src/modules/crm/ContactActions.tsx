import { Mail, MessageCircle, Phone } from 'lucide-react'

/** Digits only, with a Nigerian number written the international way (0803… becomes 234803…), which is what WhatsApp links need. */
export function phoneDigits(phone: string): string {
  const d = phone.replace(/[^\d+]/g, '').replace(/^\+/, '')
  return d.startsWith('0') ? `234${d.slice(1)}` : d
}
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
export const whatsappUrl = (phone: string, text?: string) => `https://wa.me/${phoneDigits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
export const mailUrl = (email: string, subject?: string, body?: string) => {
  const q = [subject ? `subject=${encodeURIComponent(subject)}` : '', body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&')
  return `mailto:${email}${q ? `?${q}` : ''}`
}

const btn = 'inline-flex size-8 items-center justify-center rounded-md border border-line bg-white text-ink/70 transition hover:bg-surface hover:text-ink'

/**
 * Call, WhatsApp and email in one tap, from wherever a contact is shown (a deal card, an activity, a customer row). It opens the phone's dialler, WhatsApp or the
 * mail app; DOA sends nothing itself. Buttons only appear for what the contact has.
 */
export function ContactActions({ name, phone, email, message }: { name: string; phone: string | null | undefined; email: string | null | undefined; message?: string }) {
  if (!phone && !email) return null
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {phone && <a href={telUrl(phone)} className={btn} aria-label={`Call ${name}`} title={`Call ${phone}`}><Phone className="size-4" aria-hidden /></a>}
      {phone && <a href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" className={btn} aria-label={`WhatsApp ${name}`} title="WhatsApp"><MessageCircle className="size-4" aria-hidden /></a>}
      {email && <a href={mailUrl(email, undefined, message)} className={btn} aria-label={`Email ${name}`} title={`Email ${email}`}><Mail className="size-4" aria-hidden /></a>}
    </span>
  )
}
