import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ErrorState, Notice } from '@/shared/components'
import { supabase } from '@/shared/utilities/supabase'
import { useAuth } from './AuthProvider'
import { AuthLayout, Field, passwordProblem } from './AuthPages'

const linkClass = 'font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4'

/** Asks Supabase to email a link that opens /reset-password. The answer is the same whether or not the email has an account. */
export function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.')
    if (!supabase) return setError('Password reset needs the live database connection.')
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    if (err) setError(err.message); else setSent(true)
  }

  return (
    <AuthLayout title="Reset your password">
      {sent ? <Notice>If that email has an account, a link to choose a new password is on its way. It may take a few minutes.</Notice> : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <p className="text-sm text-ink/70">Enter the email you signed up with and we will send you a link to choose a new password.</p>
          <Field label="Email" name="email" type="email" autoComplete="email" placeholder="Enter your email" />
          {error && <ErrorState title="Could not send" message={error} />}
          <Button type="submit" className="h-11 w-full text-sm font-semibold uppercase tracking-wide" loading={busy}>Send reset link</Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-ink/70"><Link to="/sign-in" className={linkClass}>Back to sign in</Link></p>
    </AuthLayout>
  )
}

/** Opened from the emailed link: Supabase signs the person in with a short-lived recovery session, and here they choose a new password. */
export function ResetPasswordPage() {
  const { userId, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password') ?? '')
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== String(f.get('again') ?? '')) return setError('The two passwords do not match.')
    if (!supabase) return
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setError(err.message); else navigate('/businesses', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password">
      {loading ? <p className="text-sm text-ink/70">Checking your link…</p> : !userId ? (
        <div className="space-y-3">
          <ErrorState title="This link has expired" message="The reset link is old or has already been used. Ask for a new one." />
          <Link to="/forgot-password" className={`block text-center text-sm ${linkClass}`}>Send a new link</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="New password" name="password" type="password" autoComplete="new-password" placeholder="Enter a new password" hint="At least 10 characters, with a lowercase letter, an uppercase letter and a number." />
          <Field label="Type it again" name="again" type="password" autoComplete="new-password" placeholder="Enter it again" />
          {error && <ErrorState title="Not saved" message={error} />}
          <Button type="submit" className="h-11 w-full text-sm font-semibold uppercase tracking-wide" loading={busy}>Save new password</Button>
        </form>
      )}
    </AuthLayout>
  )
}

/** Where the link in the confirmation email lands. Supabase has already signed the person in, so this says so and carries on to their businesses. */
export function EmailConfirmedPage() {
  const { userId, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!userId) return
    const t = setTimeout(() => navigate('/businesses', { replace: true }), 3500)
    return () => clearTimeout(t)
  }, [userId, navigate])
  return (
    <AuthLayout title="Email confirmed">
      {loading ? <p className="text-sm text-ink/70">Confirming…</p> : (
        <div className="space-y-4 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-7" aria-hidden /></span>
          <h2 className="text-lg font-bold">Your email is confirmed</h2>
          <p className="text-sm text-ink/75">{userId ? 'Welcome to DOA. Taking you to your businesses…' : 'Your account is ready. Sign in to continue.'}</p>
          <Link to={userId ? '/businesses' : '/sign-in'} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-amber text-sm font-bold uppercase tracking-wide text-ink hover:bg-amber-dark">{userId ? 'Continue' : 'Sign in'}</Link>
        </div>
      )}
    </AuthLayout>
  )
}
