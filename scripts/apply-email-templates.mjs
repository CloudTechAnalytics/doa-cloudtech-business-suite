// Puts the DOA email templates on the Supabase project (Authentication > Emails). Needs a Supabase access token in SUPABASE_ACCESS_TOKEN
// and the project reference, either as the first argument or from VITE_SUPABASE_URL in the environment or .env.local.
// The token is only ever read from the environment; it is never written anywhere.
import { existsSync, readFileSync } from 'node:fs'
import { CONFIG_KEYS, TEMPLATES } from './email-templates.mjs'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) { console.error('Set SUPABASE_ACCESS_TOKEN first.'); process.exit(1) }
let ref = process.argv[2]
if (!ref) {
  const url = process.env.VITE_SUPABASE_URL ?? (existsSync('.env.local') ? /VITE_SUPABASE_URL=(\S+)/.exec(readFileSync('.env.local', 'utf8'))?.[1] : undefined)
  ref = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
}
if (!ref) { console.error('Pass the project reference as the first argument.'); process.exit(1) }

const body = {}
for (const [name, t] of Object.entries(TEMPLATES)) { const [subject, content] = CONFIG_KEYS[name]; body[subject] = t.subject; body[content] = t.html }
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
if (!res.ok) { console.error('Failed:', res.status, (await res.text()).slice(0, 300)); process.exit(1) }
console.log(`Applied ${Object.keys(TEMPLATES).length} DOA email templates to project ${ref}.`)
