// The emails Supabase Auth sends for DOA (confirm your email, reset your password, and so on). One layout, six messages, all branded DOA.
// Run `node scripts/email-templates.mjs` to rewrite supabase/email-templates/*.html, then `node scripts/apply-email-templates.mjs` to put them on the project.
// {{ .ConfirmationURL }}, {{ .Email }}, {{ .NewEmail }} and {{ .Token }} are filled in by the auth service when each email is sent.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TEAL = '#0b4f5c'
const AMBER = '#f5a800'
const FONT = "'Segoe UI', Helvetica, Arial, sans-serif"

const wordmark = `<span style="font-family:'Trebuchet MS','Segoe UI',Arial,sans-serif;font-size:40px;font-weight:800;letter-spacing:-1px;line-height:1;"><span style="color:${TEAL};">d</span><span style="color:${AMBER};">o</span><span style="color:${TEAL};">a</span></span>`

function layout({ preheader, heading, paragraphs, button, code, note }) {
  const p = (text) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#33414d;">${text}</p>`
  const btn = button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px;"><tr><td style="border-radius:10px;background:${TEAL};"><a href="${button.url}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${button.label}</a></td></tr></table>
       <p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#6b7a86;">Button not working? Copy this link into your browser:<br><a href="${button.url}" style="color:${TEAL};word-break:break-all;">${button.url}</a></p>`
    : ''
  const codeBlock = code
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;"><tr><td style="background:#eef4f6;border-radius:10px;padding:16px 28px;font-family:'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${TEAL};">${code}</td></tr></table>`
    : ''
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#eef4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef4f6;">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef4f6;"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;font-family:${FONT};">
    <tr><td style="padding:0 4px 20px;">${wordmark}</td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;border-top:5px solid ${AMBER};padding:36px 36px 32px;box-shadow:0 2px 12px rgba(11,79,92,0.08);">
      <h1 style="margin:0 0 18px;font-size:26px;line-height:34px;font-weight:800;color:#0b1b33;">${heading}</h1>
      ${paragraphs.map(p).join('\n      ')}
      ${btn}${codeBlock}
      ${note ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e3ecf0;font-size:13px;line-height:20px;color:#6b7a86;">${note}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 8px 0;text-align:center;font-size:12px;line-height:18px;color:#7a8a96;">DOA &middot; one place to run your whole business<br>You received this email because of an action on your DOA account.</td></tr>
  </table>
</td></tr></table>
</body></html>
`
}

const IGNORE = 'If you did not do this, you can safely ignore this email and nothing will change.'

export const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your DOA account',
    html: layout({
      preheader: 'One tap to confirm your email and start using DOA.',
      heading: 'Confirm your email',
      paragraphs: ['Welcome to DOA. Confirm that <b>{{ .Email }}</b> is yours to finish creating your account.', 'The link works for a short time, so please confirm now.'],
      button: { label: 'Confirm my email', url: '{{ .ConfirmationURL }}' },
      note: 'If you did not create a DOA account, you can safely ignore this email.',
    }),
  },
  recovery: {
    subject: 'Reset your DOA password',
    html: layout({
      preheader: 'Choose a new password for your DOA account.',
      heading: 'Reset your password',
      paragraphs: ['We received a request to reset the password for <b>{{ .Email }}</b>. Use the button below to choose a new one.', 'The link works once and only for a short time.'],
      button: { label: 'Choose a new password', url: '{{ .ConfirmationURL }}' },
      note: 'If you did not ask for this, ignore this email. Your password stays the same and nobody can change it without this link.',
    }),
  },
  invite: {
    subject: 'You have been invited to DOA',
    html: layout({
      preheader: 'Accept your invitation and set up your DOA account.',
      heading: 'You have been invited',
      paragraphs: ['Someone has invited you to join DOA. Accept the invitation to set up your account.'],
      button: { label: 'Accept the invitation', url: '{{ .ConfirmationURL }}' },
      note: IGNORE,
    }),
  },
  magic_link: {
    subject: 'Your DOA sign-in link',
    html: layout({
      preheader: 'Use this link to sign in to DOA.',
      heading: 'Sign in to DOA',
      paragraphs: ['Use the button below to sign in as <b>{{ .Email }}</b>. The link works once and only for a short time.'],
      button: { label: 'Sign in', url: '{{ .ConfirmationURL }}' },
      note: IGNORE,
    }),
  },
  email_change: {
    subject: 'Confirm your new DOA email',
    html: layout({
      preheader: 'Confirm the change to your DOA email address.',
      heading: 'Confirm your new email',
      paragraphs: ['You asked to change the email on your DOA account from <b>{{ .Email }}</b> to <b>{{ .NewEmail }}</b>. Confirm to make the change.'],
      button: { label: 'Confirm the change', url: '{{ .ConfirmationURL }}' },
      note: 'If you did not ask for this, ignore this email and secure your account by changing your password.',
    }),
  },
  reauthentication: {
    subject: 'Your DOA verification code',
    html: layout({
      preheader: 'Your one-time code for DOA.',
      heading: 'Your verification code',
      paragraphs: ['Enter this code in DOA to confirm it is really you. It works once and expires soon.'],
      code: '{{ .Token }}',
      note: 'Never share this code with anyone. DOA will never ask you for it by phone or chat.',
    }),
  },
}

/** What the Supabase Auth settings call each part. */
export const CONFIG_KEYS = {
  confirmation: ['mailer_subjects_confirmation', 'mailer_templates_confirmation_content'],
  recovery: ['mailer_subjects_recovery', 'mailer_templates_recovery_content'],
  invite: ['mailer_subjects_invite', 'mailer_templates_invite_content'],
  magic_link: ['mailer_subjects_magic_link', 'mailer_templates_magic_link_content'],
  email_change: ['mailer_subjects_email_change', 'mailer_templates_email_change_content'],
  reauthentication: ['mailer_subjects_reauthentication', 'mailer_templates_reauthentication_content'],
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync('supabase/email-templates', { recursive: true })
  for (const [name, t] of Object.entries(TEMPLATES)) writeFileSync(`supabase/email-templates/${name}.html`, t.html)
  console.log('wrote', Object.keys(TEMPLATES).length, 'templates to supabase/email-templates/')
}
