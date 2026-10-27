# Launch checklist (pilot)

What stands between "it works" and "a real school or business can rely on it". Tick these off before each new pilot. See [school.md](school.md) and [apps.md](apps.md) for what is and is not built.

## 1. Email (sign-up, password reset, invitations)

Until a mail provider is connected, Supabase's built-in sender is limited to **2 emails an hour for the whole project**, and it will not let the email templates be changed. A school onboarding parents would stop receiving confirmation emails after the second.

- [ ] Sign in to the support Gmail account (`doabusinesssuite@gmail.com`), open **Google Account, Security**, turn on **2-Step Verification**, then open **App passwords**, create one called "DOA" and copy the 16-character code.
- [ ] Give the code to whoever applies the setting. It connects the live project to Gmail (`smtp.gmail.com`, port 465), sets the sender to "DOA Business Suite", raises the limit to 30 an hour, and installs the DOA-branded email templates. The code is used once and is not stored anywhere in the repository.
- [ ] Send a test: use **Forgot your password?** on the live site with a real account and check the email arrives (not in spam) and the link works.
- Gmail allows about 500 emails a day from one account and the mail comes from a Gmail address, so it can land in spam. **Move to a proper sender on your own domain** (Resend, Brevo or similar, with SPF and DKIM set up) before a school with hundreds of parents starts.
- The "Site URL" and the allowed redirect addresses in Supabase Auth must match the live address (now `https://project-mq6x9.vercel.app`). **Change them the day a custom domain is added.**

## 2. Legal and contact

- [x] Terms of use (`/terms`), Privacy notice (`/privacy`) and Contact page (`/contact`), linked from the footer, with a notice on the create-account form. The company name and support address are in one place (`src/shared/utilities/site.ts`; the address can be overridden with `VITE_SUPPORT_EMAIL` in Vercel).
- [ ] **Have a Nigerian lawyer read the Terms and the Privacy notice** and change the wording where they advise. Update the date in `SITE.legalUpdated` when you do. The pages were written in plain language from what DOA actually does; they are a starting point, not legal advice.
- [ ] Decide who answers the support address, and how quickly. The pages promise a reply "as soon as we can" and an answer to data requests "within one month". Make sure someone can keep those promises.
- [ ] Schools need a short note for parents (from the school) about what information is held and why. The Privacy notice can be linked from it.

## 3. Hosting

- [x] The Vercel project has the Supabase URL and key set (the live site shows real data).
- [ ] **Backups.** The free Supabase plan has no point-in-time recovery. Move to a paid plan with backups before a school's real records go in, and test a restore once.
- [ ] A way to give a school a copy of its data. Not built yet (on the school v2 list); until then it is done by hand on request.
- [ ] Revoke any Supabase access token that was shared for setup.

## 4. Before the first real day

- [ ] Rehearse on the live site with a test school: create it, import students, take attendance, enter and approve results, record fees and print a receipt, create report cards, and sign in as a teacher and as a parent.
- [ ] Look at the main screens on a phone.
- [ ] Agree the pilot terms with the school: what is built, what is not (online payments, SMS and email to parents), and that fees are recorded by hand.
