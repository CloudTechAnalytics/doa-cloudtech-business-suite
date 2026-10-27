# Standalone apps and industry apps

DOA has two kinds of apps, side by side, on one account and one database.

| Kind | What it is | Where it comes from |
|---|---|---|
| **Standalone app** | A tool any business can switch on, with no industry: CRM, POS, Inventory, Invoices, Expenses, Finance | `src/core/app-catalogue/apps.ts` (each maps to shared platform modules) |
| **Industry app** | A whole business with its own workflows: Farm, Bakery, Mart (retail), Pharmacy, School | `src/industries/*`, registered in the industry registry |

A **workspace is a business** (`businesses`). A freelancer makes one with the type *Business apps* (`general`, no industry modules). A bakery owner makes one of type *Bakery*. One account can own several, each with its own members, roles, data and plan. Nothing is shared between businesses.

## How "switching on an app" works

An app is one or more shared modules. Switching it on enables its modules in `business_modules` (`enable_module`); switching it off disables them (`disable_module`). Nothing is deleted: records stay readable (`module_usable(..., 'read')`) and everything returns when the app is switched on again. The checks are in the database, not the interface: the person must hold `settings.manage`, the business type must allow the module, the plan must include it, and every table's policy calls `has_module_permission`. Hiding an app in the menu is never the security control.

| App | Modules | Notes |
|---|---|---|
| DOA CRM | `customers` | contacts, leads, deal pipeline, quotes, follow-ups, report |
| DOA POS | `sales` | the same sales module the industries use; no retail setup |
| DOA Inventory | `inventory` | movement ledger |
| DOA Invoices | `invoices` | invoices and their payments |
| DOA Expenses | `expenses` | |
| DOA Finance | `reports` | cash-basis summary, cashbook, receivables and payables |

Which business types can use which app is the industry template (`industry_template_modules`). *Business apps* has all six on by default. Retail, bakery and pharmacy have all of them except Invoices, which they can switch on. Farm can switch on Purchases, Suppliers, Expenses and Invoices. A school has none of the standalone apps (it has its own fees and expenses).

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

The Starter plan (price 0) includes every standalone app: CRM, POS, Inventory, Invoices, Expenses and Finance reports. Purchases and Suppliers need Basic or above. Limits per plan live in `subscription_plans.limits` and `plan_modules.usage_limit`; the interface reads them from the plan data and does not hard-code them. Only the member and branch limits are enforced today (see below).

## Not built yet

These were asked for and are **not** done; none is claimed anywhere in the product:

- **Usage limits per app** (for example a cap on invoices a month). `plan_modules.usage_limit` exists but no function enforces it, and there is no usage screen. Only members and branches are limited.
- **Deactivation warnings and upgrade prompts** before a limit is reached.
- **An integration outbox / failed-event monitor.** Integration is by shared views and one transaction, so there are no events to fail or retry. If POS sales start feeding anything asynchronously, an outbox will be needed.
- **A separate personal workspace type.** A personal workspace is a *Business apps* business. There is no other distinction.
- **Invoice reminders by email or SMS** (no delivery integration), and **a PDF file download.** Invoices and quotes print, and "Save as PDF" in the print dialog makes a real PDF; the app does not generate files on the server.
- **Expense attachments, recurring expenses and budgets**, and **approval workflows**.
- **Reconciliation** against bank statements, and **accounts and balances** beyond the cashbook.
- **An Industries page** on the public site. The Industries menu and the picker on the home page remain.
- **Inventory links from invoices.** Invoices do not move stock; POS sales do, through the inventory module.
- **Exports** beyond the cashbook CSV.
