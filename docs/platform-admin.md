# Platform console

The place where the people who run DOA (not any one business) see every business and client, and manage the system. It lives at `/platform`.
Migration: `supabase/migrations/20261021000021_platform_admin.sql`. Demo mirror: `src/demo/demoPlatform.ts`.

## Who can use it

A separate `platform_admins` table, completely independent of business roles. Being the owner of a business gives no access here.

| Role | Can |
|---|---|
| owner | Everything, including transferring a business to another of its members, deleting (archiving) a business, and adding or removing platform team members |
| engineer | See everything; edit a business, change plans, extend trials, mark as paid, cancel, suspend or reactivate a business, and set a person inactive or remove them from a business |
| support | See everything; change nothing |

There must always be at least one owner. Make the first owner once, as the database owner:

```sql
insert into public.platform_admins (user_id, role)
select id, 'owner' from auth.users where email = 'you@example.com';
```

After that, owners add people from **Platform Team** in the console (the person needs an account first).

## Pages

Dashboard (businesses, paying, trials, suspended, MRR and ARR, users, by kind of business, trials ending soon, health), Businesses (search, owner, plan; open one for its people,
subscription, apps and the changes made from the console), Users, Subscriptions, Plans & Pricing, Platform Team, Audit Log, System Health.

## System Health

Service cards time a real request from your browser to the database API, sign-in and the website hosting (under 1.5 s is operational, up to 4 s degraded, slower or failing is not responding), and refresh every minute. Below them: database and file storage against the plan limits (turns amber at 70% and red at 90%), platform-wide counts, and data checks over the real records (businesses without a subscription, trials that ran out, past-due subscriptions). There is no emailed alert yet. Realtime and Edge Functions are not shown because DOA does not use them.

## Row actions

Every business row has a menu: View, Edit, Suspend or Reactivate, Transfer ownership (owner), View subscription, Open audit log, Delete business (owner; type the name to confirm; the business is archived and nothing is erased) and Delete permanently (owner; type the name and give a reason; every record of the business is erased from the database and cannot be recovered. Only the platform log of the deletion is kept). Every user row (one per person per business) has Set inactive, Set active again and Remove from business. The Subscriptions page lists every business with its plan and status as drop-downs; changing one asks for a reason first.

## Security

* No table is readable or writable from the console directly. Everything goes through `platform_*` security-definer functions that first check `platform_admins`.
* Every change needs a reason of at least three characters and is written to `platform_audit_log` (who, what, which business, why). That log cannot be updated or deleted.
* Suspending a business makes `is_active_member` false for everyone in it, so access stops at once. Nothing is deleted; reactivating restores it.
* Demo mode: `platform@demo.test` (owner), `engineer@demo.test`, `support@demo.test`, password `demo1234`.

## Not built (no data behind it yet)

Billing and revenue analytics beyond MRR/ARR, support tickets, error logs, platform-wide settings, and "start a support session" (impersonating a business user, deliberately left out because it needs its own consent, time limit and audit design).
"Signed in today" uses `auth.users.last_sign_in_at` and shows a dash in demo mode.

## Deleting a user

On **Users**, the platform owner has **Delete user** in each row's menu. They type the account's email and give a reason (kept in the audit log). The account is erased and the person is taken out of every business. It is refused for yourself, for anyone on the platform team (remove them from the team first) and for anyone who still owns a business (transfer ownership or delete the business first). An account that has recorded sales, payments or stock movements cannot be erased; the deletion is refused and nothing changes, so use **Remove from business** instead, which keeps those records.
