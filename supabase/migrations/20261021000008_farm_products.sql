-- Farm products: what the farm sells. A farm product is a row in the SHARED products table (so sales, inventory and
-- harvests all use the same item) plus a farm profile that says where its stock comes from:
--   produce   -> the product's own inventory stock (filled by recorded harvests)
--   livestock -> head count of active batches of a species (shown for information; sold animals are recorded as a removal on the batch)
--   other     -> not stock-tracked (manure, services, hire)
-- Additive only. Rollback: drop the objects created here and delete the 'farm-products' module row.

insert into public.modules (code, name, description, is_core, required_permission)
values ('farm-products', 'Farm Products', 'What the farm sells, in which unit and at what price.', false, 'farm.read');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m
where t.code = 'farm' and m.code = 'farm-products';

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = 'farm-products';

-- Existing farm businesses get the new module switched on.
insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'farm' and m.code = 'farm-products'
on conflict (business_id, module_id) do nothing;

create table public.farm_product_profiles (
  product_id uuid primary key,
  business_id uuid not null,
  production_type text not null check (production_type in ('poultry', 'fish', 'crop', 'livestock', 'general')),
  source_kind text not null check (source_kind in ('produce', 'livestock', 'other')),
  match_species text check (match_species is null or length(btrim(match_species)) between 1 and 80),
  created_at timestamptz not null default now(),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade,
  check (source_kind = 'livestock' or match_species is null),
  check (source_kind <> 'livestock' or match_species is not null)
);

alter table public.farm_product_profiles enable row level security;
create policy farm_product_profiles_select on public.farm_product_profiles for select to authenticated
  using (public.has_module_permission(business_id, 'farm-products', 'farm.read', 'read'));
grant select on public.farm_product_profiles to authenticated;
create trigger audit_farm_product_profiles after insert or update on public.farm_product_profiles
  for each row execute function public.audit_row_change();

-- Quantity available per farm product, derived from the ledgers (never stored).
create view public.farm_products with (security_invoker = true) as
select p.id, p.business_id, p.name, p.sku, p.description, p.selling_price, p.status, u.code as unit_code,
  f.production_type, f.source_kind, f.match_species,
  case f.source_kind
    when 'produce' then (select coalesce(sum(ib.quantity_on_hand), 0) from public.inventory_balances ib where ib.product_id = p.id)
    when 'livestock' then (select coalesce(sum(s.current_population), 0) from public.farm_batch_summaries s
                            where s.business_id = p.business_id and s.status = 'active' and lower(s.species_or_crop) = lower(f.match_species))
    else null
  end as available_quantity
from public.farm_product_profiles f
join public.products p on p.business_id = f.business_id and p.id = f.product_id
join public.units_of_measure u on u.business_id = p.business_id and u.id = p.base_unit_id;
grant select on public.farm_products to authenticated;

create function public.farm_create_product(
  p_business uuid, p_name text, p_sku text, p_production_type text, p_source_kind text, p_species text,
  p_unit_code text, p_price numeric, p_description text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_unit uuid; v_id uuid := gen_random_uuid();
begin
  perform public._farm_guard(p_business, 'farm-products', 'farm.manage');
  v_prev := public._idem_check(p_business, p_key, 'farm_create_product'); if v_prev is not null then return v_prev; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the product name (at least 2 characters)' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 then raise exception 'price cannot be negative' using errcode = '22023'; end if;
  -- The shared products table allows repeated names; a farm picks products by name, so it does not.
  if exists (select 1 from public.products where business_id = p_business and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'duplicate key: a product with this name already exists' using errcode = '23505';
  end if;
  select id into v_unit from public.units_of_measure where business_id = p_business and code = p_unit_code;
  if v_unit is null then raise exception 'unknown unit' using errcode = '22023'; end if;
  if p_source_kind = 'livestock' and length(btrim(coalesce(p_species, ''))) = 0 then
    raise exception 'choose the species this product is drawn from' using errcode = '22023';
  end if;
  insert into public.products (id, business_id, name, sku, description, product_type, base_unit_id, selling_price, tracks_stock)
  values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_sku, '')), ''), coalesce(btrim(p_description), ''),
          case p_source_kind when 'produce' then 'finished_good' else 'goods' end, v_unit, p_price, p_source_kind = 'produce');
  insert into public.farm_product_profiles (product_id, business_id, production_type, source_kind, match_species)
  values (v_id, p_business, p_production_type, p_source_kind, case when p_source_kind = 'livestock' then btrim(p_species) end);
  return public._idem_store(p_business, p_key, 'farm_create_product', jsonb_build_object('product_id', v_id));
end $$;

-- Name, price, description and active flag can change; the stock source is fixed once the product exists.
create function public.farm_update_product(p_product uuid, p_name text, p_price numeric, p_description text, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_business uuid;
begin
  select business_id into v_business from public.farm_product_profiles where product_id = p_product;
  if v_business is null then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._farm_guard(v_business, 'farm-products', 'farm.manage');
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the product name (at least 2 characters)' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 then raise exception 'price cannot be negative' using errcode = '22023'; end if;
  if exists (select 1 from public.products where business_id = v_business and id <> p_product and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'duplicate key: a product with this name already exists' using errcode = '23505';
  end if;
  update public.products set name = btrim(p_name), selling_price = p_price, description = coalesce(btrim(p_description), ''),
    status = case when p_active then 'active' else 'archived' end
  where id = p_product and business_id = v_business;
end $$;

revoke all on function public.farm_create_product(uuid, text, text, text, text, text, text, numeric, text, text),
  public.farm_update_product(uuid, text, numeric, text, boolean) from public;
grant execute on function public.farm_create_product(uuid, text, text, text, text, text, text, numeric, text, text),
  public.farm_update_product(uuid, text, numeric, text, boolean) to authenticated;
