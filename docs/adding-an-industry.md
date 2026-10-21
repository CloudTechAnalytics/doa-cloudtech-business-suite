# Adding an industry

A new industry is one folder plus a registration line. You never copy the farm or bakery folder, and you never edit the router, the sidebar, the module registry or any shared module.

Worked example: a hypothetical `salon` industry.

## 1. Create the folder

```
src/industries/salon/
  index.ts          defineIndustry({...}), the only file the registry imports
  config.ts         id, name, description, version, status, module sets
  modules.ts        the modules the industry owns (codes start with "salon-")
  permissions.ts    industry permissions (codes start with "salon.")
  navigation.ts     sidebar sections
  routes.ts         binds each owned module to its page component
  setup.ts          onboarding questions (+ optional validate function)
  demo.ts           demo dashboard figures (optional)
  pages/            the screens
  tests/            salon.test.ts
```

Create only the files you need. An industry that only composes shared modules (like retail) has no `modules.ts`, `routes.ts`, `pages/` or `permissions.ts`.

## 2. Declare it

```ts
export const salon = defineIndustry({
  id: 'salon', name: 'Salon', description: '…', version: 1, status: 'active',
  modules: salonModules,
  requiredSharedModules: ['sales'], optionalSharedModules: ['customers'],
  defaultModules: ['salon-appointments', 'sales', 'inventory'],
  optionalModules: ['customers'],
  requiredModules: ['salon-appointments'],
  permissions: salonPermissions, navigation: salonNavigation, routes: salonRoutes,
  onboarding: { questions: salonSetupQuestions },
  dashboardWidgets: [], workflows: [],
})
```

`defineIndustry` validates the definition and throws a list of problems at import time (see `src/core/industry-registry/validate.ts`). Common mistakes it catches: a module code without the `salon-` prefix, an owned module with no route, a permission without the `salon.` prefix, navigation that references a module the industry does not enable, a default module that is also optional.

Load pages and dashboard widgets lazily (`lazy(() => import('./pages/X'))`, see `industries/farm/pages/index.ts`). The registry imports every industry's `index.ts`, so an eager import of screens or data hooks can create a circular dependency through the demo layer and bloats the first load.

Reuse shared modules for shared concepts. Customers are the CRM module, stock is the inventory module, sales are the sales module. An industry must not build its own copy.

## 3. Register it

1. Add `'salon'` to the `IndustryCode` union in `src/shared/types/domain.ts`.
2. Add `salon` to `INDUSTRIES` in `src/core/industry-registry/index.ts`.

Registry-level checks (unique module codes, paths and permissions across industries; no collision with shared modules) run on import.

## 4. Database

Add a migration only if the industry needs it:

- the template row: `insert into industry_templates (code, name, description, status)`;
- its modules in `modules` (code, name, `required_permission`) and `industry_template_modules` (`is_default`, `is_required`), plus `plan_modules` entries;
- new permissions in `permissions` and `role_permissions`;
- the industry's own tables, each with `business_id`, composite foreign keys, RLS using `has_module_permission(business_id, '<module>', '<permission>', 'read'|'use')`, and writes only through functions.

Do not add `salon_data` JSON columns to shared tables. `businesses.settings` accepts only the validated keys listed in `validate_business_settings()`.

## 5. Test

`npm test`. These fail loudly if you forget something:

- `tests/integration/registry-consistency.test.ts`: the TypeScript definition and the SQL seed agree (modules, defaults, required, plan entitlements, permissions, template status);
- `tests/integration/industry-registry.test.ts`: the contract and registry rules;
- `tests/security/tenant-isolation.test.ts`: discovers every business-owned table by itself and proves another business can neither read nor write it.

Add `src/industries/salon/tests/salon.test.ts` for the industry's own rules.

## 6. Release

Keep `status: 'coming_soon'` until the industry's workflows (and any regulatory requirements, as for pharmacy) are reviewed. A `coming_soon` industry is rejected by the validator if it defines modules or routes, and `create_business` / `change_industry` refuse it. Switch to `'active'` and update the template row when it is ready.
