// Puts the email wording in templates.mjs on the live Supabase project (needs custom email sending to be set up first).
// Usage:  SB_TOKEN=<supabase access token> node supabase/email-templates/apply.mjs
// The token is read from the environment and is never written anywhere. Revoke it afterwards.
import { TEMPLATES } from './templates.mjs'

const REF = 'owgoqrybzrkexfygqxer'
const token = process.env.SB_TOKEN
if (!token) { console.error("Set SB_TOKEN to a Supabase access token first."); process.exit(1) }

const body = {}
for (const [k, v] of Object.entries(TEMPLATES)) { body[`mailer_subjects_${k}`] = v.subject; body[`mailer_templates_${k}_content`] = v.html }
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
console.log(res.status, res.ok ? 'email templates applied' : await res.text())
process.exitCode = res.ok ? 0 : 1
