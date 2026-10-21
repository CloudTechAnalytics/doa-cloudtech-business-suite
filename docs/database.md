# Database

All schema lives in `supabase/migrations/` and is applied in filename order. Migrations are additive; none drops or rewrites an earlier table. There is no production data yet.

| Migration | Adds |
|---|---|
| `…0001_identity_and_businesses` | `profiles`, `businesses`, `business_members`, `roles`, `permissions`, `role_permissions`, `branches`, `user_branch_access`, `business_invitations`; RLS helpers; business, invitation and membership functions |
| `…0002_industry_and_module_engine` | `industry_templates`, `modules`, `industry_template_modules`, `business_modules`, `business_industry_changes`, `subscription_plans`, `plan_modules`, `subscriptions`; `module_usable`, `has_module_permission`, `my_modules`, enable/disable/industry-change functions; plan limits |
| `…0003_inventory` | units, categories, products, locations; append-only `stock_movements`; `inventory_balances` projection maintained by the ledger trigger; idempotency, counts, reconciliation; weighted-average costing |
| `…0004_sales_purchasing` | customers, suppliers, sales and items, returns, payments, purchases, receipts; posting, payment, return, void and goods-receipt functions; document numbering |
| `…0005_audit_crm_settings` | `audit_logs` and audit triggers; `subscription_events`; CRM (`crm_leads`, `crm_tags`, `crm_entity_tags`, `crm_interactions`, `crm_tasks`, `convert_lead`, `customer_history`); validated business settings; `audit.read` |
| `…0006_farm` | `farm_units`, `farm_batches`, append-only `farm_batch_events` (population ledger), `farm_feed_records`, `farm_harvests`, `farm_activity_logs`; `farm_batch_summaries` view; batch, mortality, feeding, harvest, correction, void and close functions; `farm.manage` |

## Tables named in the architecture brief

`profiles`, `businesses`, `business_members`, `branches`, `industry_templates`, `modules`, `industry_template_modules`, `business_modules`, `roles`, `permissions`, `role_permissions`, `subscriptions`, `subscription_events` and `audit_logs` all exist. No equivalent concept is duplicated under another name.

## Conventions

- UUID primary keys; `business_id` on business-owned tables; composite `(business_id, id)` uniqueness so children can reference parents inside the same business.
- Money `numeric(14,2)`, costs `numeric(14,4)`, quantities `numeric(18,4)`; explicit currency.
- Statuses are `CHECK` constraints. Posted financial and stock records are never edited; corrections are reversals, returns or adjustments.
- Industry-specific data gets its own tables. Shared tables have no `farm_data`/`bakery_data` columns; JSONB is limited to validated settings and module configuration.

## Module code note

The CRM module's stable code is `customers` (policies, plan entitlements and permissions reference it). Its display name is CRM. Renaming the code would require recreating those policies and is possible in a later migration.

## Recovery

Each migration is additive, so rolling back means dropping the objects it created (triggers first, then functions and tables) and removing its rows from seeded reference tables. Take a database backup before applying migrations to any database that holds real data, and test restoration before launch (not yet done).

## Seed data

Reference data (permissions, roles, plans, templates, modules) is inserted by the migrations themselves. Demo data is not in the database; it lives in the browser demo store.
