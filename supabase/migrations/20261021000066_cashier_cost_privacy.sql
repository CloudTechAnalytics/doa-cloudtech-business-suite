-- Cashiers no longer see what the shop pays for its goods.
--
-- A cashier could read the average cost of every product (and so the margin) because the till's product list came from the stock tables, which need inventory.read.
-- Now the cashier does not have inventory.read at all. The till gets its own product list from till_catalog(): names, codes, selling prices, packs and how many
-- are on the shelf, and no costs. People who do hold inventory.read (owner, admin, manager, accountant, storekeeper, pharmacist...) get the costs in it as before.
--
-- Also, the cost recorded on each sale line is for the reports (which run on the server), not for the app, so nobody can read it straight from the table any more.

delete from public.role_permissions rp using public.roles r, public.permissions p
 where rp.role_id = r.id and rp.permission_id = p.id and r.name = 'cashier' and r.business_id is null and p.code = 'inventory.read';

create function public.till_catalog(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cost boolean;
begin
  if not (public.has_business_permission(p_business, 'sales.create') or public.has_business_permission(p_business, 'inventory.read')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_cost := public.has_business_permission(p_business, 'inventory.read');
  return jsonb_build_object(
    'units', coalesce((select jsonb_agg(u.code order by u.code) from public.units_of_measure u where u.business_id = p_business), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.product_categories c where c.business_id = p_business), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name) from public.inventory_locations l where l.business_id = p_business and l.status = 'active'), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'sku', p.sku, 'barcode', p.barcode, 'name', p.name, 'unit', u.code, 'selling_price', p.selling_price,
        'default_cost', case when v_cost then p.default_purchase_cost end, 'reorder_level', p.reorder_level, 'status', p.status, 'tracks_stock', p.tracks_stock, 'category_id', p.category_id) order by p.name)
        from public.products p join public.units_of_measure u on u.id = p.base_unit_id where p.business_id = p_business), '[]'::jsonb),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('product_id', b.product_id, 'location_id', b.location_id, 'qty', b.quantity_on_hand, 'avg_cost', case when v_cost then b.avg_unit_cost end))
        from public.inventory_balances b where b.business_id = p_business), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('product_id', k.product_id, 'name', k.name, 'units', k.units_per_pack, 'price', k.price)) from public.product_packs k where k.business_id = p_business), '[]'::jsonb)
  );
end $$;
revoke execute on function public.till_catalog(uuid) from public;
grant execute on function public.till_catalog(uuid) to authenticated;

-- pictures are part of the till
drop policy product_thumbs_select on public.product_thumbs;
create policy product_thumbs_select on public.product_thumbs for select to authenticated using (public.has_business_permission(business_id, 'inventory.read') or public.has_business_permission(business_id, 'sales.create'));
drop policy product_images_select on public.product_images;
create policy product_images_select on public.product_images for select to authenticated using (public.has_business_permission(business_id, 'inventory.read') or public.has_business_permission(business_id, 'sales.create'));

-- the cost snapshot on a sale line is for server-side reports only
revoke select on public.sale_items from authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'sale_items' and column_name <> 'unit_cost_snapshot';
  execute format('grant select (%s) on public.sale_items to authenticated', cols);
end $$;
