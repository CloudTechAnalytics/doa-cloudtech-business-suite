import { beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows
beforeAll(async () => { db = await createDb() })

/** Tables that authenticated users may delete from directly (each has a row-level-security policy that scopes it). */
const DIRECT_DELETE = ['crm_entity_tags', 'user_branch_access']

describe('database security invariants', () => {
  it('has row-level security on every table in public', async () => {
    const open = await q<{ name: string }>(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)
    expect(open.map((t) => t.name)).toEqual([])
  })

  it('gives signed-out visitors (anon) no table, sequence or function privileges at all', async () => {
    expect(await q(`select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`)).toEqual([])
    const fns = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`)
    expect(fns.map((f) => f.sig)).toEqual([])
  })

  it('lets signed-in users read tables but never write them directly, apart from two scoped deletes', async () => {
    const writes = await q<{ table_name: string; privilege_type: string }>(`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`)
    expect(writes.filter((w) => !(w.privilege_type === 'DELETE' && DIRECT_DELETE.includes(w.table_name)))).toEqual([])
  })

  it('limits direct writes to named columns that never include ids, owners or creators', async () => {
    const bad = await q<{ t: string; col: string; p: string }>(`select c.relname as t, a.attname as col, x.privilege_type as p from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace, lateral aclexplode(a.attacl) x
      where n.nspname = 'public' and a.attacl is not null and a.attnum > 0 and not a.attisdropped and x.privilege_type in ('INSERT', 'UPDATE')
        and ((x.privilege_type = 'UPDATE' and a.attname in ('id', 'business_id', 'created_by', 'created_at', 'owner_user_id')) or (x.privilege_type = 'INSERT' and a.attname in ('id', 'created_by', 'created_at', 'owner_user_id', 'recorded_by')))`)
    expect(bad).toEqual([])
  })

  it('does not let the everyone-role run any function (grants are explicit)', async () => {
    const fns = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`)
    expect(fns.map((f) => f.sig)).toEqual([])
  })

  it('pins the search path of every security-definer function', async () => {
    const loose = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text, '') like '%search_path%'`)
    expect(loose.map((f) => f.sig)).toEqual([])
  })

  it('keeps internal helpers and trigger functions out of reach of signed-in users', async () => {
    // Underscore helpers are for other database functions; a few are used inside row-level-security policies and so must be callable.
    const POLICY_HELPERS = ['_school_teaches_class', '_school_teaches_subject', '_school_is_guardian_of', '_school_can_see_student']
    const callable = await q<{ name: string }>(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and left(p.proname, 1) = '_' and has_function_privilege('authenticated', p.oid, 'EXECUTE')`)
    expect(callable.map((f) => f.name).filter((n) => !POLICY_HELPERS.includes(n))).toEqual([])
    const triggers = await q<{ name: string }>(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'EXECUTE')`)
    expect(triggers.map((f) => f.name)).toEqual([])
  })

  // farm_worker_names is the one deliberate exception: names and status only, with the caller's farm permission checked inside the view.
  it('has no view that skips the caller row-level security by accident', async () => {
    const views = await q<{ name: string }>(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text, '') like '%security_invoker=true%'`)
    expect(views.map((v) => v.name).filter((n) => n !== 'farm_worker_names')).toEqual([])
  })
})
