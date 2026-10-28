-- Selling an item that is not in the product list ("Quick item" at the till).
--
-- A till line can be typed in: a name, a price and a quantity. It is recorded like a service (no stock moves, no cost known) against a hidden placeholder product,
-- "Unlisted item", that each business gets the first time it is needed, so voids, returns, receipts and reports keep working. The sale line keeps the name that was
-- typed, and the sale is marked (has_unlisted) so it can be found and so the reports can show how much was sold this way.
--
-- Who may: owners, admins and managers always (where the till is a shop's: Mart or business apps). Cashiers only when the owner switches on "Let cashiers sell items
-- that are not in the product list" in Settings, which is off by default. The price of a typed item is whatever the cashier types: that is the point, and why it is
-- off by default and why the reports show the total sold this way.

alter table public.sales add column has_unlisted boolean not null default false;

-- the setting
do $$
declare def text;
begin
  def := replace(pg_get_functiondef('public.validate_business_settings()'::regprocedure), E'\r\n', E'\n');
  def := replace(def, '''theme'', ''receipt'') then', '''theme'', ''receipt'', ''allow_unlisted_items'') then');
  def := replace(def, E'  if new.settings ? ''receipt'' then',
    E'  if new.settings ? ''allow_unlisted_items'' and jsonb_typeof(new.settings -> ''allow_unlisted_items'') <> ''boolean'' then\n'
    || E'    raise exception ''allow_unlisted_items must be true or false'' using errcode = ''22023'';\n'
    || E'  end if;\n'
    || E'  if new.settings ? ''receipt'' then');
  if def not like '%allow_unlisted_items must be%' then raise exception 'validate_business_settings not rewritten'; end if;
  execute def;
end $$;

create function public.set_unlisted_items_allowed(p_business uuid, p_allow boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(p_business, 'settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_allow is null then raise exception 'choose yes or no' using errcode = '22023'; end if;
  update public.businesses set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{allow_unlisted_items}', to_jsonb(p_allow)) where id = p_business and status = 'active';
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_business, auth.uid(), 'business.unlisted_items', 'business', p_business, jsonb_build_object('allowed', p_allow));
end $$;
revoke execute on function public.set_unlisted_items_allowed(uuid, boolean) from public;
grant execute on function public.set_unlisted_items_allowed(uuid, boolean) to authenticated;

-- may this person sell an item that is not in the product list, here?
create function public.unlisted_items_allowed(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_business_permission(p_business, 'sales.create')
     and exists (select 1 from public.businesses b where b.id = p_business and b.status = 'active' and b.primary_industry_code in ('retail', 'general')
                   and (public.has_business_permission(p_business, 'retail.manage') or coalesce((b.settings ->> 'allow_unlisted_items')::boolean, false)))
$$;
revoke execute on function public.unlisted_items_allowed(uuid) from public;
grant execute on function public.unlisted_items_allowed(uuid) to authenticated;

-- the placeholder product (hidden: archived, no stock, price set per line), made on first use
create function public._unlisted_product(p_business uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_unit uuid;
begin
  select id into v_id from public.products where business_id = p_business and sku = 'UNLISTED' limit 1;
  if v_id is not null then return v_id; end if;
  select id into v_unit from public.units_of_measure where business_id = p_business and code = 'each';
  if v_unit is null then raise exception 'unit not found' using errcode = '22023'; end if;
  insert into public.products (business_id, name, sku, description, product_type, base_unit_id, selling_price, tracks_stock, status, archived_at)
  values (p_business, 'Unlisted item', 'UNLISTED', 'Items sold at the till that are not in the product list', 'goods', v_unit, 0, false, 'archived', now())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public._unlisted_product(uuid) from public;

-- what the till needs to know: may this person add a typed item, and which product do those lines sit on (so they can be recognised)
create function public.till_options(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(p_business, 'sales.create') or public.has_business_permission(p_business, 'sales.read')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object('allowed', public.unlisted_items_allowed(p_business),
    'product_id', (select id from public.products where business_id = p_business and sku = 'UNLISTED' limit 1));
end $$;
revoke execute on function public.till_options(uuid) from public;
grant execute on function public.till_options(uuid) to authenticated;

-- the placeholder stays out of the till's product list and the Mart's product views
do $$
declare v text; def text;
begin
  v := pg_get_viewdef('public.mart_products'::regclass, true);
  if v like '%UNLISTED%' then raise exception 'already changed'; end if;
  v := replace(v, E'WHERE p.product_type = ''goods''', E'WHERE p.product_type = ''goods'' AND p.sku IS DISTINCT FROM ''UNLISTED''');
  if v not like '%UNLISTED%' then raise exception 'mart_products not rewritten'; end if;
  execute 'create or replace view public.mart_products with (security_invoker = true) as ' || v;
  def := replace(pg_get_functiondef('public.till_catalog(uuid)'::regprocedure), E'\r\n', E'\n');
  def := replace(def, 'where p.business_id = p_business), ''[]''::jsonb),', 'where p.business_id = p_business and p.sku is distinct from ''UNLISTED''), ''[]''::jsonb),');
  if def not like '%UNLISTED%' then raise exception 'till_catalog not rewritten'; end if;
  execute def;
end $$;

-- the sale: a line with a custom_name is a typed item
do $$
declare def text;
begin
  def := replace(pg_get_functiondef('public.post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid)'::regprocedure), E'\r\n', E'\n');
  def := replace(def, 'v_price numeric; v_disc numeric; v_pdisc numeric;', 'v_price numeric; v_disc numeric; v_pdisc numeric; v_custom text; v_any_custom boolean := false; v_unl uuid;');
  def := replace(def, E'    select * into pr from public.products where id = (v_item ->> ''product_id'')::uuid and business_id = p_business;\n    if not found or pr.status <> ''active'' then',
    E'    v_custom := nullif(btrim(coalesce(v_item ->> ''custom_name'', '''')), '''');\n'
    || E'    if v_custom is not null then\n'
    || E'      if not public.unlisted_items_allowed(p_business) then raise exception ''selling an item that is not in the product list is not allowed here'' using errcode = ''42501''; end if;\n'
    || E'      if length(v_custom) > 80 then raise exception ''the item name can be at most 80 characters'' using errcode = ''22023''; end if;\n'
    || E'      if (v_item ->> ''unit_price'') is null or (v_item ->> ''unit_price'')::numeric <= 0 or scale((v_item ->> ''unit_price'')::numeric) > 2 then raise exception ''enter the price of %, above zero with at most 2 decimals'', v_custom using errcode = ''22023''; end if;\n'
    || E'      v_any_custom := true;\n'
    || E'      v_unl := public._unlisted_product(p_business);\n'
    || E'      select * into pr from public.products where id = v_unl;\n'
    || E'    else\n'
    || E'      select * into pr from public.products where id = (v_item ->> ''product_id'')::uuid and business_id = p_business;\n'
    || E'    end if;\n'
    || E'    if not found or (v_custom is null and pr.status <> ''active'') then');
  def := replace(def, E'    v_price := pr.selling_price;', E'    v_price := case when v_custom is null then pr.selling_price else (v_item ->> ''unit_price'')::numeric end;');
  def := replace(def, '''name'', pr.name,', '''name'', coalesce(v_custom, pr.name),');
  def := replace(def, E'  v_grand := v_sub - v_disc_total + v_tax_total;', E'  v_grand := v_sub - v_disc_total + v_tax_total;');
  def := replace(def, E'    v_grand, p_note, auth.uid(), p_key);', E'    v_grand, p_note, auth.uid(), p_key);\n  if v_any_custom then update public.sales set has_unlisted = true where id = v_sale; end if;');
  if def not like '%v_any_custom%' or def not like '%unlisted_items_allowed%' or def not like '%coalesce(v_custom, pr.name)%' or def not like '%set has_unlisted%' then raise exception 'post_sale not rewritten'; end if;
  execute def;
end $$;

-- the mart's wrapper lets typed items through untouched
create or replace function public.mart_post_sale(p_business uuid, p_location uuid, p_customer uuid, p_items jsonb, p_payments jsonb, p_key text, p_note text default null, p_branch uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; v_f numeric; v_out jsonb := '[]'::jsonb; v_pk numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'a sale needs 1 to 100 lines' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(btrim(coalesce(it ->> 'custom_name', '')), '') is not null then
      v_out := v_out || jsonb_build_object('custom_name', it ->> 'custom_name', 'quantity', it ->> 'quantity', 'unit_price', it ->> 'unit_price', 'discount_amount', coalesce((it ->> 'discount_amount')::numeric, 0));
      continue;
    end if;
    v_f := public._pack_factor(p_business, (it ->> 'product_id')::uuid, it ->> 'pack');
    v_pk := null;
    if nullif(btrim(coalesce(it ->> 'pack', '')), '') is not null then
      select k.price into v_pk from public.product_packs k where k.business_id = p_business and k.product_id = (it ->> 'product_id')::uuid and lower(btrim(k.name)) = lower(btrim(it ->> 'pack'));
    end if;
    if v_pk is not null and (it ->> 'unit_price') is not null and (it ->> 'unit_price')::numeric <> v_pk then
      raise exception 'the price of the % has changed to %; refresh and retry', it ->> 'pack', v_pk using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('product_id', it ->> 'product_id', 'quantity', round((it ->> 'quantity')::numeric * v_f, 4),
      'unit_price', case when v_pk is not null or (it ->> 'unit_price') is null then null else round((it ->> 'unit_price')::numeric / v_f, 4) end,
      'discount_amount', coalesce((it ->> 'discount_amount')::numeric, 0), 'pack', case when v_pk is not null then it ->> 'pack' else null end);
  end loop;
  return public.post_sale(p_business, p_location, p_customer, v_out, p_payments, p_key, p_note, p_branch);
end $$;

-- the dashboard and reports show how much was sold this way
do $$
declare def text;
begin
  def := replace(pg_get_functiondef('public.mart_overview(uuid, date, date)'::regprocedure), E'\r\n', E'\n');
  def := replace(def, 'v_wo numeric; v_cd numeric;', 'v_wo numeric; v_cd numeric; v_unl numeric; v_unl_n integer;');
  def := replace(def, E'occurred_at >= v_from and occurred_at < v_to;',
    E'occurred_at >= v_from and occurred_at < v_to;\n'
    || E'  select coalesce(sum(si.line_total - si.tax_amount), 0), count(distinct s.id) into v_unl, v_unl_n from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id\n'
    || E'    join public.products up on up.business_id = si.business_id and up.id = si.product_id and up.sku = ''UNLISTED''\n'
    || E'    where s.business_id = p_business and s.status <> ''voided'' and s.sold_at >= v_from and s.sold_at < v_to;');
  def := replace(def, '''stock_write_offs'', v_wo,', '''unlisted_sales'', v_unl, ''unlisted_count'', v_unl_n, ''stock_write_offs'', v_wo,');
  if def not like '%unlisted_count%' or def not like '%v_unl_n integer%' then raise exception 'mart_overview not rewritten'; end if;
  execute def;
end $$;
