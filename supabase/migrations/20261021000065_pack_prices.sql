-- A pack can have its own price (a carton cheaper than its pieces added up).
--
-- A pack was always priced as its units times the selling price. Now a pack may carry a price of its own, which can only be lower than that sum (a carton is
-- never dearer than buying the same pieces one by one). The till sells the pack at that price; the stock still goes down by the units in it.
-- The saving is recorded on the sale line as a discount, worked out by the server from the stored pack price: the cashier does not need the discount permission,
-- and cannot invent a pack price, because it is read from the pack, not from what the till sends. Discounts typed by hand still need the permission.

alter table public.product_packs add column price numeric(14, 2) check (price is null or price >= 0);

-- the pack list the app reads now includes the price
do $$
declare v text;
begin
  v := pg_get_viewdef('public.mart_products'::regclass, true);
  v := replace(v, 'jsonb_build_object(''name'', k.name, ''units'', k.units_per_pack)', 'jsonb_build_object(''name'', k.name, ''units'', k.units_per_pack, ''price'', k.price)');
  if v not like '%''price'', k.price%' then raise exception 'mart_products packs not rewritten'; end if;
  execute 'create or replace view public.mart_products with (security_invoker = true) as ' || v;
end $$;

-- saving a product keeps each pack's price
do $$
declare def text;
begin
  def := pg_get_functiondef(to_regprocedure('public.mart_save_product(uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, uuid, boolean, boolean, jsonb, text)'));
  def := replace(def, E'    insert into public.product_packs (business_id, product_id, name, units_per_pack) values (p_business, v_id, btrim(k ->> ''name''), round((k ->> ''units'')::numeric, 4))\n    on conflict (product_id, lower(btrim(name))) do update set units_per_pack = excluded.units_per_pack;',
    E'    if nullif(btrim(coalesce(k ->> ''price'', '''')), '''') is not null and ((k ->> ''price'')::numeric < 0 or scale((k ->> ''price'')::numeric) > 2) then raise exception ''the price of pack "%" must be zero or more with at most 2 decimals'', k ->> ''name'' using errcode = ''22023''; end if;\n'
    || E'    if nullif(btrim(coalesce(k ->> ''price'', '''')), '''') is not null and (k ->> ''price'')::numeric > round((k ->> ''units'')::numeric * p_price, 2) then raise exception ''the price of pack "%" cannot be more than its units sold one by one (%)'', k ->> ''name'', round((k ->> ''units'')::numeric * p_price, 2) using errcode = ''22023''; end if;\n'
    || E'    insert into public.product_packs (business_id, product_id, name, units_per_pack, price) values (p_business, v_id, btrim(k ->> ''name''), round((k ->> ''units'')::numeric, 4), nullif(btrim(coalesce(k ->> ''price'', '''')), '''')::numeric)\n'
    || E'    on conflict (product_id, lower(btrim(name))) do update set units_per_pack = excluded.units_per_pack, price = excluded.price;');
  if def not like '%excluded.price%' then raise exception 'pack insert not found in mart_save_product'; end if;
  execute def;
end $$;

-- the sale: a pack line with a price gets its saving as a discount, worked out here
do $$
declare def text;
begin
  def := pg_get_functiondef(to_regprocedure('public.post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid)'));
  def := replace(def, 'v_price numeric; v_disc numeric;', 'v_price numeric; v_disc numeric; v_pdisc numeric;');
  def := replace(def, E'    v_disc := coalesce((v_item ->> ''discount_amount'')::numeric, 0);',
    E'    v_disc := coalesce((v_item ->> ''discount_amount'')::numeric, 0);\n'
    || E'    v_pdisc := 0;\n'
    || E'    if (v_item ->> ''pack'') is not null then\n'
    || E'      select round(v_gross - (v_qty / k.units_per_pack) * k.price, 2) into v_pdisc from public.product_packs k\n'
    || E'       where k.business_id = p_business and k.product_id = pr.id and lower(btrim(k.name)) = lower(btrim(v_item ->> ''pack'')) and k.price is not null;\n'
    || E'      v_pdisc := greatest(coalesce(v_pdisc, 0), 0);\n'
    || E'    end if;');
  def := replace(def, E'    v_net := v_gross - v_disc;',
    E'    v_disc := v_disc + v_pdisc;\n'
    || E'    if v_disc > v_gross then raise exception ''invalid discount on line %'', v_i + 1 using errcode = ''22023''; end if;\n'
    || E'    v_net := v_gross - v_disc;');
  if def not like '%v_pdisc := v_pdisc%' and def not like '%v_disc := v_disc + v_pdisc%' then raise exception 'post_sale not rewritten'; end if;
  execute def;
end $$;

-- the mart's sale wrapper passes the pack name on, and checks a pack line's price against the stored pack price
create or replace function public.mart_post_sale(p_business uuid, p_location uuid, p_customer uuid, p_items jsonb, p_payments jsonb, p_key text, p_note text default null, p_branch uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; v_f numeric; v_out jsonb := '[]'::jsonb; v_pk numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'a sale needs 1 to 100 lines' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
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
