import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, ErrorState, Notice, TextField } from '@/shared/components'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { passwordProblem } from './AuthPages'
import { useProfile } from './useProfile'

/** A person's own details: their name and phone, and a new password. Everyone reaches it from the account menu at the top right. */
export function ProfilePage() {
  const profile = useProfile()
  const navigate = useNavigate()
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = String(f.get('name') ?? '').trim(); const phone = String(f.get('phone') ?? '').trim()
    setSaved(null); setError(null)
    if (name.length < 2) return setError('Enter your name.')
    if (isDemoMode || !supabase) return setError('Profile changes need the live database connection.')
    setBusy(true)
    const { error: err } = await supabase.from('profiles').update({ display_name: name, phone: phone || null }).eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
    setBusy(false)
    if (err) setError(err.message); else { setSaved('Saved.'); await profile.refresh() }
  }

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password') ?? '')
    setPwDone(false); setPwError(null)
    const problem = passwordProblem(password)
    if (problem) return setPwError(problem)
    if (password !== String(f.get('again') ?? '')) return setPwError('The two passwords do not match.')
    if (isDemoMode || !supabase) return setPwError('Changing the password needs the live database connection.')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setPwError(err.message); else { setPwDone(true); e.currentTarget.reset() }
  }

  return (
    <div className="min-h-dvh bg-surface px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-xl space-y-4">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Back</button>
        <h1 className="text-2xl font-bold">Your profile</h1>

        <Card>
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-xl bg-brand text-base font-bold text-white" aria-hidden>{profile.initials}</span>
            <div><p className="font-semibold">{profile.name}</p><p className="text-sm text-ink/60">{profile.email}</p></div>
          </div>
          <form onSubmit={saveDetails} noValidate className="space-y-3" key={`${profile.name}|${profile.phone}`}>
            <TextField label="Name" name="name" defaultValue={profile.name} />
            <TextField label="Phone (optional)" name="phone" defaultValue={profile.phone} />
            <TextField label="Email" value={profile.email ?? ''} readOnly disabled hint="Your email is how you sign in. It cannot be changed here." />
            {error && <ErrorState title="Not saved" message={error} />}
            {saved && <Notice>{saved}</Notice>}
            <Button type="submit" loading={busy}>Save changes</Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Change password</h2>
          <form onSubmit={savePassword} noValidate className="space-y-3">
            <TextField label="New password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters, with a lowercase letter, an uppercase letter and a number." />
            <TextField label="Type it again" name="again" type="password" autoComplete="new-password" />
            {pwError && <ErrorState title="Not saved" message={pwError} />}
            {pwDone && <Notice>Your password has been changed.</Notice>}
            <Button type="submit" variant="secondary" loading={busy}>Change password</Button>
          </form>
          <p className="mt-3 text-xs text-ink/60">Forgotten your password instead? Sign out and use <Link to="/forgot-password" className="underline">Forgot your password</Link> on the sign-in page.</p>
        </Card>
      </div>
    </div>
  )
}
