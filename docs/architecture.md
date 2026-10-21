# Architecture

CloudTech Business Suite is a **modular monolith**: one React application, one Supabase/PostgreSQL database, one authentication system, one tenant model. Industries are modules inside it, not separate apps.

## Layers

```
src/
  app/          layouts, providers, router, navigation builder: composition only, no business rules
  core/         the platform: auth, businesses, business-context, permissions, subscriptions,
                module-registry, industry-registry, audit
  shared/       industry-neutral building blocks: components, forms, tables, hooks, utilities, types
  modules/      shared business modules: crm, inventory, sales, purchasing, expenses, staff,
                reporting, notifications (each owns its pages, API layer and manifest)
  industries/   one folder per industry: retail, farm, bakery, pharmacy (scaffold)
  integrations/ boundaries to external services (payments interface only)
  demo/         browser-only demo backend, used only when Supabase is not configured
supabase/migrations/   the whole backend: schema, RLS, business rules (SQL functions)
tests/                 integration/ (workflows, registry), security/ (isolation, audit), helpers/
```

Public pages: `/` is the landing page (content comes from the shared-app list and the industry registry), `/start` is the business-type picker and works without an account (draft kept in `localStorage`, no credentials; account creation is the last step). Everything under `/app` requires sign-in.

Navigation is Odoo-style: `app/navigation/navigation.ts` turns the usable modules into **apps** (Dashboard, the industry's app, Sales, CRM, Inventory, Purchase, Finance, Staff, Settings). The home screen shows one tile per app; inside an app, a collapsible left sidebar (`app/layouts/Sidebar.tsx`, driven by `sidebarEntries()`) lists every usable module grouped by app, and is a drawer on narrow screens.

Dependency direction: `app → core → shared`, `modules → core, shared`, `industries → core (contract only), shared`. Shared modules never import an industry; an industry never imports another industry or reaches into a shared module's internals. `core/industry-registry` is the only place that imports industries.

## Four separate ideas

| Concept | Where it is decided |
|---|---|
| **Industry** | `businesses.primary_industry_code`; the definition lives in `src/industries/<id>/` |
| **Module** | a capability with a code, route and permission. Shared modules declare a `manifest.ts`; industry modules are declared by the industry |
| **Entitlement** | `subscription_plans` + `plan_modules`, evaluated by `module_usable()` in SQL |
| **Permission** | `roles` + `role_permissions`, evaluated by `has_business_permission()` in SQL |

A module is usable only when it is compatible with the industry, enabled for the business, included in the plan and permitted for the user. The UI builds navigation from `my_modules()`; every table and function independently calls `has_module_permission()`.

## Registries

- **Shared modules** (`modules/*/manifest.ts`, collected in `core/module-registry/shared-modules.ts`) provide `{ definition, page }`.
- **Industries** (`industries/*/index.ts`, collected in `core/industry-registry/index.ts`) are created with `defineIndustry()`, which validates the definition and throws at import time if it is invalid.
- `core/module-registry/registry.ts` assembles `ALL_MODULES`, `MODULES` and the industry templates from both. `routes.ts` builds the route table, `app/navigation/navigation.ts` builds the sidebar and Record menu. The router has no per-module code.
- Industry code is part of the trusted build. The database may enable or disable a module; it never supplies code.

## The industry contract

See `src/core/industry-registry/types.ts`. An industry declares: id, name, description, version, status (`active` or `coming_soon`), owned modules, required and optional shared modules, default/optional/required module sets, permissions, navigation sections, routes, onboarding setup questions (with optional extra validation), dashboard widgets and workflow entry points. The validator (`validate.ts`) enforces, among others: module codes are prefixed with the industry id; every owned module has a route and can be enabled; industry permissions are namespaced; navigation and workflows only reference modules the industry enables; a `coming_soon` industry exposes nothing.

## Data flow for a write

Browser form (generates an idempotency key) → API layer (`*Api.ts`, one interface for live and demo) → SQL function (`SECURITY DEFINER`, fixed `search_path`) → permission + module + plan check → one transaction → audit trigger. Totals, prices and entitlements are never taken from the browser.

## Demo mode

With no `VITE_SUPABASE_*` variables the app runs against a browser-only mirror (`src/demo/`). It exists for development and demonstrations. Parity tests (`ledger-parity`, `pricing-parity`, role-permission and registry consistency) keep the mirror honest; the database is the source of truth.

## Not yet built

Bakery screens and tables (registered and routable, placeholders for now), separate Poultry and Fish pages, per-site access, customer statements, payroll, notifications delivery, payment-provider integration, platform administration, end-to-end browser tests.

## Farm

The farm industry is the first full industry module, ported from the design of the farm reference system. Population, feed and produce are ledgers: `farm_batch_events` (append-only; corrections are opposite-sign rows pointing at the original), and feed and produce move through the **shared** inventory ledger as `production_consumption` / `production_output` movements, so stock is never duplicated inside the farm module. Fish counts can be flagged as estimates; a removal above the estimate writes an explicit adjustment. `farm.record` (workers) can record mortality, feeding, harvests and notes; `farm.manage` (managers) starts and closes batches and makes corrections. Farm pages and the dashboard widget are lazy-loaded so the industry registry never imports screens or data hooks (an eager import created a circular dependency through the demo layer).
