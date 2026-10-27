import { ExternalLink, MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, ErrorState, Notice } from '@/shared/components'
import { SITE } from '@/shared/utilities/site'
import { supabase } from '@/shared/utilities/supabase'
import { inboxLink } from './emailHelp'

const COOLDOWN = 60

/** "Check your inbox": shown after sign-up (and when someone tries to sign in before confirming). The link in the email opens /email-confirmed. */
export function CheckEmail({ email, reason, onBack }: { email: string; reason: 'signup' | 'unconfirmed'; onBack: () => void }) {
  const [wait, setWait] = useState(COOLDOWN)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inbox = inboxLink(email)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function resend() {
    if (!supabase) return
    setBusy(true); setError(null); setSent(false)
    const { error: err } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/email-confirmed` } })
    setBusy(false)
    if (err) setError(err.message)
    else { setSent(true); setWait(COOLDOWN) }
  }

  return (
    <div className="space-y-4 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><MailCheck className="size-7" aria-hidden /></span>
      <h2 className="text-lg font-bold">Check your email</h2>
      <p className="text-sm text-ink/75">
        {reason === 'unconfirmed' ? 'This email has not been confirmed yet. ' : ''}We sent a confirmation link to <b className="break-all">{email}</b>. Open it to finish setting up your account.
      </p>
      {inbox && <a href={inbox.url} target="_blank" rel="noreferrer" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-amber text-sm font-bold text-ink hover:bg-amber-dark">Open {inbox.name} <ExternalLink className="size-4" aria-hidden /></a>}
      <div className="rounded-lg bg-surface p-3 text-left text-xs leading-relaxed text-ink/75">
        <p className="mb-1 font-semibold text-ink">Cannot see it? It can take a minute.</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>The email comes from <b>{SITE.company}</b> ({SITE.supportEmail}). Look for the subject &ldquo;Confirm your email address for DOA Business Suite&rdquo;.</li>
          <li>Check your <b>Spam</b>, Junk or Promotions folder. If it is there, choose <b>Not spam</b>, then open the link.</li>
          <li>Is <b className="break-all">{email}</b> spelled correctly? If not, use a different email below.</li>
        </ol>
      </div>
      {sent && <Notice>Sent again. Check your inbox.</Notice>}
      {error && <ErrorState title="Could not send" message={error} />}
      <Button type="button" variant="secondary" className="w-full" loading={busy} disabled={wait > 0} onClick={() => void resend()}>{wait > 0 ? `Send it again in ${wait}s` : 'Send the email again'}</Button>
      <button type="button" onClick={onBack} className="text-sm font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4">Use a different email</button>
      <p className="text-xs text-ink/60">Still nothing after a few minutes? <Link to="/contact" className="font-semibold underline">Write to us</Link>.</p>
    </div>
  )
}
