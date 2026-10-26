import { useEffect, useState } from 'react'
import { useAsync } from '@/shared/hooks/useAsync'
import type { IndustryCode, ModuleCode, PlanCode } from '@/shared/types/domain'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { canManageStaff, useDemoState } from '@/demo/demoStore'
import { PLANS } from '@/core/subscriptions/plans'
import type { ModuleStatus } from '@/core/module-registry/availability'
import { changeIndustry, demoSwitchPlan, disableModule, enableModule, previewIndustryChange } from '@/core/module-registry/moduleActions'
import type { IndustryPlan } from '@/core/module-registry/moduleActions'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { INDUSTRY_TEMPLATES, MODULES } from '@/core/module-registry/registry'
import { AuditPanel } from '@/core/audit/AuditPanel'
import { myTradePermissions } from '@/modules/sales/tradeApi'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Button, Card, ErrorState, Notice, PageHeader, SelectField } from '@/shared/components'
import { setBusinessTheme } from '@/core/businesses/businessActions'
import { THEMES, applyTheme, themeByKey } from '@/core/theme/themes'

const BADGE: Record<ModuleStatus['availability'], string> = {
  available: 'Active',
  disabled: 'Off',
  needs_plan: 'Needs plan upgrade',
  no_permission: 'No permission',
  not_compatible: 'Not compatible',
}

export function SettingsPage() {
  const { active, refresh: refreshBusinesses } = useBusiness()
  const { statuses, refresh } = useModules()
  const demo = useDemoState()
  const [error, setError] = useState<string | null>(null)
  const [livePlan, setLivePlan] = useState<{ name: string; status: string; ends: string } | null>(null)
  const [target, setTarget] = useState<IndustryCode | ''>('')
  const [preview, setPreview] = useState<IndustryPlan | null>(null)

  const businessId = active?.id
  useEffect(() => {
    if (isDemoMode || !supabase || !businessId) return
    supabase
      .from('subscriptions')
      .select('status, current_period_end, subscription_plans(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const r = data?.[0] as unknown as { status: string; current_period_end: string; subscription_plans: { name: string } } | undefined
        setLivePlan(r ? { name: r.subscription_plans.name, status: r.status, ends: r.current_period_end.slice(0, 10) } : null)
      })
  }, [businessId])

  const perms = useAsync(() => (businessId ? myTradePermissions(businessId) : Promise.resolve([] as string[])), [businessId])
  if (!active) return null
  const demoPlan = demo.modules[active.id]?.plan ?? null
  const template = INDUSTRY_TEMPLATES[active.industry]

  async function run(action: Promise<string | null>) {
    const err = await action
    setError(err)
    await refresh()
    return err
  }

  async function onPreview(code: IndustryCode | '') {
    setTarget(code)
    setPreview(null)
    if (!code) return
    const r = await previewIndustryChange(active!.id, code)
    setError(r.error ?? null)
    setPreview(r.plan ?? null)
  }

  async function onChange(confirm: boolean) {
    if (!target) return
    const err = await changeIndustry(active!.id, target, confirm)
    setError(err)
    if (!err) {
      setTarget('')
      setPreview(null)
      await refreshBusinesses()
      await refresh()
    }
  }

  return (
    <>
      <PageHeader title="Settings" description={`${active.name} · ${template.name}`} />
      {error && <ErrorState message={error} />}

      {(isDemoMode ? canManageStaff(active.role ?? null) : perms.data?.includes('settings.manage')) && <Appearance businessId={active.id} current={themeByKey(active.theme).key} onSaved={refreshBusinesses} />}

      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-semibold">Subscription</h2>
        {isDemoMode ? (
          <>
            <p className="text-sm">
              Plan: <b>{demoPlan ? PLANS[demoPlan].name : 'None (lapsed)'}</b>
              {demoPlan && <> · up to {PLANS[demoPlan].limits.maxMembers} members, {PLANS[demoPlan].limits.maxBranches} branch(es)</>}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink/60">Demo plan switcher (stands in for payment webhooks):</span>
              {([...Object.keys(PLANS), null] as (PlanCode | null)[]).map((p) => (
                <Button key={p ?? 'none'} variant={p === demoPlan ? 'primary' : 'secondary'} onClick={() => setError(demoSwitchPlan(active.id, p))}>
                  {p ? PLANS[p].name : 'Lapse'}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm">{livePlan ? <>Plan: <b>{livePlan.name}</b> · {livePlan.status} · renews/ends {livePlan.ends}</> : 'No subscription information available.'}</p>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-semibold">Modules</h2>
        <p className="mb-3 text-xs text-ink/60">Turning a module off never deletes its records; they stay readable and reappear if you turn it back on.</p>
        <ul className="divide-y divide-ink/10">
          {statuses.map((s) => (
            <li key={s.code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <b>{MODULES[s.code].name}</b>
                <span className="ml-2 text-xs text-ink/60">{s.isCore ? 'Core' : s.isRequired ? 'Required' : ''}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-ink/70">{BADGE[s.availability]}</span>
                {!s.isRequired && (
                  s.enabled
                    ? <Button variant="secondary" onClick={() => run(disableModule(active.id, s.code as ModuleCode))}>Turn off</Button>
                    : <Button variant="secondary" onClick={() => run(enableModule(active.id, s.code as ModuleCode))}>Turn on</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Change industry</h2>
        <p className="mb-3 text-xs text-ink/60">Owner only. Incompatible modules are switched off, never deleted, and you must confirm first.</p>
        <SelectField label="New industry" value={target} onChange={(e) => void onPreview(e.target.value as IndustryCode | '')}>
          <option value="">Select…</option>
          {Object.values(INDUSTRY_TEMPLATES).filter((t) => t.code !== active.industry).map((t) => (
            <option key={t.code} value={t.code} disabled={!t.available}>{t.name}{t.available ? '' : ' (coming later)'}</option>
          ))}
        </SelectField>
        {preview && (
          <div className="mt-3 space-y-3">
            <Notice>
              Will be switched off: {preview.incompatible.length ? preview.incompatible.map((c) => MODULES[c].name).join(', ') : 'nothing'}.
              <br />
              Will be turned on: {preview.toEnable.length ? preview.toEnable.map((c) => MODULES[c].name).join(', ') : 'nothing'}.
            </Notice>
            <Button onClick={() => void onChange(true)}>Confirm change</Button>
          </div>
        )}
      </Card>
      {perms.data?.includes('audit.read') && <AuditPanel businessId={active.id} />}
    </>
  )
}

/** Colour theme picker: choosing a swatch repaints the workspace straight away and saves it for everyone in the business. */
function Appearance({ businessId, current, onSaved }: { businessId: string; current: string; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function pick(key: string) {
    setBusy(true); setError(null)
    const err = await setBusinessTheme(businessId, key)
    if (err) { setError(err); applyTheme(themeByKey(current)) } else { applyTheme(themeByKey(key)); await onSaved() }
    setBusy(false)
  }
  return (
    <Card className="mb-4">
      <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
      <p className="mb-3 text-xs text-ink/60">Choose the colours of your workspace. Everyone in this business sees the same colours.</p>
      <ul className="flex flex-wrap gap-3" aria-label="Colour themes">
        {THEMES.map((t) => (
          <li key={t.key}>
            <button type="button" disabled={busy} onClick={() => void pick(t.key)} aria-pressed={t.key === current} aria-label={`${t.name} theme`}
              className={`flex w-24 flex-col items-center gap-2 rounded-lg border p-2 text-xs font-medium transition hover:-translate-y-0.5 ${t.key === current ? 'border-accent ring-2 ring-accent' : 'border-line'}`}>
              <span className="flex h-9 w-full overflow-hidden rounded-md" aria-hidden><span className="w-1/3" style={{ background: t.brand }} /><span className="w-1/3" style={{ background: t.accent }} /><span className="w-1/3" style={{ background: t.cta }} /></span>
              {t.name}{t.key === current && ' ✓'}
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="mt-3"><ErrorState title="Not saved" message={error} /></div>}
    </Card>
  )
}
