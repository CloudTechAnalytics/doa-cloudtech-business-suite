-- Security hardening: pin every privilege to exactly what the migrations intend.
--
-- A hosted Supabase project gives the anon and authenticated roles broad default privileges on every new table and function, and PostgreSQL lets everyone run
-- a new function. The migrations only ever revoke from PUBLIC, which does not remove those defaults. This migration:
--   1. stops new objects in public from being exposed automatically,
--   2. removes every table, function and sequence privilege from anon (signed-out visitors can do nothing),
--   3. removes all privileges from authenticated and PUBLIC, and
--   4. grants back only what the application needs: SELECT on the tables and views that have row-level-security policies, DELETE on the two link tables, and EXECUTE on
--      the functions that are meant to be called from the app. Every write goes through a guarded function; internal helpers are not callable at all.
--      Writes that the browser may make directly are limited to named columns (the grants below), never a whole row.
-- Later migrations must grant what they add, explicitly, in the same way. tests/integration/security.test.ts fails if anything drifts.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;

revoke create on schema public from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.audit_logs, public.bakery_finished_goods, public.bakery_ingredient_stock, public.bakery_lot_status, public.bakery_lots, public.bakery_product_profiles to authenticated;
grant select on public.branches, public.business_industry_changes, public.business_invitations, public.business_members, public.business_modules, public.businesses to authenticated;
grant select on public.cash_movements, public.cashbook, public.cashier_shifts, public.crm_entity_tags, public.crm_interactions, public.crm_leads to authenticated;
grant select on public.crm_tags, public.crm_tasks, public.customer_summary, public.customers, public.expenses, public.farm_activity_logs to authenticated;
grant select on public.farm_asset_status, public.farm_assets, public.farm_batch_costs, public.farm_batch_events, public.farm_batch_summaries, public.farm_batches to authenticated;
grant select on public.farm_feed_records, public.farm_harvests, public.farm_health_records, public.farm_maintenance_records, public.farm_product_profiles, public.farm_products to authenticated;
grant select on public.farm_tasks, public.farm_units, public.farm_withdrawals, public.farm_worker_names, public.farm_workers, public.industry_template_modules to authenticated;
grant select on public.industry_templates, public.inventory_balances, public.inventory_locations, public.mart_lot_status, public.mart_lots, public.mart_product_profiles to authenticated;
grant select on public.mart_products, public.modules, public.payables, public.payments, public.permissions, public.pharmacy_batch_events to authenticated;
grant select on public.pharmacy_batches, public.pharmacy_dispensing_items, public.pharmacy_dispensings, public.pharmacy_goods_receipt_items, public.pharmacy_goods_receipts, public.pharmacy_medicine_profiles to authenticated;
grant select on public.pharmacy_medicines, public.pharmacy_prescription_items, public.pharmacy_prescription_list, public.pharmacy_prescriptions, public.pharmacy_settings, public.plan_modules to authenticated;
grant select on public.platform_admins, public.product_categories, public.product_packs, public.production_batches, public.production_ingredient_usage, public.products to authenticated;
grant select on public.profiles, public.purchase_items, public.purchase_receipt_items, public.purchase_receipts, public.purchase_request_items, public.purchase_requests to authenticated;
grant select on public.purchases, public.receivables, public.recipe_ingredients, public.recipe_overview, public.recipe_versions, public.recipes to authenticated;
grant select on public.role_permissions, public.roles, public.sale_items, public.sale_return_items, public.sale_returns, public.sales to authenticated;
grant select on public.sales_order_line_status, public.sales_order_lines, public.sales_order_status, public.sales_orders, public.school_admissions, public.school_announcements to authenticated;
grant select on public.school_assignments, public.school_attendance, public.school_bill_items, public.school_bill_summary, public.school_bills, public.school_class_subjects to authenticated;
grant select on public.school_classes, public.school_enrollments, public.school_fee_items, public.school_grade_bands, public.school_guardians, public.school_holidays to authenticated;
grant select on public.school_payments, public.school_remarks, public.school_scores, public.school_sessions, public.school_settings, public.school_staff to authenticated;
grant select on public.school_student_guardians, public.school_student_list, public.school_students, public.school_subjects, public.school_terms, public.shift_summary to authenticated;
grant select on public.stock_count_items, public.stock_counts, public.stock_loss_records, public.stock_movements, public.subscription_events, public.subscription_plans to authenticated;
grant select on public.subscriptions, public.supplier_bill_status, public.supplier_bills, public.supplier_return_items, public.supplier_returns, public.suppliers to authenticated;
grant select on public.units_of_measure, public.user_branch_access, public.waste_records to authenticated;

grant delete on public.crm_entity_tags, public.user_branch_access to authenticated;

grant execute on function _school_can_see_student(uuid,uuid), _school_is_guardian_of(uuid,uuid), _school_teaches_class(uuid,uuid), _school_teaches_subject(uuid,uuid,uuid) to authenticated;
grant execute on function accept_my_invitations(), archive_business(uuid,text), bakery_batch_requirements(uuid), bakery_cancel_production(uuid,text,text) to authenticated;
grant execute on function bakery_complete_production(uuid,numeric,numeric,jsonb,text), bakery_ingredient_cost(uuid), bakery_line_base_qty(uuid), bakery_overview(uuid,date,date) to authenticated;
grant execute on function bakery_plan_production(uuid,uuid,numeric,date,uuid,uuid,text,text), bakery_record_waste(uuid,uuid,uuid,numeric,text,uuid,text,text), bakery_reverse_production(uuid,text,text), bakery_save_ingredient(uuid,uuid,text,text,text,numeric,numeric,boolean,numeric,uuid,text) to authenticated;
grant execute on function bakery_save_product(uuid,uuid,text,text,text,numeric,integer,numeric,text,boolean,text), bakery_save_recipe(uuid,uuid,uuid,text,numeric,text,jsonb,text), bakery_set_recipe_status(uuid,boolean), bakery_start_production(uuid) to authenticated;
grant execute on function bakery_version_cost(uuid), bakery_void_waste(uuid,text,text), can_access_branch(uuid,uuid), cancel_purchase(uuid,text,text) to authenticated;
grant execute on function cancel_purchase_request(uuid,text), cancel_sales_order(uuid,text,text), change_industry(uuid,text,boolean), confirm_payment(uuid,text) to authenticated;
grant execute on function convert_lead(uuid,text), convert_quantity(uuid,numeric,uuid,uuid), create_business(text,text,text,text,text), create_purchase(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function create_purchase_request(uuid,jsonb,text,text), create_sales_order(uuid,uuid,jsonb,date,text,text), customer_history(uuid), customer_top_products(uuid,integer) to authenticated;
grant execute on function decide_purchase_request(uuid,boolean,text,text), delete_record(text,uuid), disable_module(uuid,text), enable_module(uuid,text) to authenticated;
grant execute on function farm_adjust_population(uuid,text,numeric,text,date,text), farm_alerts(uuid), farm_close_batch(uuid,text,boolean,text), farm_create_product(uuid,text,text,text,text,text,text,numeric,text,text) to authenticated;
grant execute on function farm_record_feeding(uuid,uuid,uuid,numeric,date,text,text), farm_record_harvest(uuid,uuid,uuid,numeric,date,numeric,text), farm_record_health(uuid,text,text,uuid,uuid,numeric,date,integer,text,text), farm_record_mortality(uuid,numeric,text,date,text) to authenticated;
grant execute on function farm_reverse_event(uuid,text,text), farm_start_batch(uuid,uuid,text,text,text,text,numeric,date,date,text,text), farm_update_product(uuid,text,numeric,text,boolean), farm_void_feeding(uuid,text,text) to authenticated;
grant execute on function farm_void_harvest(uuid,text,text), farm_void_health(uuid,text,text), fulfil_sales_order(uuid,uuid,jsonb,jsonb,text), has_business_permission(uuid,text) to authenticated;
grant execute on function has_module_permission(uuid,text,text,text), inventory_adjust_stock(uuid,uuid,uuid,numeric,text,text), inventory_issue_stock(uuid,uuid,jsonb,text,text), inventory_receive_stock(uuid,uuid,jsonb,text,text,timestamp with time zone) to authenticated;
grant execute on function inventory_reconcile(uuid), inventory_return_stock(uuid,uuid,uuid,numeric,text,text,numeric,text), inventory_reverse_movement(uuid,text,text), inventory_transfer_stock(uuid,uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function invite_member(uuid,text,text), is_active_member(uuid), mart_cash_movement(uuid,text,numeric,text,text), mart_close_shift(uuid,numeric,text,text) to authenticated;
grant execute on function mart_create_purchase(uuid,uuid,jsonb,text,text), mart_open_shift(uuid,numeric,text), mart_overview(uuid,date,date), mart_post_sale(uuid,uuid,uuid,jsonb,jsonb,text,text,uuid) to authenticated;
grant execute on function mart_receive_stock(uuid,uuid,jsonb,text,text), mart_record_loss(uuid,uuid,uuid,numeric,text,text,text), mart_review_shift(uuid,text), mart_save_product(uuid,uuid,text,text,text,uuid,text,text,numeric,numeric,numeric,numeric,uuid,boolean,boolean,jsonb,text) to authenticated;
grant execute on function mart_set_lot(uuid,text,date), mart_start_count(uuid,uuid,uuid,text), mart_supplier_return(uuid,uuid,uuid,uuid,jsonb,text,text), mart_void_loss(uuid,text,text) to authenticated;
grant execute on function module_usable(uuid,text,text), my_modules(uuid), my_permissions(uuid), order_purchase_request(uuid,uuid,text) to authenticated;
grant execute on function pay_purchase(uuid,text,numeric,text,text), pharmacy_cancel_prescription(uuid,text), pharmacy_complete_batch(uuid,text,date), pharmacy_dispense(uuid,uuid,jsonb,jsonb,text) to authenticated;
grant execute on function pharmacy_dispose_batch(uuid,numeric,text,text,text), pharmacy_overview(uuid,date,date), pharmacy_receive_goods(uuid,uuid,uuid,uuid,jsonb,text,text), pharmacy_review_prescription(uuid,text,text) to authenticated;
grant execute on function pharmacy_save_medicine(uuid,uuid,text,text,text,uuid,text,numeric,numeric,numeric,uuid,boolean,jsonb,jsonb,text), pharmacy_save_prescription(uuid,uuid,uuid,text,text,text,date,date,integer,text,jsonb,boolean,text), pharmacy_save_settings(uuid,text,text,text,integer,integer,integer), pharmacy_set_batch_status(uuid,text,text,text,date) to authenticated;
grant execute on function pharmacy_submit_prescription(uuid), platform_add_admin(text,text), platform_admins_list(), platform_audit(integer) to authenticated;
grant execute on function platform_business_detail(uuid), platform_businesses(text), platform_health(), platform_overview() to authenticated;
grant execute on function platform_plans(), platform_remove_admin(uuid), platform_role(), platform_set_business_status(uuid,text,text) to authenticated;
grant execute on function platform_set_subscription(uuid,text,text,integer,text), platform_users(text), post_sale(uuid,uuid,uuid,jsonb,jsonb,text,text,uuid), preview_industry_change(uuid,text) to authenticated;
grant execute on function receive_purchase(uuid,uuid,jsonb,text,text), record_expense(uuid,text,numeric,text,text,date,uuid,uuid,text), record_maintenance(uuid,text,date,numeric,text,text,text), record_sale_payment(uuid,text,numeric,text,text,text) to authenticated;
grant execute on function record_supplier_bill(uuid,uuid,text,date,date,numeric,text), report_summary(uuid,date,date), return_sale(uuid,jsonb,text,jsonb,text), reverse_payment(uuid,text,text) to authenticated;
grant execute on function revoke_invitation(uuid), sale_receipt(uuid), save_farm_asset(uuid,uuid,text,text,text,date,numeric,text,integer,text,text), save_farm_task(uuid,uuid,text,text,date,text,uuid,uuid,boolean,text) to authenticated;
grant execute on function save_farm_worker(uuid,uuid,text,text,text,boolean), school_adjust_bill(uuid,numeric,text,text,numeric), school_apply(uuid,jsonb,text), school_claim_links(uuid) to authenticated;
grant execute on function school_decide_admission(uuid,text,uuid,text), school_generate_bills(uuid,uuid,uuid,date,text), school_link_guardian(uuid,uuid,uuid,text,boolean,boolean), school_mark_attendance(uuid,uuid,date,jsonb) to authenticated;
grant execute on function school_overview(uuid,uuid), school_promote(uuid,jsonb,text), school_publish_announcement(uuid,text,text,text,uuid,date), school_record_payment(uuid,numeric,text,text,text) to authenticated;
grant execute on function school_register_student(uuid,jsonb,jsonb,text), school_report_card(uuid,uuid), school_reverse_payment(uuid,text), school_review_scores(uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function school_save_class(uuid,uuid,text,integer,text,boolean,text), school_save_fee_item(uuid,uuid,text,numeric,uuid,uuid,boolean,boolean), school_save_grades(uuid,jsonb), school_save_guardian(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function school_save_holiday(uuid,date,text,boolean), school_save_remarks(uuid,uuid,uuid,text,text,text), school_save_scores(uuid,uuid,uuid,uuid,jsonb,boolean), school_save_session(uuid,uuid,text,date,date,boolean) to authenticated;
grant execute on function school_save_settings(uuid,text,text,text,text,numeric,numeric,boolean,integer[]), school_save_staff(uuid,uuid,text,text,text,text,text,boolean), school_save_subject(uuid,uuid,text,text), school_save_term(uuid,uuid,uuid,text,date,date,boolean) to authenticated;
grant execute on function school_set_assignments(uuid,uuid,jsonb), school_set_class_subjects(uuid,uuid,uuid[]), school_set_student_status(uuid,text,text), school_setup(uuid,text,text,date) to authenticated;
grant execute on function school_update_student(uuid,jsonb), set_customer_credit_limit(uuid,numeric), set_farm_task_status(uuid,text), set_member_role(uuid,text) to authenticated;
grant execute on function set_member_status(uuid,text), shares_business_with(uuid), stock_count_post(uuid,text), stock_count_record(uuid,uuid,numeric) to authenticated;
grant execute on function stock_count_start(uuid,uuid,text), void_expense(uuid,text,text), void_maintenance(uuid,text,text), void_sale(uuid,text,text) to authenticated;
grant execute on function void_supplier_bill(uuid,text,text) to authenticated;

-- Column-level writes: only these columns can be inserted or updated directly, and never ids, owners or creators.
grant insert (address, business_id, code, name, timezone) on public.branches to authenticated;
grant update (address, code, name, status, timezone) on public.branches to authenticated;
grant update (legal_name, name, settings, timezone) on public.businesses to authenticated;
grant insert (business_id, customer_id, lead_id, tag_id) on public.crm_entity_tags to authenticated;
grant insert (business_id, customer_id, kind, lead_id, occurred_at, summary) on public.crm_interactions to authenticated;
grant insert (business_id, email, name, notes, phone, source) on public.crm_leads to authenticated;
grant update (email, name, notes, phone, source, status) on public.crm_leads to authenticated;
grant insert (business_id, name) on public.crm_tags to authenticated;
grant insert (assigned_to, business_id, customer_id, due_at, lead_id, title) on public.crm_tasks to authenticated;
grant update (assigned_to, due_at, status, title) on public.crm_tasks to authenticated;
grant insert (address, business_id, category, city, company, contact_person, email, name, notes, phone, source) on public.customers to authenticated;
grant update (address, category, city, company, contact_person, email, name, notes, phone, source, status) on public.customers to authenticated;
grant insert (activity_on, activity_type, business_id, farm_batch_id, farm_unit_id, notes) on public.farm_activity_logs to authenticated;
grant insert (business_id, capacity, name, production_type, unit_type) on public.farm_units to authenticated;
grant update (capacity, name, status) on public.farm_units to authenticated;
grant insert (branch_id, business_id, location_type, name) on public.inventory_locations to authenticated;
grant update (location_type, name, status) on public.inventory_locations to authenticated;
grant insert (business_id, name, parent_id) on public.product_categories to authenticated;
grant update (name) on public.product_categories to authenticated;
grant insert (barcode, base_unit_id, business_id, category_id, currency, default_purchase_cost, description, name, product_type, reorder_level, selling_price, sku, tracks_stock) on public.products to authenticated;
grant update (barcode, category_id, default_purchase_cost, description, name, product_type, reorder_level, selling_price, sku, status) on public.products to authenticated;
grant update (avatar_path, display_name, phone) on public.profiles to authenticated;
grant insert (address, business_id, contact_name, email, name, phone) on public.suppliers to authenticated;
grant update (address, contact_name, email, name, phone, status) on public.suppliers to authenticated;
grant insert (business_id, code, conversion_factor, dimension, name) on public.units_of_measure to authenticated;
grant update (name) on public.units_of_measure to authenticated;
grant insert (branch_id, business_id, user_id) on public.user_branch_access to authenticated;
