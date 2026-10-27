-- Inventory: bring a product list in from a spreadsheet, with opening stock, in one safe step.
--   * Up to 500 rows. A row needs a name; unit defaults to "each"; a row can be a service (no stock), can name a category (created if new) and, for a product that
--     tracks stock, can carry an opening quantity (and cost) that is received into the chosen location through the same ledger as every other receipt.
--   * A SKU, a barcode or (when neither is given) a name that is already in use is skipped as a duplicate, against what exists and inside the file.
--   * It is all or nothing, and a repeat of the same request (same key) does nothing the second time.
-- Additive. Rollback: drop the function.

create function public.inventory_import_products(p_business uuid, p_location uuid, p_rows jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i integer := 0; v_prev jsonb; v_name text; v_sku text; v_barcode text; v_unit uuid; v_unit_code text; v_price numeric; v_cost numeric; v_reorder numeric; v_qty numeric;
  v_service boolean; v_cat uuid; v_cat_name text; v_id uuid; v_group uuid := gen_random_uuid();
  v_created integer := 0; v_stocked integer := 0; v_dups jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_key text;
begin
  perform public._inv_guard(p_business);
  v_prev := public._idem_check(p_business, p_key, 'import_products'); if v_prev is not null then return v_prev; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'there are no rows to import' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'import at most 500 rows at a time' using errcode = '22023'; end if;
  if p_location is not null then perform public._require_location(p_business, p_location); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := btrim(coalesce(r ->> 'name', '')); v_sku := nullif(btrim(coalesce(r ->> 'sku', '')), ''); v_barcode := nullif(btrim(coalesce(r ->> 'barcode', '')), '');
    v_unit_code := lower(coalesce(nullif(btrim(coalesce(r ->> 'unit', '')), ''), 'each'));
    v_service := lower(coalesce(r ->> 'type', '')) in ('service', 'services');
    v_cat_name := nullif(btrim(coalesce(r ->> 'category', '')), '');
    if v_name = '' then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'no name'); continue; end if;
    if length(v_name) > 200 then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'name is too long'); continue; end if;
    select id into v_unit from public.units_of_measure where business_id = p_business and lower(code) = v_unit_code;
    if v_unit is null then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'unknown unit ' || v_unit_code); continue; end if;
    begin v_price := coalesce(nullif(btrim(coalesce(r ->> 'price', '')), '')::numeric, 0); v_cost := nullif(btrim(coalesce(r ->> 'cost', '')), '')::numeric;
          v_reorder := nullif(btrim(coalesce(r ->> 'reorder', '')), '')::numeric; v_qty := coalesce(nullif(btrim(coalesce(r ->> 'quantity', '')), '')::numeric, 0);
    exception when others then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'a price, cost, reorder level or quantity is not a number'); continue; end;
    if v_price < 0 or coalesce(v_cost, 0) < 0 or coalesce(v_reorder, 0) < 0 or v_qty < 0 then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'a price, cost, reorder level or quantity is negative'); continue; end if;
    if v_qty > 0 and v_service then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'a service has no stock to count'); continue; end if;
    if v_qty > 0 and p_location is null then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'choose where the opening stock goes'); continue; end if;
    v_key := coalesce('s:' || lower(v_sku), 'b:' || lower(v_barcode), 'n:' || lower(v_name));
    if v_key = any (v_seen)
       or (v_sku is not null and exists (select 1 from public.products where business_id = p_business and lower(sku) = lower(v_sku)))
       or (v_barcode is not null and exists (select 1 from public.products where business_id = p_business and lower(barcode) = lower(v_barcode)))
       or (v_sku is null and v_barcode is null and exists (select 1 from public.products where business_id = p_business and lower(name) = lower(v_name))) then
      v_dups := v_dups || to_jsonb(i); continue;
    end if;
    v_seen := v_seen || v_key;
    v_cat := null;
    if v_cat_name is not null then
      select id into v_cat from public.product_categories where business_id = p_business and lower(name) = lower(v_cat_name);
      if v_cat is null then insert into public.product_categories (business_id, name) values (p_business, v_cat_name) returning id into v_cat; end if;
    end if;
    insert into public.products (business_id, name, sku, barcode, category_id, base_unit_id, selling_price, default_purchase_cost, reorder_level, tracks_stock)
    values (p_business, v_name, v_sku, v_barcode, v_cat, v_unit, round(v_price, 2), v_cost, v_reorder, not v_service) returning id into v_id;
    v_created := v_created + 1;
    if v_qty > 0 then
      perform public._post_movement(p_business, v_id, p_location, 'receipt', v_qty, v_cost, 'import', null, v_group, 'Opening stock (import)', now());
      v_stocked := v_stocked + 1;
    end if;
  end loop;
  return public._idem_store(p_business, p_key, 'import_products', jsonb_build_object('created', v_created, 'stocked', v_stocked, 'duplicates', v_dups, 'invalid', v_bad));
end $$;

revoke execute on function public.inventory_import_products(uuid, uuid, jsonb, text) from public;
grant execute on function public.inventory_import_products(uuid, uuid, jsonb, text) to authenticated;
