-- An archived product no longer holds its name, SKU or barcode.
--
-- A product with history cannot be deleted (its sales and stock entries are part of the books), so the way to remove one is to archive it. Until now an archived
-- product still blocked a new product from using its name, SKU or barcode, which made "archive" a poor substitute for "delete" (a product entered by mistake kept
-- its barcode forever). Now only active products have to be unique. Bringing an archived product back is refused if an active one has taken its name or code.

drop index if exists public.products_sku_uq;
drop index if exists public.products_barcode_uq;
create unique index products_sku_uq on public.products (business_id, lower(sku)) where sku is not null and status = 'active';
create unique index products_barcode_uq on public.products (business_id, barcode) where barcode is not null and status = 'active';

do $$
declare def text;
begin
  def := pg_get_functiondef(to_regprocedure('public.mart_save_product(uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, uuid, boolean, boolean, jsonb, text)'));
  def := replace(def, 'where business_id = p_business and id <> v_id and lower(btrim(name)) = lower(btrim(p_name))', 'where business_id = p_business and status = ''active'' and id <> v_id and lower(btrim(name)) = lower(btrim(p_name))');
  if def not like '%status = ''active'' and id <> v_id%' then raise exception 'name check not found in mart_save_product'; end if;
  execute def;
end $$;
