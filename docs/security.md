# Security

## Tenant isolation

- Every table in `public` has row-level security enabled (asserted by `tests/security/tenant-isolation.test.ts`, which also discovers every `business_id` table at run time).
- Authenticated users receive only `SELECT` plus narrow column-level `INSERT`/`UPDATE` grants where a screen edits records directly. Money, stock, membership, ownership, industry, module and subscription changes have no direct write path; they go through `SECURITY DEFINER` functions with a fixed `search_path`.
- Policies call `has_business_permission()` / `has_module_permission()`, which resolve membership, role, branch restrictions, module state and plan entitlement from the database. A `business_id` supplied by the browser is never proof of access.
- Composite foreign keys `(business_id, id)` prevent a record in one business from referencing a record in another (products, locations, customers, tasks assigned to members, branch access, and so on).
- Revoking a membership removes access to every table immediately.

## Entitlements

`module_usable(business, module, mode)`: `use` requires the module to be enabled and included in the plan (core modules excepted); `read` keeps historical records readable after a module is switched off or a subscription lapses. Plan limits (members, branches) are enforced in SQL. Subscription status changes come from verified, idempotent provider events (`subscription_events.provider_event_reference` is unique); no browser claim of payment is trusted. No payment provider is integrated yet.

## Audit

`audit_logs` is written only by triggers (no `INSERT` grant), is immutable (even for the table owner), and is readable only with `audit.read` (owner and administrator roles). Updates store the changed columns only, excluding `updated_at`, idempotency keys and provider references; derived payment totals do not create log noise. `business_id` is intentionally not a foreign key so history survives record deletion.

## Settings

`businesses.settings` is validated JSON with defined owners (`tax_rate_percent`, `allow_negative_stock`, `setup`). Unknown keys, wrong types and nested setup answers are rejected by the database.

## Secrets

Only the Supabase URL and anon key reach the browser (`VITE_*`). The service-role key must never be placed in client code or a `VITE_` variable. Demo accounts and demo data exist only in the browser's local storage, have no security value, and switch off as soon as Supabase is configured.

## Known gaps

- Tests run against an in-process PostgreSQL (PGlite) with a stand-in for Supabase Auth. Run the same migrations and tests against a real Supabase instance before launch, including true concurrent stock postings.
- No private file storage or signed downloads yet (no feature uses files).
- No rate limiting or bot protection beyond Supabase Auth defaults.
- Pharmacy compliance (prescriptions, controlled medicines, privacy and recordkeeping) is not assessed; the module is `coming_soon`.
