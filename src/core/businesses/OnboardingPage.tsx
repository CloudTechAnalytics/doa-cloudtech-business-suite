import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { getIndustry, listIndustries } from '@/core/industry-registry'
import { answersToSettings } from '@/core/industry-registry/settings'
import type { SetupAnswerValue } from '@/core/industry-registry/types'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { demoCreateBusiness } from '@/demo/demoStore'
import { Button, Card, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import type { IndustryCode } from '@/shared/types/domain'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { SetupFields } from './SetupFields'

export function OnboardingPage() {
  const navigate = useNavigate()
  const { refresh, select } = useBusiness()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [industry, setIndustry] = useState<IndustryCode>('retail')
  const [answers, setAnswers] = useState<Record<string, SetupAnswerValue>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const definition = getIndustry(industry)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = String(f.get('name') ?? '').trim()
    const next: Record<string, string> = { ...validateSetupAnswers(definition, answers) }
    if (!name) next.name = 'Enter the business name.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    const settings = answersToSettings(definition, answers)

    if (isDemoMode) {
      select(demoCreateBusiness(name, industry, settings))
      navigate('/app/dashboard')
      return
    }
    if (!supabase) return setFormError('Backend not configured.')

    setBusy(true)
    const { data, error } = await supabase.rpc('create_business', {
      p_name: name, p_industry: industry, p_currency: String(f.get('currency')), p_timezone: String(f.get('tz')),
    })
    if (error) { setBusy(false); return setFormError(error.message) }
    // Setup answers are saved as validated business settings (the owner holds settings.manage).
    if (Object.keys(settings).length) {
      const upd = await supabase.from('businesses').update({ settings }).eq('id', data as string)
      if (upd.error) setFormError(`Business created, but setup answers were not saved: ${upd.error.message}`)
    }
    setBusy(false)
    await refresh()
    select(data as string)
    navigate('/app/dashboard')
  }

  return (
    <>
      <PageHeader title="Create a business" description="Choose an industry and answer a few setup questions. You can add more businesses later under the same login." />
      <Card>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <TextField label="Business name" name="name" error={errors.name} />
          <SelectField label="Industry" value={industry} onChange={(e) => { setIndustry(e.target.value as IndustryCode); setAnswers({}); setErrors({}) }} hint={definition.description}>
            {listIndustries().map((d) => (
              <option key={d.id} value={d.id} disabled={d.status !== 'active'}>{d.name}{d.status === 'active' ? '' : ' (coming later)'}</option>
            ))}
          </SelectField>
          <SelectField label="Currency" name="currency" defaultValue="NGN"><option value="NGN">Nigerian Naira (NGN)</option></SelectField>
          <SelectField label="Timezone" name="tz" defaultValue="Africa/Lagos"><option value="Africa/Lagos">Africa/Lagos</option></SelectField>
          <SetupFields questions={definition.onboarding.questions} answers={answers} errors={errors} onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} />
          <div className="space-y-3 sm:col-span-2">
            {formError && <ErrorState title="Could not create business" message={formError} />}
            <Button type="submit" loading={busy}>Create business</Button>
          </div>
        </form>
      </Card>
    </>
  )
}
