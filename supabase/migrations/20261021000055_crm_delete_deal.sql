-- CRM: delete a deal.
--   * Whoever can manage customers can delete a deal. The deal's own stage history, activity log and to-dos go with it; customers and leads are untouched.
--   * A deal with a quote is kept (the quote, and any invoice made from it, refer to it): move it to Lost instead.
--   * The delete is written to the audit log first, and the audit log outlives the deal.
-- Additive. Rollback: drop the function.

create function public.crm_delete_deal(p_deal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.crm_deals;
begin
  select * into d from public.crm_deals where id = p_deal;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.has_module_permission(d.business_id, 'customers', 'customers.manage', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  if exists (select 1 from public.crm_quotes where deal_id = p_deal) then
    raise exception '"%" has quotes, so it cannot be deleted. Move it to Lost instead.', d.title using errcode = '23503';
  end if;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (d.business_id, auth.uid(), 'crm_deals.delete', 'crm_deals', p_deal, jsonb_strip_nulls(jsonb_build_object('name', d.title, 'value', d.value, 'stage', d.stage_kind)));
  delete from public.crm_tasks where deal_id = p_deal;
  delete from public.crm_interactions where deal_id = p_deal;
  delete from public.crm_deals where id = p_deal;
end $$;

revoke execute on function public.crm_delete_deal(uuid) from public;
grant execute on function public.crm_delete_deal(uuid) to authenticated;
