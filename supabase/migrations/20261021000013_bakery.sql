-- Bakery industry: products with shelf life, ingredients, versioned recipes with costing, production batches that consume
-- ingredients and add finished goods in one transaction, expiry lots (first-expiry-first-out), waste, and the overview.
--   * Stock is never held in the bakery tables. Ingredients and finished goods are rows in the SHARED products table and move
--     through the shared append-only stock ledger (production_consumption, production_output, adjustment, reversal), so the
--     weighted-average cost, the no-negative-stock rule and the history all come from one place.
--   * A recipe version is immutable; editing a recipe adds a new version. A production batch keeps the version it used and
--     the cost of every ingredient at the moment it was made.
--   * Completing a batch is atomic and idempotent. A completed batch is corrected by a reversal with a reason, never edited.
--   * Finished-goods lots are allocated first-expiry-first-out by a trigger on the stock ledger, so every sale, waste entry or
--     adjustment is matched to a lot, and a reversal gives the quantity back to the same lot.
-- Additive only. Rollback: drop the objects created here and delete the new module rows.

-- ------------------------------------------------------------ permissions and modules
insert into public.permissions (code, description) values ('bakery.manage', 'Define products, recipes and ingredients; reverse production and waste');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'bakery.manage'
where r.business_id is null and r.name in ('owner', 'business_admin', 'manager');

insert into public.modules (code, name, description, is_core, required_permission) values
  ('bakery-waste', 'Waste', 'Waste, spoilage and expiry write-offs.', false, 'bakery.record'),
  ('bakery-reports', 'Bakery Reports', 'Production, yield, waste and profit reports.', false, 'reports.finance.read');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m
where t.code = 'bakery' and m.code in ('bakery-waste', 'bakery-reports');

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code in ('bakery-waste', 'bakery-reports');

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'bakery' and m.code in ('bakery-waste', 'bakery-reports')
on conflict (business_id, module_id) do nothing;

create function public._bakery_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- ----------------------------------------------------------------- tables
create table public.bakery_product_profiles (
  product_id uuid primary key,
  business_id uuid not null,
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days between 1 and 365),
  min_stock numeric(18, 4) check (min_stock is null or min_stock >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, product_id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version integer not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, product_id) references public.bakery_product_profiles (business_id, product_id)
);
create unique index recipes_name_uq on public.recipes (business_id, lower(btrim(name)));

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  recipe_id uuid not null,
  version integer not null check (version >= 1),
  output_quantity numeric(18, 4) not null check (output_quantity > 0),
  instructions text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (recipe_id, version),
  foreign key (business_id, recipe_id) references public.recipes (business_id, id)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  recipe_version_id uuid not null,
  ingredient_product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_id uuid not null,
  unique (recipe_version_id, ingredient_product_id),
  foreign key (business_id, recipe_version_id) references public.recipe_versions (business_id, id),
  foreign key (business_id, ingredient_product_id) references public.products (business_id, id),
  foreign key (business_id, unit_id) references public.units_of_measure (business_id, id)
);

create function public.bakery_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'recipe versions are immutable; save the recipe to create a new version' using errcode = '42501';
end $$;
create trigger recipe_versions_no_change before update or delete on public.recipe_versions for each row execute function public.bakery_immutable();
create trigger recipe_ingredients_no_change before update or delete on public.recipe_ingredients for each row execute function public.bakery_immutable();

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  batch_number text not null,
  recipe_id uuid not null,
  recipe_version_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  production_date date not null,
  planned_output numeric(18, 4) not null check (planned_output > 0),
  actual_output numeric(18, 4) check (actual_output is null or actual_output >= 0),
  failed_output numeric(18, 4) not null default 0 check (failed_output >= 0),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled', 'reversed')),
  assigned_to uuid references public.profiles (id),
  notes text,
  ingredient_cost numeric(14, 2),
  unit_cost numeric(14, 4),
  void_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, batch_number),
  unique (business_id, idempotency_key),
  check (status not in ('cancelled', 'reversed') or void_reason is not null),
  foreign key (business_id, recipe_id) references public.recipes (business_id, id),
  foreign key (business_id, recipe_version_id) references public.recipe_versions (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);
create index production_batches_date_idx on public.production_batches (business_id, production_date desc);

create table public.production_ingredient_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  batch_id uuid not null,
  ingredient_product_id uuid not null,
  planned_quantity numeric(18, 4) not null check (planned_quantity > 0),
  actual_quantity numeric(18, 4) check (actual_quantity is null or actual_quantity >= 0),
  unit_cost numeric(14, 4),
  line_cost numeric(14, 2),
  stock_movement_id uuid,
  unique (batch_id, ingredient_product_id),
  foreign key (business_id, batch_id) references public.production_batches (business_id, id),
  foreign key (business_id, ingredient_product_id) references public.products (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);

create table public.bakery_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  production_batch_id uuid not null unique,
  quantity numeric(18, 4) not null check (quantity > 0),
  remaining numeric(18, 4) not null check (remaining >= 0),
  produced_on date not null,
  expires_on date,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  check (remaining <= quantity),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, production_batch_id) references public.production_batches (business_id, id)
);
create index bakery_lots_fefo_idx on public.bakery_lots (business_id, product_id, expires_on nulls last, produced_on) where remaining > 0 and not voided;

create table public.bakery_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  lot_id uuid not null,
  movement_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  restored boolean not null default false,
  foreign key (business_id, lot_id) references public.bakery_lots (business_id, id),
  foreign key (business_id, movement_id) references public.stock_movements (business_id, id)
);
create index bakery_alloc_movement_idx on public.bakery_lot_allocations (movement_id);

create table public.waste_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  waste_number text not null,
  product_id uuid not null,
  location_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  reason text not null check (reason in ('expired', 'damaged', 'burnt', 'failed_batch', 'unsold', 'other')),
  production_batch_id uuid,
  estimated_loss numeric(14, 2) not null check (estimated_loss >= 0),
  notes text,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  stock_movement_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, waste_number),
  unique (business_id, idempotency_key),
  check (status = 'posted' or void_reason is not null),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id),
  foreign key (business_id, production_batch_id) references public.production_batches (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);

-- ------------------------------------------------------------ lots follow the ledger (first expiry first out)
create function public.bakery_allocate_lots() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_need numeric; l record; v_take numeric; a record;
begin
  if new.movement_type in ('production_output', 'transfer_in', 'transfer_out') then return new; end if;
  if not exists (select 1 from public.bakery_product_profiles where product_id = new.product_id and business_id = new.business_id) then return new; end if;

  if new.reversal_of_movement_id is not null then
    -- a reversal hands the quantity back to the lots the original movement took it from
    for a in select * from public.bakery_lot_allocations where movement_id = new.reversal_of_movement_id and not restored loop
      update public.bakery_lots set remaining = remaining + a.quantity where id = a.lot_id and not voided;
      update public.bakery_lot_allocations set restored = true where id = a.id;
    end loop;
    return new;
  end if;

  if new.quantity_delta < 0 then
    v_need := -new.quantity_delta;
    for l in select * from public.bakery_lots where business_id = new.business_id and product_id = new.product_id and remaining > 0 and not voided
             order by expires_on nulls last, produced_on, created_at for update loop
      exit when v_need <= 0;
      v_take := least(l.remaining, v_need);
      update public.bakery_lots set remaining = remaining - v_take where id = l.id;
      insert into public.bakery_lot_allocations (business_id, lot_id, movement_id, quantity) values (new.business_id, l.id, new.id, v_take);
      v_need := v_need - v_take;
    end loop;
    -- stock with no lot (opening balances, returns) is simply not allocated
  end if;
  return new;
end $$;
create trigger stock_movements_lots after insert on public.stock_movements for each row execute function public.bakery_allocate_lots();

-- --------------------------------------------------------------------- views
create view public.bakery_ingredient_stock with (security_invoker = true) as
select p.id, p.business_id, p.name, p.sku, u.code as unit_code, p.reorder_level, p.default_purchase_cost, p.status,
  coalesce(s.on_hand, 0) as on_hand, s.avg_cost,
  (p.reorder_level is not null and p.reorder_level > 0 and coalesce(s.on_hand, 0) <= p.reorder_level) as low_stock
from public.products p
join public.units_of_measure u on u.business_id = p.business_id and u.id = p.base_unit_id
left join lateral (
  select sum(b.quantity_on_hand) as on_hand,
    case when sum(b.quantity_on_hand) > 0 then round(sum(b.quantity_on_hand * coalesce(b.avg_unit_cost, 0)) / sum(b.quantity_on_hand), 4) end as avg_cost
  from public.inventory_balances b where b.product_id = p.id) s on true
where p.product_type = 'ingredient';

create view public.bakery_finished_goods with (security_invoker = true) as
select p.id, p.business_id, p.name, p.sku, p.barcode, p.description, p.selling_price, p.status, u.code as unit_code,
  f.shelf_life_days, f.min_stock, coalesce(s.on_hand, 0) as on_hand, s.avg_cost,
  (f.min_stock is not null and f.min_stock > 0 and coalesce(s.on_hand, 0) <= f.min_stock) as low_stock,
  (select min(l.expires_on) from public.bakery_lots l where l.product_id = p.id and l.remaining > 0 and not l.voided) as next_expiry
from public.bakery_product_profiles f
join public.products p on p.business_id = f.business_id and p.id = f.product_id
join public.units_of_measure u on u.business_id = p.business_id and u.id = p.base_unit_id
left join lateral (
  select sum(b.quantity_on_hand) as on_hand,
    case when sum(b.quantity_on_hand) > 0 then round(sum(b.quantity_on_hand * coalesce(b.avg_unit_cost, 0)) / sum(b.quantity_on_hand), 4) end as avg_cost
  from public.inventory_balances b where b.product_id = p.id) s on true;

create view public.bakery_lot_status with (security_invoker = true) as
select l.id, l.business_id, l.product_id, p.name as product_name, pb.batch_number, l.quantity, l.remaining, l.produced_on, l.expires_on,
  (l.expires_on - current_date) as days_left,
  case when l.expires_on is null then 'ok' when l.expires_on < current_date then 'expired' when l.expires_on <= current_date + 2 then 'expiring' else 'ok' end as expiry_status
from public.bakery_lots l
join public.products p on p.business_id = l.business_id and p.id = l.product_id
join public.production_batches pb on pb.business_id = l.business_id and pb.id = l.production_batch_id
where l.remaining > 0 and not l.voided;

-- Weighted-average cost of an ingredient across its stock, falling back to its usual purchase cost.
create function public.bakery_ingredient_cost(p_product uuid) returns numeric
language sql stable as $$
  select coalesce(
    (select case when sum(quantity_on_hand) > 0 then sum(quantity_on_hand * coalesce(avg_unit_cost, 0)) / sum(quantity_on_hand) end from public.inventory_balances where product_id = p_product),
    (select default_purchase_cost from public.products where id = p_product), 0);
$$;

-- Quantity of a recipe line in the ingredient's own (base) unit.
create function public.bakery_line_base_qty(p_line uuid) returns numeric
language sql stable as $$
  select round(ri.quantity * uf.conversion_factor / ub.conversion_factor, 4)
  from public.recipe_ingredients ri
  join public.products p on p.business_id = ri.business_id and p.id = ri.ingredient_product_id
  join public.units_of_measure uf on uf.business_id = ri.business_id and uf.id = ri.unit_id
  join public.units_of_measure ub on ub.business_id = p.business_id and ub.id = p.base_unit_id
  where ri.id = p_line;
$$;

-- Estimated cost of one batch of a recipe version, at today's ingredient costs.
create function public.bakery_version_cost(p_version uuid) returns numeric
language sql stable as $$
  select round(coalesce(sum(public.bakery_line_base_qty(ri.id) * public.bakery_ingredient_cost(ri.ingredient_product_id)), 0), 2)
  from public.recipe_ingredients ri where ri.recipe_version_id = p_version;
$$;

create view public.recipe_overview with (security_invoker = true) as
select r.id, r.business_id, r.product_id, p.name as product_name, r.name, r.status, r.current_version, v.id as version_id, v.output_quantity, v.instructions,
  public.bakery_version_cost(v.id) as batch_cost,
  case when v.output_quantity > 0 then round(public.bakery_version_cost(v.id) / v.output_quantity, 4) end as unit_cost
from public.recipes r
join public.recipe_versions v on v.recipe_id = r.id and v.version = r.current_version
join public.products p on p.business_id = r.business_id and p.id = r.product_id;

-- --------------------------------------------------------------------- RLS
alter table public.bakery_product_profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_ingredient_usage enable row level security;
alter table public.bakery_lots enable row level security;
alter table public.bakery_lot_allocations enable row level security;
alter table public.waste_records enable row level security;

create policy bakery_profiles_select on public.bakery_product_profiles for select to authenticated using (public.has_module_permission(business_id, 'bakery-finished-goods', 'inventory.read', 'read'));
create policy recipes_select on public.recipes for select to authenticated using (public.has_module_permission(business_id, 'bakery-recipes', 'bakery.read', 'read'));
create policy recipe_versions_select on public.recipe_versions for select to authenticated using (public.has_module_permission(business_id, 'bakery-recipes', 'bakery.read', 'read'));
create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated using (public.has_module_permission(business_id, 'bakery-recipes', 'bakery.read', 'read'));
create policy production_batches_select on public.production_batches for select to authenticated using (public.has_module_permission(business_id, 'bakery-production', 'bakery.record', 'read'));
create policy production_usage_select on public.production_ingredient_usage for select to authenticated using (public.has_module_permission(business_id, 'bakery-production', 'bakery.record', 'read'));
create policy bakery_lots_select on public.bakery_lots for select to authenticated using (public.has_module_permission(business_id, 'bakery-finished-goods', 'inventory.read', 'read'));
create policy waste_records_select on public.waste_records for select to authenticated using (public.has_module_permission(business_id, 'bakery-waste', 'bakery.record', 'read'));
grant select on public.bakery_product_profiles, public.recipes, public.recipe_versions, public.recipe_ingredients, public.production_batches,
  public.production_ingredient_usage, public.bakery_lots, public.waste_records, public.bakery_ingredient_stock, public.bakery_finished_goods,
  public.bakery_lot_status, public.recipe_overview to authenticated;

create trigger audit_production_batches after insert or update on public.production_batches for each row execute function public.audit_row_change();
create trigger audit_recipes after insert or update on public.recipes for each row execute function public.audit_row_change();
create trigger audit_waste_records after insert or update on public.waste_records for each row execute function public.audit_row_change();
create trigger audit_bakery_profiles after insert or update on public.bakery_product_profiles for each row execute function public.audit_row_change();

-- --------------------------------------------------------- products and ingredients
create function public.bakery_save_product(
  p_business uuid, p_id uuid, p_name text, p_sku text, p_unit_code text, p_price numeric, p_shelf_life integer, p_min_stock numeric,
  p_description text, p_active boolean, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_unit uuid;
begin
  perform public._bakery_guard(p_business, 'bakery-finished-goods', 'bakery.manage');
  if p_id is null then v_prev := public._idem_check(p_business, p_key, 'bakery_product_create'); if v_prev is not null then return v_prev; end if; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the product name (at least 2 characters)' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or scale(p_price) > 2 then raise exception 'price must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if p_shelf_life is not null and p_shelf_life not between 1 and 365 then raise exception 'shelf life must be between 1 and 365 days' using errcode = '22023'; end if;
  if p_min_stock is not null and p_min_stock < 0 then raise exception 'minimum stock cannot be negative' using errcode = '22023'; end if;
  if exists (select 1 from public.products where business_id = p_business and id is distinct from p_id and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'duplicate key: a product with this name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    select id into v_unit from public.units_of_measure where business_id = p_business and code = p_unit_code;
    if v_unit is null then raise exception 'unknown unit' using errcode = '22023'; end if;
    insert into public.products (id, business_id, name, sku, description, product_type, base_unit_id, selling_price, tracks_stock)
    values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_sku, '')), ''), coalesce(btrim(p_description), ''), 'finished_good', v_unit, p_price, true);
    insert into public.bakery_product_profiles (product_id, business_id, shelf_life_days, min_stock) values (v_id, p_business, p_shelf_life, p_min_stock);
    return public._idem_store(p_business, p_key, 'bakery_product_create', jsonb_build_object('product_id', v_id));
  end if;
  if not exists (select 1 from public.bakery_product_profiles where product_id = p_id and business_id = p_business) then
    raise exception 'product not found' using errcode = '22023';
  end if;
  -- price changes affect future sales only: sale lines keep the price they were sold at
  update public.products set name = btrim(p_name), sku = nullif(btrim(coalesce(p_sku, '')), ''), description = coalesce(btrim(p_description), ''),
    selling_price = p_price, status = case when coalesce(p_active, true) then 'active' else 'archived' end where id = p_id and business_id = p_business;
  update public.bakery_product_profiles set shelf_life_days = p_shelf_life, min_stock = p_min_stock where product_id = p_id;
  return jsonb_build_object('product_id', p_id);
end $$;

create function public.bakery_save_ingredient(
  p_business uuid, p_id uuid, p_name text, p_sku text, p_unit_code text, p_reorder numeric, p_cost numeric, p_active boolean,
  p_opening_qty numeric, p_location uuid, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_unit uuid;
begin
  if not (public.has_module_permission(p_business, 'bakery-ingredients', 'bakery.manage', 'use') or public.has_module_permission(p_business, 'bakery-ingredients', 'inventory.adjust', 'use')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_id is null then v_prev := public._idem_check(p_business, p_key, 'bakery_ingredient_create'); if v_prev is not null then return v_prev; end if; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the ingredient name (at least 2 characters)' using errcode = '22023'; end if;
  if p_reorder is not null and p_reorder < 0 then raise exception 'reorder level cannot be negative' using errcode = '22023'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'cost cannot be negative' using errcode = '22023'; end if;
  if exists (select 1 from public.products where business_id = p_business and id is distinct from p_id and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'duplicate key: a product with this name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    select id into v_unit from public.units_of_measure where business_id = p_business and code = p_unit_code;
    if v_unit is null then raise exception 'unknown unit' using errcode = '22023'; end if;
    insert into public.products (id, business_id, name, sku, product_type, base_unit_id, selling_price, default_purchase_cost, reorder_level, tracks_stock)
    values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_sku, '')), ''), 'ingredient', v_unit, 0, p_cost, p_reorder, true);
    if p_opening_qty is not null and p_opening_qty > 0 then
      perform public._require_location(p_business, p_location);
      perform public._post_movement(p_business, v_id, p_location, 'receipt', p_opening_qty, p_cost, 'opening_balance', null, gen_random_uuid(), 'Opening balance');
    end if;
    return public._idem_store(p_business, p_key, 'bakery_ingredient_create', jsonb_build_object('product_id', v_id));
  end if;
  update public.products set name = btrim(p_name), sku = nullif(btrim(coalesce(p_sku, '')), ''), default_purchase_cost = p_cost, reorder_level = p_reorder,
    status = case when coalesce(p_active, true) then 'active' else 'archived' end
  where id = p_id and business_id = p_business and product_type = 'ingredient';
  if not found then raise exception 'ingredient not found' using errcode = '22023'; end if;
  return jsonb_build_object('product_id', p_id);
end $$;

-- ------------------------------------------------------------------- recipes
-- Creates a recipe (version 1) or, when p_recipe is given, adds a new version. Lines: [{ingredient_id, quantity, unit_code}].
create function public.bakery_save_recipe(
  p_business uuid, p_recipe uuid, p_product uuid, p_name text, p_output numeric, p_instructions text, p_lines jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev jsonb; r public.recipes; v_recipe uuid; v_version integer; v_vid uuid := gen_random_uuid(); l jsonb; pr public.products; uf public.units_of_measure; ub public.units_of_measure; v_seen uuid[] := '{}';
begin
  perform public._bakery_guard(p_business, 'bakery-recipes', 'bakery.manage');
  v_prev := public._idem_check(p_business, p_key, 'bakery_recipe_save'); if v_prev is not null then return v_prev; end if;
  if p_output is null or p_output <= 0 then raise exception 'the batch output must be greater than zero' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 60 then
    raise exception 'a recipe needs 1 to 60 ingredients' using errcode = '22023';
  end if;
  if p_recipe is null then
    if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'enter the recipe name' using errcode = '22023'; end if;
    if not exists (select 1 from public.bakery_product_profiles where product_id = p_product and business_id = p_business) then
      raise exception 'choose a bakery product for this recipe' using errcode = '22023';
    end if;
    begin
      insert into public.recipes (business_id, product_id, name, created_by) values (p_business, p_product, btrim(p_name), auth.uid()) returning id into v_recipe;
    exception when unique_violation then
      raise exception 'duplicate key: a recipe with this name already exists' using errcode = '23505';
    end;
    v_version := 1;
  else
    select * into r from public.recipes where id = p_recipe and business_id = p_business for update;
    if not found then raise exception 'recipe not found' using errcode = '22023'; end if;
    v_recipe := r.id; v_version := r.current_version + 1;
  end if;
  insert into public.recipe_versions (id, business_id, recipe_id, version, output_quantity, instructions, created_by)
  values (v_vid, p_business, v_recipe, v_version, p_output, nullif(btrim(coalesce(p_instructions, '')), ''), auth.uid());
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pr from public.products where id = (l ->> 'ingredient_id')::uuid and business_id = p_business and product_type = 'ingredient' and status = 'active';
    if not found then raise exception 'choose an active ingredient on every line' using errcode = '22023'; end if;
    if pr.id = any (v_seen) then raise exception 'each ingredient can appear once per recipe' using errcode = '22023'; end if;
    v_seen := v_seen || pr.id;
    if (l ->> 'quantity') is null or (l ->> 'quantity')::numeric <= 0 then raise exception 'every ingredient needs a quantity above zero' using errcode = '22023'; end if;
    select * into uf from public.units_of_measure where business_id = p_business and code = l ->> 'unit_code';
    if not found then raise exception 'unknown unit "%"', l ->> 'unit_code' using errcode = '22023'; end if;
    select * into ub from public.units_of_measure where id = pr.base_unit_id;
    if uf.dimension <> ub.dimension then
      raise exception '% is kept in % (%) and cannot be measured in % (%)', pr.name, ub.code, ub.dimension, uf.code, uf.dimension using errcode = '22023';
    end if;
    insert into public.recipe_ingredients (business_id, recipe_version_id, ingredient_product_id, quantity, unit_id)
    values (p_business, v_vid, pr.id, round((l ->> 'quantity')::numeric, 4), uf.id);
  end loop;
  update public.recipes set current_version = v_version where id = v_recipe;
  return public._idem_store(p_business, p_key, 'bakery_recipe_save', jsonb_build_object('recipe_id', v_recipe, 'version', v_version));
end $$;

create function public.bakery_set_recipe_status(p_recipe uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_business uuid;
begin
  select business_id into v_business from public.recipes where id = p_recipe;
  if v_business is null then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._bakery_guard(v_business, 'bakery-recipes', 'bakery.manage');
  update public.recipes set status = case when p_active then 'active' else 'archived' end where id = p_recipe;
end $$;

-- ---------------------------------------------------------------- production
create function public.bakery_plan_production(
  p_business uuid, p_recipe uuid, p_planned numeric, p_date date, p_location uuid, p_assignee uuid, p_notes text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; r public.recipes; v public.recipe_versions; v_id uuid := gen_random_uuid(); v_number text; ri record;
begin
  perform public._bakery_guard(p_business, 'bakery-production', 'bakery.record');
  v_prev := public._idem_check(p_business, p_key, 'bakery_plan'); if v_prev is not null then return v_prev; end if;
  select * into r from public.recipes where id = p_recipe and business_id = p_business;
  if not found or r.status <> 'active' then raise exception 'choose an active recipe' using errcode = '22023'; end if;
  select * into v from public.recipe_versions where recipe_id = r.id and version = r.current_version;
  if p_planned is null or p_planned <= 0 then raise exception 'the planned quantity must be greater than zero' using errcode = '22023'; end if;
  if p_date is null then raise exception 'choose the production date' using errcode = '22023'; end if;
  perform public._require_location(p_business, p_location);
  if p_assignee is not null and not exists (select 1 from public.business_members where business_id = p_business and user_id = p_assignee and status = 'active') then
    raise exception 'the assigned person is not an active member of this business' using errcode = '22023';
  end if;
  v_number := public._next_number(p_business, 'production', 'PB');
  insert into public.production_batches (id, business_id, batch_number, recipe_id, recipe_version_id, product_id, location_id, production_date, planned_output, assigned_to, notes, created_by, idempotency_key)
  values (v_id, p_business, v_number, r.id, v.id, r.product_id, p_location, p_date, p_planned, p_assignee, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), p_key);
  for ri in select id, ingredient_product_id from public.recipe_ingredients where recipe_version_id = v.id loop
    insert into public.production_ingredient_usage (business_id, batch_id, ingredient_product_id, planned_quantity)
    values (p_business, v_id, ri.ingredient_product_id, round(public.bakery_line_base_qty(ri.id) * p_planned / v.output_quantity, 4));
  end loop;
  return public._idem_store(p_business, p_key, 'bakery_plan', jsonb_build_object('batch_id', v_id, 'batch_number', v_number));
end $$;

-- What a batch needs against what is on hand at its location.
create function public.bakery_batch_requirements(p_batch uuid) returns table (ingredient_product_id uuid, ingredient_name text, unit_code text, required numeric, on_hand numeric, shortfall numeric)
language sql stable as $$
  select u.ingredient_product_id, p.name, un.code, u.planned_quantity,
    coalesce((select b.quantity_on_hand from public.inventory_balances b where b.product_id = u.ingredient_product_id and b.location_id = pb.location_id), 0),
    greatest(u.planned_quantity - coalesce((select b.quantity_on_hand from public.inventory_balances b where b.product_id = u.ingredient_product_id and b.location_id = pb.location_id), 0), 0)
  from public.production_ingredient_usage u
  join public.production_batches pb on pb.business_id = u.business_id and pb.id = u.batch_id
  join public.products p on p.business_id = u.business_id and p.id = u.ingredient_product_id
  join public.units_of_measure un on un.business_id = p.business_id and un.id = p.base_unit_id
  where u.batch_id = p_batch order by p.name;
$$;

create function public.bakery_start_production(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.production_batches;
begin
  select * into b from public.production_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._bakery_guard(b.business_id, 'bakery-production', 'bakery.record');
  select * into b from public.production_batches where id = p_batch for update;
  if b.status <> 'planned' then raise exception 'only a planned batch can be started' using errcode = '22023'; end if;
  update public.production_batches set status = 'in_progress', started_at = now() where id = p_batch;
end $$;

-- Completes a batch in one transaction: consumes the ingredients actually used (at their current weighted-average cost),
-- adds the good output to finished stock at the resulting unit cost, records the lot and expiry, and keeps the costs on the batch.
create function public.bakery_complete_production(p_batch uuid, p_actual_output numeric, p_failed_output numeric, p_usage jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.production_batches; v_prev jsonb; u record; v_qty numeric; m public.stock_movements; v_total numeric := 0; v_unit numeric; v_line numeric;
  v_group uuid := gen_random_uuid(); v_shelf integer; v_override jsonb; v_out public.stock_movements; v_known uuid[];
begin
  select * into b from public.production_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._bakery_guard(b.business_id, 'bakery-production', 'bakery.record');
  v_prev := public._idem_check(b.business_id, p_key, 'bakery_complete'); if v_prev is not null then return v_prev; end if;
  select * into b from public.production_batches where id = p_batch for update;
  if b.status not in ('planned', 'in_progress') then raise exception 'this batch is %, so it cannot be completed', b.status using errcode = '22023'; end if;
  if p_actual_output is null or p_actual_output < 0 then raise exception 'the quantity produced cannot be negative' using errcode = '22023'; end if;
  if p_failed_output is null or p_failed_output < 0 then raise exception 'failed units cannot be negative' using errcode = '22023'; end if;

  if p_usage is not null and jsonb_typeof(p_usage) = 'array' then
    select array_agg((x ->> 'ingredient_product_id')::uuid) into v_known from jsonb_array_elements(p_usage) x;
    if exists (select 1 from unnest(coalesce(v_known, '{}')) k where k not in (select ingredient_product_id from public.production_ingredient_usage where batch_id = p_batch)) then
      raise exception 'an ingredient was recorded that is not part of this batch' using errcode = '22023';
    end if;
  end if;

  for u in select * from public.production_ingredient_usage where batch_id = p_batch order by ingredient_product_id for update loop
    v_qty := u.planned_quantity;
    if p_usage is not null and jsonb_typeof(p_usage) = 'array' then
      select x into v_override from jsonb_array_elements(p_usage) x where (x ->> 'ingredient_product_id')::uuid = u.ingredient_product_id limit 1;
      if v_override is not null then
        v_qty := round((v_override ->> 'actual_quantity')::numeric, 4);
        if v_qty is null or v_qty < 0 then raise exception 'ingredient quantities cannot be negative' using errcode = '22023'; end if;
      end if;
    end if;
    if v_qty > 0 then
      m := public._post_movement(b.business_id, u.ingredient_product_id, b.location_id, 'production_consumption', -v_qty, null, 'production_batch', p_batch, v_group, 'Production ' || b.batch_number);
      v_line := round(v_qty * m.unit_cost, 2);
      update public.production_ingredient_usage set actual_quantity = v_qty, unit_cost = m.unit_cost, line_cost = v_line, stock_movement_id = m.id where id = u.id;
      v_total := v_total + v_line;
    else
      update public.production_ingredient_usage set actual_quantity = 0, unit_cost = 0, line_cost = 0 where id = u.id;
    end if;
  end loop;

  v_unit := case when p_actual_output > 0 then round(v_total / p_actual_output, 4) end;
  if p_actual_output > 0 then
    v_out := public._post_movement(b.business_id, b.product_id, b.location_id, 'production_output', p_actual_output, v_unit, 'production_batch', p_batch, v_group, 'Production ' || b.batch_number);
    select shelf_life_days into v_shelf from public.bakery_product_profiles where product_id = b.product_id;
    insert into public.bakery_lots (business_id, product_id, production_batch_id, quantity, remaining, produced_on, expires_on)
    values (b.business_id, b.product_id, p_batch, p_actual_output, p_actual_output, b.production_date, case when v_shelf is not null then b.production_date + v_shelf end);
  end if;

  update public.production_batches set status = 'completed', actual_output = p_actual_output, failed_output = p_failed_output,
    ingredient_cost = v_total, unit_cost = v_unit, completed_at = now(), started_at = coalesce(started_at, now()) where id = p_batch;
  return public._idem_store(b.business_id, p_key, 'bakery_complete', jsonb_build_object('batch_id', p_batch, 'ingredient_cost', v_total, 'unit_cost', v_unit));
end $$;

create function public.bakery_cancel_production(p_batch uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.production_batches; v_prev jsonb;
begin
  select * into b from public.production_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._bakery_guard(b.business_id, 'bakery-production', 'bakery.record');
  v_prev := public._idem_check(b.business_id, p_key, 'bakery_cancel'); if v_prev is not null then return v_prev; end if;
  select * into b from public.production_batches where id = p_batch for update;
  if b.status not in ('planned', 'in_progress') then raise exception 'only a batch that has not been completed can be cancelled; reverse a completed one instead' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.production_batches set status = 'cancelled', void_reason = btrim(p_reason) where id = p_batch;
  return public._idem_store(b.business_id, p_key, 'bakery_cancel', jsonb_build_object('batch_id', p_batch));
end $$;

-- Undoes a completed batch with a reason: ingredients go back at the cost they were taken at and the finished goods leave stock.
-- Refused once any of the batch has been sold or written off, because those units can no longer be taken back.
create function public.bakery_reverse_production(p_batch uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.production_batches; v_prev jsonb; u record; mv public.stock_movements; lot public.bakery_lots; v_group uuid := gen_random_uuid();
begin
  select * into b from public.production_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._bakery_guard(b.business_id, 'bakery-production', 'bakery.manage');
  v_prev := public._idem_check(b.business_id, p_key, 'bakery_reverse'); if v_prev is not null then return v_prev; end if;
  select * into b from public.production_batches where id = p_batch for update;
  if b.status <> 'completed' then raise exception 'only a completed batch can be reversed' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into lot from public.bakery_lots where production_batch_id = p_batch for update;
  if found and lot.remaining < lot.quantity then
    raise exception 'part of this batch has already been sold or written off, so it cannot be reversed' using errcode = '22023';
  end if;
  for u in select * from public.production_ingredient_usage where batch_id = p_batch and stock_movement_id is not null loop
    select * into mv from public.stock_movements where id = u.stock_movement_id;
    perform public._post_movement(b.business_id, u.ingredient_product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'production_reversal', p_batch, v_group, 'Reversed ' || b.batch_number || ': ' || btrim(p_reason), now(), mv.id);
  end loop;
  select * into mv from public.stock_movements where source_type = 'production_batch' and source_id = p_batch and movement_type = 'production_output';
  if found then
    perform public._post_movement(b.business_id, b.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'production_reversal', p_batch, v_group, 'Reversed ' || b.batch_number || ': ' || btrim(p_reason), now(), mv.id);
    update public.bakery_lots set remaining = 0, voided = true where production_batch_id = p_batch;
  end if;
  update public.production_batches set status = 'reversed', void_reason = btrim(p_reason) where id = p_batch;
  return public._idem_store(b.business_id, p_key, 'bakery_reverse', jsonb_build_object('batch_id', p_batch));
end $$;

-- --------------------------------------------------------------------- waste
create function public.bakery_record_waste(
  p_business uuid, p_product uuid, p_location uuid, p_qty numeric, p_reason text, p_batch uuid, p_notes text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; m public.stock_movements;
begin
  perform public._bakery_guard(p_business, 'bakery-waste', 'bakery.record');
  v_prev := public._idem_check(p_business, p_key, 'bakery_waste'); if v_prev is not null then return v_prev; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
  if p_reason not in ('expired', 'damaged', 'burnt', 'failed_batch', 'unsold', 'other') then raise exception 'choose a reason' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and business_id = p_business and product_type in ('ingredient', 'finished_good') and tracks_stock) then
    raise exception 'choose an ingredient or a finished product' using errcode = '22023';
  end if;
  if p_batch is not null and not exists (select 1 from public.production_batches where id = p_batch and business_id = p_business) then
    raise exception 'unknown production batch' using errcode = '22023';
  end if;
  perform public._require_location(p_business, p_location);
  v_number := public._next_number(p_business, 'waste', 'WST');
  m := public._post_movement(p_business, p_product, p_location, 'adjustment', -p_qty, null, 'bakery_waste', v_id, gen_random_uuid(), 'Waste (' || replace(p_reason, '_', ' ') || ')');
  insert into public.waste_records (id, business_id, waste_number, product_id, location_id, quantity, reason, production_batch_id, estimated_loss, notes, stock_movement_id, created_by, idempotency_key)
  values (v_id, p_business, v_number, p_product, p_location, p_qty, p_reason, p_batch, round(p_qty * m.unit_cost, 2), nullif(btrim(coalesce(p_notes, '')), ''), m.id, auth.uid(), p_key);
  return public._idem_store(p_business, p_key, 'bakery_waste', jsonb_build_object('waste_id', v_id, 'waste_number', v_number, 'estimated_loss', round(p_qty * m.unit_cost, 2)));
end $$;

create function public.bakery_void_waste(p_record uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.waste_records; v_prev jsonb; mv public.stock_movements;
begin
  select * into w from public.waste_records where id = p_record;
  if not found then raise exception 'record not found' using errcode = '22023'; end if;
  perform public._bakery_guard(w.business_id, 'bakery-waste', 'bakery.manage');
  v_prev := public._idem_check(w.business_id, p_key, 'bakery_void_waste'); if v_prev is not null then return v_prev; end if;
  if w.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into mv from public.stock_movements where id = w.stock_movement_id;
  perform public._post_movement(w.business_id, w.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'bakery_waste_void', w.id, gen_random_uuid(), 'Void waste ' || w.waste_number, now(), mv.id);
  update public.waste_records set status = 'voided', void_reason = btrim(p_reason) where id = p_record;
  return public._idem_store(w.business_id, p_key, 'bakery_void_waste', jsonb_build_object('waste_id', p_record));
end $$;

-- ----------------------------------------------------------------- overview
-- Operational figures for anyone who can see the dashboard; money figures only for those who may read financial reports.
--   net sales = completed sales less discounts, tax and refunds; gross profit = net sales less cost of goods sold (units sold at the
--   average cost they left stock at, less restocked returns); operating profit = gross profit less expenses (ingredient purchases are
--   stock, not expenses, so they are never counted twice). The profit figure is an estimate.
create function public.bakery_overview(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz; v_fin boolean;
  v_sales numeric; v_count integer; v_units_sold numeric; v_cogs numeric; v_expenses numeric; v_discounts numeric; v_returns numeric;
  v_batches integer; v_produced numeric; v_failed numeric; v_cost numeric; v_waste_loss numeric; v_waste_n integer;
  v_low integer; v_expiring integer; v_expired integer; v_pending integer; v_outstanding numeric;
  v_daily jsonb; v_best jsonb; v_methods jsonb; v_prod_vs jsonb; v_out jsonb;
begin
  perform public._bakery_guard(p_business, 'dashboard', 'dashboard.read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'choose a valid period of up to a year' using errcode = '22023'; end if;
  v_fin := public.has_business_permission(p_business, 'reports.finance.read');

  select coalesce(sum(grand_total - tax_total - returned_total), 0), count(*), coalesce(sum(discount_total), 0), coalesce(sum(returned_total), 0)
    into v_sales, v_count, v_discounts, v_returns from public.sales where business_id = p_business and status <> 'voided' and sold_at >= v_from and sold_at < v_to;
  select coalesce(sum(si.quantity), 0) into v_units_sold from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to;
  select coalesce(sum((si.quantity - coalesce(rt.restocked, 0)) * coalesce(si.unit_cost_snapshot, 0)), 0) into v_cogs
    from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
    left join lateral (select sum(ri.quantity) as restocked from public.sale_return_items ri where ri.sale_item_id = si.id and ri.disposition = 'restock') rt on true
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to;
  select coalesce(sum(amount), 0) into v_expenses from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to;
  select count(*), coalesce(sum(actual_output), 0), coalesce(sum(failed_output), 0), coalesce(sum(ingredient_cost), 0) into v_batches, v_produced, v_failed, v_cost
    from public.production_batches where business_id = p_business and status = 'completed' and production_date between p_from and p_to;
  select count(*), coalesce(sum(estimated_loss), 0) into v_waste_n, v_waste_loss from public.waste_records where business_id = p_business and status = 'posted' and created_at >= v_from and created_at < v_to;
  select count(*) into v_low from public.bakery_ingredient_stock where business_id = p_business and status = 'active' and low_stock;
  select count(*) filter (where expiry_status = 'expiring'), count(*) filter (where expiry_status = 'expired') into v_expiring, v_expired from public.bakery_lot_status where business_id = p_business;
  select count(*) into v_pending from public.production_batches where business_id = p_business and status in ('planned', 'in_progress');

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'net_sales', d.net, 'sales', d.n) order by d.day), '[]') into v_daily from (
    select sold_at::date as day, sum(grand_total - tax_total - returned_total) as net, count(*) as n from public.sales
    where business_id = p_business and status <> 'voided' and sold_at >= v_from and sold_at < v_to group by 1) d;
  select coalesce(jsonb_agg(jsonb_build_object('product', t.name, 'units', t.units, 'revenue', t.revenue) order by t.units desc), '[]') into v_best from (
    select p.name, sum(si.quantity) as units, sum(si.line_total - si.tax_amount) as revenue from public.sale_items si
    join public.sales s on s.business_id = si.business_id and s.id = si.sale_id join public.products p on p.business_id = si.business_id and p.id = si.product_id
    where s.business_id = p_business and s.status <> 'voided' and s.sold_at >= v_from and s.sold_at < v_to group by p.name order by sum(si.quantity) desc limit 8) t;
  select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount)), '[]') into v_methods from (
    select payment_method as method, sum(amount) as amount from public.payments where business_id = p_business and status = 'successful' and payment_type = 'sale_receipt'
      and coalesce(received_at, created_at) >= v_from and coalesce(received_at, created_at) < v_to group by payment_method) x;
  select coalesce(jsonb_agg(jsonb_build_object('day', y.day, 'produced', y.produced, 'sold', y.sold) order by y.day), '[]') into v_prod_vs from (
    select days.day, coalesce(pr.produced, 0) as produced, coalesce(sd.sold, 0) as sold from (
      select generate_series(p_from, p_to, interval '1 day')::date as day) days
    left join (select production_date as day, sum(actual_output) as produced from public.production_batches where business_id = p_business and status = 'completed' group by 1) pr on pr.day = days.day
    left join (select s.sold_at::date as day, sum(si.quantity) as sold from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
               where s.business_id = p_business and s.status <> 'voided' group by 1) sd on sd.day = days.day) y;

  v_out := jsonb_build_object(
    'batches_completed', v_batches, 'units_produced', v_produced, 'failed_units', v_failed, 'units_sold', v_units_sold, 'sales_count', v_count,
    'waste_records', v_waste_n, 'low_stock_ingredients', v_low, 'expiring_lots', v_expiring, 'expired_lots', v_expired, 'open_batches', v_pending,
    'daily', v_daily, 'best_sellers', v_best, 'production_vs_sales', v_prod_vs, 'financial', null);
  if v_fin then
    select coalesce(sum(balance_due), 0) into v_outstanding from public.receivables where business_id = p_business;
    v_out := v_out || jsonb_build_object('financial', jsonb_build_object(
      'net_sales', v_sales, 'discounts', v_discounts, 'refunds', v_returns, 'cogs', v_cogs, 'gross_profit', v_sales - v_cogs,
      'gross_margin_percent', case when v_sales > 0 then round((v_sales - v_cogs) * 100 / v_sales, 1) end,
      'operating_expenses', v_expenses, 'operating_profit_estimate', v_sales - v_cogs - v_expenses,
      'ingredient_cost_produced', v_cost, 'waste_loss', v_waste_loss, 'outstanding_balances', v_outstanding, 'payment_methods', v_methods));
  end if;
  return v_out;
end $$;

revoke all on function public._bakery_guard(uuid, text, text), public.bakery_immutable(), public.bakery_allocate_lots(),
  public.bakery_save_product(uuid, uuid, text, text, text, numeric, integer, numeric, text, boolean, text),
  public.bakery_save_ingredient(uuid, uuid, text, text, text, numeric, numeric, boolean, numeric, uuid, text),
  public.bakery_save_recipe(uuid, uuid, uuid, text, numeric, text, jsonb, text), public.bakery_set_recipe_status(uuid, boolean),
  public.bakery_plan_production(uuid, uuid, numeric, date, uuid, uuid, text, text), public.bakery_start_production(uuid),
  public.bakery_complete_production(uuid, numeric, numeric, jsonb, text), public.bakery_cancel_production(uuid, text, text),
  public.bakery_reverse_production(uuid, text, text), public.bakery_record_waste(uuid, uuid, uuid, numeric, text, uuid, text, text),
  public.bakery_void_waste(uuid, text, text), public.bakery_overview(uuid, date, date) from public;
grant execute on function
  public.bakery_save_product(uuid, uuid, text, text, text, numeric, integer, numeric, text, boolean, text),
  public.bakery_save_ingredient(uuid, uuid, text, text, text, numeric, numeric, boolean, numeric, uuid, text),
  public.bakery_save_recipe(uuid, uuid, uuid, text, numeric, text, jsonb, text), public.bakery_set_recipe_status(uuid, boolean),
  public.bakery_plan_production(uuid, uuid, numeric, date, uuid, uuid, text, text), public.bakery_start_production(uuid),
  public.bakery_complete_production(uuid, numeric, numeric, jsonb, text), public.bakery_cancel_production(uuid, text, text),
  public.bakery_reverse_production(uuid, text, text), public.bakery_record_waste(uuid, uuid, uuid, numeric, text, uuid, text, text),
  public.bakery_void_waste(uuid, text, text), public.bakery_overview(uuid, date, date),
  public.bakery_batch_requirements(uuid), public.bakery_version_cost(uuid), public.bakery_ingredient_cost(uuid), public.bakery_line_base_qty(uuid) to authenticated;
