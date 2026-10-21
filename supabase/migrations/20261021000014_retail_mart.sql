-- Mart (retail) management: product profiles with pack conversions, optional expiry and batch lots served first-expiry-first-out,
-- stock counts that a manager must approve, damaged/expired stock loss, supplier returns, cashier shifts with cash control,
-- and the overview used by the dashboard and reports.
--   * Stock is never held in the mart tables. Everything moves through the shared append-only stock ledger, so the weighted-average
--     cost, the no-negative-stock rule and the history stay in one place.
--   * A pack (carton, case, sack) is a business-defined number of the product's base unit. Receiving or selling in packs is converted
--     on the server, so the ledger only ever holds base units.
--   * Lots exist only for products that track expiry; a trigger creates one for every inbound receipt (expiry can be completed
--     afterwards) and allocates outgoing stock to the earliest-expiring lot.
-- Additive, except stock_count_post, which now needs the manager permission (counting stays open to the storekeeper).
-- Rollback: drop the objects created here, restore the earlier stock_count_post and delete the new module rows.

-- ------------------------------------------------------------ permissions and modules
insert into public.permissions (code, description) values ('retail.manage', 'Define products and packs, approve stock counts, void stock losses, review cashier shifts');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'retail.manage'
where r.business_id is null and r.name in ('owner', 'business_admin', 'manager');

insert into public.modules (code, name, description, is_core, required_permission) values
  ('retail-products', 'Products', 'Products with categories, packs, barcodes and expiry tracking.', false, 'inventory.read'),
  ('retail-categories', 'Categories', 'Product categories.', false, 'inventory.read'),
  ('retail-counts', 'Stock Counts', 'Physical counts with manager approval.', false, 'inventory.read'),
  ('retail-losses', 'Damaged & Expired', 'Damaged, expired and missing stock.', false, 'inventory.read'),
  ('retail-returns', 'Supplier Returns', 'Goods sent back to suppliers.', false, 'purchases.read'),
  ('retail-shifts', 'Cashier Shifts', 'Opening cash, cash movements and closing variance.', false, 'sales.create'),
  ('retail-reports', 'Mart Reports', 'Sales, stock and profit reports.', false, 'reports.finance.read');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m
where t.code = 'retail' and m.code like 'retail-%';

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code like 'retail-%';

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'retail' and m.code like 'retail-%'
on conflict (business_id, module_id) do nothing;

create function public._mart_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- ----------------------------------------------------------------- tables
create table public.mart_product_profiles (
  product_id uuid primary key,
  business_id uuid not null,
  brand text check (brand is null or length(btrim(brand)) between 1 and 80),
  wholesale_price numeric(14, 2) check (wholesale_price is null or wholesale_price >= 0),
  preferred_supplier_id uuid,
  track_expiry boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, product_id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade,
  foreign key (business_id, preferred_supplier_id) references public.suppliers (business_id, id)
);

-- A pack is a number of the product's base unit (a carton of 12 packs of 6 pieces is 72 when the base unit is the piece).
create table public.product_packs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  units_per_pack numeric(18, 4) not null check (units_per_pack > 0),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);
create unique index product_packs_name_uq on public.product_packs (product_id, lower(btrim(name)));

create table public.mart_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  batch_number text check (batch_number is null or length(btrim(batch_number)) between 1 and 60),
  expires_on date,
  received_on date not null default current_date,
  quantity numeric(18, 4) not null check (quantity > 0),
  remaining numeric(18, 4) not null check (remaining >= 0),
  source_movement_id uuid not null,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  check (remaining <= quantity),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, source_movement_id) references public.stock_movements (business_id, id)
);
create index mart_lots_fefo_idx on public.mart_lots (business_id, product_id, expires_on nulls last, received_on) where remaining > 0 and not voided;

create table public.mart_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  lot_id uuid not null,
  movement_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  restored boolean not null default false,
  foreign key (business_id, lot_id) references public.mart_lots (business_id, id),
  foreign key (business_id, movement_id) references public.stock_movements (business_id, id)
);
create index mart_alloc_movement_idx on public.mart_lot_allocations (movement_id);

create table public.stock_loss_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  loss_number text not null,
  product_id uuid not null,
  location_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  reason text not null check (reason in ('damaged', 'expired', 'missing', 'other')),
  estimated_loss numeric(14, 2) not null check (estimated_loss >= 0),
  notes text,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  stock_movement_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, loss_number),
  unique (business_id, idempotency_key),
  check (status = 'posted' or void_reason is not null),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);

create table public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  return_number text not null,
  supplier_id uuid not null,
  purchase_id uuid,
  location_id uuid not null,
  reason text not null check (length(btrim(reason)) >= 3),
  total_credit numeric(14, 2) not null check (total_credit >= 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, return_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);
create table public.supplier_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  return_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  stock_movement_id uuid,
  foreign key (business_id, return_id) references public.supplier_returns (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);

create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  shift_number text not null,
  cashier_id uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(14, 2) not null check (opening_cash >= 0),
  closed_at timestamptz,
  counted_cash numeric(14, 2) check (counted_cash is null or counted_cash >= 0),
  expected_cash numeric(14, 2),
  variance numeric(14, 2),
  status text not null default 'open' check (status in ('open', 'closed', 'reviewed')),
  notes text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, shift_number),
  unique (business_id, idempotency_key)
);
create unique index cashier_one_open_shift_uq on public.cashier_shifts (business_id, cashier_id) where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shift_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) >= 3),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, idempotency_key),
  foreign key (business_id, shift_id) references public.cashier_shifts (business_id, id)
);

-- -------------------------------------------------------- lots follow the ledger
create function public.mart_track_lots() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_need numeric; l record; v_take numeric; a record;
begin
  if new.movement_type in ('transfer_in', 'transfer_out', 'production_output') then return new; end if;
  if not exists (select 1 from public.mart_product_profiles where product_id = new.product_id and business_id = new.business_id and track_expiry) then return new; end if;

  if new.reversal_of_movement_id is not null then
    for a in select * from public.mart_lot_allocations where movement_id = new.reversal_of_movement_id and not restored loop
      update public.mart_lots set remaining = remaining + a.quantity where id = a.lot_id and not voided;
      update public.mart_lot_allocations set restored = true where id = a.id;
    end loop;
    -- reversing a receipt takes its lot out of play
    update public.mart_lots set remaining = 0, voided = true where source_movement_id = new.reversal_of_movement_id;
    return new;
  end if;

  if new.movement_type in ('receipt', 'return_in') and new.quantity_delta > 0 then
    -- expiry and batch are added afterwards when they were not known at the dock
    insert into public.mart_lots (business_id, product_id, quantity, remaining, source_movement_id)
    values (new.business_id, new.product_id, new.quantity_delta, new.quantity_delta, new.id);
  elsif new.quantity_delta < 0 then
    v_need := -new.quantity_delta;
    for l in select * from public.mart_lots where business_id = new.business_id and product_id = new.product_id and remaining > 0 and not voided
             order by expires_on nulls last, received_on, created_at for update loop
      exit when v_need <= 0;
      v_take := least(l.remaining, v_need);
      update public.mart_lots set remaining = remaining - v_take where id = l.id;
      insert into public.mart_lot_allocations (business_id, lot_id, movement_id, quantity) values (new.business_id, l.id, new.id, v_take);
      v_need := v_need - v_take;
    end loop;
  end if;
  return new;
end $$;
create trigger stock_movements_mart_lots after insert on public.stock_movements for each row execute function public.mart_track_lots();

-- ------------------------------------------------------------------- helpers
create function public._pack_factor(p_business uuid, p_product uuid, p_pack text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v numeric;
begin
  if p_pack is null or btrim(p_pack) = '' then return 1; end if;
  select units_per_pack into v from public.product_packs where business_id = p_business and product_id = p_product and lower(btrim(name)) = lower(btrim(p_pack));
  if v is null then raise exception 'this product has no pack called "%"', p_pack using errcode = '22023'; end if;
  return v;
end $$;

-- --------------------------------------------------------------------- views
create view public.mart_products with (security_invoker = true) as
select p.id, p.business_id, p.name, p.sku, p.barcode, p.description, p.status, p.selling_price, p.default_purchase_cost as cost_price, p.reorder_level,
  p.category_id, c.name as category_name, u.code as unit_code, p.tracks_stock,
  f.brand, f.wholesale_price, f.preferred_supplier_id, coalesce(f.track_expiry, false) as track_expiry,
  coalesce(s.on_hand, 0) as on_hand, s.avg_cost, round(coalesce(s.on_hand, 0) * coalesce(s.avg_cost, p.default_purchase_cost, 0), 2) as stock_value,
  (p.reorder_level is not null and p.reorder_level > 0 and coalesce(s.on_hand, 0) > 0 and coalesce(s.on_hand, 0) <= p.reorder_level) as low_stock,
  (p.tracks_stock and coalesce(s.on_hand, 0) <= 0) as out_of_stock,
  coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'units', k.units_per_pack) order by k.units_per_pack) from public.product_packs k where k.product_id = p.id), '[]'::jsonb) as packs,
  (select min(l.expires_on) from public.mart_lots l where l.product_id = p.id and l.remaining > 0 and not l.voided) as next_expiry
from public.products p
left join public.product_categories c on c.business_id = p.business_id and c.id = p.category_id
left join public.mart_product_profiles f on f.business_id = p.business_id and f.product_id = p.id
join public.units_of_measure u on u.business_id = p.business_id and u.id = p.base_unit_id
left join lateral (
  select sum(b.quantity_on_hand) as on_hand,
    case when sum(b.quantity_on_hand) > 0 then round(sum(b.quantity_on_hand * coalesce(b.avg_unit_cost, 0)) / sum(b.quantity_on_hand), 4) end as avg_cost
  from public.inventory_balances b where b.product_id = p.id) s on true
where p.product_type = 'goods';

create view public.mart_lot_status with (security_invoker = true) as
select l.id, l.business_id, l.product_id, p.name as product_name, l.batch_number, l.quantity, l.remaining, l.received_on, l.expires_on,
  (l.expires_on - current_date) as days_left,
  case when l.expires_on is null then 'unknown' when l.expires_on < current_date then 'expired' when l.expires_on <= current_date + 7 then 'expiring' else 'ok' end as expiry_status
from public.mart_lots l join public.products p on p.business_id = l.business_id and p.id = l.product_id
where l.remaining > 0 and not l.voided;

-- Shift totals; cash is counted from the cashier's own successful cash payments and refunds inside the shift window.
create view public.shift_summary with (security_invoker = true) as
select s.id, s.business_id, s.shift_number, s.cashier_id, pr.display_name as cashier_name, s.opened_at, s.closed_at, s.opening_cash, s.counted_cash, s.status, s.notes,
  s.reviewed_by, s.reviewed_at, s.review_note,
  c.cash_sales, c.cash_refunds, m.moved_in, m.moved_out, o.other_methods,
  coalesce(s.expected_cash, s.opening_cash + c.cash_sales - c.cash_refunds + m.moved_in - m.moved_out) as expected_cash,
  coalesce(s.variance, null) as variance
from public.cashier_shifts s
left join public.profiles pr on pr.id = s.cashier_id
left join lateral (select
    coalesce(sum(p.amount) filter (where p.payment_type = 'sale_receipt'), 0) as cash_sales,
    coalesce(sum(p.amount) filter (where p.payment_type = 'refund'), 0) as cash_refunds
  from public.payments p where p.business_id = s.business_id and p.created_by = s.cashier_id and p.payment_method = 'cash' and p.status = 'successful'
    and coalesce(p.received_at, p.created_at) >= s.opened_at and coalesce(p.received_at, p.created_at) <= coalesce(s.closed_at, now())) c on true
left join lateral (select
    coalesce(sum(x.amount) filter (where x.direction = 'in'), 0) as moved_in, coalesce(sum(x.amount) filter (where x.direction = 'out'), 0) as moved_out
  from public.cash_movements x where x.shift_id = s.id) m on true
left join lateral (select coalesce(sum(p.amount) filter (where p.payment_type = 'sale_receipt'), 0) - coalesce(sum(p.amount) filter (where p.payment_type = 'refund'), 0) as other_methods
  from public.payments p where p.business_id = s.business_id and p.created_by = s.cashier_id and p.payment_method <> 'cash' and p.status = 'successful'
    and coalesce(p.received_at, p.created_at) >= s.opened_at and coalesce(p.received_at, p.created_at) <= coalesce(s.closed_at, now())) o on true;

-- Supplier credit notes reduce what is still owed on the purchase they were returned against.
create or replace view public.payables with (security_invoker = true) as
select p.id as purchase_id, p.business_id, p.purchase_number, p.supplier_id, sp.name as supplier_name, p.purchased_at,
  p.total_amount, p.amount_paid, greatest(p.total_amount - p.amount_paid - coalesce(cr.credit, 0), 0) as balance_due, (current_date - p.purchased_at::date) as age_days
from public.purchases p join public.suppliers sp on sp.business_id = p.business_id and sp.id = p.supplier_id
left join lateral (select sum(r.total_credit) as credit from public.supplier_returns r where r.purchase_id = p.id) cr on true
where p.status <> 'cancelled' and p.total_amount - p.amount_paid - coalesce(cr.credit, 0) > 0;

-- --------------------------------------------------------------------- RLS
alter table public.mart_product_profiles enable row level security;
alter table public.product_packs enable row level security;
alter table public.mart_lots enable row level security;
alter table public.mart_lot_allocations enable row level security;
alter table public.stock_loss_records enable row level security;
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_items enable row level security;
alter table public.cashier_shifts enable row level security;
alter table public.cash_movements enable row level security;

create policy mart_profiles_select on public.mart_product_profiles for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy product_packs_select on public.product_packs for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy mart_lots_select on public.mart_lots for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy stock_loss_select on public.stock_loss_records for select to authenticated using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'));
create policy supplier_returns_select on public.supplier_returns for select to authenticated using (public.has_module_permission(business_id, 'purchases', 'purchases.read', 'read'));
create policy supplier_return_items_select on public.supplier_return_items for select to authenticated using (public.has_module_permission(business_id, 'purchases', 'purchases.read', 'read'));
-- a cashier sees their own shifts; managers see every shift
create policy cashier_shifts_select on public.cashier_shifts for select to authenticated using (
  public.has_module_permission(business_id, 'sales', 'sales.create', 'read') and (cashier_id = auth.uid() or public.has_business_permission(business_id, 'retail.manage')));
create policy cash_movements_select on public.cash_movements for select to authenticated using (exists (
  select 1 from public.cashier_shifts s where s.id = cash_movements.shift_id and s.business_id = cash_movements.business_id
    and public.has_module_permission(s.business_id, 'sales', 'sales.create', 'read') and (s.cashier_id = auth.uid() or public.has_business_permission(s.business_id, 'retail.manage'))));
grant select on public.mart_product_profiles, public.product_packs, public.mart_lots, public.stock_loss_records, public.supplier_returns, public.supplier_return_items,
  public.cashier_shifts, public.cash_movements, public.mart_products, public.mart_lot_status, public.shift_summary to authenticated;

create trigger audit_stock_loss after insert or update on public.stock_loss_records for each row execute function public.audit_row_change();
create trigger audit_supplier_returns after insert on public.supplier_returns for each row execute function public.audit_row_change();
create trigger audit_cashier_shifts after insert or update on public.cashier_shifts for each row execute function public.audit_row_change();
create trigger audit_mart_profiles after insert or update on public.mart_product_profiles for each row execute function public.audit_row_change();

-- ----------------------------------------------------------------- products
-- Creates or updates a product with its profile and packs. A price or cost change affects future sales only.
-- Packs: [{name, units}] where units is a number of the product's base unit.
create function public.mart_save_product(
  p_business uuid, p_id uuid, p_name text, p_sku text, p_barcode text, p_category uuid, p_brand text, p_unit_code text, p_cost numeric, p_price numeric,
  p_wholesale numeric, p_reorder numeric, p_supplier uuid, p_track_expiry boolean, p_active boolean, p_packs jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := coalesce(p_id, gen_random_uuid()); v_unit uuid; k jsonb; v_names text[] := '{}';
begin
  perform public._mart_guard(p_business, 'retail-products', 'retail.manage');
  if p_id is null then v_prev := public._idem_check(p_business, p_key, 'mart_product_create'); if v_prev is not null then return v_prev; end if; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the product name (at least 2 characters)' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or scale(p_price) > 2 then raise exception 'the selling price must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'the cost price cannot be negative' using errcode = '22023'; end if;
  if p_wholesale is not null and (p_wholesale < 0 or scale(p_wholesale) > 2) then raise exception 'the wholesale price must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if p_reorder is not null and p_reorder < 0 then raise exception 'the reorder level cannot be negative' using errcode = '22023'; end if;
  if p_category is not null and not exists (select 1 from public.product_categories where id = p_category and business_id = p_business) then raise exception 'unknown category' using errcode = '22023'; end if;
  if exists (select 1 from public.products where business_id = p_business and id <> v_id and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'duplicate key: a product with this name already exists' using errcode = '23505';
  end if;
  if p_packs is not null and jsonb_typeof(p_packs) <> 'array' then raise exception 'packs must be a list' using errcode = '22023'; end if;

  begin
    if p_id is null then
      select id into v_unit from public.units_of_measure where business_id = p_business and code = p_unit_code;
      if v_unit is null then raise exception 'unknown unit' using errcode = '22023'; end if;
      insert into public.products (id, business_id, name, sku, barcode, category_id, product_type, base_unit_id, selling_price, default_purchase_cost, reorder_level, tracks_stock)
      values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_sku, '')), ''), nullif(btrim(coalesce(p_barcode, '')), ''), p_category, 'goods', v_unit, p_price, p_cost, p_reorder, true);
    else
      update public.products set name = btrim(p_name), sku = nullif(btrim(coalesce(p_sku, '')), ''), barcode = nullif(btrim(coalesce(p_barcode, '')), ''), category_id = p_category,
        selling_price = p_price, default_purchase_cost = p_cost, reorder_level = p_reorder, status = case when coalesce(p_active, true) then 'active' else 'archived' end
      where id = p_id and business_id = p_business and product_type = 'goods';
      if not found then raise exception 'product not found' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'duplicate key: this SKU or barcode is already used by another product' using errcode = '23505';
  end;

  insert into public.mart_product_profiles (product_id, business_id, brand, wholesale_price, preferred_supplier_id, track_expiry)
  values (v_id, p_business, nullif(btrim(coalesce(p_brand, '')), ''), p_wholesale, p_supplier, coalesce(p_track_expiry, false))
  on conflict (product_id) do update set brand = excluded.brand, wholesale_price = excluded.wholesale_price, preferred_supplier_id = excluded.preferred_supplier_id, track_expiry = excluded.track_expiry;

  for k in select * from jsonb_array_elements(coalesce(p_packs, '[]'::jsonb)) loop
    if length(btrim(coalesce(k ->> 'name', ''))) = 0 then raise exception 'every pack needs a name' using errcode = '22023'; end if;
    if (k ->> 'units') is null or (k ->> 'units')::numeric <= 0 then raise exception 'pack "%" must contain more than zero units', k ->> 'name' using errcode = '22023'; end if;
    if lower(btrim(k ->> 'name')) = any (v_names) then raise exception 'each pack name can be used once' using errcode = '22023'; end if;
    v_names := v_names || lower(btrim(k ->> 'name'));
    insert into public.product_packs (business_id, product_id, name, units_per_pack) values (p_business, v_id, btrim(k ->> 'name'), round((k ->> 'units')::numeric, 4))
    on conflict (product_id, lower(btrim(name))) do update set units_per_pack = excluded.units_per_pack;
  end loop;
  delete from public.product_packs where product_id = v_id and not (lower(btrim(name)) = any (v_names));

  if p_id is null then return public._idem_store(p_business, p_key, 'mart_product_create', jsonb_build_object('product_id', v_id)); end if;
  return jsonb_build_object('product_id', v_id);
end $$;

-- Adds expiry or batch details to a lot that was created without them (for example by a purchase receipt).
create function public.mart_set_lot(p_lot uuid, p_batch text, p_expiry date) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.mart_lots;
begin
  select * into l from public.mart_lots where id = p_lot;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  if not (public.has_module_permission(l.business_id, 'inventory', 'inventory.adjust', 'use')) then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.mart_lots set batch_number = nullif(btrim(coalesce(p_batch, '')), ''), expires_on = p_expiry where id = p_lot;
end $$;

-- ------------------------------------------------------------ receiving and buying in packs
-- Items: [{product_id, quantity, pack, unit_cost, batch, expiry}]; quantity and unit_cost are per pack when a pack is named.
create function public.mart_receive_stock(p_business uuid, p_location uuid, p_items jsonb, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); it jsonb; pr public.products; pf public.mart_product_profiles; m public.stock_movements; v_f numeric; v_qty numeric; v_cost numeric; v_ids uuid[] := '{}';
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'mart_receive'); if v_prev is not null then return v_prev; end if;
  perform public._require_location(p_business, p_location);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'items must be 1 to 200 lines' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and business_id = p_business and status = 'active' and tracks_stock;
    if not found then raise exception 'invalid product' using errcode = '22023'; end if;
    v_f := public._pack_factor(p_business, pr.id, it ->> 'pack');
    v_qty := round((it ->> 'quantity')::numeric * v_f, 4);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    v_cost := case when (it ->> 'unit_cost') is null then null else round((it ->> 'unit_cost')::numeric / v_f, 4) end;
    if v_cost is not null and v_cost < 0 then raise exception 'unit cost cannot be negative' using errcode = '22023'; end if;
    select * into pf from public.mart_product_profiles where product_id = pr.id;
    if pf.track_expiry and (it ->> 'expiry') is null then raise exception 'enter the expiry date for %', pr.name using errcode = '22023'; end if;
    m := public._post_movement(p_business, pr.id, p_location, 'receipt', v_qty, v_cost, 'receipt', null, v_group, p_reference);
    v_ids := v_ids || m.id;
    if pf.track_expiry then
      update public.mart_lots set batch_number = nullif(btrim(coalesce(it ->> 'batch', '')), ''), expires_on = (it ->> 'expiry')::date where source_movement_id = m.id;
    end if;
  end loop;
  return public._idem_store(p_business, p_key, 'mart_receive', jsonb_build_object('group_id', v_group, 'movement_ids', to_jsonb(v_ids)));
end $$;

-- Items: [{product_id, quantity, pack, unit_cost}]; converted to base units, then created as a normal purchase order.
create function public.mart_create_purchase(p_business uuid, p_supplier uuid, p_items jsonb, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; v_f numeric; v_out jsonb := '[]'::jsonb; v_cost numeric;
begin
  perform public._mart_guard(p_business, 'purchases', 'purchases.manage');
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'a purchase needs 1 to 100 lines' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_f := public._pack_factor(p_business, (it ->> 'product_id')::uuid, it ->> 'pack');
    v_cost := case when (it ->> 'unit_cost') is null then null else round((it ->> 'unit_cost')::numeric / v_f, 4) end;
    v_out := v_out || jsonb_build_object('product_id', it ->> 'product_id', 'quantity', round((it ->> 'quantity')::numeric * v_f, 4), 'unit_cost', v_cost);
  end loop;
  return public.create_purchase(p_business, p_supplier, v_out, p_reference, p_key);
end $$;

-- Items: [{product_id, quantity, pack, unit_price, discount_amount}]; a pack line is sold as its number of base units.
create function public.mart_post_sale(p_business uuid, p_location uuid, p_customer uuid, p_items jsonb, p_payments jsonb, p_key text, p_note text default null, p_branch uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; v_f numeric; v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'a sale needs 1 to 100 lines' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_f := public._pack_factor(p_business, (it ->> 'product_id')::uuid, it ->> 'pack');
    v_out := v_out || jsonb_build_object('product_id', it ->> 'product_id', 'quantity', round((it ->> 'quantity')::numeric * v_f, 4),
      'unit_price', case when (it ->> 'unit_price') is null then null else round((it ->> 'unit_price')::numeric / v_f, 4) end, 'discount_amount', coalesce((it ->> 'discount_amount')::numeric, 0));
  end loop;
  return public.post_sale(p_business, p_location, p_customer, v_out, p_payments, p_key, p_note, p_branch);
end $$;

-- ------------------------------------------------------------- stock counts
-- Counting stays open to the storekeeper; posting the variances needs a manager.
create or replace function public.stock_count_post(p_count uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts; v_prev jsonb; v_group uuid := gen_random_uuid(); i record; v_cur numeric; m public.stock_movements; v_ids uuid[] := '{}';
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'count not found' using errcode = '22023'; end if;
  perform public._inv_guard(c.business_id);
  if not public.has_business_permission(c.business_id, 'retail.manage') then raise exception 'a manager must approve a stock count before it is posted' using errcode = '42501'; end if;
  v_prev := public._idem_check(c.business_id, p_key, 'count_post'); if v_prev is not null then return v_prev; end if;
  if c.status <> 'open' then raise exception 'count is already posted' using errcode = '22023'; end if;
  for i in select * from public.stock_count_items where stock_count_id = p_count and counted_quantity is not null loop
    select coalesce(quantity_on_hand, 0) into v_cur from public.inventory_balances
     where business_id = c.business_id and product_id = i.product_id and location_id = c.location_id;
    v_cur := coalesce(v_cur, 0);
    if i.counted_quantity <> v_cur then
      m := public._post_movement(c.business_id, i.product_id, c.location_id, 'count_adjustment', i.counted_quantity - v_cur, null,
             'stock_count', c.id, v_group, 'Stock count ' || left(c.id::text, 8));
      v_ids := v_ids || m.id;
    end if;
  end loop;
  update public.stock_counts set status = 'posted', posted_at = now() where id = p_count;
  return public._idem_store(c.business_id, p_key, 'count_post', jsonb_build_object('group_id', v_group, 'movement_ids', to_jsonb(v_ids)));
end $$;

-- A count limited to one category (or all products when p_category is null).
create function public.mart_start_count(p_business uuid, p_location uuid, p_category uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_count uuid;
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'mart_count_start'); if v_prev is not null then return v_prev; end if;
  perform public._require_location(p_business, p_location);
  if p_category is not null and not exists (select 1 from public.product_categories where id = p_category and business_id = p_business) then raise exception 'unknown category' using errcode = '22023'; end if;
  insert into public.stock_counts (business_id, location_id, created_by) values (p_business, p_location, auth.uid()) returning id into v_count;
  insert into public.stock_count_items (business_id, stock_count_id, product_id, expected_quantity)
  select p_business, v_count, p.id, coalesce(b.quantity_on_hand, 0)
  from public.products p
  left join public.inventory_balances b on b.product_id = p.id and b.location_id = p_location and b.business_id = p_business
  where p.business_id = p_business and p.status = 'active' and p.tracks_stock and (p_category is null or p.category_id = p_category);
  if not exists (select 1 from public.stock_count_items where stock_count_id = v_count) then raise exception 'no products to count in that selection' using errcode = '22023'; end if;
  return public._idem_store(p_business, p_key, 'mart_count_start', jsonb_build_object('count_id', v_count));
end $$;

-- ------------------------------------------------------------- stock loss
create function public.mart_record_loss(p_business uuid, p_product uuid, p_location uuid, p_qty numeric, p_reason text, p_notes text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; m public.stock_movements;
begin
  perform public._mart_guard(p_business, 'retail-losses', 'inventory.adjust');
  v_prev := public._idem_check(p_business, p_key, 'mart_loss'); if v_prev is not null then return v_prev; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
  if p_reason not in ('damaged', 'expired', 'missing', 'other') then raise exception 'choose a reason' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and business_id = p_business and tracks_stock) then raise exception 'invalid product' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  v_number := public._next_number(p_business, 'stock_loss', 'LOS');
  m := public._post_movement(p_business, p_product, p_location, 'adjustment', -p_qty, null, 'stock_loss', v_id, gen_random_uuid(), 'Stock loss (' || p_reason || ')');
  insert into public.stock_loss_records (id, business_id, loss_number, product_id, location_id, quantity, reason, estimated_loss, notes, stock_movement_id, created_by, idempotency_key)
  values (v_id, p_business, v_number, p_product, p_location, p_qty, p_reason, round(p_qty * m.unit_cost, 2), nullif(btrim(coalesce(p_notes, '')), ''), m.id, auth.uid(), p_key);
  return public._idem_store(p_business, p_key, 'mart_loss', jsonb_build_object('loss_id', v_id, 'loss_number', v_number, 'estimated_loss', round(p_qty * m.unit_cost, 2)));
end $$;

create function public.mart_void_loss(p_record uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.stock_loss_records; v_prev jsonb; mv public.stock_movements;
begin
  select * into w from public.stock_loss_records where id = p_record;
  if not found then raise exception 'record not found' using errcode = '22023'; end if;
  perform public._mart_guard(w.business_id, 'retail-losses', 'retail.manage');
  v_prev := public._idem_check(w.business_id, p_key, 'mart_void_loss'); if v_prev is not null then return v_prev; end if;
  if w.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into mv from public.stock_movements where id = w.stock_movement_id;
  perform public._post_movement(w.business_id, w.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'stock_loss_void', w.id, gen_random_uuid(), 'Void ' || w.loss_number, now(), mv.id);
  update public.stock_loss_records set status = 'voided', void_reason = btrim(p_reason) where id = p_record;
  return public._idem_store(w.business_id, p_key, 'mart_void_loss', jsonb_build_object('loss_id', p_record));
end $$;

-- ---------------------------------------------------------- supplier returns
-- Items: [{product_id, quantity, unit_cost}] where unit_cost is the credit per base unit. Stock leaves immediately.
create function public.mart_supplier_return(p_business uuid, p_supplier uuid, p_purchase uuid, p_location uuid, p_items jsonb, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; it jsonb; m public.stock_movements; v_total numeric := 0; v_group uuid := gen_random_uuid(); v_qty numeric; v_cost numeric; pi public.purchase_items;
begin
  perform public._mart_guard(p_business, 'retail-returns', 'purchases.manage');
  v_prev := public._idem_check(p_business, p_key, 'mart_supplier_return'); if v_prev is not null then return v_prev; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and business_id = p_business) then raise exception 'unknown supplier' using errcode = '22023'; end if;
  if p_purchase is not null and not exists (select 1 from public.purchases where id = p_purchase and business_id = p_business and supplier_id = p_supplier) then raise exception 'that purchase order is not from this supplier' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'a return needs 1 to 100 lines' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  v_number := public._next_number(p_business, 'supplier_return', 'SRT');
  insert into public.supplier_returns (id, business_id, return_number, supplier_id, purchase_id, location_id, reason, total_credit, created_by, idempotency_key)
  values (v_id, p_business, v_number, p_supplier, p_purchase, p_location, btrim(p_reason), 0, auth.uid(), p_key);
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.products where id = (it ->> 'product_id')::uuid and business_id = p_business and tracks_stock) then raise exception 'invalid product' using errcode = '22023'; end if;
    v_qty := round((it ->> 'quantity')::numeric, 4);
    v_cost := coalesce((it ->> 'unit_cost')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if v_cost < 0 then raise exception 'unit cost cannot be negative' using errcode = '22023'; end if;
    if p_purchase is not null then
      select * into pi from public.purchase_items where purchase_id = p_purchase and product_id = (it ->> 'product_id')::uuid;
      if not found then raise exception 'that product is not on the purchase order' using errcode = '22023'; end if;
      if v_qty > pi.quantity_received - coalesce((select sum(i2.quantity) from public.supplier_return_items i2 join public.supplier_returns r2 on r2.id = i2.return_id where r2.purchase_id = p_purchase and i2.product_id = pi.product_id and r2.id <> v_id), 0) then
        raise exception 'you can only return what was received on that order' using errcode = '22023';
      end if;
    end if;
    m := public._post_movement(p_business, (it ->> 'product_id')::uuid, p_location, 'return_out', -v_qty, null, 'supplier_return', v_id, v_group, 'Supplier return ' || v_number || ': ' || btrim(p_reason));
    insert into public.supplier_return_items (business_id, return_id, product_id, quantity, unit_cost, stock_movement_id) values (p_business, v_id, (it ->> 'product_id')::uuid, v_qty, v_cost, m.id);
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;
  update public.supplier_returns set total_credit = v_total where id = v_id;
  return public._idem_store(p_business, p_key, 'mart_supplier_return', jsonb_build_object('return_id', v_id, 'return_number', v_number, 'total_credit', v_total));
end $$;

-- ------------------------------------------------------------------- shifts
create function public.mart_open_shift(p_business uuid, p_opening numeric, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text;
begin
  perform public._mart_guard(p_business, 'retail-shifts', 'sales.create');
  v_prev := public._idem_check(p_business, p_key, 'mart_open_shift'); if v_prev is not null then return v_prev; end if;
  if p_opening is null or p_opening < 0 or scale(p_opening) > 2 then raise exception 'opening cash must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if exists (select 1 from public.cashier_shifts where business_id = p_business and cashier_id = auth.uid() and status = 'open') then
    raise exception 'you already have an open shift; close it first' using errcode = '22023';
  end if;
  v_number := public._next_number(p_business, 'shift', 'SHF');
  insert into public.cashier_shifts (id, business_id, shift_number, cashier_id, opening_cash, idempotency_key) values (v_id, p_business, v_number, auth.uid(), p_opening, p_key);
  return public._idem_store(p_business, p_key, 'mart_open_shift', jsonb_build_object('shift_id', v_id, 'shift_number', v_number));
end $$;

create function public.mart_cash_movement(p_shift uuid, p_direction text, p_amount numeric, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; v_prev jsonb;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(s.business_id, 'retail-shifts', 'sales.create');
  if s.cashier_id <> auth.uid() and not public.has_business_permission(s.business_id, 'retail.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  v_prev := public._idem_check(s.business_id, p_key, 'mart_cash_movement'); if v_prev is not null then return v_prev; end if;
  select * into s from public.cashier_shifts where id = p_shift for update;
  if s.status <> 'open' then raise exception 'the shift is closed' using errcode = '22023'; end if;
  if p_direction not in ('in', 'out') then raise exception 'choose cash in or cash out' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then raise exception 'amount must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  insert into public.cash_movements (business_id, shift_id, direction, amount, reason, created_by, idempotency_key) values (s.business_id, p_shift, p_direction, p_amount, btrim(p_reason), auth.uid(), p_key);
  return public._idem_store(s.business_id, p_key, 'mart_cash_movement', jsonb_build_object('shift_id', p_shift));
end $$;

-- Expected cash = opening cash + cash sales - cash refunds + cash put in - cash taken out. Other payment methods never count.
create function public.mart_close_shift(p_shift uuid, p_counted numeric, p_notes text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; v_prev jsonb; v_expected numeric; v_now timestamptz := now();
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(s.business_id, 'retail-shifts', 'sales.create');
  if s.cashier_id <> auth.uid() and not public.has_business_permission(s.business_id, 'retail.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  v_prev := public._idem_check(s.business_id, p_key, 'mart_close_shift'); if v_prev is not null then return v_prev; end if;
  select * into s from public.cashier_shifts where id = p_shift for update;
  if s.status <> 'open' then raise exception 'the shift is already closed' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 or scale(p_counted) > 2 then raise exception 'enter the cash you counted (zero or more, at most 2 decimals)' using errcode = '22023'; end if;
  update public.cashier_shifts set closed_at = v_now where id = p_shift;
  select expected_cash into v_expected from public.shift_summary where id = p_shift;
  update public.cashier_shifts set status = 'closed', counted_cash = p_counted, expected_cash = v_expected, variance = p_counted - v_expected, notes = nullif(btrim(coalesce(p_notes, '')), '') where id = p_shift;
  return public._idem_store(s.business_id, p_key, 'mart_close_shift', jsonb_build_object('shift_id', p_shift, 'expected_cash', v_expected, 'variance', p_counted - v_expected));
end $$;

create function public.mart_review_shift(p_shift uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(s.business_id, 'retail-shifts', 'retail.manage');
  if s.status <> 'closed' then raise exception 'only a closed shift can be reviewed' using errcode = '22023'; end if;
  if s.variance <> 0 and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'explain the cash variance in the review note' using errcode = '22023'; end if;
  update public.cashier_shifts set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_shift;
end $$;

-- ----------------------------------------------------------------- overview
-- Same definitions as the bakery overview: net sales = sales less discounts, tax and refunds; cost of goods sold = units sold at the
-- cost they left stock at, less restocked returns; operating profit = gross profit less recorded expenses (stock purchases are not
-- expenses). Operational figures go to anyone who can see the dashboard; money figures only to those who may read financial reports.
create function public.mart_overview(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz; v_fin boolean;
  v_sales numeric; v_count integer; v_units numeric; v_cogs numeric; v_exp numeric; v_disc numeric; v_ret numeric;
  v_low integer; v_out integer; v_value numeric; v_slow jsonb; v_expiring integer; v_expired integer; v_pending integer;
  v_daily jsonb; v_best jsonb; v_cat jsonb; v_methods jsonb; v_recent jsonb; v_moves jsonb; v_cashier jsonb; v_var numeric; v_payables numeric; v_receivables numeric; v_out_json jsonb;
begin
  perform public._mart_guard(p_business, 'dashboard', 'dashboard.read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'choose a valid period of up to a year' using errcode = '22023'; end if;
  v_fin := public.has_business_permission(p_business, 'reports.finance.read');

  select coalesce(sum(grand_total - tax_total - returned_total), 0), count(*), coalesce(sum(discount_total), 0), coalesce(sum(returned_total), 0) into v_sales, v_count, v_disc, v_ret
    from public.sales where business_id = p_business and status <> 'voided' and sold_at >= v_from and sold_at < v_to;
  select coalesce(sum(si.quantity), 0) into v_units from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to;
  select coalesce(sum((si.quantity - coalesce(rt.restocked, 0)) * coalesce(si.unit_cost_snapshot, 0)), 0) into v_cogs
    from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
    left join lateral (select sum(ri.quantity) as restocked from public.sale_return_items ri where ri.sale_item_id = si.id and ri.disposition = 'restock') rt on true
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to;
  select coalesce(sum(amount), 0) into v_exp from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to;
  select count(*) filter (where low_stock and status = 'active'), count(*) filter (where out_of_stock and status = 'active'), coalesce(sum(stock_value) filter (where status = 'active'), 0)
    into v_low, v_out, v_value from public.mart_products where business_id = p_business;
  select count(*) filter (where expiry_status = 'expiring'), count(*) filter (where expiry_status = 'expired') into v_expiring, v_expired from public.mart_lot_status where business_id = p_business;
  select coalesce(sum(balance_due), 0) into v_payables from public.payables where business_id = p_business;
  select coalesce(sum(balance_due), 0) into v_receivables from public.receivables where business_id = p_business;
  select coalesce(sum(variance), 0) into v_var from public.cashier_shifts where business_id = p_business and status in ('closed', 'reviewed') and closed_at >= v_from and closed_at < v_to;
  select count(*) into v_pending from public.cashier_shifts where business_id = p_business and status = 'open';

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'net_sales', d.net, 'sales', d.n) order by d.day), '[]') into v_daily from (
    select sold_at::date as day, sum(grand_total - tax_total - returned_total) as net, count(*) as n from public.sales
    where business_id = p_business and status <> 'voided' and sold_at >= v_from and sold_at < v_to group by 1) d;
  select coalesce(jsonb_agg(jsonb_build_object('product', t.name, 'units', t.units, 'revenue', t.revenue) order by t.units desc), '[]') into v_best from (
    select p.name, sum(si.quantity) as units, sum(si.line_total - si.tax_amount) as revenue from public.sale_items si
    join public.sales s on s.business_id = si.business_id and s.id = si.sale_id join public.products p on p.business_id = si.business_id and p.id = si.product_id
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to group by p.name order by sum(si.quantity) desc limit 8) t;
  select coalesce(jsonb_agg(jsonb_build_object('category', t.cat, 'units', t.units, 'revenue', t.revenue) order by t.revenue desc), '[]') into v_cat from (
    select coalesce(c.name, 'Uncategorised') as cat, sum(si.quantity) as units, sum(si.line_total - si.tax_amount) as revenue from public.sale_items si
    join public.sales s on s.business_id = si.business_id and s.id = si.sale_id join public.products p on p.business_id = si.business_id and p.id = si.product_id
    left join public.product_categories c on c.business_id = p.business_id and c.id = p.category_id
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to group by 1) t;
  select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount)), '[]') into v_methods from (
    select payment_method as method, sum(amount) as amount from public.payments where business_id = p_business and status = 'successful' and payment_type = 'sale_receipt'
      and coalesce(received_at, created_at) >= v_from and coalesce(received_at, created_at) < v_to group by payment_method) x;
  select coalesce(jsonb_agg(jsonb_build_object('cashier', t.name, 'sales', t.n, 'net_sales', t.net) order by t.net desc), '[]') into v_cashier from (
    select coalesce(pr.display_name, 'Unknown') as name, count(*) as n, sum(s.grand_total - s.tax_total - s.returned_total) as net from public.sales s
    left join public.profiles pr on pr.id = s.created_by
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to group by 1) t;
  select coalesce(jsonb_agg(jsonb_build_object('number', r.sale_number, 'at', r.sold_at, 'total', r.grand_total, 'status', r.status) order by r.sold_at desc), '[]') into v_recent from (
    select sale_number, sold_at, grand_total, status from public.sales where business_id = p_business order by sold_at desc limit 8) r;
  select coalesce(jsonb_agg(jsonb_build_object('product', t.name, 'type', t.movement_type, 'quantity', t.quantity_delta, 'at', t.occurred_at) order by t.occurred_at desc), '[]') into v_moves from (
    select p.name, m.movement_type, m.quantity_delta, m.occurred_at from public.stock_movements m join public.products p on p.business_id = m.business_id and p.id = m.product_id
    where m.business_id = p_business order by m.occurred_at desc limit 8) t;
  select coalesce(jsonb_agg(jsonb_build_object('product', t.name, 'on_hand', t.on_hand, 'value', t.stock_value) order by t.stock_value desc), '[]') into v_slow from (
    select mp.name, mp.on_hand, mp.stock_value from public.mart_products mp
    where mp.business_id = p_business and mp.status = 'active' and mp.on_hand > 0
      and not exists (select 1 from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
                      where si.product_id = mp.id and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to)
    order by mp.stock_value desc limit 8) t;

  v_out_json := jsonb_build_object(
    'transactions', v_count, 'units_sold', v_units, 'avg_transaction', case when v_count > 0 then round(v_sales / v_count, 2) end,
    'low_stock', v_low, 'out_of_stock', v_out, 'expiring_lots', v_expiring, 'expired_lots', v_expired, 'open_shifts', v_pending,
    'daily', v_daily, 'best_sellers', v_best, 'recent_sales', v_recent, 'recent_movements', v_moves, 'slow_movers', v_slow, 'financial', null);
  if v_fin then
    v_out_json := v_out_json || jsonb_build_object('financial', jsonb_build_object(
      'net_sales', v_sales, 'discounts', v_disc, 'refunds', v_ret, 'cogs', v_cogs, 'gross_profit', v_sales - v_cogs,
      'gross_margin_percent', case when v_sales > 0 then round((v_sales - v_cogs) * 100 / v_sales, 1) end,
      'operating_expenses', v_exp, 'operating_profit_estimate', v_sales - v_cogs - v_exp, 'inventory_value', v_value,
      'supplier_balances', v_payables, 'customer_balances', v_receivables, 'shift_variance', v_var,
      'by_category', v_cat, 'by_cashier', v_cashier, 'payment_methods', v_methods));
  end if;
  return v_out_json;
end $$;

revoke all on function public._mart_guard(uuid, text, text), public.mart_track_lots(), public._pack_factor(uuid, uuid, text),
  public.mart_save_product(uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, uuid, boolean, boolean, jsonb, text),
  public.mart_set_lot(uuid, text, date), public.mart_receive_stock(uuid, uuid, jsonb, text, text), public.mart_create_purchase(uuid, uuid, jsonb, text, text),
  public.mart_post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid), public.mart_start_count(uuid, uuid, uuid, text),
  public.mart_record_loss(uuid, uuid, uuid, numeric, text, text, text), public.mart_void_loss(uuid, text, text),
  public.mart_supplier_return(uuid, uuid, uuid, uuid, jsonb, text, text), public.mart_open_shift(uuid, numeric, text),
  public.mart_cash_movement(uuid, text, numeric, text, text), public.mart_close_shift(uuid, numeric, text, text), public.mart_review_shift(uuid, text),
  public.mart_overview(uuid, date, date) from public;
grant execute on function
  public.mart_save_product(uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, uuid, boolean, boolean, jsonb, text),
  public.mart_set_lot(uuid, text, date), public.mart_receive_stock(uuid, uuid, jsonb, text, text), public.mart_create_purchase(uuid, uuid, jsonb, text, text),
  public.mart_post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid), public.mart_start_count(uuid, uuid, uuid, text),
  public.mart_record_loss(uuid, uuid, uuid, numeric, text, text, text), public.mart_void_loss(uuid, text, text),
  public.mart_supplier_return(uuid, uuid, uuid, uuid, jsonb, text, text), public.mart_open_shift(uuid, numeric, text),
  public.mart_cash_movement(uuid, text, numeric, text, text), public.mart_close_shift(uuid, numeric, text, text), public.mart_review_shift(uuid, text),
  public.mart_overview(uuid, date, date) to authenticated;
