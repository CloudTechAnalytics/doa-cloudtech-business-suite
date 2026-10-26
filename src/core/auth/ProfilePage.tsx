import { ArrowLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, ErrorState, Notice, TextField } from '@/shared/components'
import { Avatar } from '@/shared/topbar/Avatar'
import { blobToDataUrl, shrinkImage } from '@/shared/utilities/image'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { passwordProblem } from './AuthPages'
import { demoSetUserName } from '@/demo/demoStore'
import { announceAvatarChange, setDemoAvatar, setDemoTitle, useProfile } from './useProfile'

/** A person's own details: their name and phone, and a new password. Everyone reaches it from the account menu at the top right. */
export function ProfilePage() {
  const profile = useProfile()
  const navigate = useNavigate()
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picError, setPicError] = useState<string | null>(null)
  const [picBusy, setPicBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function choosePicture(file: File | undefined) {
    if (!file) return
    setPicError(null); setPicBusy(true)
    try {
      const blob = await shrinkImage(file)
      if (isDemoMode) setDemoAvatar(profile.userId ?? '', await blobToDataUrl(blob))
      else {
        if (!supabase || !profile.userId) throw new Error('You are not signed in.')
        const path = `${profile.userId}/avatar-${Date.now()}.jpg`
        const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (up.error) throw new Error(up.error.message)
        const set = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profile.userId)
        if (set.error) throw new Error(set.error.message)
        if (profile.picturePath) await supabase.storage.from('avatars').remove([profile.picturePath])
        announceAvatarChange()
      }
    } catch (e) { setPicError((e as Error).message) }
    setPicBusy(false)
    if (fileInput.current) fileInput.current.value = ''
  }
  async function removePicture() {
    setPicError(null); setPicBusy(true)
    try {
      if (isDemoMode) setDemoAvatar(profile.userId ?? '', null)
      else if (supabase && profile.userId) {
        const set = await supabase.from('profiles').update({ avatar_path: null }).eq('id', profile.userId)
        if (set.error) throw new Error(set.error.message)
        if (profile.picturePath) await supabase.storage.from('avatars').remove([profile.picturePath])
        announceAvatarChange()
      }
    } catch (e) { setPicError((e as Error).message) }
    setPicBusy(false)
  }

  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = String(f.get('name') ?? '').trim(); const phone = String(f.get('phone') ?? '').trim(); const title = String(f.get('title') ?? '').trim()
    setSaved(null); setError(null)
    if (name.length < 2) return setError('Enter your name.')
    if (title.length > 60) return setError('Your title can be at most 60 characters.')
    if (isDemoMode) { demoSetUserName(profile.userId ?? '', name); setDemoTitle(profile.userId ?? '', title || null); return setSaved('Saved. (Demo: your phone number is not kept.)') }
    if (!supabase) return setError('Profile changes need the live database connection.')
    setBusy(true)
    const { error: err } = await supabase.from('profiles').update({ display_name: name, phone: phone || null, job_title: title || null }).eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
    setBusy(false)
    if (err) setError(err.message); else { setSaved('Saved.'); announceAvatarChange(); await profile.refresh() }
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
            <Avatar url={profile.picture} initials={profile.initials} className="size-16 text-lg" />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{profile.name}</p><p className="truncate text-sm text-ink/60">{profile.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a profile picture" onChange={(e) => void choosePicture(e.target.files?.[0])} />
                <Button type="button" variant="secondary" loading={picBusy} onClick={() => fileInput.current?.click()}>{profile.picture ? 'Change picture' : 'Add a picture'}</Button>
                {profile.picture && <Button type="button" variant="ghost" disabled={picBusy} onClick={() => void removePicture()}>Remove</Button>}
              </div>
            </div>
          </div>
          {picError && <div className="mb-3"><ErrorState title="Picture not saved" message={picError} /></div>}
          <form onSubmit={saveDetails} noValidate className="space-y-3" key={`${profile.name}|${profile.phone}|${profile.title}`}>
            <TextField label="Name" name="name" defaultValue={profile.name} />
            <TextField label="Your title (optional)" name="title" defaultValue={profile.title} maxLength={60} list="title-suggestions" placeholder="For example Principal, Director or Manager" hint="Shown under your name at the top of the app, in place of your role. It does not change what you can do." />
            <datalist id="title-suggestions">{['Owner', 'Director', 'Managing Director', 'CEO', 'Proprietor', 'Principal', 'Head Teacher', 'Proprietress', 'Manager', 'Administrator', 'Pharmacist-in-charge', 'Farm Manager'].map((x) => <option key={x} value={x} />)}</datalist>
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
