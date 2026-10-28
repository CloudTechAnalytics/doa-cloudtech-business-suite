-- Mart depth: suppliers on every plan, safer stock reversal, product pictures.
--
-- * Suppliers (the simple list of who you buy from) is now on the free Starter plan. A mart cannot return goods, or even say where stock came from, without it.
--   Purchase orders stay on the paid plans.
-- * Reversing a stock movement is for mistakes made by hand: a stock receipt, an adjustment, an issue, an opening balance or an import. A movement that belongs to a
--   sale, a loss, a count, a supplier return or a purchase order is undone where it was made (void the sale, void the loss...), otherwise the stock would change
--   while the record it came from said nothing had happened.
-- * Product pictures: a small one for lists and the till, a larger one for the product's details. Stored as small JPEG pictures; only managers of the products change them.

update public.plan_modules pm set included = true
  from public.subscription_plans p, public.modules m
 where pm.plan_id = p.id and pm.module_id = m.id and p.code = 'starter' and m.code = 'suppliers';

create or replace function public.inventory_reverse_movement(p_movement uuid, p_reason text, p_key text) returns jsonb
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
  if coalesce(v_orig.source_type, '') not in ('receipt', 'adjustment', 'issue', 'opening_balance', 'import', 'pharmacy_receipt') then
    raise exception 'this stock movement belongs to a sale, loss, count, return or purchase; undo it there (void the sale or the loss, for example) instead' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if exists (select 1 from public.stock_movements where reversal_of_movement_id = p_movement) then
    raise exception 'movement was already reversed' using errcode = '23505';
  end if;
  m := public._post_movement(v_orig.business_id, v_orig.product_id, v_orig.location_id, 'reversal', -v_orig.quantity_delta,
         v_orig.unit_cost, 'reversal', v_orig.id, v_group, btrim(p_reason), now(), v_orig.id);
  return public._idem_store(v_orig.business_id, p_key, 'reverse', jsonb_build_object('group_id', v_group, 'movement_ids', jsonb_build_array(m.id)));
end $$;

create table public.product_thumbs (
  product_id uuid primary key,
  business_id uuid not null,
  thumb text not null check (length(thumb) <= 30000 and thumb ~ '^data:image/jpeg;base64,'),
  updated_at timestamptz not null default now(),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);
create table public.product_images (
  product_id uuid primary key,
  business_id uuid not null,
  image text not null check (length(image) <= 200000 and image ~ '^data:image/jpeg;base64,'),
  updated_at timestamptz not null default now(),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);
alter table public.product_thumbs enable row level security;
alter table public.product_images enable row level security;
create policy product_thumbs_select on public.product_thumbs for select to authenticated using (public.has_business_permission(business_id, 'inventory.read'));
create policy product_images_select on public.product_images for select to authenticated using (public.has_business_permission(business_id, 'inventory.read'));
grant select on public.product_thumbs, public.product_images to authenticated;

-- Sets or removes a product's picture. Pass null to remove it.
create function public.mart_set_product_image(p_product uuid, p_thumb text, p_image text) returns void
language plpgsql security definer set search_path = '' as $$
declare pr public.products;
begin
  select * into pr from public.products where id = p_product;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(pr.business_id, 'retail-products', 'retail.manage');
  if p_thumb is null or btrim(p_thumb) = '' then
    delete from public.product_thumbs where product_id = p_product; delete from public.product_images where product_id = p_product; return;
  end if;
  if p_thumb !~ '^data:image/jpeg;base64,' or coalesce(p_image, '') !~ '^data:image/jpeg;base64,' then raise exception 'the picture must be a JPEG picture' using errcode = '22023'; end if;
  if length(p_thumb) > 30000 or length(p_image) > 200000 then raise exception 'the picture is too large; use a smaller one' using errcode = '22023'; end if;
  insert into public.product_thumbs (product_id, business_id, thumb) values (p_product, pr.business_id, p_thumb)
    on conflict (product_id) do update set thumb = excluded.thumb, updated_at = now();
  insert into public.product_images (product_id, business_id, image) values (p_product, pr.business_id, p_image)
    on conflict (product_id) do update set image = excluded.image, updated_at = now();
end $$;

revoke execute on function public.mart_set_product_image(uuid, text, text) from public;
grant execute on function public.mart_set_product_image(uuid, text, text) to authenticated;
