import { Check } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { SiteHeader } from '@/app/landing/SiteHeader'
import { industryColor } from '@/app/navigation/navigation'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { getIndustry, listIndustries } from '@/core/industry-registry'
import { answersToSettings } from '@/core/industry-registry/settings'
import type { IndustryDefinition, SetupAnswerValue } from '@/core/industry-registry/types'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { enableModule } from '@/core/module-registry/moduleActions'
import { MODULES } from '@/core/module-registry/registry'
import { demoCreateBusiness, demoSignUp } from '@/demo/demoStore'
import { Button, Card, ErrorState, Notice, SelectField, TextField } from '@/shared/components'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { BusinessTypePicker } from './BusinessTypePicker'
import { clearDraft, loadDraft, saveDraft } from './draft'
import { SelectionSummary } from './SelectionSummary'
import { toggleSelection } from './selection'
import { SetupFields } from './SetupFields'

interface Result { id?: string; error?: string; notes: string[] }
type Answers = Record<string, SetupAnswerValue>
type Step = 1 | 2 | 3

const isActive = (id: string | null): id is IndustryCode => !!id && id !== 'general' && listIndustries().some((d) => d.id === id && d.status === 'active')

/**
 * The site's starting point after the landing page, in the style of Odoo's "Choose your Apps":
 *   1. tick one or more business types (each becomes its own business)
 *   2. name each business and answer that industry's setup questions
 *   3. create an account (skipped when already signed in)
 * It works before sign-in. Choices are kept in this browser so they survive sign-up and email confirmation.
 */
export function OnboardingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { refresh, select } = useBusiness()
  const { userId } = useAuth()

  // A saved draft is only resumed for a signed-in user (i.e. after sign-up or email confirmation).
  const [draft] = useState(() => (userId ? loadDraft() : null))
  const preselect = params.get('type')
  const [step, setStep] = useState<Step>(draft ? 2 : 1)
  const [selected, setSelected] = useState<IndustryCode[]>(draft?.selected ?? (isActive(preselect) ? [preselect] : []))
  const [addons, setAddons] = useState<Record<string, Set<ModuleCode>>>(() => Object.fromEntries(Object.entries(draft?.addons ?? {}).map(([k, v]) => [k, new Set(v)])))
  const [names, setNames] = useState<Record<string, string>>(draft?.names ?? {})
  const [answers, setAnswers] = useState<Record<string, Answers>>(draft?.answers ?? {})
  const [common, setCommon] = useState({ currency: draft?.currency ?? 'NGN', tz: draft?.tz ?? 'Africa/Lagos' })
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [account, setAccount] = useState({ name: '', email: '', password: '' })
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})
  const [awaitingEmail, setAwaitingEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Registry order keeps the page stable however the cards were ticked.
  const defs = listIndustries().filter((d) => selected.includes(d.id))
  // More than one new business: let them choose which to open first.
  const opened = defs.length > 1 ? '/businesses' : '/app'
  const allCreated = defs.length > 0 && defs.every((d) => results[d.id]?.id)
  const toggleAddon = (industry: IndustryCode, code: ModuleCode) => setAddons((a) => {
    const set = new Set(a[industry] ?? [])
    if (set.has(code)) set.delete(code); else set.add(code)
    return { ...a, [industry]: set }
  })

  const persist = () => saveDraft({ selected, names, answers, addons: Object.fromEntries(Object.entries(addons).map(([k, v]) => [k, [...v]])), currency: common.currency, tz: common.tz })

  async function createOne(d: IndustryDefinition): Promise<Result> {
    const notes: string[] = []
    const settings = answersToSettings(d, answers[d.id] ?? {})
    const name = (names[d.id] ?? '').trim()
    let id: string
    if (isDemoMode) {
      id = demoCreateBusiness(name, d.id, settings)
    } else {
      if (!supabase) return { error: 'Backend not configured.', notes }
      const { data, error } = await supabase.rpc('create_business', { p_name: name, p_industry: d.id, p_currency: common.currency, p_timezone: common.tz })
      if (error) return { error: error.message, notes }
      id = data as string
      // Setup answers are saved as validated business settings (the owner holds settings.manage).
      if (Object.keys(settings).length) {
        const upd = await supabase.from('businesses').update({ settings }).eq('id', id)
        if (upd.error) notes.push(`setup answers were not saved (${upd.error.message})`)
      }
    }
    if (d.afterCreate) {
      const err = await d.afterCreate(id, answers[d.id] ?? {})
      if (err) notes.push(err)
    }
    for (const code of addons[d.id] ?? []) {
      const err = await enableModule(id, code)
      if (err) notes.push(`could not add ${MODULES[code]?.name ?? code} (${err})`)
    }
    return { id, notes }
  }

  /** Creates every business that does not exist yet, one at a time, so a failure never undoes the others. */
  async function createAll() {
    setBusy(true); setFormError(null)
    const out: Record<string, Result> = { ...results }
    for (const d of defs.filter((x) => !results[x.id]?.id)) out[d.id] = await createOne(d)
    setBusy(false)
    setResults(out)
    await refresh()
    const created = defs.map((d) => out[d.id]?.id).filter((x): x is string => !!x)
    if (created.length) { select(created[0]); clearDraft() }
    if (defs.every((d) => out[d.id]?.id && out[d.id].notes.length === 0)) navigate(opened)
    else if (created.length === 0) setFormError('No business was created. Check the messages below and try again.')
  }

  function onDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const pending = defs.filter((d) => !results[d.id]?.id)
    const next: Record<string, Record<string, string>> = {}
    for (const d of pending) {
      const errs = { ...validateSetupAnswers(d, answers[d.id] ?? {}) }
      if (!(names[d.id] ?? '').trim()) errs.name = 'Enter the business name.'
      if (Object.keys(errs).length) next[d.id] = errs
    }
    setErrors(next)
    if (Object.keys(next).length) return
    if (userId) void createAll()
    else { persist(); setStep(3) }
  }

  async function onAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!account.name.trim()) errs.name = 'Enter your name.'
    if (!/^\S+@\S+\.\S+$/.test(account.email.trim())) errs.email = 'Enter a valid email address.'
    if (account.password.length < 8) errs.password = 'Use at least 8 characters.'
    setAccountErrors(errs)
    setFormError(null)
    if (Object.keys(errs).length) return

    setBusy(true)
    if (isDemoMode) {
      const err = demoSignUp(account.name.trim(), account.email.trim(), account.password)
      setBusy(false)
      if (err) return setFormError(err)
      return void createAll()
    }
    if (!supabase) { setBusy(false); return setFormError('Backend not configured.') }
    const { data, error } = await supabase.auth.signUp({ email: account.email.trim(), password: account.password, options: { data: { name: account.name.trim() } } })
    setBusy(false)
    if (error) return setFormError(error.message)
    persist()
    // With email confirmation on there is no session yet: keep the draft and ask them to confirm, then sign in.
    if (!data.session) return setAwaitingEmail(true)
    void createAll()
  }

  const heading = step === 1 ? ['Choose your ', 'business'] : step === 2 ? ['Set up your ', defs.length > 1 ? 'businesses' : 'business'] : ['Create your ', 'account']
  const subtitle = step === 1 ? 'Tick every kind of business you run. Each one becomes its own business.' : step === 2 ? 'A few details for each, and you are nearly there.' : 'One login for all your businesses. The first 14 days are free.'

  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />
      <div className="bg-white">
        <div className="mx-auto max-w-3xl px-4 pb-12 pt-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            {heading[0]}<span className="relative inline-block">{heading[1]}<span aria-hidden className="absolute -bottom-1.5 left-0 h-1.5 w-full rounded-full bg-mint" /></span>
          </h1>
          <p className="mt-5 text-base font-medium text-ink">{subtitle}</p>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_300px]">
        <div>
          {step === 1 && <BusinessTypePicker industries={listIndustries().filter((d) => d.id !== 'general')} selected={selected} onToggle={(id) => setSelected((s) => toggleSelection(s, id))} />}

          {step === 2 && (
            <form onSubmit={onDetails} noValidate className="space-y-4">
              {Object.keys(results).length > 0 && <Progress defs={defs} results={results} names={names} allCreated={allCreated} onOpen={() => navigate(opened)} />}
              <Card>
                <h2 className="mb-3 text-sm font-semibold">{defs.length > 1 ? 'Settings for all of them' : 'Settings'}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Currency" value={common.currency} onChange={(e) => setCommon((c) => ({ ...c, currency: e.target.value }))}><option value="NGN">Nigerian Naira (NGN)</option></SelectField>
                  <SelectField label="Timezone" value={common.tz} onChange={(e) => setCommon((c) => ({ ...c, tz: e.target.value }))}><option value="Africa/Lagos">Africa/Lagos</option></SelectField>
                </div>
              </Card>
              {defs.filter((d) => !results[d.id]?.id).map((d) => (
                <Card key={d.id}>
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-md text-white" style={{ background: industryColor(d.id) }}><d.icon className="size-4" aria-hidden /></span>
                    <h2 className="text-base font-bold">{d.name}</h2>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <TextField label="Business name" value={names[d.id] ?? ''} onChange={(e) => setNames((n) => ({ ...n, [d.id]: e.target.value }))} error={errors[d.id]?.name} placeholder={`e.g. My ${d.name.split(' ')[0]} business`} />
                    </div>
                    <SetupFields questions={d.onboarding.questions} answers={answers[d.id] ?? {}} errors={errors[d.id] ?? {}} onChange={(id, v) => setAnswers((a) => ({ ...a, [d.id]: { ...(a[d.id] ?? {}), [id]: v } }))} />
                  </div>
                </Card>
              ))}
              {formError && <ErrorState title="Could not create" message={formError} />}
              {!allCreated && (
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setStep(1)} disabled={busy || Object.values(results).some((r) => r.id)}>Back</Button>
                  <Button type="submit" loading={busy}>{userId ? (defs.length > 1 ? `Create ${defs.filter((d) => !results[d.id]?.id).length} businesses` : 'Create business') : 'Continue'}</Button>
                </div>
              )}
              {defs.length > 1 && !allCreated && userId && <Notice>Each business has its own data, staff and subscription. If one fails, the others are kept and you can retry just that one.</Notice>}
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {Object.keys(results).length > 0 && <Progress defs={defs} results={results} names={names} allCreated={allCreated} onOpen={() => navigate(opened)} />}
              {awaitingEmail ? (
                <Card>
                  <h2 className="text-lg font-bold">Check your email</h2>
                  <p className="mt-1 text-sm text-ink/70">We sent a confirmation link to <b>{account.email}</b>. Confirm it, then sign in: your {defs.length > 1 ? 'businesses are' : 'business is'} saved and will be set up straight after.</p>
                  <div className="mt-4"><Link to="/sign-in" className="inline-flex h-9 items-center rounded-md bg-amber px-3.5 text-sm font-bold text-ink hover:bg-amber-dark">Go to sign in</Link></div>
                </Card>
              ) : !allCreated && (
                <Card>
                  <form onSubmit={onAccount} noValidate className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Your name" autoComplete="name" value={account.name} onChange={(e) => setAccount((a) => ({ ...a, name: e.target.value }))} error={accountErrors.name} autoFocus />
                    <TextField label="Email" type="email" autoComplete="email" value={account.email} onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))} error={accountErrors.email} />
                    <div className="sm:col-span-2"><TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters." value={account.password} onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))} error={accountErrors.password} /></div>
                    <div className="space-y-3 sm:col-span-2">
                      {formError && <ErrorState title="Could not continue" message={formError} />}
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="secondary" onClick={() => setStep(2)} disabled={busy}>Back</Button>
                        <Button type="submit" loading={busy}>{defs.length > 1 ? `Create account and ${defs.length} businesses` : 'Create account and business'}</Button>
                      </div>
                      <p className="text-sm text-ink/60">Already have an account? <Link to="/sign-in" onClick={persist} className="font-medium text-ink underline decoration-amber decoration-2 underline-offset-4">Sign in</Link></p>
                    </div>
                  </form>
                </Card>
              )}
            </div>
          )}
        </div>

        <SelectionSummary selected={defs} addons={addons} onToggleAddon={toggleAddon}>
          {step === 1 && <Button className="w-full" disabled={defs.length === 0} onClick={() => setStep(2)}>{defs.length > 1 ? `Continue with ${defs.length}` : 'Continue'}</Button>}
        </SelectionSummary>
      </div>
    </div>
  )
}

function Progress({ defs, results, names, allCreated, onOpen }: { defs: IndustryDefinition[]; results: Record<string, Result>; names: Record<string, string>; allCreated: boolean; onOpen: () => void }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">Progress</h2>
      <ul className="space-y-1.5 text-sm">
        {defs.map((d) => {
          const r = results[d.id]
          if (!r) return null
          return (
            <li key={d.id} className={r.id ? 'text-success' : 'text-danger'}>
              {r.id ? <><Check className="mr-1 inline size-4" aria-hidden />{names[d.id]} was created.</> : <>{getIndustry(d.id).name}: {r.error}</>}
              {r.notes.map((n) => <span key={n} className="block pl-5 text-warning">Needs attention: {n}. You can fix this in Settings.</span>)}
            </li>
          )
        })}
      </ul>
      {allCreated && <div className="mt-3"><Button type="button" onClick={onOpen}>Open my {defs.length > 1 ? 'businesses' : 'business'}</Button></div>}
    </Card>
  )
}
