-- Farm navigation mirrors the reference farm system. Each entry is a module so it can be switched on or off per business
-- and is plan-gated and permission-checked like any other. Modules still marked "soon" in the application show a placeholder.
-- Additive only. Rollback: delete these module rows (and their business_modules / template / plan rows).

-- ------------------------------------------------------------ permissions (modules reference them, so they come first)
insert into public.permissions (code, description) values
  ('expenses.record', 'Record and void expenses'),
  ('procurement.request', 'Raise purchase requests'),
  ('procurement.approve', 'Approve or reject purchase requests');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  (r.name in ('owner', 'business_admin', 'manager') and p.code in ('expenses.record', 'procurement.request', 'procurement.approve'))
  or (r.name = 'accountant' and p.code in ('expenses.record', 'procurement.approve'))
  or (r.name in ('inventory_officer', 'operations_staff') and p.code = 'procurement.request')
) where r.business_id is null
on conflict do nothing;

insert into public.modules (code, name, description, is_core, required_permission) values
  ('farm-alerts', 'Alerts', 'Low stock, high mortality and overdue work in one place.', false, 'farm.read'),
  ('farm-tasks', 'Tasks', 'Assign and track farm work.', false, 'farm.read'),
  ('farm-health', 'Health & Biosecurity', 'Treatments, vaccinations and withdrawal periods.', false, 'farm.read'),
  ('farm-equipment', 'Equipment', 'Machines, maintenance and repairs.', false, 'farm.read'),
  ('farm-crops', 'Crops', 'Crop cycles from planting to harvest.', false, 'farm.read'),
  ('farm-purchase-requests', 'Purchase Requests', 'Request and approve purchases before ordering.', false, 'procurement.request'),
  ('farm-supplier-bills', 'Supplier Bills', 'Bills from suppliers and what is still owed.', false, 'purchases.read'),
  ('farm-sales-orders', 'Sales Orders', 'Customer orders before they are invoiced.', false, 'sales.read'),
  ('farm-receivables', 'Receivables', 'What customers still owe the farm.', false, 'reports.finance.read'),
  ('farm-payables', 'Payables', 'What the farm still owes suppliers.', false, 'reports.finance.read'),
  ('farm-cashbook', 'Cashbook', 'Cash and bank movements in date order.', false, 'reports.finance.read'),
  ('farm-workers', 'Workers', 'Farm workers, roles and pay.', false, 'farm.manage');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m
where t.code = 'farm' and m.code = any (array['farm-alerts', 'farm-tasks', 'farm-health', 'farm-equipment', 'farm-crops', 'farm-purchase-requests', 'farm-supplier-bills', 'farm-sales-orders', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'farm-workers']);

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = any (array['farm-alerts', 'farm-tasks', 'farm-health', 'farm-equipment', 'farm-crops', 'farm-purchase-requests', 'farm-supplier-bills', 'farm-sales-orders', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'farm-workers']);

-- Existing farm businesses get the new entries switched on.
insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'farm' and m.code = any (array['farm-alerts', 'farm-tasks', 'farm-health', 'farm-equipment', 'farm-crops', 'farm-purchase-requests', 'farm-supplier-bills', 'farm-sales-orders', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'farm-workers'])
on conflict (business_id, module_id) do nothing;
