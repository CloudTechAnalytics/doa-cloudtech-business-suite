-- Pharmacy & medicine store: medicine profiles with a dispensing classification, batch-level stock that never sells expired,
-- quarantined or undated stock, quarantine / release / disposal with a recorded reason, goods receiving with accepted and rejected
-- quantities, prescriptions with a pharmacist review and permission-controlled dispensing, and the pharmacy overview.
--   * Pharmacy reuses the mart machinery (stock ledger, pack conversions, lots, counts, losses, supplier returns, cashier shifts).
--     A pharmacy business gets pharmacy-* modules whose codes mirror the mart's retail-* ones; _mart_guard maps between them.
--   * Stock stays in the shared append-only ledger. Batches (mart_lots) follow it by trigger; for pharmacy products an outgoing
--     movement may only draw on active, dated, unexpired batches, earliest expiry first. If those cannot cover it, the movement fails.
--   * Prescription-only and controlled medicines cannot be put on an ordinary sale: a trigger on sale_items refuses them unless the
--     sale is posted from pharmacy_dispense(), which needs the pharmacist permission and an approved, valid prescription.
-- Additive. Rollback: drop the objects created here, restore mart_track_lots and _mart_guard from migration 14, delete the new rows.

-- ------------------------------------------------------------ roles, permissions, modules
insert into public.permissions (code, description) values
  ('pharmacy.manage', 'Define medicines, quarantine and dispose of batches, change pharmacy settings'),
  ('pharmacy.rx', 'View and enter prescriptions and patient prescription history'),
  ('pharmacy.dispense', 'Review and approve prescriptions and dispense restricted medicines (professional authorisation)');

insert into public.roles (name, description, is_system_role) values
  ('pharmacist', 'Licensed pharmacist: reviews prescriptions and dispenses', true),
  ('pharmacy_technician', 'Enters prescriptions and serves customers; cannot approve or dispense restricted medicines', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  (p.code = 'pharmacy.manage' and r.name in ('owner', 'business_admin', 'manager'))
  or (p.code = 'pharmacy.rx' and r.name in ('owner', 'business_admin', 'manager', 'pharmacist', 'pharmacy_technician'))
  or (p.code = 'pharmacy.dispense' and r.name in ('owner', 'business_admin', 'pharmacist'))
) where r.business_id is null;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  (r.name = 'pharmacist' and p.code in ('dashboard.read', 'inventory.read', 'inventory.adjust', 'sales.read', 'sales.create', 'customers.read', 'customers.manage', 'purchases.read', 'suppliers.read'))
  or (r.name = 'pharmacy_technician' and p.code in ('dashboard.read', 'inventory.read', 'sales.read', 'sales.create', 'customers.read', 'customers.manage'))
) where r.business_id is null;

insert into public.modules (code, name, description, is_core, required_permission) values
  ('pharmacy-products', 'Medicines', 'Medicine catalogue with classification, units and barcodes.', false, 'inventory.read'),
  ('pharmacy-categories', 'Categories', 'Medicine categories.', false, 'inventory.read'),
  ('pharmacy-batches', 'Batches & Expiry', 'Batch balances, expiry, quarantine and disposal.', false, 'inventory.read'),
  ('pharmacy-prescriptions', 'Prescriptions', 'Prescription records, pharmacist review and dispensing.', false, 'pharmacy.rx'),
  ('pharmacy-counts', 'Stock Counts', 'Physical counts with manager approval.', false, 'inventory.read'),
  ('pharmacy-losses', 'Damaged & Expired', 'Damaged, expired and missing stock.', false, 'inventory.read'),
  ('pharmacy-returns', 'Supplier Returns', 'Goods sent back to suppliers.', false, 'purchases.read'),
  ('pharmacy-shifts', 'Cashier Shifts', 'Opening cash, cash movements and closing variance.', false, 'sales.create'),
  ('pharmacy-reports', 'Pharmacy Reports', 'Sales, stock, expiry and profit reports.', false, 'reports.finance.read');

update public.industry_templates set name = 'Pharmacy & Medicine Store', description = 'Pharmacies and medicine stores: batches, expiry, prescriptions and dispensing.', status = 'active' where code = 'pharmacy';

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, m.is_core or m.code = 'sales'
from public.industry_templates t
join public.modules m on m.is_core or m.code like 'pharmacy-%' or m.code in ('inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports')
where t.code = 'pharmacy'
on conflict do nothing;

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code like 'pharmacy-%';

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'pharmacy' and (m.code like 'pharmacy-%' or m.code in ('inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports'))
on conflict (business_id, module_id) do nothing;

-- A pharmacy business uses the mart's functions through its own pharmacy-* modules.
create or replace function public._mart_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_module text := p_module;
begin
  if p_module like 'retail-%' and exists (select 1 from public.businesses where id = p_business and primary_industry_code = 'pharmacy') then
    v_module := 'pharmacy-' || substr(p_module, 8);
  end if;
  if not public.has_module_permission(p_business, v_module, p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- ----------------------------------------------------------------- tables
create table public.pharmacy_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  business_type text not null default 'community_pharmacy' check (business_type in ('community_pharmacy', 'medicine_store', 'retail_chain', 'hospital_pharmacy', 'distributor')),
  licence_number text check (licence_number is null or length(btrim(licence_number)) between 1 and 80),
  superintendent_name text check (superintendent_name is null or length(btrim(superintendent_name)) between 1 and 120),
  expiry_warning_days integer not null default 180 check (expiry_warning_days between 1 and 730),
  expiry_alert_days integer not null default 90 check (expiry_alert_days between 1 and 730),
  expiry_critical_days integer not null default 30 check (expiry_critical_days between 1 and 730),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (expiry_critical_days <= expiry_alert_days and expiry_alert_days <= expiry_warning_days)
);

create table public.pharmacy_medicine_profiles (
  product_id uuid primary key,
  business_id uuid not null,
  generic_name text check (generic_name is null or length(btrim(generic_name)) between 1 and 160),
  active_ingredient text check (active_ingredient is null or length(btrim(active_ingredient)) between 1 and 200),
  strength text check (strength is null or length(btrim(strength)) between 1 and 60),
  dosage_form text not null default 'other' check (dosage_form in ('tablet', 'capsule', 'syrup', 'suspension', 'cream', 'ointment', 'injection', 'drops', 'inhaler', 'powder', 'suppository', 'device', 'other')),
  manufacturer text check (manufacturer is null or length(btrim(manufacturer)) between 1 and 160),
  registration_no text check (registration_no is null or length(btrim(registration_no)) between 1 and 60),
  classification text not null default 'otc' check (classification in ('otc', 'prescription_only', 'controlled', 'device', 'general')),
  storage text check (storage is null or length(btrim(storage)) between 1 and 300),
  max_stock numeric(18, 4) check (max_stock is null or max_stock >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, product_id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);

alter table public.mart_lots
  add column status text not null default 'active' check (status in ('active', 'quarantined')),
  add column status_reason text,
  add column manufactured_on date,
  add column supplier_id uuid,
  add column location_id uuid;

create table public.pharmacy_batch_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  lot_id uuid not null,
  event text not null check (event in ('quarantined', 'released', 'recalled', 'disposed', 'completed')),
  quantity numeric(18, 4),
  reason text not null,
  actor uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, lot_id) references public.mart_lots (business_id, id)
);
create index pharmacy_batch_events_lot_idx on public.pharmacy_batch_events (lot_id, created_at);

create table public.pharmacy_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  receipt_number text not null,
  purchase_id uuid,
  supplier_id uuid,
  location_id uuid not null,
  invoice_reference text,
  received_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, receipt_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);
create table public.pharmacy_goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  receipt_id uuid not null,
  product_id uuid not null,
  batch_number text,
  expires_on date not null,
  manufactured_on date,
  received_quantity numeric(18, 4) not null check (received_quantity > 0),
  accepted_quantity numeric(18, 4) not null check (accepted_quantity >= 0),
  rejected_quantity numeric(18, 4) not null check (rejected_quantity >= 0),
  rejection_reason text,
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  stock_movement_id uuid,
  check (accepted_quantity + rejected_quantity = received_quantity),
  check (rejected_quantity = 0 or rejection_reason is not null),
  foreign key (business_id, receipt_id) references public.pharmacy_goods_receipts (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);

create table public.pharmacy_prescriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  rx_number text not null,
  customer_id uuid,
  patient_name text not null check (length(btrim(patient_name)) between 2 and 160),
  prescriber_name text not null check (length(btrim(prescriber_name)) between 2 and 160),
  prescriber_licence text check (prescriber_licence is null or length(btrim(prescriber_licence)) between 1 and 80),
  prescribed_on date not null default current_date,
  valid_until date not null,
  refills_allowed integer not null default 0 check (refills_allowed between 0 and 12),
  status text not null default 'draft' check (status in ('draft', 'awaiting_review', 'approved', 'partially_dispensed', 'dispensed', 'rejected', 'cancelled')),
  notes text,
  review_note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, rx_number),
  unique (business_id, idempotency_key),
  check (valid_until >= prescribed_on),
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);
create table public.pharmacy_prescription_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  prescription_id uuid not null,
  product_id uuid not null,
  quantity_prescribed numeric(18, 4) not null check (quantity_prescribed > 0),
  quantity_dispensed numeric(18, 4) not null default 0 check (quantity_dispensed >= 0),
  directions text check (directions is null or length(btrim(directions)) between 1 and 400),
  unique (business_id, id),
  check (quantity_dispensed <= quantity_prescribed),
  foreign key (business_id, prescription_id) references public.pharmacy_prescriptions (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);
create table public.pharmacy_dispensings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  prescription_id uuid not null,
  sale_id uuid,
  dispensed_by uuid references public.profiles (id),
  dispensed_at timestamptz not null default now(),
  note text,
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, prescription_id) references public.pharmacy_prescriptions (business_id, id),
  foreign key (business_id, sale_id) references public.sales (business_id, id)
);
create table public.pharmacy_dispensing_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  dispensing_id uuid not null,
  prescription_item_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  foreign key (business_id, dispensing_id) references public.pharmacy_dispensings (business_id, id) on delete cascade,
  foreign key (business_id, prescription_item_id) references public.pharmacy_prescription_items (business_id, id)
);

-- -------------------------------------------------------- lots follow the ledger (pharmacy-aware)
create or replace function public.mart_track_lots() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_need numeric; l record; v_take numeric; a record; v_pharm boolean; v_forced uuid; v_name text;
begin
  if new.movement_type in ('transfer_in', 'transfer_out', 'production_output') then return new; end if;
  v_pharm := exists (select 1 from public.pharmacy_medicine_profiles where product_id = new.product_id and business_id = new.business_id);
  if not v_pharm and not exists (select 1 from public.mart_product_profiles where product_id = new.product_id and business_id = new.business_id and track_expiry) then return new; end if;

  if new.reversal_of_movement_id is not null then
    for a in select * from public.mart_lot_allocations where movement_id = new.reversal_of_movement_id and not restored loop
      update public.mart_lots set remaining = remaining + a.quantity where id = a.lot_id and not voided;
      update public.mart_lot_allocations set restored = true where id = a.id;
    end loop;
    update public.mart_lots set remaining = 0, voided = true where source_movement_id = new.reversal_of_movement_id;
    return new;
  end if;

  if new.quantity_delta > 0 and new.movement_type in ('receipt', 'return_in', 'adjustment', 'count_adjustment') then
    -- pharmacy: only a goods receipt is sellable at once; returns and found stock wait in quarantine until batch and expiry are confirmed
    insert into public.mart_lots (business_id, product_id, quantity, remaining, source_movement_id, location_id, status, status_reason)
    values (new.business_id, new.product_id, new.quantity_delta, new.quantity_delta, new.id, new.location_id,
      case when v_pharm and new.movement_type <> 'receipt' then 'quarantined' else 'active' end,
      case when v_pharm and new.movement_type = 'return_in' then 'Customer return awaiting inspection'
           when v_pharm and new.movement_type in ('adjustment', 'count_adjustment') then 'Stock added by adjustment: confirm batch and expiry' end);
  elsif new.quantity_delta < 0 then
    v_need := -new.quantity_delta;
    begin v_forced := nullif(current_setting('app.pharm_lot', true), '')::uuid; exception when others then v_forced := null; end;
    for l in select * from public.mart_lots where business_id = new.business_id and product_id = new.product_id and remaining > 0 and not voided
               and (case when v_forced is not null then id = v_forced
                         when not v_pharm then true
                         when new.movement_type = 'return_out' then true
                         else status = 'active' and expires_on is not null and expires_on >= current_date end)
             order by (v_pharm and status = 'active' and expires_on is not null and expires_on >= current_date), expires_on nulls last, received_on, created_at for update loop
      exit when v_need <= 0;
      v_take := least(l.remaining, v_need);
      update public.mart_lots set remaining = remaining - v_take where id = l.id;
      insert into public.mart_lot_allocations (business_id, lot_id, movement_id, quantity) values (new.business_id, l.id, new.id, v_take);
      v_need := v_need - v_take;
    end loop;
    if v_pharm and v_need > 0 then
      select name into v_name from public.products where id = new.product_id;
      raise exception 'not enough saleable stock of %: expired, quarantined or undated batches are excluded', v_name using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- Restricted medicines only leave through a dispensing; units that cannot be split must be whole.
create function public.pharmacy_sale_item_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f public.pharmacy_medicine_profiles; v_name text; v_unit text;
begin
  select * into f from public.pharmacy_medicine_profiles where product_id = new.product_id and business_id = new.business_id;
  if not found then return new; end if;
  select p.name, u.code into v_name, v_unit from public.products p join public.units_of_measure u on u.business_id = p.business_id and u.id = p.base_unit_id where p.id = new.product_id;
  if f.classification in ('prescription_only', 'controlled') and coalesce(current_setting('app.pharm_dispense', true), '') <> 'on' then
    raise exception '% is a restricted medicine and can only be dispensed against an approved prescription', v_name using errcode = '42501';
  end if;
  if v_unit in ('each', 'dozen') and new.quantity <> trunc(new.quantity) then
    raise exception '% is sold in whole units', v_name using errcode = '22023';
  end if;
  return new;
end $$;
create trigger sale_items_pharmacy_guard before insert on public.sale_items for each row execute function public.pharmacy_sale_item_guard();

-- --------------------------------------------------------------------- views
create view public.pharmacy_medicines with (security_invoker = true) as
select m.*, f.generic_name, f.active_ingredient, f.strength, f.dosage_form, f.manufacturer, f.registration_no, f.classification, f.storage, f.max_stock,
  coalesce(l.saleable, 0) as saleable, coalesce(l.quarantined, 0) as quarantined_qty, coalesce(l.expired, 0) as expired_qty, coalesce(l.undated, 0) as undated_qty
from public.mart_products m
join public.pharmacy_medicine_profiles f on f.business_id = m.business_id and f.product_id = m.id
left join lateral (
  select sum(remaining) filter (where status = 'active' and expires_on >= current_date) as saleable,
         sum(remaining) filter (where status = 'quarantined') as quarantined,
         sum(remaining) filter (where status = 'active' and expires_on < current_date) as expired,
         sum(remaining) filter (where status = 'active' and expires_on is null) as undated
  from public.mart_lots x where x.product_id = m.id and x.remaining > 0 and not x.voided) l on true;

create view public.pharmacy_batches with (security_invoker = true) as
select l.id, l.business_id, l.product_id, p.name as product_name, l.batch_number, l.quantity, l.remaining, l.received_on, l.manufactured_on, l.expires_on, l.status, l.status_reason,
  l.location_id, loc.name as location_name, l.supplier_id, s.name as supplier_name, (l.expires_on - current_date) as days_left,
  case when l.expires_on is null then 'unknown' when l.expires_on < current_date then 'expired'
       when l.expires_on <= current_date + coalesce(ps.expiry_critical_days, 30) then 'critical'
       when l.expires_on <= current_date + coalesce(ps.expiry_alert_days, 90) then 'warning'
       when l.expires_on <= current_date + coalesce(ps.expiry_warning_days, 180) then 'watch' else 'ok' end as expiry_status,
  round(l.remaining * coalesce(sm.unit_cost, p.default_purchase_cost, 0), 2) as value
from public.mart_lots l
join public.products p on p.business_id = l.business_id and p.id = l.product_id
left join public.stock_movements sm on sm.business_id = l.business_id and sm.id = l.source_movement_id
left join public.pharmacy_settings ps on ps.business_id = l.business_id
left join public.inventory_locations loc on loc.business_id = l.business_id and loc.id = l.location_id
left join public.suppliers s on s.business_id = l.business_id and s.id = l.supplier_id
where l.remaining > 0 and not l.voided
  and exists (select 1 from public.pharmacy_medicine_profiles f where f.product_id = l.product_id);

create view public.pharmacy_prescription_list with (security_invoker = true) as
select pr.*, case when pr.status in ('awaiting_review', 'approved', 'partially_dispensed') and pr.valid_until < current_date then 'expired' else pr.status end as effective_status,
  c.name as customer_name,
  coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id, 'product', p.name, 'prescribed', i.quantity_prescribed, 'dispensed', i.quantity_dispensed, 'directions', i.directions) order by p.name)
    from public.pharmacy_prescription_items i join public.products p on p.business_id = i.business_id and p.id = i.product_id where i.prescription_id = pr.id), '[]'::jsonb) as items
from public.pharmacy_prescriptions pr left join public.customers c on c.business_id = pr.business_id and c.id = pr.customer_id;

-- --------------------------------------------------------------------- RLS
alter table public.pharmacy_settings enable row level security;
alter table public.pharmacy_medicine_profiles enable row level security;
alter table public.pharmacy_batch_events enable row level security;
alter table public.pharmacy_goods_receipts enable row level security;
alter table public.pharmacy_goods_receipt_items enable row level security;
alter table public.pharmacy_prescriptions enable row level security;
alter table public.pharmacy_prescription_items enable row level security;
alter table public.pharmacy_dispensings enable row level security;
alter table public.pharmacy_dispensing_items enable row level security;

create policy pharmacy_settings_select on public.pharmacy_settings for select to authenticated using (public.is_active_member(business_id));
create policy pharmacy_profiles_select on public.pharmacy_medicine_profiles for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy pharmacy_events_select on public.pharmacy_batch_events for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy pharmacy_grn_select on public.pharmacy_goods_receipts for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy pharmacy_grn_items_select on public.pharmacy_goods_receipt_items for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
-- prescriptions and dispensing history are health-related: only staff with the prescription permission see them
create policy pharmacy_rx_select on public.pharmacy_prescriptions for select to authenticated using (public.has_module_permission(business_id, 'pharmacy-prescriptions', 'pharmacy.rx', 'read'));
create policy pharmacy_rx_items_select on public.pharmacy_prescription_items for select to authenticated using (public.has_module_permission(business_id, 'pharmacy-prescriptions', 'pharmacy.rx', 'read'));
create policy pharmacy_disp_select on public.pharmacy_dispensings for select to authenticated using (public.has_module_permission(business_id, 'pharmacy-prescriptions', 'pharmacy.rx', 'read'));
create policy pharmacy_disp_items_select on public.pharmacy_dispensing_items for select to authenticated using (public.has_module_permission(business_id, 'pharmacy-prescriptions', 'pharmacy.rx', 'read'));
grant select on public.pharmacy_settings, public.pharmacy_medicine_profiles, public.pharmacy_batch_events, public.pharmacy_goods_receipts, public.pharmacy_goods_receipt_items,
  public.pharmacy_prescriptions, public.pharmacy_prescription_items, public.pharmacy_dispensings, public.pharmacy_dispensing_items,
  public.pharmacy_medicines, public.pharmacy_batches, public.pharmacy_prescription_list to authenticated;

create trigger audit_pharmacy_profiles after insert or update on public.pharmacy_medicine_profiles for each row execute function public.audit_row_change();
create trigger audit_pharmacy_settings after insert or update on public.pharmacy_settings for each row execute function public.audit_row_change();
-- notes and review notes are health-related, so they stay out of the audit metadata
create trigger audit_pharmacy_rx after insert or update on public.pharmacy_prescriptions for each row execute function public.audit_row_change('notes', 'review_note');
create trigger audit_pharmacy_dispensings after insert on public.pharmacy_dispensings for each row execute function public.audit_row_change();
create trigger audit_pharmacy_events after insert on public.pharmacy_batch_events for each row execute function public.audit_row_change();
create trigger audit_pharmacy_grn after insert on public.pharmacy_goods_receipts for each row execute function public.audit_row_change();

-- --------------------------------------------------------------------- functions
create function public._pharmacy_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
end $$;

create function public.pharmacy_save_settings(p_business uuid, p_type text, p_licence text, p_superintendent text, p_warning integer, p_alert integer, p_critical integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(p_business, 'pharmacy.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.module_usable(p_business, 'pharmacy-products', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not (p_critical between 1 and 730 and p_alert between 1 and 730 and p_warning between 1 and 730) or p_critical > p_alert or p_alert > p_warning then
    raise exception 'expiry warning periods must go from the shortest (critical) to the longest (watch), each between 1 and 730 days' using errcode = '22023';
  end if;
  insert into public.pharmacy_settings (business_id, business_type, licence_number, superintendent_name, expiry_warning_days, expiry_alert_days, expiry_critical_days, updated_by)
  values (p_business, coalesce(p_type, 'community_pharmacy'), nullif(btrim(coalesce(p_licence, '')), ''), nullif(btrim(coalesce(p_superintendent, '')), ''), p_warning, p_alert, p_critical, auth.uid())
  on conflict (business_id) do update set business_type = excluded.business_type, licence_number = excluded.licence_number, superintendent_name = excluded.superintendent_name,
    expiry_warning_days = excluded.expiry_warning_days, expiry_alert_days = excluded.expiry_alert_days, expiry_critical_days = excluded.expiry_critical_days, updated_by = auth.uid(), updated_at = now();
end $$;

-- Profile: {generic_name, brand, active_ingredient, strength, dosage_form, manufacturer, registration_no, classification, storage, max_stock}
create function public.pharmacy_save_medicine(
  p_business uuid, p_id uuid, p_name text, p_sku text, p_barcode text, p_category uuid, p_unit_code text, p_cost numeric, p_price numeric, p_reorder numeric,
  p_supplier uuid, p_active boolean, p_packs jsonb, p_profile jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_pid uuid; v_class text := coalesce(p_profile ->> 'classification', 'otc'); v_form text := coalesce(p_profile ->> 'dosage_form', 'other'); v_prev jsonb;
begin
  perform public._pharmacy_guard(p_business, 'pharmacy-products', 'pharmacy.manage');
  if p_id is null then v_prev := public._idem_check(p_business, p_key, 'pharmacy_medicine_create'); if v_prev is not null then return v_prev; end if; end if;
  if v_class not in ('otc', 'prescription_only', 'controlled', 'device', 'general') then raise exception 'choose a valid classification' using errcode = '22023'; end if;
  if v_form not in ('tablet', 'capsule', 'syrup', 'suspension', 'cream', 'ointment', 'injection', 'drops', 'inhaler', 'powder', 'suppository', 'device', 'other') then raise exception 'choose a valid dosage form' using errcode = '22023'; end if;
  if p_id is not null and not exists (select 1 from public.pharmacy_medicine_profiles where product_id = p_id and business_id = p_business) then raise exception 'medicine not found' using errcode = '22023'; end if;
  -- the mart product function holds the shared rules (names, prices, packs, duplicates); every medicine tracks batches and expiry
  v_res := public.mart_save_product(p_business, p_id, p_name, p_sku, p_barcode, p_category, p_profile ->> 'brand', p_unit_code, p_cost, p_price, null, p_reorder, p_supplier, true, p_active, p_packs,
    case when p_id is null then p_key || ':mart' else null end);
  v_pid := (v_res ->> 'product_id')::uuid;
  insert into public.pharmacy_medicine_profiles (product_id, business_id, generic_name, active_ingredient, strength, dosage_form, manufacturer, registration_no, classification, storage, max_stock)
  values (v_pid, p_business, nullif(btrim(coalesce(p_profile ->> 'generic_name', '')), ''), nullif(btrim(coalesce(p_profile ->> 'active_ingredient', '')), ''), nullif(btrim(coalesce(p_profile ->> 'strength', '')), ''),
    v_form, nullif(btrim(coalesce(p_profile ->> 'manufacturer', '')), ''), nullif(btrim(coalesce(p_profile ->> 'registration_no', '')), ''), v_class,
    nullif(btrim(coalesce(p_profile ->> 'storage', '')), ''), nullif(p_profile ->> 'max_stock', '')::numeric)
  on conflict (product_id) do update set generic_name = excluded.generic_name, active_ingredient = excluded.active_ingredient, strength = excluded.strength, dosage_form = excluded.dosage_form,
    manufacturer = excluded.manufacturer, registration_no = excluded.registration_no, classification = excluded.classification, storage = excluded.storage, max_stock = excluded.max_stock;
  if p_id is null then return public._idem_store(p_business, p_key, 'pharmacy_medicine_create', jsonb_build_object('product_id', v_pid)); end if;
  return jsonb_build_object('product_id', v_pid);
end $$;

-- Quarantine a batch (it stops being saleable) or release it (batch and expiry must be known and in date).
create function public.pharmacy_set_batch_status(p_lot uuid, p_status text, p_reason text, p_batch text default null, p_expiry date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.mart_lots; v_expiry date;
begin
  select * into l from public.mart_lots where id = p_lot and not voided;
  if not found or not exists (select 1 from public.pharmacy_medicine_profiles where product_id = l.product_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if not (public.has_business_permission(l.business_id, 'pharmacy.manage') or public.has_business_permission(l.business_id, 'pharmacy.dispense'))
     or not public.module_usable(l.business_id, 'pharmacy-batches', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('active', 'quarantined') then raise exception 'choose quarantine or release' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_status = 'quarantined' and l.status = 'quarantined' then raise exception 'this batch is already quarantined' using errcode = '22023'; end if;
  if p_status = 'active' then
    if l.status = 'active' then raise exception 'this batch is not quarantined' using errcode = '22023'; end if;
    v_expiry := coalesce(p_expiry, l.expires_on);
    if v_expiry is null then raise exception 'enter the expiry date before releasing this batch' using errcode = '22023'; end if;
    if v_expiry < current_date then raise exception 'an expired batch cannot be released for sale; dispose of it' using errcode = '22023'; end if;
    update public.mart_lots set status = 'active', status_reason = null, expires_on = v_expiry, batch_number = coalesce(nullif(btrim(coalesce(p_batch, '')), ''), batch_number) where id = p_lot;
  else
    update public.mart_lots set status = 'quarantined', status_reason = btrim(p_reason) where id = p_lot;
  end if;
  insert into public.pharmacy_batch_events (business_id, lot_id, event, quantity, reason, actor)
  values (l.business_id, l.id, case when p_status = 'active' then 'released' else 'quarantined' end, l.remaining, btrim(p_reason), auth.uid());
end $$;

-- Completes batch and expiry for stock that arrived without them (for example through a plain purchase receipt).
create function public.pharmacy_complete_batch(p_lot uuid, p_batch text, p_expiry date) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.mart_lots;
begin
  select * into l from public.mart_lots where id = p_lot and not voided;
  if not found or not exists (select 1 from public.pharmacy_medicine_profiles where product_id = l.product_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._pharmacy_guard(l.business_id, 'inventory', 'inventory.adjust');
  if p_expiry is null then raise exception 'enter the expiry date' using errcode = '22023'; end if;
  update public.mart_lots set batch_number = nullif(btrim(coalesce(p_batch, '')), ''), expires_on = p_expiry where id = p_lot;
  insert into public.pharmacy_batch_events (business_id, lot_id, event, quantity, reason, actor) values (l.business_id, l.id, 'completed', l.remaining, 'Batch and expiry recorded', auth.uid());
end $$;

-- Writes off stock from one named batch (typically expired, damaged or recalled). Needs the manager permission.
create function public.pharmacy_dispose_batch(p_lot uuid, p_qty numeric, p_reason text, p_notes text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.mart_lots; v_prev jsonb; v_loc uuid; v_res jsonb; v_reason text;
begin
  select * into l from public.mart_lots where id = p_lot and not voided;
  if not found or not exists (select 1 from public.pharmacy_medicine_profiles where product_id = l.product_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._pharmacy_guard(l.business_id, 'pharmacy-batches', 'pharmacy.manage');
  v_prev := public._idem_check(l.business_id, p_key, 'pharmacy_dispose'); if v_prev is not null then return v_prev; end if;
  if p_reason not in ('expired', 'damaged', 'recalled', 'other') then raise exception 'choose a reason' using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > l.remaining then raise exception 'quantity must be between 0 and the % left in this batch', l.remaining using errcode = '22023'; end if;
  select location_id into v_loc from public.stock_movements where id = l.source_movement_id;
  v_reason := case when p_reason in ('expired', 'damaged') then p_reason else 'other' end;
  perform set_config('app.pharm_lot', l.id::text, true);
  v_res := public.mart_record_loss(l.business_id, l.product_id, v_loc, p_qty, v_reason, case when p_reason in ('recalled', 'other') then initcap(p_reason) || ': ' else '' end || coalesce(p_notes, '') || ' (batch ' || coalesce(l.batch_number, 'unnamed') || ')', p_key || ':loss');
  perform set_config('app.pharm_lot', '', true);
  insert into public.pharmacy_batch_events (business_id, lot_id, event, quantity, reason, actor)
  values (l.business_id, l.id, case when p_reason = 'recalled' then 'recalled' else 'disposed' end, p_qty, p_reason || coalesce(': ' || nullif(btrim(coalesce(p_notes, '')), ''), ''), auth.uid());
  return public._idem_store(l.business_id, p_key, 'pharmacy_dispose', v_res);
end $$;

-- Items: [{product_id, pack, received, rejected, rejection_reason, unit_cost, batch, expiry, manufactured, purchase_item_id}].
-- Only the accepted quantity enters stock; quantities and unit costs are per pack when a pack is named. With a purchase order the
-- accepted quantity is received against the order line (rejected goods stay open on the order).
create function public.pharmacy_receive_goods(p_business uuid, p_location uuid, p_purchase uuid, p_supplier uuid, p_items jsonb, p_invoice text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; it jsonb; pr public.products; v_f numeric; v_recv numeric; v_rej numeric; v_acc numeric; v_cost numeric; m public.stock_movements;
  v_group uuid := gen_random_uuid(); v_lines jsonb := '[]'::jsonb; v_pu public.purchases; v_receipt jsonb; v_exp date; v_sup uuid := p_supplier; v_pi uuid; v_mv uuid; v_items uuid[] := '{}'; v_ins uuid; v_pend jsonb := '[]'::jsonb; r record;
begin
  perform public._pharmacy_guard(p_business, 'inventory', 'inventory.adjust');
  v_prev := public._idem_check(p_business, p_key, 'pharmacy_receive'); if v_prev is not null then return v_prev; end if;
  perform public._require_location(p_business, p_location);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'items must be 1 to 200 lines' using errcode = '22023'; end if;
  if p_purchase is not null then
    select * into v_pu from public.purchases where id = p_purchase and business_id = p_business;
    if not found then raise exception 'purchase not found' using errcode = '22023'; end if;
    v_sup := v_pu.supplier_id;
  end if;
  v_number := public._next_number(p_business, 'pharmacy_grn', 'PGR');
  insert into public.pharmacy_goods_receipts (id, business_id, receipt_number, purchase_id, supplier_id, location_id, invoice_reference, received_by, idempotency_key)
  values (v_id, p_business, v_number, p_purchase, v_sup, p_location, nullif(btrim(coalesce(p_invoice, '')), ''), auth.uid(), p_key);

  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and business_id = p_business and status = 'active' and tracks_stock;
    if not found or not exists (select 1 from public.pharmacy_medicine_profiles where product_id = pr.id) then raise exception 'invalid medicine' using errcode = '22023'; end if;
    v_f := public._pack_factor(p_business, pr.id, it ->> 'pack');
    v_recv := round((it ->> 'received')::numeric * v_f, 4);
    v_rej := round(coalesce((it ->> 'rejected')::numeric, 0) * v_f, 4);
    if v_recv is null or v_recv <= 0 then raise exception 'received quantity must be greater than zero' using errcode = '22023'; end if;
    if v_rej < 0 or v_rej > v_recv then raise exception 'rejected quantity cannot be more than received' using errcode = '22023'; end if;
    if v_rej > 0 and length(btrim(coalesce(it ->> 'rejection_reason', ''))) < 3 then raise exception 'say why % was rejected', pr.name using errcode = '22023'; end if;
    v_acc := v_recv - v_rej;
    v_exp := nullif(it ->> 'expiry', '')::date;
    if v_exp is null then raise exception 'enter the expiry date for %', pr.name using errcode = '22023'; end if;
    if v_acc > 0 and v_exp < current_date then raise exception 'the expiry date for % is in the past; reject expired goods', pr.name using errcode = '22023'; end if;
    if length(btrim(coalesce(it ->> 'batch', ''))) = 0 then raise exception 'enter the batch number for %', pr.name using errcode = '22023'; end if;
    if pr.base_unit_id is not null and exists (select 1 from public.units_of_measure u where u.id = pr.base_unit_id and u.code in ('each', 'dozen')) and (v_recv <> trunc(v_recv) or v_rej <> trunc(v_rej)) then
      raise exception '% is received in whole units', pr.name using errcode = '22023';
    end if;
    v_cost := case when (it ->> 'unit_cost') is null then null else round((it ->> 'unit_cost')::numeric / v_f, 4) end;
    if v_cost is not null and v_cost < 0 then raise exception 'unit cost cannot be negative' using errcode = '22023'; end if;
    v_mv := null;
    if v_acc > 0 then
      if p_purchase is not null then
        v_pi := nullif(it ->> 'purchase_item_id', '')::uuid;
        if v_pi is null then select id into v_pi from public.purchase_items where purchase_id = p_purchase and product_id = pr.id limit 1; end if;
        if v_pi is null then raise exception '% is not on this purchase order', pr.name using errcode = '22023'; end if;
        v_lines := v_lines || jsonb_build_object('purchase_item_id', v_pi, 'quantity', v_acc);
        v_pend := v_pend || jsonb_build_object('purchase_item_id', v_pi, 'batch', it ->> 'batch', 'expiry', v_exp, 'manufactured', nullif(it ->> 'manufactured', ''));
      else
        m := public._post_movement(p_business, pr.id, p_location, 'receipt', v_acc, v_cost, 'pharmacy_receipt', v_id, v_group, coalesce(p_invoice, v_number));
        v_mv := m.id;
        update public.mart_lots set batch_number = btrim(it ->> 'batch'), expires_on = v_exp, manufactured_on = nullif(it ->> 'manufactured', '')::date, supplier_id = v_sup where source_movement_id = m.id;
      end if;
    end if;
    insert into public.pharmacy_goods_receipt_items (business_id, receipt_id, product_id, batch_number, expires_on, manufactured_on, received_quantity, accepted_quantity, rejected_quantity, rejection_reason, unit_cost, stock_movement_id)
    values (p_business, v_id, pr.id, btrim(it ->> 'batch'), v_exp, nullif(it ->> 'manufactured', '')::date, v_recv, v_acc, v_rej, nullif(btrim(coalesce(it ->> 'rejection_reason', '')), ''), v_cost, v_mv);
  end loop;

  if p_purchase is not null and jsonb_array_length(v_lines) > 0 then
    v_receipt := public.receive_purchase(p_purchase, p_location, v_lines, 'Pharmacy receipt ' || v_number, p_key || ':po');
    -- attach batch, expiry and supplier to the lots the purchase receipt just created
    for r in select pri.purchase_item_id, pri.stock_movement_id from public.purchase_receipt_items pri where pri.purchase_receipt_id = (v_receipt ->> 'receipt_id')::uuid and pri.stock_movement_id is not null loop
      update public.mart_lots set batch_number = btrim(x.batch), expires_on = x.expiry::date, manufactured_on = nullif(x.manufactured, '')::date, supplier_id = v_sup
      from (select it2 ->> 'batch' as batch, it2 ->> 'expiry' as expiry, it2 ->> 'manufactured' as manufactured from jsonb_array_elements(v_pend) it2 where (it2 ->> 'purchase_item_id')::uuid = r.purchase_item_id limit 1) x
      where source_movement_id = r.stock_movement_id;
      update public.pharmacy_goods_receipt_items set stock_movement_id = r.stock_movement_id
      where receipt_id = v_id and stock_movement_id is null and accepted_quantity > 0 and product_id = (select product_id from public.purchase_items where id = r.purchase_item_id);
    end loop;
  end if;
  return public._idem_store(p_business, p_key, 'pharmacy_receive', jsonb_build_object('receipt_id', v_id, 'receipt_number', v_number));
end $$;

-- ------------------------------------------------------------- prescriptions
-- Items: [{product_id, quantity, directions}]; quantities are in the medicine's base unit. Drafts can be edited; submitting sends it for review.
create function public.pharmacy_save_prescription(
  p_business uuid, p_id uuid, p_customer uuid, p_patient text, p_prescriber text, p_licence text, p_prescribed_on date, p_valid_until date,
  p_refills integer, p_notes text, p_items jsonb, p_submit boolean, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := coalesce(p_id, gen_random_uuid()); v_number text; rx public.pharmacy_prescriptions; it jsonb; v_seen uuid[] := '{}'; v_pid uuid;
begin
  perform public._pharmacy_guard(p_business, 'pharmacy-prescriptions', 'pharmacy.rx');
  if p_id is null then v_prev := public._idem_check(p_business, p_key, 'pharmacy_rx_create'); if v_prev is not null then return v_prev; end if; end if;
  if length(btrim(coalesce(p_patient, ''))) < 2 then raise exception 'enter the patient name' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_prescriber, ''))) < 2 then raise exception 'enter the prescriber name' using errcode = '22023'; end if;
  if p_prescribed_on is null or p_valid_until is null or p_valid_until < p_prescribed_on then raise exception 'the prescription must be valid from its date' using errcode = '22023'; end if;
  if p_prescribed_on > current_date then raise exception 'a prescription cannot be dated in the future' using errcode = '22023'; end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and business_id = p_business) then raise exception 'unknown customer' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'a prescription needs 1 to 30 medicines' using errcode = '22023'; end if;
  if p_id is not null then
    select * into rx from public.pharmacy_prescriptions where id = p_id and business_id = p_business for update;
    if not found then raise exception 'prescription not found' using errcode = '22023'; end if;
    if rx.status <> 'draft' then raise exception 'only a draft prescription can be edited' using errcode = '22023'; end if;
    update public.pharmacy_prescriptions set customer_id = p_customer, patient_name = btrim(p_patient), prescriber_name = btrim(p_prescriber), prescriber_licence = nullif(btrim(coalesce(p_licence, '')), ''),
      prescribed_on = p_prescribed_on, valid_until = p_valid_until, refills_allowed = coalesce(p_refills, 0), notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now() where id = p_id;
    delete from public.pharmacy_prescription_items where prescription_id = p_id;
  else
    v_number := public._next_number(p_business, 'pharmacy_rx', 'RX');
    insert into public.pharmacy_prescriptions (id, business_id, rx_number, customer_id, patient_name, prescriber_name, prescriber_licence, prescribed_on, valid_until, refills_allowed, notes, created_by, idempotency_key)
    values (v_id, p_business, v_number, p_customer, btrim(p_patient), btrim(p_prescriber), nullif(btrim(coalesce(p_licence, '')), ''), p_prescribed_on, p_valid_until, coalesce(p_refills, 0), nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), p_key);
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it ->> 'product_id')::uuid;
    if v_pid = any (v_seen) then raise exception 'each medicine can appear once on a prescription' using errcode = '22023'; end if;
    v_seen := v_seen || v_pid;
    if not exists (select 1 from public.pharmacy_medicine_profiles f join public.products p on p.id = f.product_id and p.business_id = f.business_id where f.product_id = v_pid and f.business_id = p_business and p.status = 'active') then raise exception 'invalid medicine' using errcode = '22023'; end if;
    if (it ->> 'quantity') is null or (it ->> 'quantity')::numeric <= 0 then raise exception 'prescribed quantity must be greater than zero' using errcode = '22023'; end if;
    insert into public.pharmacy_prescription_items (business_id, prescription_id, product_id, quantity_prescribed, directions)
    values (p_business, v_id, v_pid, round((it ->> 'quantity')::numeric, 4), nullif(btrim(coalesce(it ->> 'directions', '')), ''));
  end loop;
  if coalesce(p_submit, false) then update public.pharmacy_prescriptions set status = 'awaiting_review', updated_at = now() where id = v_id; end if;
  if p_id is null then return public._idem_store(p_business, p_key, 'pharmacy_rx_create', jsonb_build_object('prescription_id', v_id, 'rx_number', v_number)); end if;
  return jsonb_build_object('prescription_id', v_id);
end $$;

create function public.pharmacy_submit_prescription(p_rx uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare rx public.pharmacy_prescriptions;
begin
  select * into rx from public.pharmacy_prescriptions where id = p_rx for update;
  if not found then raise exception 'prescription not found' using errcode = '22023'; end if;
  perform public._pharmacy_guard(rx.business_id, 'pharmacy-prescriptions', 'pharmacy.rx');
  if rx.status <> 'draft' then raise exception 'only a draft can be submitted for review' using errcode = '22023'; end if;
  update public.pharmacy_prescriptions set status = 'awaiting_review', updated_at = now() where id = p_rx;
end $$;

-- A pharmacist's professional review. The system records the decision; it never decides clinical safety.
create function public.pharmacy_review_prescription(p_rx uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare rx public.pharmacy_prescriptions;
begin
  select * into rx from public.pharmacy_prescriptions where id = p_rx for update;
  if not found then raise exception 'prescription not found' using errcode = '22023'; end if;
  perform public._pharmacy_guard(rx.business_id, 'pharmacy-prescriptions', 'pharmacy.dispense');
  if rx.status <> 'awaiting_review' then raise exception 'only a prescription awaiting review can be reviewed' using errcode = '22023'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'choose approve or reject' using errcode = '22023'; end if;
  if rx.valid_until < current_date then raise exception 'this prescription has expired' using errcode = '22023'; end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why the prescription is rejected' using errcode = '22023'; end if;
  update public.pharmacy_prescriptions set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, review_note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p_rx;
end $$;

create function public.pharmacy_cancel_prescription(p_rx uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare rx public.pharmacy_prescriptions;
begin
  select * into rx from public.pharmacy_prescriptions where id = p_rx for update;
  if not found then raise exception 'prescription not found' using errcode = '22023'; end if;
  perform public._pharmacy_guard(rx.business_id, 'pharmacy-prescriptions', 'pharmacy.rx');
  if rx.status in ('dispensed', 'cancelled', 'rejected') then raise exception 'a % prescription cannot be cancelled', rx.status using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.pharmacy_prescriptions set status = 'cancelled', review_note = btrim(p_reason), updated_at = now() where id = p_rx;
end $$;

-- Items: [{item_id, quantity}] (base units). Posts a normal sale for the quantities (so stock, batches, payments and receipts behave as usual).
create function public.pharmacy_dispense(p_rx uuid, p_location uuid, p_items jsonb, p_payments jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rx public.pharmacy_prescriptions; v_prev jsonb; it jsonb; pi public.pharmacy_prescription_items; v_qty numeric; v_lines jsonb := '[]'::jsonb; v_sale jsonb; v_did uuid := gen_random_uuid(); v_sale_id uuid; v_left numeric;
begin
  select * into rx from public.pharmacy_prescriptions where id = p_rx;
  if not found then raise exception 'prescription not found' using errcode = '22023'; end if;
  perform public._pharmacy_guard(rx.business_id, 'pharmacy-prescriptions', 'pharmacy.dispense');
  v_prev := public._idem_check(rx.business_id, p_key, 'pharmacy_dispense'); if v_prev is not null then return v_prev; end if;
  select * into rx from public.pharmacy_prescriptions where id = p_rx for update;
  if rx.status not in ('approved', 'partially_dispensed') then raise exception 'this prescription is % and cannot be dispensed', replace(rx.status, '_', ' ') using errcode = '22023'; end if;
  if rx.valid_until < current_date then raise exception 'this prescription has expired' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'choose what to dispense' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pi from public.pharmacy_prescription_items where id = (it ->> 'item_id')::uuid and prescription_id = p_rx for update;
    if not found then raise exception 'that item is not on this prescription' using errcode = '22023'; end if;
    v_qty := round((it ->> 'quantity')::numeric, 4);
    v_left := pi.quantity_prescribed - pi.quantity_dispensed;
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if v_qty > v_left then raise exception 'only % remain to be dispensed for this item', v_left using errcode = '22023'; end if;
    v_lines := v_lines || jsonb_build_object('product_id', pi.product_id, 'quantity', v_qty, 'unit_price', null, 'discount_amount', 0);
  end loop;
  perform set_config('app.pharm_dispense', 'on', true);
  v_sale := public.post_sale(rx.business_id, p_location, rx.customer_id, v_lines, coalesce(p_payments, '[]'::jsonb), p_key || ':sale', 'Dispensing ' || rx.rx_number);
  perform set_config('app.pharm_dispense', '', true);
  v_sale_id := (v_sale ->> 'sale_id')::uuid;
  insert into public.pharmacy_dispensings (id, business_id, prescription_id, sale_id, dispensed_by, idempotency_key) values (v_did, rx.business_id, p_rx, v_sale_id, auth.uid(), p_key);
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pi from public.pharmacy_prescription_items where id = (it ->> 'item_id')::uuid;
    insert into public.pharmacy_dispensing_items (business_id, dispensing_id, prescription_item_id, product_id, quantity) values (rx.business_id, v_did, pi.id, pi.product_id, round((it ->> 'quantity')::numeric, 4));
    update public.pharmacy_prescription_items set quantity_dispensed = quantity_dispensed + round((it ->> 'quantity')::numeric, 4) where id = pi.id;
  end loop;
  update public.pharmacy_prescriptions set updated_at = now(), status = case when exists (select 1 from public.pharmacy_prescription_items where prescription_id = p_rx and quantity_dispensed < quantity_prescribed) then 'partially_dispensed' else 'dispensed' end where id = p_rx;
  return public._idem_store(rx.business_id, p_key, 'pharmacy_dispense', jsonb_build_object('dispensing_id', v_did, 'sale_id', v_sale_id));
end $$;

-- ------------------------------------------------------------------ overview
create function public.pharmacy_overview(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_fin boolean; v_rx boolean; ps public.pharmacy_settings; v_crit integer; v_alert integer; v_warn integer; v_expired numeric; v_expired_value numeric; v_quarantined integer; v_undated integer; v_pending integer;
  v_c integer; v_a integer; v_w integer; v_awaiting integer; v_approved integer; v_by_cat jsonb;
begin
  v := public.mart_overview(p_business, p_from, p_to);
  v_fin := public.has_business_permission(p_business, 'reports.finance.read');
  v_rx := public.has_business_permission(p_business, 'pharmacy.rx') and public.module_usable(p_business, 'pharmacy-prescriptions', 'read');
  select * into ps from public.pharmacy_settings where business_id = p_business;
  v_crit := coalesce(ps.expiry_critical_days, 30); v_alert := coalesce(ps.expiry_alert_days, 90); v_warn := coalesce(ps.expiry_warning_days, 180);
  select coalesce(sum(remaining) filter (where status = 'active' and expires_on < current_date), 0), coalesce(sum(value) filter (where status = 'active' and expires_on < current_date), 0),
         count(*) filter (where status = 'quarantined'), count(*) filter (where status = 'active' and expires_on is null),
         count(*) filter (where status = 'active' and expires_on >= current_date and expires_on <= current_date + v_crit),
         count(*) filter (where status = 'active' and expires_on > current_date + v_crit and expires_on <= current_date + v_alert),
         count(*) filter (where status = 'active' and expires_on > current_date + v_alert and expires_on <= current_date + v_warn)
    into v_expired, v_expired_value, v_quarantined, v_undated, v_c, v_a, v_w from public.pharmacy_batches where business_id = p_business;
  select count(*) into v_pending from public.purchases where business_id = p_business and status in ('ordered', 'partially_received');
  if v_rx then
    select count(*) filter (where status = 'awaiting_review' and valid_until >= current_date), count(*) filter (where status in ('approved', 'partially_dispensed') and valid_until >= current_date)
      into v_awaiting, v_approved from public.pharmacy_prescriptions where business_id = p_business;
  end if;
  return v || jsonb_build_object('expired_units', v_expired, 'expired_value', case when v_fin then v_expired_value end, 'quarantined_batches', v_quarantined, 'undated_batches', v_undated,
    'expiring_critical', v_c, 'expiring_alert', v_a, 'expiring_watch', v_w, 'pending_orders', v_pending,
    'rx_awaiting_review', case when v_rx then v_awaiting end, 'rx_ready_to_dispense', case when v_rx then v_approved end);
end $$;

revoke execute on function public._pharmacy_guard(uuid, text, text), public.pharmacy_sale_item_guard() from public;
revoke execute on function
  public.pharmacy_save_settings(uuid, text, text, text, integer, integer, integer),
  public.pharmacy_save_medicine(uuid, uuid, text, text, text, uuid, text, numeric, numeric, numeric, uuid, boolean, jsonb, jsonb, text),
  public.pharmacy_set_batch_status(uuid, text, text, text, date), public.pharmacy_complete_batch(uuid, text, date), public.pharmacy_dispose_batch(uuid, numeric, text, text, text),
  public.pharmacy_receive_goods(uuid, uuid, uuid, uuid, jsonb, text, text),
  public.pharmacy_save_prescription(uuid, uuid, uuid, text, text, text, date, date, integer, text, jsonb, boolean, text),
  public.pharmacy_submit_prescription(uuid), public.pharmacy_review_prescription(uuid, text, text), public.pharmacy_cancel_prescription(uuid, text),
  public.pharmacy_dispense(uuid, uuid, jsonb, jsonb, text), public.pharmacy_overview(uuid, date, date) from public;
grant execute on function
  public.pharmacy_save_settings(uuid, text, text, text, integer, integer, integer),
  public.pharmacy_save_medicine(uuid, uuid, text, text, text, uuid, text, numeric, numeric, numeric, uuid, boolean, jsonb, jsonb, text),
  public.pharmacy_set_batch_status(uuid, text, text, text, date), public.pharmacy_complete_batch(uuid, text, date), public.pharmacy_dispose_batch(uuid, numeric, text, text, text),
  public.pharmacy_receive_goods(uuid, uuid, uuid, uuid, jsonb, text, text),
  public.pharmacy_save_prescription(uuid, uuid, uuid, text, text, text, date, date, integer, text, jsonb, boolean, text),
  public.pharmacy_submit_prescription(uuid), public.pharmacy_review_prescription(uuid, text, text), public.pharmacy_cancel_prescription(uuid, text),
  public.pharmacy_dispense(uuid, uuid, jsonb, jsonb, text), public.pharmacy_overview(uuid, date, date) to authenticated;
