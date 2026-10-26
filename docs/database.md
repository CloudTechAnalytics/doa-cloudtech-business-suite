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
| `…0019_school` | industry `school`, roles `principal`, `teacher`, `bursar`, `admissions_officer`, `parent`, permissions `school.*`, `school-*` modules, sessions/terms/classes/subjects, students with enrolment history, guardians and links, admissions, staff and assignments, attendance, scores with approval workflow, remarks, fee items, bills, payments (reversed, never edited), announcements; RLS scoped so teachers reach their classes and parents their children (published results only); `school_*` functions and `school_overview`. See docs/school.md |
| `…0020_school_stages` | `school_classes.stage`; the kind of school (nursery, primary, secondary or all) decides which stages exist: `school_setup` builds only that kind's classes and subjects, `school_save_class` refuses another stage, and `school_save_settings` retires other stages (refused while they hold active students). See docs/school.md |
| `…0021_platform_admin` | `platform_admins` (owner, engineer, support) and the append-only `platform_audit_log`; `platform_*` functions for overview, businesses, users, plans, audit, health and team, and for changing subscriptions and suspending businesses (each needs a reason and is logged). See docs/platform-admin.md |
| `…0024_platform_actions` | `platform_update_business`, `platform_set_member_status` (engineer or owner), `platform_transfer_ownership` and `platform_archive_business` (platform owner only); each needs a reason and is logged. The owner of a business cannot be stopped until ownership is moved. See docs/platform-admin.md |
| `…0025_platform_usage` | `platform_settings` (plan limits, closed to direct access) and `platform_usage()`: database size, file storage, businesses, users and audit events for the System Health page. Limits start at the free plan (500 MB, 1 GB); raise them in `platform_settings` after upgrading |
| `…0026_platform_purge` | `platform_purge_business(business, exact name, reason)`: platform owners only; erases every row of a business in every table (children first, append-only guards off for that one transaction only, all or nothing) and keeps only the platform log of the deletion. `platform_audit` now shows the name of a deleted business |
| `…0027_purge_accounts` | `platform_purge_business` also deletes the accounts of people who belonged only to the deleted business (not people in another business, not the platform team, not the person doing it). The result and the platform log give the counts |
| `…0028_avatars` | public storage bucket `avatars` (small JPEG, PNG or WebP only, 512 KB) with policies so a person can add, replace or remove pictures only inside a folder named after their own user id; `profiles.avatar_path` remembers the file. Does nothing where the storage schema does not exist (the test database) |
| `…0029_profile_title` | `profiles.job_title` (up to 60 characters, set only by the person themselves): what they are called at work (Principal, Director...), shown at the top of the app in place of the role. No effect on permissions |
| `…0030_school_teacher_parent` | module `school-my-classes` (My Classes, permission `school.teach`) for schools, switched on for existing schools too; `school_update_my_contact`: a parent changes only the contact record tied to their own login |
| `…0031_school_timetable` | module `school-timetable`; `school_periods` and `school_timetable` (readable by school staff, a teacher for their own classes and lessons, a parent for their child's class); `school_save_periods` and `school_set_slot` (school managers only) refuse breaks, non-school days, subjects the class does not take, teachers not assigned to that subject and class, and a teacher in two places at once |
| `…0032_school_departments_report` | `school.delete` (owner and business admin only); `school_departments` (Science, Art, Commercial and any the school adds) on senior secondary classes and subjects; subjects carry the levels they are taught at; `school_setup` builds classes, departments, subjects and each class's starting subjects for the kind of school; `school_delete_student` and `school_delete_guardian` (reason required, audited; a student with fee payments is refused); `school_report_card` now returns the school, grading key, next term and class average, highest and lowest per subject |
| `…0033_school_staff_login` | optional sign-in for school staff: `school_give_login` (invites the staff member's email with teacher, bursar, admissions officer or principal; principal only by the owner or an admin), `school_cancel_login`, `school_staff_access` (none, invited or signed in, per person). Nobody sets another person's password |
| `…0034_school_delete_class_subject` | `school_delete_class` and `school_delete_subject` (school managers): an unused class or subject is removed with its subject choices, assignments and timetable lessons; one that holds students, attendance, results or fees is refused with a plain reason |
| `…0035_school_create_login` | `school_create_login`: the principal or an admin creates a staff member's login with a temporary password (stored only as a hash; the person must choose their own at first sign-in). Refused for an email that already has an account, so it can never reset or take over someone's sign-in |
| `…0036_school_staff_access_heal` | `school_staff_access` links a staff record to the active member whose email matches it, so the staff list shows the true sign-in state |
| `…0037_school_teacher_scope` | permission `school.guardians` (teachers, principal, bursar, admissions officer, manager, admin, owner) opens Parents & Guardians; `school.teach` (My Classes) now belongs to the teacher role alone |

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
