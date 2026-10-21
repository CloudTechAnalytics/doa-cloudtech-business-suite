import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { DEMO_LOGINS, demoSignIn, demoSignUp } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Button, Card, ErrorState, Notice, TextField } from '@/shared/components'
import { BrandLockup } from '@/app/layouts/Brand'
import { useAuth } from '@/core/auth/AuthProvider'

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-md">
        <BrandLockup inverted className="mb-6 justify-center" />
        <Card>
          <h1 className="mb-4 text-xl font-bold">{title}</h1>
          {isDemoMode && (
            <Notice>
              <p className="font-semibold">Demo mode (no backend configured)</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {DEMO_LOGINS.map((d) => <li key={d.email}><code>{d.email}</code> / <code>{d.password}</code>: {d.note}</li>)}
              </ul>
            </Notice>
          )}
          <div className="mt-4">{children}</div>
        </Card>
      </div>
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
      else navigate('/app', { replace: true })
      return
    }
    if (!supabase) return

    setBusy(true)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setFormError(error.message)
      else navigate('/app', { replace: true })
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
      if (error) setFormError(error.message)
      else if (data.session) navigate('/app', { replace: true })
      else setInfo('Check your email to confirm your address, then sign in.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {mode === 'signup' && <TextField label="Full name" name="name" autoComplete="name" error={errors.name} />}
      <TextField label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
      <TextField
        label="Password" name="password" type="password" error={errors.password}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
      />
      {formError && <ErrorState title="Could not continue" message={formError} />}
      {info && <Notice>{info}</Notice>}
      <Button type="submit" className="w-full" loading={busy}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  )
}

export function SignInPage() {
  const { userId } = useAuth()
  if (userId) return <Navigate to="/app" replace />
  return (
    <AuthLayout title="Sign in">
      <AuthForm mode="signin" />
      <p className="mt-4 text-center text-sm text-navy/70">
        New here? <Link to="/sign-up" className="font-semibold text-gold-ink underline">Create an account</Link>
      </p>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { userId } = useAuth()
  if (userId) return <Navigate to="/app" replace />
  return (
    <AuthLayout title="Create your account">
      <AuthForm mode="signup" />
      <p className="mt-4 text-center text-sm text-navy/70">
        Already registered? <Link to="/sign-in" className="font-semibold text-gold-ink underline">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
