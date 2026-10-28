-- The sales tax rate can be changed after a business is created.
-- It was only asked for at setup, so a wrong rate could never be corrected. Owners and admins (settings.manage) can set it; it applies to sales made from then on,
-- never to sales already made. 0 means no tax. The change is kept in the audit trail.

create function public.set_business_tax(p_business uuid, p_rate numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old numeric;
begin
  if not public.has_business_permission(p_business, 'settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then raise exception 'the tax rate must be between 0 and 100' using errcode = '22023'; end if;
  select coalesce((settings ->> 'tax_rate_percent')::numeric, 0) into v_old from public.businesses where id = p_business and status = 'active';
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
  update public.businesses set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{tax_rate_percent}', to_jsonb(round(p_rate, 2))) where id = p_business;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_business, auth.uid(), 'business.tax_rate', 'business', p_business, jsonb_build_object('from', v_old, 'to', round(p_rate, 2)));
end $$;

revoke execute on function public.set_business_tax(uuid, numeric) from public;
grant execute on function public.set_business_tax(uuid, numeric) to authenticated;
