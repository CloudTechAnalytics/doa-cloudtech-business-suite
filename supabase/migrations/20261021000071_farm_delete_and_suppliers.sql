-- Farm: delete notes, pens/ponds/fields and batches, and switch suppliers and purchase orders on for farms.
--
-- * delete_record() learns three more kinds:
--     farm_note   a note in the farm diary. Nothing depends on it. Its writer or a farm manager may delete it.
--     farm_unit   a pen, pond or field. Refused while a batch was ever kept in it.
--     farm_batch  a flock, fish stock or crop started by mistake: only while nothing but its starting count was ever recorded against it
--                 (deleted records are kept for the log, so they count). A batch with history is closed instead.
--   Every delete is written to the audit log first, as before.
-- * Batch events stay immutable, except the starting count of a batch that is being deleted.
-- * Suppliers and purchase orders are part of a farm's default set (supplier bills need them), and are switched on for existing farms.
-- Additive. Rollback: restore delete_record() and farm_batch_events_immutable() from migration 18 and 6.

create or replace function public.farm_batch_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.event_type = 'opening' and current_setting('farm.deleting_batch', true) = old.farm_batch_id::text then return old; end if;
  raise exception 'batch events are immutable; post a correction' using errcode = '42501';
end $$;

create or replace function public.delete_record(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_table text; v_biz uuid; v_row jsonb; v_label text;
begin
  v_table := case p_kind
    when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'product' then 'products' when 'category' then 'product_categories'
    when 'location' then 'inventory_locations' when 'lead' then 'crm_leads' when 'loss' then 'stock_loss_records'
    when 'worker' then 'farm_workers' when 'equipment' then 'farm_assets' when 'task' then 'farm_tasks'
    when 'farm_note' then 'farm_activity_logs' when 'farm_unit' then 'farm_units' when 'farm_batch' then 'farm_batches' end;
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
  elsif p_kind = 'farm_note' then
    if not (public.has_business_permission(v_biz, 'farm.manage')
      or (public.has_business_permission(v_biz, 'farm.record') and (v_row ->> 'created_by')::uuid = auth.uid())) then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    if not public.has_business_permission(v_biz, 'farm.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  end if;

  v_label := coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'description', v_row ->> 'number', v_row ->> 'loss_number', v_row ->> 'batch_code', v_row ->> 'notes');
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_biz, auth.uid(), v_table || '.delete', v_table, p_id, jsonb_strip_nulls(jsonb_build_object('name', left(v_label, 200), 'record', v_row)));
  begin
    if p_kind = 'farm_batch' then
      if exists (select 1 from public.farm_batch_events where farm_batch_id = p_id and event_type <> 'opening') then
        raise exception '"%" has records against it, so it cannot be deleted. Close it instead', v_label using errcode = '22023';
      end if;
      perform set_config('farm.deleting_batch', p_id::text, true);
      delete from public.farm_batch_events where farm_batch_id = p_id and event_type = 'opening';
      perform set_config('farm.deleting_batch', '', true);
    end if;
    execute format('delete from public.%I where id = $1', v_table) using p_id;
  exception when foreign_key_violation then
    raise exception '"%" cannot be deleted because it is used by other records. %', coalesce(v_label, 'This record'),
      case when p_kind = 'loss' then 'Keep it voided.'
           when p_kind = 'farm_unit' then 'A flock, fish stock or crop was kept in it: delete those first, or archive it.'
           when p_kind = 'farm_batch' then 'It has feeding, harvests, treatments, expenses, tasks or notes recorded against it (deleted ones are kept for the log). Close it instead.'
           else 'Archive it instead.' end using errcode = '23503';
  end;
end $$;

-- Supplier bills come from purchase orders, which come from suppliers: a farm has all three by default.
update public.industry_template_modules itm set is_default = true
from public.industry_templates t, public.modules m
where itm.industry_template_id = t.id and itm.module_id = m.id and t.code = 'farm' and m.code in ('suppliers', 'purchases');

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code = 'farm' and m.code in ('suppliers', 'purchases')
on conflict (business_id, module_id) do nothing;
