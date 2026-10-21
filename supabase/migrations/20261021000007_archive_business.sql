-- Deleting a business archives it: its records (ledgers, audit trail) are kept, but nobody can open it any more.
-- is_active_member and has_business_permission already require businesses.status = 'active', so archiving
-- hides the business and blocks every table guarded by RLS or the SECURITY DEFINER functions.

create function public.archive_business(p_business uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_business public.businesses;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_business from public.businesses where id = p_business and status = 'active';
  -- Same answer for "missing" and "not yours" so ids cannot be probed.
  if not found or v_business.owner_user_id <> auth.uid() then
    raise exception 'only the owner can delete a business' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> v_business.name then
    raise exception 'type the business name exactly to confirm' using errcode = '22023';
  end if;
  update public.businesses set status = 'archived', archived_at = now() where id = p_business;
end $$;

revoke all on function public.archive_business(uuid, text) from public;
grant execute on function public.archive_business(uuid, text) to authenticated;
