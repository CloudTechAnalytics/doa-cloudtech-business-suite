// The wording and layout of the emails Supabase Auth sends for DOA. This file is the source of truth; apply.mjs puts it on the live project.
//
// Written to be kept out of the spam folder, as far as wording can do it (the sender's reputation does the rest):
//   * a plain, specific subject with the product name, no capitals for emphasis, no exclamation marks, no sales words;
//   * the sender is named and the email says why the person is getting it, with the address it was sent to;
//   * one clear button plus the same link in plain text, no images, no shortened links, no tracking;
//   * a way to reach a person, and a line that says it is a message about their account.
// Template variables are Supabase's: {{ .ConfirmationURL }}, {{ .Token }}, {{ .Email }}, {{ .NewEmail }}, {{ .Data.name }}.

export const SUPPORT = 'doabusinesssuite@gmail.com'

const layout = ({ preheader, heading, greeting = 'Hello,', reason, body, button, link, after }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1c2b3a;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e1e7ee;border-radius:10px;">
<tr><td style="padding:22px 28px 6px 28px;font-size:20px;font-weight:700;">DOA Business Suite</td></tr>
<tr><td style="padding:6px 28px 0 28px;font-size:18px;font-weight:700;">${heading}</td></tr>
<tr><td style="padding:12px 28px 0 28px;font-size:15px;line-height:1.6;color:#33475b;">${greeting}<br><br>${body}</td></tr>
${button ? `<tr><td style="padding:18px 28px 0 28px;"><a href="${link}" style="display:inline-block;background:#f6b73c;color:#1c2b3a;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px;">${button}</a></td></tr>
<tr><td style="padding:12px 28px 0 28px;font-size:13px;line-height:1.5;color:#5b6b7f;">Or copy this link into your browser:<br><a href="${link}" style="color:#33475b;word-break:break-all;">${link}</a></td></tr>` : ''}
${after ? `<tr><td style="padding:14px 28px 0 28px;font-size:13px;line-height:1.5;color:#5b6b7f;">${after}</td></tr>` : ''}
<tr><td style="padding:20px 28px 22px 28px;font-size:12px;line-height:1.55;color:#6b7a8c;">${reason}<br>This is a message about your account, not an advertisement. Questions? Reply to this email or write to ${SUPPORT}.</td></tr>
</table></td></tr></table></body></html>`

const named = '{{ if .Data.name }}Hello {{ .Data.name }},{{ else }}Hello,{{ end }}'

export const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your email address for DOA Business Suite',
    html: layout({ preheader: 'One step to finish creating your DOA account.', heading: 'Confirm your email address', greeting: named,
      body: 'Thank you for creating a DOA account. To finish, please confirm that this email address is yours. After that you can sign in.', button: 'Confirm email address', link: '{{ .ConfirmationURL }}',
      after: 'The link works for one hour. If it has expired, go to the sign-in page and ask for a new one.', reason: 'You are receiving this because an account was created on DOA Business Suite with the address {{ .Email }}. If that was not you, you can ignore this email and no account will be activated.' }),
  },
  invite: {
    subject: 'You have been invited to join a business on DOA',
    html: layout({ preheader: 'Accept your invitation to start using DOA.', heading: 'You have been invited to DOA',
      body: 'You have been invited to join a business on DOA Business Suite. Accept the invitation to choose a password and get started. Please use this same email address, so your invitation is matched to you.', button: 'Accept the invitation', link: '{{ .ConfirmationURL }}',
      reason: 'You are receiving this because someone invited the address {{ .Email }} to DOA Business Suite. If you were not expecting it, you can ignore this email.' }),
  },
  magic_link: {
    subject: 'Your sign-in link for DOA Business Suite',
    html: layout({ preheader: 'Use this link to sign in.', heading: 'Sign in to DOA', body: 'Use the button below to sign in to DOA Business Suite. The link works once and expires soon.', button: 'Sign in', link: '{{ .ConfirmationURL }}',
      reason: 'You are receiving this because a sign-in link was requested for {{ .Email }}. If it was not you, you can ignore this email.' }),
  },
  recovery: {
    subject: 'Reset your password for DOA Business Suite',
    html: layout({ preheader: 'Choose a new password for your DOA account.', heading: 'Reset your password', body: 'We received a request to reset the password for your DOA account. Use the button below to choose a new one. The link works once and expires soon.', button: 'Choose a new password', link: '{{ .ConfirmationURL }}',
      reason: 'You are receiving this because a password reset was requested for {{ .Email }}. If it was not you, you can ignore this email and your password stays the same.' }),
  },
  email_change: {
    subject: 'Confirm your new email address for DOA Business Suite',
    html: layout({ preheader: 'Confirm the change of email address on your DOA account.', heading: 'Confirm your new email address', body: 'You asked to change the email address on your DOA account to {{ .NewEmail }}. Use the button below to confirm the change.', button: 'Confirm the change', link: '{{ .ConfirmationURL }}',
      reason: 'You are receiving this because a change of email address was requested for the account {{ .Email }}. If it was not you, do not use the button, and write to us.' }),
  },
  reauthentication: {
    subject: 'Your confirmation code for DOA Business Suite',
    html: layout({ preheader: 'Your one-time code for DOA.', heading: 'Your confirmation code', body: 'Enter this code in DOA to confirm it is you: <b style="font-size:20px;letter-spacing:3px;">{{ .Token }}</b>',
      after: 'The code works once and expires soon. Never share it with anyone.', reason: 'You are receiving this because a code was requested for {{ .Email }}. If it was not you, change your password and write to us.' }),
  },
}
