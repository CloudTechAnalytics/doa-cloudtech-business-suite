import { Check } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { industryColor } from '@/app/navigation/navigation'
import { BrandLockup } from '@/app/layouts/Brand'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { listIndustries } from '@/core/industry-registry'
import { answersToSettings } from '@/core/industry-registry/settings'
import type { IndustryDefinition, SetupAnswerValue } from '@/core/industry-registry/types'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { enableModule } from '@/core/module-registry/moduleActions'
import { MODULES } from '@/core/module-registry/registry'
import { demoCreateBusiness } from '@/demo/demoStore'
import { Button, Card, ErrorState, Notice, SelectField, TextField } from '@/shared/components'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { BusinessTypePicker } from './BusinessTypePicker'
import { toggleSelection } from './selection'
import { SelectionSummary } from './SelectionSummary'
import { SetupFields } from './SetupFields'

interface Result { id?: string; error?: string; notes: string[] }
type Answers = Record<string, SetupAnswerValue>

/**
 * Two steps on one page, in the style of Odoo's "Choose your Apps": tick one or more business types,
 * then name each business and answer that industry's setup questions. Each ticked type becomes its own
 * business (a business has exactly one industry), all under the same owner.
 */
export function OnboardingPage() {
  const navigate = useNavigate()
  const { businesses, refresh, select } = useBusiness()
  const { signOut } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  const [selected, setSelected] = useState<IndustryCode[]>([])
  const [addons, setAddons] = useState<Record<string, Set<ModuleCode>>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, Answers>>({})
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Registry order keeps the page stable however the cards were ticked.
  const defs = listIndustries().filter((d) => selected.includes(d.id))
  const allCreated = defs.length > 0 && defs.every((d) => results[d.id]?.id)
  const toggleAddon = (industry: IndustryCode, code: ModuleCode) => setAddons((a) => {
    const set = new Set(a[industry] ?? [])
    if (set.has(code)) set.delete(code); else set.add(code)
    return { ...a, [industry]: set }
  })

  async function createOne(d: IndustryDefinition, common: { currency: string; tz: string }): Promise<Result> {
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
    for (const code of addons[d.id] ?? []) {
      const err = await enableModule(id, code)
      if (err) notes.push(`could not add ${MODULES[code]?.name ?? code} (${err})`)
    }
    return { id, notes }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const pending = defs.filter((d) => !results[d.id]?.id)
    const next: Record<string, Record<string, string>> = {}
    for (const d of pending) {
      const errs = { ...validateSetupAnswers(d, answers[d.id] ?? {}) }
      if (!(names[d.id] ?? '').trim()) errs.name = 'Enter the business name.'
      if (Object.keys(errs).length) next[d.id] = errs
    }
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return

    setBusy(true)
    const common = { currency: String(f.get('currency')), tz: String(f.get('tz')) }
    const out: Record<string, Result> = { ...results }
    // One at a time, so a failure never leaves the others half-created and a retry skips what already worked.
    for (const d of pending) out[d.id] = await createOne(d, common)
    setBusy(false)
    setResults(out)
    await refresh()

    const created = defs.map((d) => out[d.id]?.id).filter((x): x is string => !!x)
    if (created.length) select(created[0])
    const clean = defs.every((d) => out[d.id]?.id && out[d.id].notes.length === 0)
    if (clean) navigate('/app')
    else if (created.length === 0) setFormError('No business was created. Check the messages below and try again.')
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLockup />
          <div className="flex items-center gap-4 text-sm font-medium text-ink/70">
            {businesses.length > 0 && <Link to="/app" className="hover:text-ink">Back to apps</Link>}
            <button type="button" onClick={signOut} className="hover:text-ink">Sign out</button>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-12 pt-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            {step === 1 ? 'Choose your ' : 'Set up your '}
            <span className="relative inline-block">business{step === 2 && defs.length > 1 ? 'es' : ''}<span aria-hidden className="absolute -bottom-1.5 left-0 h-1.5 w-full rounded-full bg-mint" /></span>
          </h1>
          <p className="mt-5 text-base font-medium text-ink">
            {step === 1 ? 'Tick every kind of business you run. Each one becomes its own business.' : 'A few details for each, and you are ready to start.'}
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_300px]">
        <div>
          {step === 1 ? (
            <BusinessTypePicker industries={listIndustries()} selected={selected} onToggle={(id) => setSelected((s) => toggleSelection(s, id))} />
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {Object.keys(results).length > 0 && (
                <Card>
                  <h2 className="mb-2 text-sm font-semibold">Progress</h2>
                  <ul className="space-y-1.5 text-sm">
                    {defs.map((d) => {
                      const r = results[d.id]
                      if (!r) return null
                      return (
                        <li key={d.id} className={r.id ? 'text-success' : 'text-danger'}>
                          {r.id ? <><Check className="mr-1 inline size-4" aria-hidden />{names[d.id]} was created.</> : <>{d.name}: {r.error}</>}
                          {r.notes.map((n) => <span key={n} className="block pl-5 text-warning">Needs attention: {n}. You can fix this in Settings.</span>)}
                        </li>
                      )
                    })}
                  </ul>
                  {allCreated && <div className="mt-3"><Button type="button" onClick={() => navigate('/app')}>Open my {defs.length > 1 ? 'businesses' : 'business'}</Button></div>}
                </Card>
              )}

              <Card>
                <h2 className="mb-3 text-sm font-semibold">{defs.length > 1 ? 'Settings for all of them' : 'Settings'}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Currency" name="currency" defaultValue="NGN"><option value="NGN">Nigerian Naira (NGN)</option></SelectField>
                  <SelectField label="Timezone" name="tz" defaultValue="Africa/Lagos"><option value="Africa/Lagos">Africa/Lagos</option></SelectField>
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
                  <Button type="submit" loading={busy}>{defs.length > 1 ? `Create ${defs.filter((d) => !results[d.id]?.id).length} businesses` : 'Create business'}</Button>
                </div>
              )}
              {defs.length > 1 && !allCreated && <Notice>Each business has its own data, staff and subscription. If one fails, the others are kept and you can retry just that one.</Notice>}
            </form>
          )}
        </div>

        <SelectionSummary selected={defs} addons={addons} onToggleAddon={toggleAddon}>
          {step === 1 && <Button className="w-full" disabled={defs.length === 0} onClick={() => setStep(2)}>{defs.length > 1 ? `Continue with ${defs.length}` : 'Continue'}</Button>}
        </SelectionSummary>
      </div>
    </div>
  )
}
