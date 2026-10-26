import { MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, ErrorState, Notice } from '@/shared/components'
import { supabase } from '@/shared/utilities/supabase'

const COOLDOWN = 60

/** "Check your inbox": shown after sign-up (and when someone tries to sign in before confirming). The link in the email opens /email-confirmed. */
export function CheckEmail({ email, reason, onBack }: { email: string; reason: 'signup' | 'unconfirmed'; onBack: () => void }) {
  const [wait, setWait] = useState(COOLDOWN)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <p className="text-xs text-ink/60">It can take a minute. Look in your spam or promotions folder too.</p>
      {sent && <Notice>Sent again. Check your inbox.</Notice>}
      {error && <ErrorState title="Could not send" message={error} />}
      <Button type="button" variant="secondary" className="w-full" loading={busy} disabled={wait > 0} onClick={() => void resend()}>{wait > 0 ? `Send it again in ${wait}s` : 'Send the email again'}</Button>
      <button type="button" onClick={onBack} className="text-sm font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4">Use a different email</button>
    </div>
  )
}
