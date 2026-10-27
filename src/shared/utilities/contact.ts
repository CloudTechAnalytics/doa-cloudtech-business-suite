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
