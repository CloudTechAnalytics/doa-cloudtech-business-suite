import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { DEMO_LOGINS, demoSignIn, demoSignUp } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Eye, EyeOff } from 'lucide-react'
import { Button, ErrorState, Notice } from '@/shared/components'
import { BrandLockup } from '@/app/layouts/Brand'
import { useAuth } from '@/core/auth/AuthProvider'

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 pb-10 pt-16 sm:pt-24">
      <div className="w-full max-w-[350px] rounded-xl border border-line bg-white px-6 pb-7 pt-6 shadow-raised">
        <Link to="/" aria-label="DOA B-Suite home" className="mb-5 flex justify-center"><BrandLockup /></Link>
        <div className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-4 text-center text-[13px] leading-relaxed text-ink">
          {isDemoMode ? (
            <>
              <p className="font-semibold">Demo mode: no backend configured</p>
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {DEMO_LOGINS.map((d) => <li key={d.email}><code>{d.email}</code> / <code>{d.password}</code>: {d.note}</li>)}
              </ul>
            </>
          ) : (
            <p>Access and manage your businesses from DOA B-Suite.</p>
          )}
        </div>
        <h1 className="sr-only">{title}</h1>
        <div className="mt-5 border-t border-line/60 pt-5">{children}</div>
      </div>
      <Link to="/" className="mt-6 text-sm text-ink/60 hover:text-ink">&larr; Back to the website</Link>
    </div>
  )
}

function Field({ label, name, type = 'text', autoComplete, error, placeholder, hint }: {
  label: string; name: string; type?: string; autoComplete?: string; error?: string; placeholder: string; hint?: string
}) {
  const [shown, setShown] = useState(false)
  const isPassword = type === 'password'
  const id = `f-${name}`
  const ring = 'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20'
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

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email') ?? '').trim()
    const password = String(f.get('password') ?? '')
    const name = String(f.get('name') ?? '').trim()
    const next: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter a valid email address.'
    if (password.length < 8) next.password = 'Password must be at least 8 characters.'
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
      if (error) setFormError(error.message)
      else navigate('/businesses', { replace: true })
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
      if (error) setFormError(error.message)
      else if (data.session) navigate('/businesses', { replace: true })
      else setInfo('Check your email to confirm your address, then sign in.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {mode === 'signup' && <Field label="Full name" name="name" autoComplete="name" placeholder="Enter your name" error={errors.name} />}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="Enter your email" error={errors.email} />
      <Field
        label="Password" name="password" type="password" error={errors.password} placeholder="Enter your password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
      />
      {formError && <ErrorState title="Could not continue" message={formError} />}
      {info && <Notice>{info}</Notice>}
      <Button type="submit" className="h-11 w-full text-sm font-semibold uppercase tracking-wide" loading={busy}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  )
}

export function SignInPage() {
  const { userId } = useAuth()
  if (userId) return <Navigate to="/businesses" replace />
  return (
    <AuthLayout title="Sign in">
      <AuthForm mode="signin" />
      <p className="mt-5 text-center text-sm text-ink/70">
        New here? <Link to="/sign-up" className="font-semibold text-brand-ink underline">Create an account</Link>
      </p>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { userId } = useAuth()
  if (userId) return <Navigate to="/businesses" replace />
  return (
    <AuthLayout title="Create your account">
      <AuthForm mode="signup" />
      <p className="mt-5 text-center text-sm text-ink/70">
        Already registered? <Link to="/sign-in" className="font-semibold text-brand-ink underline">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
