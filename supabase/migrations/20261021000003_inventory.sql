-- Prompt 4: inventory and product management.
-- Design:
--   * stock_movements is an append-only ledger and the source of truth.
--   * inventory_balances is a projection maintained ONLY by the BEFORE INSERT trigger on the ledger,
--     so every posting path updates it in the same statement/transaction; inventory_reconcile() proves it.
--   * Costing: weighted average per (product, location). Outgoing movements snapshot the average.
--   * All stock operations are SECURITY DEFINER functions: permission + module + idempotency checks,
--     then atomic postings. Authenticated users have no INSERT/UPDATE/DELETE on ledger tables.

-- ------------------------------------------------------------ catalogue
create table public.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null check (code = lower(code) and length(code) between 1 and 20),
  name text not null check (length(btrim(name)) > 0),
  dimension text not null check (dimension in ('mass', 'volume', 'count')),
  -- multiples of the dimension's base unit (g, ml, each)
  conversion_factor numeric(18, 6) not null check (conversion_factor > 0),
  created_at timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  parent_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, parent_id) references public.product_categories (business_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  sku text check (sku is null or length(btrim(sku)) > 0),
  barcode text check (barcode is null or length(btrim(barcode)) > 0),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text not null default '',
  category_id uuid,
  product_type text not null default 'goods' check (product_type in ('goods', 'ingredient', 'finished_good', 'consumable')),
  base_unit_id uuid not null,
  selling_price numeric(14, 2) not null default 0 check (selling_price >= 0),
  default_purchase_cost numeric(14, 4) check (default_purchase_cost is null or default_purchase_cost >= 0),
  currency text not null default 'NGN' check (length(currency) = 3),
  reorder_level numeric(18, 4) check (reorder_level is null or reorder_level >= 0),
  tracks_stock boolean not null default true,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, category_id) references public.product_categories (business_id, id),
  foreign key (business_id, base_unit_id) references public.units_of_measure (business_id, id)
);
create unique index products_sku_uq on public.products (business_id, lower(sku)) where sku is not null;
create unique index products_barcode_uq on public.products (business_id, barcode) where barcode is not null;
create index products_name_idx on public.products (business_id, lower(name));
create index products_active_idx on public.products (business_id) where status = 'active';
create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();

create function public.products_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.base_unit_id <> old.base_unit_id and exists (
      select 1 from public.stock_movements where product_id = old.id
    ) then
      raise exception 'base unit cannot change once stock has moved' using errcode = '23514';
    end if;
    new.archived_at := case when new.status = 'archived' then coalesce(old.archived_at, now()) else null end;
  end if;
  return new;
end $$;

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  name text not null check (length(btrim(name)) > 0),
  location_type text not null default 'store' check (location_type in ('store', 'shelf', 'warehouse', 'farm_store', 'kitchen')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, branch_id) references public.branches (business_id, id)
);

-- --------------------------------------------------------------- ledger
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  movement_type text not null check (movement_type in (
    'receipt', 'sale', 'return_in', 'return_out', 'transfer_out', 'transfer_in',
    'adjustment', 'count_adjustment', 'issue', 'production_consumption', 'production_output', 'reversal')),
  quantity_delta numeric(18, 4) not null check (quantity_delta <> 0),
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  currency text not null default 'NGN',
  source_type text not null,
  source_id uuid,
  group_id uuid not null default gen_random_uuid(),
  reason text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  reversal_of_movement_id uuid,
  unique (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id),
  foreign key (business_id, reversal_of_movement_id) references public.stock_movements (business_id, id),
  check (movement_type not in ('receipt', 'return_in', 'transfer_in', 'production_output') or quantity_delta > 0),
  check (movement_type not in ('sale', 'return_out', 'transfer_out', 'issue', 'production_consumption') or quantity_delta < 0),
  check (movement_type not in ('adjustment', 'count_adjustment', 'issue', 'return_in', 'return_out', 'reversal')
         or length(btrim(coalesce(reason, ''))) >= 3),
  check ((movement_type = 'reversal') = (reversal_of_movement_id is not null))
);
create unique index stock_movements_one_reversal_uq on public.stock_movements (reversal_of_movement_id)
  where reversal_of_movement_id is not null;
create index stock_movements_product_idx on public.stock_movements (business_id, product_id, occurred_at desc);
create index stock_movements_location_idx on public.stock_movements (business_id, location_id);
create index stock_movements_group_idx on public.stock_movements (group_id);

create function public.stock_movements_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'posted stock movements are immutable; post a reversal or adjustment' using errcode = '42501';
end $$;
create trigger stock_movements_no_change before update or delete on public.stock_movements
  for each row execute function public.stock_movements_immutable();

create table public.inventory_balances (
  business_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  quantity_on_hand numeric(18, 4) not null default 0,
  avg_unit_cost numeric(14, 4) check (avg_unit_cost is null or avg_unit_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, product_id, location_id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);

-- The ONLY writer of balances. Locks the balance row, enforces stock rules, maintains weighted-average cost.
create function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.products;
  v_bal public.inventory_balances;
  v_allow_negative boolean;
  v_new_qty numeric;
  v_avg numeric;
begin
  select * into v_prod from public.products where id = new.product_id and business_id = new.business_id;
  if not found then raise exception 'product does not belong to this business' using errcode = '23503'; end if;
  if not v_prod.tracks_stock then raise exception 'product does not track stock' using errcode = '23514'; end if;
  if not exists (select 1 from public.inventory_locations where id = new.location_id and business_id = new.business_id) then
    raise exception 'location does not belong to this business' using errcode = '23503';
  end if;

  insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand)
  values (new.business_id, new.product_id, new.location_id, 0)
  on conflict do nothing;
  select * into v_bal from public.inventory_balances
   where business_id = new.business_id and product_id = new.product_id and location_id = new.location_id
   for update;                                   -- serialises concurrent postings on this stock line

  select coalesce((settings ->> 'allow_negative_stock')::boolean, false) into v_allow_negative
    from public.businesses where id = new.business_id;
  v_new_qty := v_bal.quantity_on_hand + new.quantity_delta;
  if v_new_qty < 0 and not v_allow_negative then
    raise exception 'insufficient stock: % on hand, % requested', v_bal.quantity_on_hand, -new.quantity_delta
      using errcode = '23514';
  end if;

  if new.quantity_delta < 0 then
    new.unit_cost := coalesce(v_bal.avg_unit_cost, v_prod.default_purchase_cost, 0);
    v_avg := v_bal.avg_unit_cost;
  else
    new.unit_cost := coalesce(new.unit_cost, v_bal.avg_unit_cost, v_prod.default_purchase_cost, 0);
    if v_bal.quantity_on_hand <= 0 or v_bal.avg_unit_cost is null then
      v_avg := new.unit_cost;
    else
      v_avg := round((v_bal.quantity_on_hand * v_bal.avg_unit_cost + new.quantity_delta * new.unit_cost) / v_new_qty, 4);
    end if;
  end if;

  update public.inventory_balances
     set quantity_on_hand = v_new_qty, avg_unit_cost = v_avg, updated_at = now()
   where business_id = new.business_id and product_id = new.product_id and location_id = new.location_id;
  return new;
end $$;
create trigger stock_movements_apply before insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create trigger products_guard_trg before update on public.products
  for each row execute function public.products_guard();

-- -------------------------------------------------- idempotency & counts
create table public.idempotency_records (
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text not null,
  operation text not null,
  result jsonb not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (business_id, key)
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  location_id uuid not null,
  status text not null default 'open' check (status in ('open', 'posted')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);
create table public.stock_count_items (
  business_id uuid not null,
  stock_count_id uuid not null,
  product_id uuid not null,
  expected_quantity numeric(18, 4) not null,
  counted_quantity numeric(18, 4) check (counted_quantity is null or counted_quantity >= 0),
  primary key (stock_count_id, product_id),
  foreign key (business_id, stock_count_id) references public.stock_counts (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);

-- --------------------------------------------------------------- RLS
alter table public.units_of_measure enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;

-- read: inventory.read, still allowed after a module is turned off or a plan lapses ('read' mode)
-- write: inventory.adjust, requires the module to be enabled and entitled ('use' mode)
do $$
declare t text;
begin
  foreach t in array array['units_of_measure', 'product_categories', 'products', 'inventory_locations',
                           'stock_movements', 'inventory_balances', 'stock_counts', 'stock_count_items'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (public.has_module_permission(business_id, 'inventory', 'inventory.read', 'read'))$f$, t || '_select', t);
  end loop;
  foreach t in array array['units_of_measure', 'product_categories', 'products', 'inventory_locations'] loop
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (public.has_module_permission(business_id, 'inventory', 'inventory.adjust'))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (public.has_module_permission(business_id, 'inventory', 'inventory.adjust'))
      with check (public.has_module_permission(business_id, 'inventory', 'inventory.adjust'))$f$, t || '_update', t);
  end loop;
end $$;

grant select on public.units_of_measure, public.product_categories, public.products, public.inventory_locations,
  public.stock_movements, public.inventory_balances, public.stock_counts, public.stock_count_items to authenticated;
grant insert (business_id, code, name, dimension, conversion_factor) on public.units_of_measure to authenticated;
grant update (name) on public.units_of_measure to authenticated;
grant insert (business_id, name, parent_id) on public.product_categories to authenticated;
grant update (name) on public.product_categories to authenticated;
grant insert (business_id, sku, barcode, name, description, category_id, product_type, base_unit_id,
              selling_price, default_purchase_cost, currency, reorder_level, tracks_stock)
  on public.products to authenticated;
grant update (sku, barcode, name, description, category_id, product_type, selling_price,
              default_purchase_cost, reorder_level, status)
  on public.products to authenticated;
grant insert (business_id, branch_id, name, location_type) on public.inventory_locations to authenticated;
grant update (name, location_type, status) on public.inventory_locations to authenticated;
-- idempotency_records: no grants at all (internal).

-- ---------------------------------------------------- defaults per business
create function public._seed_inventory_defaults(p_business uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.units_of_measure (business_id, code, name, dimension, conversion_factor) values
    (p_business, 'each', 'Each', 'count', 1), (p_business, 'dozen', 'Dozen', 'count', 12),
    (p_business, 'kg', 'Kilogram', 'mass', 1000), (p_business, 'g', 'Gram', 'mass', 1),
    (p_business, 'l', 'Litre', 'volume', 1000), (p_business, 'ml', 'Millilitre', 'volume', 1)
  on conflict do nothing;
  insert into public.inventory_locations (business_id, name, location_type) values (p_business, 'Main store', 'store')
  on conflict do nothing;
$$;

create function public.businesses_seed_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._seed_inventory_defaults(new.id);
  return new;
end $$;
create trigger businesses_seed_inventory_trg after insert on public.businesses
  for each row execute function public.businesses_seed_inventory();
select public._seed_inventory_defaults(id) from public.businesses;

-- ------------------------------------------------------------- helpers
create function public._inv_guard(p_business uuid, p_permission text default 'inventory.adjust') returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, 'inventory', p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- Returns the stored result when the key was already used for the same operation.
create function public._idem_check(p_business uuid, p_key text, p_op text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.idempotency_records;
begin
  if p_key is null or length(btrim(p_key)) < 8 then
    raise exception 'an idempotency key of at least 8 characters is required' using errcode = '22023';
  end if;
  select * into r from public.idempotency_records where business_id = p_business and key = p_key;
  if found then
    if r.operation <> p_op then raise exception 'idempotency key already used for another operation' using errcode = '22023'; end if;
    return r.result;
  end if;
  return null;
end $$;

create function public._idem_store(p_business uuid, p_key text, p_op text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.idempotency_records (business_id, key, operation, result, created_by)
  values (p_business, p_key, p_op, p_result, auth.uid());
  return p_result;
end $$;

create function public._require_location(p_business uuid, p_location uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.inventory_locations where id = p_location and business_id = p_business and status = 'active') then
    raise exception 'unknown or inactive location' using errcode = '22023';
  end if;
end $$;

-- Converts between units of the SAME dimension only.
create function public.convert_quantity(p_business uuid, p_quantity numeric, p_from uuid, p_to uuid) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare f public.units_of_measure; t public.units_of_measure;
begin
  if not public.is_active_member(p_business) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into f from public.units_of_measure where id = p_from and business_id = p_business;
  select * into t from public.units_of_measure where id = p_to and business_id = p_business;
  if f.id is null or t.id is null then raise exception 'unknown unit' using errcode = '22023'; end if;
  if f.dimension <> t.dimension then
    raise exception 'incompatible units: % (%) cannot convert to % (%)', f.code, f.dimension, t.code, t.dimension using errcode = '22023';
  end if;
  return round(p_quantity * f.conversion_factor / t.conversion_factor, 4);
end $$;

-- Validates line items and normalises quantity/cost into each product's base unit.
create function public._inv_items(p_business uuid, p_items jsonb)
returns table (item_product uuid, item_qty numeric, item_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb; v_prod public.products; v_unit public.units_of_measure; v_base public.units_of_measure;
  v_qty numeric; v_cost numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'items must be an array of 1 to 200 lines' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.products where id = (v_item ->> 'product_id')::uuid and business_id = p_business;
    if not found or v_prod.status <> 'active' or not v_prod.tracks_stock then
      raise exception 'invalid product on line: %', coalesce(v_item ->> 'product_id', 'missing') using errcode = '22023';
    end if;
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    v_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
    if v_cost is not null and v_cost < 0 then raise exception 'unit cost cannot be negative' using errcode = '22023'; end if;

    if nullif(v_item ->> 'unit_id', '') is not null then
      select * into v_unit from public.units_of_measure where id = (v_item ->> 'unit_id')::uuid and business_id = p_business;
      select * into v_base from public.units_of_measure where id = v_prod.base_unit_id;
      if v_unit.id is null then raise exception 'unknown unit' using errcode = '22023'; end if;
      if v_unit.dimension <> v_base.dimension then
        raise exception 'incompatible units: % (%) cannot convert to % (%)', v_unit.code, v_unit.dimension, v_base.code, v_base.dimension
          using errcode = '22023';
      end if;
      v_qty := round(v_qty * v_unit.conversion_factor / v_base.conversion_factor, 4);
      if v_qty <= 0 then raise exception 'quantity too small after unit conversion' using errcode = '22023'; end if;
      if v_cost is not null then v_cost := round(v_cost * v_base.conversion_factor / v_unit.conversion_factor, 4); end if;
    end if;
    item_product := v_prod.id; item_qty := v_qty; item_cost := v_cost;
    return next;
  end loop;
end $$;

-- Internal posting primitive (also used by sales/purchasing/production in later stages).
create function public._post_movement(
  p_business uuid, p_product uuid, p_location uuid, p_type text, p_delta numeric, p_unit_cost numeric,
  p_source_type text, p_source_id uuid, p_group uuid, p_reason text, p_occurred_at timestamptz default now(),
  p_reversal_of uuid default null
) returns public.stock_movements
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements;
begin
  insert into public.stock_movements (business_id, product_id, location_id, movement_type, quantity_delta, unit_cost,
    source_type, source_id, group_id, reason, occurred_at, created_by, reversal_of_movement_id)
  values (p_business, p_product, p_location, p_type, p_delta, p_unit_cost, p_source_type, p_source_id, p_group,
    p_reason, coalesce(p_occurred_at, now()), auth.uid(), p_reversal_of)
  returning * into m;
  return m;
end $$;

-- ------------------------------------------------------------ operations
create function public.inventory_receive_stock(
  p_business uuid, p_location uuid, p_items jsonb, p_reference text, p_key text, p_occurred_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); r record; m public.stock_movements; v_ids uuid[] := '{}';
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'receive'); if v_prev is not null then return v_prev; end if;
  perform public._require_location(p_business, p_location);
  for r in select * from public._inv_items(p_business, p_items) loop
    m := public._post_movement(p_business, r.item_product, p_location, 'receipt', r.item_qty, r.item_cost,
                               'receipt', null, v_group, p_reference, p_occurred_at);
    v_ids := v_ids || m.id;
  end loop;
  return public._idem_store(p_business, p_key, 'receive', jsonb_build_object('group_id', v_group, 'movement_ids', to_jsonb(v_ids)));
end $$;

create function public.inventory_adjust_stock(
  p_business uuid, p_location uuid, p_product uuid, p_quantity_delta numeric, p_reason text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); m public.stock_movements;
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'adjust'); if v_prev is not null then return v_prev; end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then raise exception 'adjustment quantity cannot be zero' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'an adjustment reason is required' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  m := public._post_movement(p_business, p_product, p_location, 'adjustment', p_quantity_delta, null,
                             'adjustment', null, v_group, p_reason);
  return public._idem_store(p_business, p_key, 'adjust', jsonb_build_object('group_id', v_group, 'movement_ids', jsonb_build_array(m.id)));
end $$;

create function public.inventory_issue_stock(
  p_business uuid, p_location uuid, p_items jsonb, p_reason text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); r record; m public.stock_movements; v_ids uuid[] := '{}';
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'issue'); if v_prev is not null then return v_prev; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  for r in select * from public._inv_items(p_business, p_items) loop
    m := public._post_movement(p_business, r.item_product, p_location, 'issue', -r.item_qty, null, 'issue', null, v_group, p_reason);
    v_ids := v_ids || m.id;
  end loop;
  return public._idem_store(p_business, p_key, 'issue', jsonb_build_object('group_id', v_group, 'movement_ids', to_jsonb(v_ids)));
end $$;

-- Both legs are posted in the same transaction; the source leg's cost carries to the destination.
create function public.inventory_transfer_stock(
  p_business uuid, p_from uuid, p_to uuid, p_items jsonb, p_key text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); r record; o public.stock_movements; i public.stock_movements; v_ids uuid[] := '{}';
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'transfer'); if v_prev is not null then return v_prev; end if;
  if p_from = p_to then raise exception 'source and destination must differ' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_from);
  perform public._require_location(p_business, p_to);
  for r in select * from public._inv_items(p_business, p_items) loop
    o := public._post_movement(p_business, r.item_product, p_from, 'transfer_out', -r.item_qty, null, 'transfer', null, v_group, p_note);
    i := public._post_movement(p_business, r.item_product, p_to, 'transfer_in', r.item_qty, o.unit_cost, 'transfer', null, v_group, p_note);
    v_ids := v_ids || o.id || i.id;
  end loop;
  return public._idem_store(p_business, p_key, 'transfer', jsonb_build_object('group_id', v_group, 'movement_ids', to_jsonb(v_ids)));
end $$;

-- Customer return (direction 'in') or return to supplier (direction 'out').
create function public.inventory_return_stock(
  p_business uuid, p_location uuid, p_product uuid, p_quantity numeric, p_direction text,
  p_reason text, p_unit_cost numeric, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_group uuid := gen_random_uuid(); m public.stock_movements; r record;
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'return'); if v_prev is not null then return v_prev; end if;
  if p_direction not in ('in', 'out') then raise exception 'direction must be in or out' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a return reason is required' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  select * into r from public._inv_items(p_business, jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_quantity, 'unit_cost', p_unit_cost)));
  m := public._post_movement(p_business, p_product, p_location, 'return_' || p_direction,
         case p_direction when 'in' then r.item_qty else -r.item_qty end,
         case p_direction when 'in' then r.item_cost end, 'return', null, v_group, p_reason);
  return public._idem_store(p_business, p_key, 'return', jsonb_build_object('group_id', v_group, 'movement_ids', jsonb_build_array(m.id)));
end $$;

-- Corrects a posted movement by posting its exact opposite. One reversal per movement; transfers use adjustments.
create function public.inventory_reverse_movement(p_movement uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_orig public.stock_movements; v_prev jsonb; v_group uuid := gen_random_uuid(); m public.stock_movements;
begin
  select * into v_orig from public.stock_movements where id = p_movement;
  if not found then raise exception 'movement not found' using errcode = '22023'; end if;
  perform public._inv_guard(v_orig.business_id);
  v_prev := public._idem_check(v_orig.business_id, p_key, 'reverse'); if v_prev is not null then return v_prev; end if;
  if v_orig.movement_type = 'reversal' then raise exception 'a reversal cannot be reversed' using errcode = '22023'; end if;
  if v_orig.movement_type in ('transfer_in', 'transfer_out') then
    raise exception 'transfers cannot be reversed leg by leg; post a counter-transfer' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where reversal_of_movement_id = p_movement) then
    raise exception 'movement was already reversed' using errcode = '23505';
  end if;
  m := public._post_movement(v_orig.business_id, v_orig.product_id, v_orig.location_id, 'reversal', -v_orig.quantity_delta,
         v_orig.unit_cost, 'reversal', v_orig.id, v_group, p_reason, now(), v_orig.id);
  return public._idem_store(v_orig.business_id, p_key, 'reverse', jsonb_build_object('group_id', v_group, 'movement_ids', jsonb_build_array(m.id)));
end $$;

-- ------------------------------------------------------------ stock counts
create function public.stock_count_start(p_business uuid, p_location uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_count uuid;
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'count_start'); if v_prev is not null then return v_prev; end if;
  perform public._require_location(p_business, p_location);
  insert into public.stock_counts (business_id, location_id, created_by) values (p_business, p_location, auth.uid()) returning id into v_count;
  insert into public.stock_count_items (business_id, stock_count_id, product_id, expected_quantity)
  select p_business, v_count, p.id, coalesce(b.quantity_on_hand, 0)
  from public.products p
  left join public.inventory_balances b on b.product_id = p.id and b.location_id = p_location and b.business_id = p_business
  where p.business_id = p_business and p.status = 'active' and p.tracks_stock;
  return public._idem_store(p_business, p_key, 'count_start', jsonb_build_object('count_id', v_count));
end $$;

create function public.stock_count_record(p_count uuid, p_product uuid, p_counted numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count;
  if not found then raise exception 'count not found' using errcode = '22023'; end if;
  perform public._inv_guard(c.business_id);
  if c.status <> 'open' then raise exception 'count is already posted' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'counted quantity must be zero or more' using errcode = '22023'; end if;
  update public.stock_count_items set counted_quantity = p_counted where stock_count_id = p_count and product_id = p_product;
  if not found then raise exception 'product is not part of this count' using errcode = '22023'; end if;
end $$;

-- Variance is applied against the balance at posting time so the result equals what was counted,
-- even if stock moved after the count started; the original expected quantity is kept for audit.
create function public.stock_count_post(p_count uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts; v_prev jsonb; v_group uuid := gen_random_uuid(); i record; v_cur numeric; m public.stock_movements; v_ids uuid[] := '{}';
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'count not found' using errcode = '22023'; end if;
  perform public._inv_guard(c.business_id);
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

-- ---------------------------------------------------------- reconciliation
-- Rows returned = balances that do not equal the sum of the ledger (should always be empty).
create function public.inventory_reconcile(p_business uuid)
returns table (product_id uuid, location_id uuid, balance numeric, ledger_sum numeric, difference numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(b.product_id, l.product_id), coalesce(b.location_id, l.location_id),
         coalesce(b.quantity_on_hand, 0), coalesce(l.s, 0), coalesce(b.quantity_on_hand, 0) - coalesce(l.s, 0)
  from (select * from public.inventory_balances where business_id = p_business) b
  full join (select product_id, location_id, sum(quantity_delta) s from public.stock_movements
             where business_id = p_business group by product_id, location_id) l
    on l.product_id = b.product_id and l.location_id = b.location_id
  where public.has_module_permission(p_business, 'inventory', 'inventory.read', 'read')
    and coalesce(b.quantity_on_hand, 0) <> coalesce(l.s, 0);
$$;

revoke all on function
  public.products_guard(), public.stock_movements_immutable(), public.apply_stock_movement(),
  public._seed_inventory_defaults(uuid), public.businesses_seed_inventory(),
  public._inv_guard(uuid, text), public._idem_check(uuid, text, text), public._idem_store(uuid, text, text, jsonb),
  public._require_location(uuid, uuid), public.convert_quantity(uuid, numeric, uuid, uuid),
  public._inv_items(uuid, jsonb),
  public._post_movement(uuid, uuid, uuid, text, numeric, numeric, text, uuid, uuid, text, timestamptz, uuid),
  public.inventory_receive_stock(uuid, uuid, jsonb, text, text, timestamptz),
  public.inventory_adjust_stock(uuid, uuid, uuid, numeric, text, text),
  public.inventory_issue_stock(uuid, uuid, jsonb, text, text),
  public.inventory_transfer_stock(uuid, uuid, uuid, jsonb, text, text),
  public.inventory_return_stock(uuid, uuid, uuid, numeric, text, text, numeric, text),
  public.inventory_reverse_movement(uuid, text, text),
  public.stock_count_start(uuid, uuid, text), public.stock_count_record(uuid, uuid, numeric),
  public.stock_count_post(uuid, text), public.inventory_reconcile(uuid)
from public;

grant execute on function
  public.convert_quantity(uuid, numeric, uuid, uuid),
  public.inventory_receive_stock(uuid, uuid, jsonb, text, text, timestamptz),
  public.inventory_adjust_stock(uuid, uuid, uuid, numeric, text, text),
  public.inventory_issue_stock(uuid, uuid, jsonb, text, text),
  public.inventory_transfer_stock(uuid, uuid, uuid, jsonb, text, text),
  public.inventory_return_stock(uuid, uuid, uuid, numeric, text, text, numeric, text),
  public.inventory_reverse_movement(uuid, text, text),
  public.stock_count_start(uuid, uuid, text), public.stock_count_record(uuid, uuid, numeric),
  public.stock_count_post(uuid, text), public.inventory_reconcile(uuid)
to authenticated;
-- Internal helpers (_inv_guard, _post_movement, ...) are deliberately not granted to API roles.

-- Permission codes the caller holds in a business (for UI affordances only; the database still enforces).
create function public.my_permissions(p_business uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.code order by p.code), '{}')
  from public.business_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  join public.permissions p on p.id = rp.permission_id
  where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
$$;
revoke all on function public.my_permissions(uuid) from public;
grant execute on function public.my_permissions(uuid) to authenticated;
