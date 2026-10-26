import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// Minimal stand-in for the parts of Supabase the migrations depend on.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    instance_id uuid, aud text, role text, encrypted_password text, confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
    email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text, raw_app_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz
  );
  create table auth.identities (id uuid primary key, user_id uuid not null, provider_id text not null, identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  -- stand-ins for pgcrypto, which Supabase keeps in the extensions schema
  create schema extensions;
  create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
  create function extensions.crypt(pw text, salt text) returns text language sql as $$ select 'hash:' || md5(pw || salt) $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  const dir = join(process.cwd(), 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
  return db
}

export type Db = Awaited<ReturnType<typeof createDb>>

export async function createUser(db: Db, email: string, confirmed = true): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, ${confirmed ? 'now()' : 'null'}, $2::jsonb) returning id`,
    [email, JSON.stringify({ name: email.split('@')[0] })],
  )
  return r.rows[0].id
}

/** Runs queries as an authenticated Supabase user (RLS applies), then resets to superuser. */
export async function asUser<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  const claims = userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : '{}'
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
  await db.exec(userId ? 'set role authenticated' : 'set role anon')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows
}
