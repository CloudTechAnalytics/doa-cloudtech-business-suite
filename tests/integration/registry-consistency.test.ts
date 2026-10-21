import { beforeAll, describe, expect, it } from 'vitest'
import { INDUSTRIES } from '@/core/industry-registry'
import { SHARED_PERMISSION_CODES } from '@/core/permissions/codes'
import { PLANS, planIncludes } from '@/core/subscriptions/plans'
import { ROLE_MODELLED_PERMISSIONS, rolePermissions } from '@/core/permissions/roles'
import { ALL_MODULES, CORE_MODULES, INDUSTRY_TEMPLATES } from '@/core/module-registry/registry'
import { createDb, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
beforeAll(async () => { db = await createDb() })

const sorted = (a: string[]) => [...a].sort()

describe('TypeScript registry matches the SQL seed', () => {
  it('has the same modules and permissions', async () => {
    const r = await rows<{ code: string; required_permission: string; is_core: boolean }>(db, 'select code, required_permission, is_core from public.modules')
    expect(sorted(r.map((x) => x.code))).toEqual(sorted(ALL_MODULES.map((m) => m.code)))
    for (const m of ALL_MODULES) {
      const row = r.find((x) => x.code === m.code)!
      expect(row.required_permission, m.code).toBe(m.permission)
      expect(row.is_core, m.code).toBe(CORE_MODULES.includes(m.code))
    }
  })

  it('has the same industry defaults, optional and required modules', async () => {
    for (const t of Object.values(INDUSTRY_TEMPLATES)) {
      const r = await rows<{ code: string; is_default: boolean; is_required: boolean }>(db,
        `select m.code, itm.is_default, itm.is_required from public.industry_template_modules itm
         join public.modules m on m.id = itm.module_id join public.industry_templates it on it.id = itm.industry_template_id
         where it.code = $1 and not m.is_core`, [t.code])
      expect(sorted(r.filter((x) => x.is_default).map((x) => x.code)), `${t.code} defaults`).toEqual(sorted(t.modules))
      expect(sorted(r.filter((x) => !x.is_default).map((x) => x.code)), `${t.code} optional`).toEqual(sorted(t.optionalModules))
      expect(sorted(r.filter((x) => x.is_required).map((x) => x.code)), `${t.code} required`).toEqual(sorted(t.requiredModules))
    }
  })

  it('has the same plan entitlements and limits', async () => {
    for (const [code, plan] of Object.entries(PLANS)) {
      const r = await rows<{ module: string; included: boolean }>(db,
        `select m.code as module, pm.included from public.plan_modules pm join public.modules m on m.id = pm.module_id
         join public.subscription_plans p on p.id = pm.plan_id where p.code = $1`, [code])
      for (const m of ALL_MODULES) {
        if (m.group === 'core' && CORE_MODULES.includes(m.code)) continue
        expect(r.find((x) => x.module === m.code)!.included, `${code}/${m.code}`).toBe(planIncludes(code as keyof typeof PLANS, m.code))
      }
      const [lim] = await rows<{ limits: { max_members: number; max_branches: number } }>(db, 'select limits from public.subscription_plans where code = $1', [code])
      expect(lim.limits).toEqual({ max_members: plan.limits.maxMembers, max_branches: plan.limits.maxBranches })
    }
  })

  it('grants the same permissions to each system role (within the permissions the UI knows)', async () => {
    const roles = ['owner', 'business_admin', 'manager', 'accountant', 'cashier', 'inventory_officer', 'operations_staff', 'pharmacist', 'pharmacy_technician', 'viewer'] as const
    const known = new Set(ROLE_MODELLED_PERMISSIONS)
    for (const role of roles) {
      const r = await rows<{ code: string }>(db, `select p.code from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
        join public.roles ro on ro.id = rp.role_id where ro.name = $1 and ro.business_id is null`, [role])
      const sql = sorted(r.map((x) => x.code).filter((c) => known.has(c)))
      expect(sql, role).toEqual(sorted([...rolePermissions(role)]))
    }
  })

  it('declares exactly the permissions the database seeds (shared + industry)', async () => {
    const sql = await rows<{ code: string }>(db, 'select code from public.permissions')
    const declared = [...SHARED_PERMISSION_CODES, ...Object.values(INDUSTRIES).flatMap((i) => i.permissions.map((p) => p.code))]
    expect(sorted(sql.map((r) => r.code))).toEqual(sorted(declared))
  })

  it('mirrors each industry definition in the database template', async () => {
    for (const d of Object.values(INDUSTRIES)) {
      const [row] = await rows<{ status: string; name: string }>(db, 'select status, name from public.industry_templates where code = $1', [d.id])
      expect(row, d.id).toBeDefined()
      expect(row.status, d.id).toBe(d.status)
      expect(row.name, d.id).toBe(d.name)
    }
  })

  it('gives pharmacy the same default modules in the database as in the registry', async () => {
    const r = await rows<{ code: string }>(db, `select m.code from public.industry_template_modules itm join public.industry_templates t on t.id = itm.industry_template_id join public.modules m on m.id = itm.module_id where t.code = 'pharmacy' and itm.is_default`)
    expect(r.map((x) => x.code).filter((c) => c.startsWith('pharmacy-')).sort()).toEqual(INDUSTRIES.pharmacy.modules.map((m) => m.code).sort())
    expect(INDUSTRY_TEMPLATES.pharmacy.available).toBe(true)
  })
})
