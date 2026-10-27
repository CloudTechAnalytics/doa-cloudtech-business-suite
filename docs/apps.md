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

The Starter plan (price 0) includes every standalone app: CRM, POS, Inventory, Invoices, Expenses and Finance reports. Purchases and Suppliers need Basic or above.

## Usage limits

Limits are plan data (`subscription_plans.limits`), not code. The keys are `customers`, `invoices_per_month`, `sales_per_month` and `expenses_per_month`; a plan with no such key has no limit, and **no plan has any yet**: the numbers are a commercial decision, set by updating the plan data (for example `update subscription_plans set limits = limits || '{"invoices_per_month": 30}' where code = 'starter'`). Members and branches keep their own limits.

- **Enforced in the database**: a `before insert` trigger on `customers`, `invoices`, `expenses` and `sales` stops a new record when the plan's limit is used up (`enforce_usage_limit`), so no screen, import or API call can get around it. Months are counted in UTC; cancelled invoices, voided sales and voided expenses do not count.
- **Only new records are blocked.** Nothing existing is locked, hidden or removed, and lowering a plan's limit later removes nothing. Moving to a bigger plan lifts the limit at once.
- **Told in advance**: `my_usage()` returns used and allowed for each limit. The App Library shows a Plan usage panel, and the Invoices, CRM, Sales and Expenses pages show a notice from 80% of a limit, and again when it is full, with a link to the plans.
- Products are not limited, because industries create products themselves (a bakery's finished goods, for example).

## How deep each app is, and what comes next

Each app is measured against what Zoho, Odoo, Microsoft Dynamics 365 and HubSpot offer for the same job (compared from their public feature pages), and deepened one at a time.

### CRM (deepened first)

Built: customers and leads with one-tap call, WhatsApp and email; a deal pipeline with **your own stages and a chance of winning at each**, so the board shows what is *likely to close* (weighted value); deal **owners**, "My deals", a **next step**, and a flag on deals nobody has touched for 14 days; an **Activities** hub (calls, meetings, emails, to-dos on a deal, customer or lead; overdue, today and coming up; finishing one records what happened on the timeline); lead **rating** (hot, warm, cold) and owner; **CSV import** with a template, duplicate skipping by email or phone, a preview and a clear result (all or nothing, 500 rows at a time); **CSV export**; printable quotes that become invoices; a **first-run guide**; and a report with the funnel, forecast by month, results by owner, which lead sources become sales, why deals are lost, win rate and average time to win.

Not yet (in the order I would do them): companies (organisations with their contacts), more than one pipeline, automation rules (for example a task when a deal reaches a stage), email templates and logging email in the timeline, sales targets and quota, products in quotes (picked from Inventory), a web form that creates leads, duplicate merging, custom fields and saved views.

### POS (deepened second)

Built, on top of what it already had (a product grid with search and barcode scan, line discounts, tax, credit sales to a customer, returns, voids, printed receipts):

- **Split payments**: pay one sale in cash and transfer and card; the till shows what is left, and works out the **change** from the cash given (a helper, not recorded).
- **Hold and resume** a sale while the customer fetches something. Held sales are kept in the browser on that device only (not in the database), and the till says so.
- **Today** tab: the end-of-day summary for any day in the business's own time zone (`sales_day_summary`): sales, discounts, returns, net sales, money received by method (refunds taken off), what is still owed, voided sales, results by cashier, best sellers; **print** it as an end-of-day sheet or **export** the day's sales as CSV.
- **History** with search, filters (owing, refunded, voided), a date range and CSV export.
- **Receipt by WhatsApp** (opens WhatsApp with the receipt text; DOA sends nothing itself) as well as print or save as PDF.
- Every part of the till is in the sidebar (New sale, History, Today).

Services (items with no stock) are sold from the same till since Inventory was deepened (below). Not yet: product categories and variants in the generic till (retail has them), tips, loyalty points, customer-facing display, offline sales, a cash drawer with opening and closing counts for the general till (the retail and pharmacy tills have shifts).

### Inventory (deepened third)

Built, on top of the movement ledger, locations, receive / adjust / issue / transfer and reversal it already had:

- **Services**: a product can be a *Service* (sold like a product, no stock). It is set when the product is created and cannot be changed afterwards (the database does not allow it). A service is left out of Stock, Receive, Adjust, Transfer and Counts, shows "Service" on the till tile with no stock check, and a sale of it moves no stock. Voids and returns of such a sale work.
- **Edit a product** (name, SKU, barcode, price, cost, reorder level, category) and **categories** (pick one, or name a new one inline; one category per name, whatever the case).
- **Counts** tab over `stock_count_start / record / post`: pick a location, type what is on the shelf (blank skips a product), post. Each difference is one *count adjustment* in the ledger, worked out against the stock at posting time so sales made during the count are not lost. A posted count is read-only.
- **Stock tab**: summary tiles (stock value, products kept in stock, out of stock, running low) and a **Needs attention** list, out of stock first. The suggested quantity is a plain rule (top back up to twice the reorder level), labelled as such; a product with no reorder level gets no suggestion.
- **CSV import** of a product list (`inventory_import_products`): up to 500 rows, loose headings (Item name, Code, Qty, Retail price...), a template, a preview, **opening stock** received into a chosen location through the ledger at the row's cost, services by *Type = Service*, categories created on the way, duplicates (SKU, barcode, or name when neither is given) skipped, unreadable rows reported one by one, all or nothing, and a repeat of the same request does nothing. **CSV export** of the stock list and of the product list (same headings as the template).
- Every part is in the sidebar (Stock, Products, Counts, Movements, Receive, Adjust / issue, Transfer, Locations); `?tab=receive` style addresses, with the older `?tab=Receive` still accepted.

Not yet: variants and product images, lots and expiry for general goods (pharmacy has its own), bundles / kits, units conversion on the screen, a purchase-order-driven reorder (Purchases is a separate module), per-location reorder levels, barcode label printing, valuation reports by date, and a forecast-based reorder suggestion.

### Invoices (deepened fourth)

Built, on top of drafts, sending, payments (with reversal), cancelling, quotes-to-invoices and print-to-PDF:

- **Credit notes** (`invoice_issue_credit_note`): lower what a customer owes on a sent invoice (goods returned, a price corrected) without cancelling it or touching payments. Each has its own number (CN-000001), a reason, and can never be edited or deleted. The invoice keeps its total; balance = total - credit notes - payments, and neither a payment nor a further credit can exceed it. When credits and payments cover the total the invoice is **Paid**, or **Credited** if nothing was paid. An invoice with credit notes cannot be cancelled. Finance reads the lower figure (receivables, the invoice summary and the invoiced total). A credit note prints.
- **Customer statements**: pick a customer (and optionally a date range) for every invoice sent to them, every payment and credit note, a running balance, a balance brought forward, and what is owing now. Print or save as PDF, or export CSV. Drafts and cancelled invoices are left out.
- **Ageing**: open invoices by customer, in how late they are (not yet due, 1-30, 31-60, 61-90, over 90 days), biggest debt first, with totals and CSV export. An invoice with no due date counts from the day it was issued.
- **Reminders**: on an open invoice, a polite message (what is owed, how late) to send by WhatsApp or email, or copy. DOA sends nothing itself.
- **Recording payments is quicker**: every open invoice in the list has a **Record payment** button (no need to open it first). The amount has one-tap choices (the full balance, or half), how it was paid is a row of buttons, and a part payment leaves the invoice part-paid. Once saved, a **payment receipt** (RCT number, who paid, how much, how, the invoice, what is still owed) can be printed or saved as PDF, or sent by WhatsApp or email, and any earlier payment on the invoice can print its receipt too. A repeat of the same submit never records twice.
- **Payment terms** (on receipt, 7, 14, 30, 60 days) when setting the due date, **copy as new invoice**, and **CSV export** of the list.
- Every part is in the sidebar (Invoices, Statements, Ageing).

Not yet: recurring invoices (they need a scheduler), automatic reminders by email or SMS (no delivery integration), a link a customer can open and accept, tax profiles (more than one rate on an invoice, tax-inclusive prices), invoicing from inventory items, partial refunds of a settled invoice (a credit note cannot go below what has already been paid), multi-currency, and a PDF file generated on the server.

### Expenses (deepened fifth)

Built, on top of recording, voiding with a reason (never deleting), the cashbook and the farm's batch costing:

- **Your own categories.** A category is a short lower-case name (`marketing`, `staff_welfare`). A farm still starts with feed, labour, medication and the rest; every other business starts with a general set (supplies, rent, utilities, salaries, transport, marketing, software, taxes and so on). Pick one, or type a new name: the screens turn "Staff welfare" into `staff_welfare`. The database accepts any such name (the old fixed list is gone), and anything already used stays choosable.
- **Budgets** (`expense_set_budget`, `expense_budget_status`): a monthly amount per category that repeats every month until changed or removed, shown beside what was actually spent in any month (posted entries only). The bar turns amber at 80% and red when passed; spending in a category with no budget is listed too. Setting one needs the same permission as recording an expense; reading needs the expenses read permission. Removing a budget is written to the audit log.
- **Report** (`expense_report`): for This month, Last month, Last 30 days, This year or any dates: total, count and average, and by category (with share), month, how it was paid and top suppliers, worked out on the server; CSV export.
- **The list**: filters for words (description, number, category), category, how it was paid, a date range and posted or voided; CSV export; **record again** copies an entry into the form.
- Every part is in the sidebar (Expenses, Budgets, Report).

Not yet: receipt photos and file attachments (needs file storage), recurring expenses (they need a scheduler), approval before an expense counts, expense claims by staff, per-department or per-project budgets, a yearly budget view, budget alerts by email, and tax or VAT split on an entry.

### The other apps (not yet deepened)


### Finance (deepened last)

Before, the Finance app was one summary page; the cashbook, receivables and payables existed only inside the farm. Now Finance is five parts, all in the sidebar:

- **Overview**: the cash-basis summary for any dates (sales, purchases, expenses, stock, cash in and out, surplus, owed each way, expenses by category), as before.
- **Cash flow** (`finance_cash_flow`): for This month, Last month, Last 30 days, This year or any dates: the **opening balance**, money in, money out and the **closing balance**, which must reconcile (the screen says so if it ever does not); by month; **where money came from** (sales, invoice payments) and **where it went** (supplier payments, refunds, and each expense category by name); **where the money is** (the balance in each way of paying: cash, bank transfer, card, POS, to the end of the period); and **expected from invoices** (overdue, due in the next 30 days, no due date, after credit notes and payments). CSV export.
- **Cashbook**: every money movement with a running balance per way of paying, filterable by dates, CSV export.
- **Owed to you** (receivables, sales and invoices, aged) and **You owe** (payables, purchase orders, aged).

All of it is cash basis, and says so: it is money that moved, not profit.

Not yet: profit and loss on an accrual basis (needs costs matched to sales and a chart of accounts), bank accounts you name and import statements for, **reconciliation** against a bank statement, a forecast beyond what invoices are due (bills have no due dates), budget against actual across all categories (it lives in Expenses), tax and VAT reporting, multi-currency, closing a period, and journals.

## One workspace, visible to the platform

Apps are **not** split into separate workspaces. Customers, invoice payments and Finance share data inside one workspace, and sharing across workspaces would break tenant isolation; a person who adds Invoices to a CRM workspace should not re-enter their customers. Instead the Platform console shows what a workspace really is:

- **The starting app** is recorded once (`businesses.started_with_app`), so a workspace that began as CRM is still known as a CRM sign-up after it grows.
- **The apps on now** are shown as chips in the workspace list (with an *App in use* filter) and on the workspace page. A Business apps workspace is labelled "Apps workspace", not an industry.
- **Use, not just on/off**: per app, the number of records and the time of the latest one. An app that is on but has no records shows "Not used yet".
- **A history of switching apps on and off**, with who did it, written by a database trigger (`business_module_events`). The workspace setup noise (every default switched on, then most off) is replaced by one "start" entry for the chosen app.
- **Adoption** on the console home: per app, workspaces using it now, started with it, *grew* (started with it and later added another app, the upgrade signal) and active in the last 30 days. It counts Business apps workspaces only, because industry businesses switch several shared apps on by default.

Because each app's on and off dates are recorded per workspace, pricing per app later does not need a different workspace model.

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
