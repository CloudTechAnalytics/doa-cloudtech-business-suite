# CloudTech Business Suite (DOA B-Suite)

A multi-tenant, multi-industry business management platform from CloudTech Analytics. One owner can run several separate businesses (a farm, a bakery, a retail shop), each with its own industry, staff, data, modules and subscription. Retail (Mart), Farm, Bakery and Pharmacy are registered.

Stack: React 19, TypeScript, Tailwind CSS 4, Supabase (PostgreSQL, Row Level Security, Auth). Modular monolith: one app, one database, one tenant model.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check + production build
npm run lint
npm test               # 230+ tests (in-process PostgreSQL via PGlite; no Docker needed)
```

Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` the app runs in **demo mode**: a browser-only backend with demo logins and illustrative data. It switches off automatically when the variables are set. Copy `.env.example` to `.env` to configure Supabase; never put the service-role key in any `VITE_*` variable.

Demo logins (password `demo1234`): `owner@demo.test` (owns a farm, a bakery, a retail shop and a pharmacy), `cashier@demo.test` (cashier at CityMart), `accountant@demo.test`.

## Layout

```text
src/app/          layouts, providers, router, navigation builder
src/core/         auth, businesses, business-context, permissions, subscriptions,
                  module-registry, industry-registry, audit
src/shared/       components, forms, tables, hooks, utilities, types
src/modules/      shared business modules: crm, inventory, sales, purchasing, expenses,
                  staff, reporting, notifications
src/industries/   retail, farm, bakery, pharmacy
src/integrations/ payments interface (no provider yet)
src/demo/         browser-only demo backend
supabase/migrations/   schema, RLS, business rules
tests/            integration/, security/, helpers/
docs/             architecture, adding-an-industry, security, database
```

Read [docs/architecture.md](docs/architecture.md) first. To add an industry see [docs/adding-an-industry.md](docs/adding-an-industry.md): one folder plus a registration line, with no change to the router, sidebar, registry or shared modules. Security and tenant isolation are in [docs/security.md](docs/security.md); the schema is in [docs/database.md](docs/database.md).

## What exists

- **Core:** sign-in, multiple businesses per owner with a business switcher, memberships and roles, plan and module entitlements enforced in the database, validated settings, audit log, subscription events.
- **Shared modules:** CRM (leads, customers, notes, follow-ups, tags, lead conversion without duplicates, credit limits), inventory (append-only ledger, weighted-average cost, transfers, counts, reconciliation), sales and POS (server-side totals, payments, returns, voids, receipts), purchasing (orders, goods received, supplier payments), staff and roles.
- **Industries:** Retail (composes shared modules), Farm (production units, batches with a population ledger, mortality, feeding from shared stock, harvests into shared stock, daily log, corrections and voids, products, health and withdrawal periods, tasks and workers, equipment and maintenance, crop cycles, purchase requests, supplier bills, sales orders, expenses, receivables, payables, cashbook, reports and alerts, and a dashboard that shows the farm overview) and Bakery (ingredients with reorder alerts, products with shelf life, versioned recipes with costing, production planning and atomic completion, expiry lots served first-expiry-first-out, waste, a dashboard and production, yield, waste and profit reports, on top of the shared sales, purchasing, inventory and expenses), Pharmacy (scaffold, unavailable).

## Not built yet

- Bakery: ingredient batch and expiry dates (only finished goods have expiry lots), pack products, a guided setup wizard with removable sample data; notification delivery, payment-provider integration, platform administration, browser end-to-end tests. From the reference farm system: separate Poultry and Fish pages (Farm Batches covers them), per-site access, customer statements and payroll. Migrations 0001 to 0012 have only been run against the in-memory test database, never a real Supabase project.
- The migrations have not been run against a real Supabase project, and stock locking has not been tested under truly concurrent connections (the test database has one connection). Do both before launch.
- Pricing is a commercial decision and is not defined; no payment processing exists.

## UI conventions

The look follows Odoo (taken from odoo.com's own stylesheet): Inter throughout, brand navy `#071B33` with deep blue `#0B2A4A` as its darker shade, teal `#017E84` as the secondary accent, near-black text `#111827`, light grey canvas `#F8F9FA`, soft borders and rounded corners. Navigation: a navy top navbar with an apps button and a home screen of app tiles (Odoo's model), plus a left sidebar inside every app listing all usable modules grouped by app. The sidebar collapses to icons (remembered per browser) and becomes a drawer on phones. The site starts at a public landing page (`/`, in `src/app/landing/`) in Odoo's style: white hero with a highlighted headline, then a grey arched section of apps, industries and reasons to join. The header's "Apps" and "Industries" open wide drop-down panels (hover or click, Escape closes, a dimmed backdrop behind) built from the module and industry registries, with "Preview" and "Soon" labels on unfinished modules. "Try it free" opens "Choose your business" (`/start`), which works before sign-in; an account is created at the end and the visitor's choices are kept in the browser so they survive sign-up and email confirmation. Creating a business starts with a "Choose your business" page where you can tick several business types (each becomes its own business) in the same style (white header, light grey canvas, cards grouped by category, a sticky selection panel with included modules and optional add-ons); the groups, icons and descriptions come from the industry registry. Each page opens with a boxed "control panel" header showing a breadcrumb, title and actions. Navy is the CloudTech primary; the gold accent was dropped at the owner's request.
