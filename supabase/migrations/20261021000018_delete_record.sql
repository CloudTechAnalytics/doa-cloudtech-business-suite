-- Deleting records that were never used. A record with history cannot be deleted: the database refuses (a foreign key still points at it),
-- and the person is told to archive it. Every delete is written to the audit log first, and the audit log outlives the record.
-- Stock losses can only be deleted after they were voided (so they no longer affect any figure). Expenses are money records that the
-- database never lets anyone delete (they are voided with a reason), so they are not offered here.
-- Additive. Rollback: drop the function.

create function public.delete_record(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_table text; v_biz uuid; v_row jsonb; v_label text;
begin
  v_table := case p_kind
    when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'product' then 'products' when 'category' then 'product_categories'
    when 'location' then 'inventory_locations' when 'lead' then 'crm_leads' when 'loss' then 'stock_loss_records'
    when 'worker' then 'farm_workers' when 'equipment' then 'farm_assets' when 'task' then 'farm_tasks' end;
  if v_table is null then raise exception 'unknown record type' using errcode = '22023'; end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v_row using p_id;
  if v_row is null then raise exception 'permission denied' using errcode = '42501'; end if;
  v_biz := (v_row ->> 'business_id')::uuid;

  -- who may delete what: the same people who may change it
  if p_kind in ('customer', 'lead') then
    if not public.has_module_permission(v_biz, 'customers', 'customers.manage', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  elsif p_kind = 'supplier' then
    if not public.has_module_permission(v_biz, 'suppliers', 'suppliers.manage', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  elsif p_kind in ('product', 'category', 'location') then
    if not public.has_module_permission(v_biz, 'inventory', 'inventory.adjust', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
    if p_kind = 'product' then
      if exists (select 1 from public.pharmacy_medicine_profiles where product_id = p_id) and not public.has_business_permission(v_biz, 'pharmacy.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
      if exists (select 1 from public.mart_product_profiles where product_id = p_id) and not public.has_business_permission(v_biz, 'retail.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
      if exists (select 1 from public.bakery_product_profiles where product_id = p_id) and not public.has_business_permission(v_biz, 'bakery.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
    end if;
  elsif p_kind = 'loss' then
    perform public._mart_guard(v_biz, 'retail-losses', 'retail.manage');
    if v_row ->> 'status' <> 'voided' then raise exception 'void this entry first; only a voided entry can be deleted' using errcode = '22023'; end if;
  else
    if not public.has_business_permission(v_biz, 'farm.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  end if;

  v_label := coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'description', v_row ->> 'number', v_row ->> 'loss_number');
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_biz, auth.uid(), v_table || '.delete', v_table, p_id, jsonb_strip_nulls(jsonb_build_object('name', v_label)));
  begin
    execute format('delete from public.%I where id = $1', v_table) using p_id;
  exception when foreign_key_violation then
    raise exception '"%" cannot be deleted because it is used by other records. %', coalesce(v_label, 'This record'),
      case when p_kind = 'loss' then 'Keep it voided.' else 'Archive it instead.' end using errcode = '23503';
  end;
end $$;
revoke execute on function public.delete_record(text, uuid) from public;
grant execute on function public.delete_record(text, uuid) to authenticated;
