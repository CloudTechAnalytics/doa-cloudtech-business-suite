import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { DEMO_LOGINS, demoSignIn, demoSignUp } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Eye, EyeOff } from 'lucide-react'
import { Button, ErrorState } from '@/shared/components'
import { BrandLockup } from '@/app/layouts/Brand'
import { useAuth } from '@/core/auth/AuthProvider'
import { CheckEmail } from './CheckEmail'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 pb-10 pt-16 sm:pt-24">
      <div className="w-full max-w-[350px] rounded-xl border border-line border-t-4 border-t-amber bg-white px-6 pb-7 pt-6 shadow-raised">
        <Link to="/" aria-label="DOA home" className="mb-5 flex justify-center"><BrandLockup /></Link>
        <div className="rounded-lg border border-amber/40 bg-amber/10 px-4 py-4 text-center text-[13px] leading-relaxed text-ink">
          {isDemoMode ? (
            <>
              <p className="font-semibold">Demo mode: no backend configured</p>
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {DEMO_LOGINS.map((d) => <li key={d.email}><code>{d.email}</code> / <code>{d.password}</code>: {d.note}</li>)}
              </ul>
            </>
          ) : (
            <p>Access and manage your businesses from DOA.</p>
          )}
        </div>
        <h1 className="sr-only">{title}</h1>
        <div className="mt-5 border-t border-line/60 pt-5">{children}</div>
      </div>
      <Link to="/" className="mt-6 text-sm text-ink/60 hover:text-ink">&larr; Back to the website</Link>
    </div>
  )
}

export function Field({ label, name, type = 'text', autoComplete, error, placeholder, hint }: {
  label: string; name: string; type?: string; autoComplete?: string; error?: string; placeholder: string; hint?: string
}) {
  const [shown, setShown] = useState(false)
  const isPassword = type === 'password'
  const id = `f-${name}`
  const ring = 'focus-within:border-amber focus-within:ring-2 focus-within:ring-amber/30'
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] text-ink">{label}</label>
      <div className={`flex h-11 overflow-hidden rounded-md border bg-white ${error ? 'border-danger' : 'border-line'} ${ring}`}>
        <input
          id={id} name={name} type={isPassword && shown ? 'text' : type} autoComplete={autoComplete} placeholder={placeholder}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink/35"
        />
        {isPassword && (
          <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
            className="grid w-11 place-items-center border-l border-line text-ink/60 hover:bg-surface hover:text-ink">
            {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        )}
      </div>
      {error ? <p id={`${id}-err`} className="mt-1 text-xs text-danger">{error}</p> : hint && <p className="mt-1 text-xs text-ink/55">{hint}</p>}
    </div>
  )
}

type Mode = 'signin' | 'signup'

/** The same rules the database enforces on new passwords (Supabase Authentication settings). */
export const passwordProblem = (p: string) => (p.length < 10 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) ? 'Use at least 10 characters, with a lowercase letter, an uppercase letter and a number.' : null)

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  // An address waiting for its confirmation email: shows the "Check your email" screen instead of the form.
  const [pending, setPending] = useState<{ email: string; reason: 'signup' | 'unconfirmed' } | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email') ?? '').trim()
    const password = String(f.get('password') ?? '')
    const name = String(f.get('name') ?? '').trim()
    const next: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter a valid email address.'
    if (mode === 'signup' && !isDemoMode) {
      const problem = passwordProblem(password)
      if (problem) next.password = problem
    } else if (password.length < 8) next.password = 'Password must be at least 8 characters.'
    if (mode === 'signup' && !name) next.name = 'Enter your name.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    if (isDemoMode) {
      const err = mode === 'signin' ? demoSignIn(email, password) : demoSignUp(name, email, password)
      if (err) setFormError(err)
      else navigate('/businesses', { replace: true })
      return
    }
    if (!supabase) return

    setBusy(true)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error && /not confirmed/i.test(error.message)) setPending({ email, reason: 'unconfirmed' })
      else if (error) setFormError(error.message)
      else navigate('/businesses', { replace: true })
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${window.location.origin}/email-confirmed` } })
      if (error) setFormError(error.message)
      else if (data.session) navigate('/businesses', { replace: true })
      else setPending({ email, reason: 'signup' })
    }
    setBusy(false)
  }

  if (pending) return <CheckEmail email={pending.email} reason={pending.reason} onBack={() => setPending(null)} />

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {mode === 'signup' && <Field label="Full name" name="name" autoComplete="name" placeholder="Enter your name" error={errors.name} />}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="Enter your email" error={errors.email} />
      <Field
        label="Password" name="password" type="password" error={errors.password} placeholder="Enter your password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        hint={mode === 'signup' ? (isDemoMode ? 'At least 8 characters.' : 'At least 10 characters, with a lowercase letter, an uppercase letter and a number.') : undefined}
      />
      {formError && <ErrorState title="Could not continue" message={formError} />}
      <Button type="submit" className="h-11 w-full text-sm font-semibold uppercase tracking-wide" loading={busy}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  )
}

/** The sign-in page is always the sign-in page. Someone who is already signed in is told so, and can continue or sign in as somebody else. */
export function SignInPage() {
  const { userId, email } = useAuth()
  return (
    <AuthLayout title="Sign in">
      {userId && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm">
          <p>You are already signed in{email ? <> as <b>{email}</b></> : null}.</p>
          <Link to="/businesses" className="mt-2 inline-flex h-9 items-center rounded-md bg-amber px-3.5 text-sm font-bold text-ink hover:bg-amber-dark">Continue to my businesses</Link>
          <p className="mt-2 text-xs text-ink/60">Or sign in below to switch to a different account.</p>
        </div>
      )}
      <AuthForm mode="signin" />
      {!isDemoMode && <p className="mt-3 text-center text-sm"><Link to="/forgot-password" className="text-ink/70 underline decoration-amber decoration-2 underline-offset-4 hover:text-ink">Forgot your password?</Link></p>}
      <p className="mt-5 text-center text-sm text-ink/70">
        New here? <Link to="/sign-up" className="font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4">Create an account</Link>
      </p>
    </AuthLayout>
  )
}

/** Create account always shows the sign-up form. Someone already signed in is told so, and can continue or create a new account. */
export function SignUpPage() {
  const { userId, email } = useAuth()
  return (
    <AuthLayout title="Create your account">
      {userId && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm">
          <p>You are signed in{email ? <> as <b>{email}</b></> : null}. Creating an account below signs you in as the new person.</p>
          <Link to="/businesses" className="mt-2 inline-flex h-9 items-center rounded-md border border-line px-3.5 text-sm font-semibold hover:bg-white">Back to my businesses</Link>
        </div>
      )}
      <AuthForm mode="signup" />
      <p className="mt-5 text-center text-sm text-ink/70">
        Already registered? <Link to="/sign-in" className="font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
