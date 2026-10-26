# Deployment

## Database (Supabase)

All schema lives in `supabase/migrations/`, applied in file-name order (0001 to 0022 so far). A fresh project has no business data: the only rows the migrations insert are
reference data the app needs to work (industries, modules, permissions, system roles, the four plans).

Apply with the Supabase CLI (`supabase link` then `supabase db push`) or by running each file in order in the SQL editor. Every new migration must grant what it adds,
explicitly: migration 0022 removes all default exposure, so a new table or function is unreachable from the browser until a migration grants it.
`tests/integration/security.test.ts` fails if anything drifts (row-level security off, anything for signed-out visitors, writes outside named columns, loose functions).

## Website (Vercel or any static host)

Set two build-time variables, then redeploy:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | the project URL, `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's **anon** key (safe in the browser). Never use the service-role key. |

Without them a production build shows a "not connected" page. It never falls back to demo data. Demo mode (sample businesses and logins) only exists for local development with no `.env.local`, and for the automated tests.

## Auth settings (Supabase dashboard, Authentication)

* Site URL and redirect URLs: the production address (and `http://localhost:5173/**` for development).
* Passwords: at least 10 characters with lowercase, uppercase and a digit (the sign-up form checks the same rules).
* Email confirmation is on. Supabase's built-in mail sender is limited to a few emails an hour, so configure a real SMTP provider before inviting customers.
* Anonymous sign-ins and open redirects stay off.

## First platform owner

1. Open the site and sign up with your own email, then confirm it.
2. In the SQL editor, once:

```sql
insert into public.platform_admins (user_id, role)
select id, 'owner' from auth.users where email = 'you@example.com';
```

3. Sign in again; "Platform console" appears in your account menu. Add engineers and support staff from Platform Team.

## Keys and tokens

A Supabase personal access token (`sbp_...`) can change the whole project. Treat it like a password: never commit it, and revoke it in Account, Access Tokens once you have finished using it.
