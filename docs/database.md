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
| `…0007_archive_business` | `archive_business()`: an owner deletes a business by archiving it (records kept, hidden from everyone) |
| `…0008_farm_products` | `farm_product_profiles`, `farm_products` view (availability derived from stock or live batches), `farm_create_product`, `farm_update_product` |
| `…0009_farm_navigation_modules` | Farm sidebar modules (alerts, tasks, health, equipment, crops, purchase requests, supplier bills, sales orders, receivables, payables, cashbook, workers) and the `expenses.record`, `procurement.request`, `procurement.approve` permissions |
| `…0010_finance` | `expenses` (void, never delete), `receivables`, `payables` and `cashbook` views, `report_summary`, `record_expense`, `void_expense` |
| `…0011_requests_bills_orders` | purchase requests (approval, then a normal purchase order), supplier bills, sales orders (fulfilment posts a normal sale; "fulfilled" is derived) |
| `…0012_farm_operations` | workers, tasks, health records with withdrawal-period enforcement, equipment and maintenance (costs become one expense), `farm_alerts`, `farm_batch_costs` |
| `…0013_bakery` | `bakery_product_profiles`, immutable `recipes` / `recipe_versions` / `recipe_ingredients`, `production_batches` and `production_ingredient_usage`, `bakery_lots` with FEFO allocation triggered by the stock ledger, `waste_records`; costing functions, ingredient and finished-goods views, atomic production completion, reversal, waste, `bakery_overview`; `bakery.manage` |
| `…0014_retail_mart` | `mart_product_profiles`, `product_packs` (pack/carton conversion to base units), `mart_lots` with FEFO triggers, `stock_loss_records`, `supplier_returns`, `cashier_shifts`, `cash_movements`; views `mart_products`, `mart_lot_status`, `shift_summary`; `mart_save_product`, `mart_receive_stock`, `mart_post_sale`, `mart_start_count`, losses, supplier returns, shifts, `mart_overview`; count posting now needs `retail.manage`; `payables` subtracts supplier credit; `retail.manage` |
| `…0015_pharmacy` | roles `pharmacist` and `pharmacy_technician`, permissions `pharmacy.manage` / `pharmacy.rx` / `pharmacy.dispense`, `pharmacy-*` modules, `pharmacy_settings`, `pharmacy_medicine_profiles` (classification), batch status on `mart_lots`, `pharmacy_batch_events`, goods receipts with rejected quantities, prescriptions and dispensings (RLS: `pharmacy.rx` only), pharmacy-aware `mart_track_lots` (expired, quarantined and undated batches never sell), `sale_items` guard for restricted medicines, `pharmacy_*` functions and `pharmacy_overview`; `_mart_guard` maps retail modules to pharmacy modules. See docs/pharmacy.md |
| `…0016_customer_profiles` | `customers` gains `company`, `contact_person`, `city`, `notes`; view `customer_summary` (orders, spend net of tax and returns, paid, owed, first and last purchase) and `customer_top_products()`; both respect sales and customer RLS |
| `…0017_location_guard` | trigger refusing to archive a stock location that still holds stock or is the last active one |
| `…0018_delete_record` | `delete_record(kind, id)`: deletes a never-used customer, supplier, product, category, location, lead, voided stock loss, or farm worker, equipment or task; refuses records with history; audited |

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
