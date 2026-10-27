# Standalone apps and industry apps

DOA has two kinds of apps, side by side, on one account and one database.

| Kind | What it is | Where it comes from |
|---|---|---|
| **Standalone app** | A tool any business can switch on, with no industry: CRM, POS, Inventory, Invoices, Expenses, Finance | `src/core/app-catalogue/apps.ts` (each maps to shared platform modules) |
| **Industry app** | A whole business with its own workflows: Farm, Bakery, Mart (retail), Pharmacy, School | `src/industries/*`, registered in the industry registry |

A **workspace is a business** (`businesses`). A freelancer makes one with the type *Business apps* (`general`, no industry modules). A bakery owner makes one of type *Bakery*. One account can own several, each with its own members, roles, data and plan. Nothing is shared between businesses.

## Starting with one app

Each app has its own entry on the public site (the Apps menu and the Apps page). Its links go to the **sign-in page for that app** (`/sign-in?app=<id>`, with a matching sign-up page). The app is remembered in the browser through sign-in or account creation (`pendingApp`), and afterwards the person lands on `/start/<id>`, where they name a workspace. It is created as a Business apps workspace with **only that app switched on** (`startWithApp` disables the other defaults), so a person who clicks POS or Invoices works in that app alone, not a bundle. The rest are one click away in the App Library, which shows only in these workspaces, not in a school, farm or other industry business.

"Business apps" is not a choice on the *Choose your business* page: that page lists industries only. It remains the internal type (`general`) that app workspaces use.

An app that cannot work without other data carries what it needs, inside the app:

- **POS** carries the Inventory module as its product list (you cannot sell without products). In the App Library, Inventory shows as needed by POS and cannot be switched off while POS is on; switching POS off leaves Inventory on if the Inventory app is on.
- **Invoices** reads and adds its own customers (`customers_select` also allows `invoices.read`, and `invoice_add_customer` reuses a matching customer). It does not need the CRM app. Quotes live in the CRM, so "accepted quotes ready to invoice" appears only when the CRM is on.
- **Finance** reads the money other apps record; on its own it has nothing to show until POS, Invoices or Expenses is on.

## How "switching on an app" works

An app is one or more shared modules. Switching it on enables its modules in `business_modules` (`enable_module`); switching it off disables them (`disable_module`). Nothing is deleted: records stay readable (`module_usable(..., 'read')`) and everything returns when the app is switched on again. The checks are in the database, not the interface: the person must hold `settings.manage`, the business type must allow the module, the plan must include it, and every table's policy calls `has_module_permission`. Hiding an app in the menu is never the security control.

| App | Modules | Notes |
|---|---|---|
| DOA CRM | `customers` | contacts, leads, deal pipeline, quotes, follow-ups, report |
| DOA POS | `sales`, `inventory` | the same sales module the industries use, plus the product list; no retail setup |
| DOA Inventory | `inventory` | movement ledger |
| DOA Invoices | `invoices` | invoices and their payments |
| DOA Expenses | `expenses` | |
| DOA Finance | `reports` | cash-basis summary, cashbook, receivables and payables |

Switching an app on or off always asks first (`ConfirmSwitch`). Off lists what stops, what is kept and what keeps working (for example, unpaid invoices stay in Finance as money owed, and the dialog shows how much is still owed), says when part of the app stays on because another app needs it, and that everyone in the business is affected. On says what it adds and that nothing is deleted if it is switched off later. Only the owner or an admin can do either, and the change is written to the audit log.

Which business types can use which app is the industry template (`industry_template_modules`). *Business apps* has all six on when chosen in the picker, or one when started from an app's link. Retail, bakery and pharmacy have all of them except Invoices, which they can switch on. Farm can switch on Purchases, Suppliers, Expenses and Invoices. A school has none of the standalone apps (it has its own fees and expenses).

## Integration contracts and data ownership

Finance does not keep a copy of anyone's money. It reads two views, and each source owns its own records:

- **`cashbook`** (cash in and out): sale and purchase `payments`, posted `expenses`, and successful `invoice_payments`. Reversed payments and voided expenses are left out.
- **`receivables`** (what customers owe, with a `source` of `sale` or `invoice`): open sales and sent or part-paid invoices.
- **`payables`**: open purchase orders.
- **`report_summary`** adds these up for a period. It reports cash in, cash out and the surplus between them (not profit), receivables, payables, stock at cost, and what was invoiced.

Because a payment is one row in one table and the views only read it, nothing is counted twice and nothing has to be kept in step. An invoice payment is never a sale payment; the Receivables page tells you to record an invoice's payment under Invoices.

Other rules every app follows: each record has `business_id` and a stable number per business (`document_sequences`); money is worked out in database functions, never taken from the browser; a payment needs an idempotency key so a retry cannot book it twice; financial records are reversed or voided with a reason, never edited or deleted; and the audit log records the change.

CRM contacts are the shared `customers`. School students, parents and pharmacy patients are separate tables and are never read by the CRM or Invoices.

## Free tier

The Starter plan (price 0) includes every standalone app: CRM, POS, Inventory, Invoices, Expenses and Finance reports. Purchases and Suppliers need Basic or above. ## Usage limits

Limits are plan data (`subscription_plans.limits`), not code. The keys are `customers`, `invoices_per_month`, `sales_per_month` and `expenses_per_month`; a plan with no such key has no limit, and **no plan has any yet**: the numbers are a commercial decision, set by updating the plan data (for example `update subscription_plans set limits = limits || '{"invoices_per_month": 30}' where code = 'starter'`). Members and branches keep their own limits.

- **Enforced in the database**: a `before insert` trigger on `customers`, `invoices`, `expenses` and `sales` stops a new record when the plan's limit is used up (`enforce_usage_limit`), so no screen, import or API call can get around it. Months are counted in UTC; cancelled invoices, voided sales and voided expenses do not count.
- **Only new records are blocked.** Nothing existing is locked, hidden or removed, and lowering a plan's limit later removes nothing. Moving to a bigger plan lifts the limit at once.
- **Told in advance**: `my_usage()` returns used and allowed for each limit. The App Library shows a Plan usage panel, and the Invoices, CRM, Sales and Expenses pages show a notice from 80% of a limit, and again when it is full, with a link to the plans.
- Products are not limited, because industries create products themselves (a bakery's finished goods, for example).

## Not built yet

These were asked for and are **not** done; none is claimed anywhere in the product:

- **Limit numbers.** The mechanism is built and tested, but no plan has a limit set. Choose the numbers and set them in the plan data. There is also no screen for editing them (the Platform console shows plans read-only).
- **Upgrading from the notice.** The notice links to Settings, where the plan can be changed in demo mode; live billing is not connected, so a plan change is made by the platform team.
- **An integration outbox / failed-event monitor.** Integration is by shared views and one transaction, so there are no events to fail or retry. If POS sales start feeding anything asynchronously, an outbox will be needed.
- **A separate personal workspace type.** A personal workspace is a *Business apps* business. There is no other distinction.
- **Invoice reminders by email or SMS** (no delivery integration), and **a PDF file download.** Invoices and quotes print, and "Save as PDF" in the print dialog makes a real PDF; the app does not generate files on the server.
- **Expense attachments, recurring expenses and budgets**, and **approval workflows**.
- **Reconciliation** against bank statements, and **accounts and balances** beyond the cashbook.
- **An Industries page** on the public site. The Industries menu and the picker on the home page remain.
- **Inventory links from invoices.** Invoices do not move stock; POS sales do, through the inventory module.
- **Exports** beyond the cashbook CSV.
