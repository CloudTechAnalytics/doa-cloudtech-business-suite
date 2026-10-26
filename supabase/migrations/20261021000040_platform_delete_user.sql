-- The platform owner can delete a user account for good, the way they can delete a business.
--
-- * The person must type the account's email to confirm, and a reason is kept in the platform log.
-- * Refused for yourself, for anyone on the platform team (remove them from the team first), and for anyone who still owns a business (transfer the
--   ownership or delete the business first).
-- * Their memberships go, tasks assigned to them are unassigned, their school staff and parent links are cleared, and invitations they sent are removed.
-- * If the account has recorded something that must be kept (a sale, a payment, a stock movement), the deletion is refused as a whole and nothing changes:
--   remove them from the business instead, which keeps those records.

create function public.platform_delete_user(p_user uuid, p_confirm_email text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_name text; v_owned text; v_members integer;
begin
  perform public._platform_guard('owner');
  perform public._platform_reason(p_reason);
  select lower(u.email), pr.display_name into v_email, v_name from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot delete your own account' using errcode = '42501'; end if;
  if lower(btrim(coalesce(p_confirm_email, ''))) <> v_email then raise exception 'type the email address exactly to confirm' using errcode = '22023'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then raise exception 'this person is on the platform team; remove them from the team first' using errcode = '22023'; end if;
  select string_agg(b.name, ', ' order by b.name) into v_owned from public.businesses b where b.owner_user_id = p_user;
  if v_owned is not null then raise exception 'this person owns %. Transfer the ownership or delete the business first', v_owned using errcode = '22023'; end if;

  select count(*) into v_members from public.business_members where user_id = p_user;
  begin
    update public.crm_tasks set assigned_to = null where assigned_to = p_user;
    delete from public.user_branch_access where user_id = p_user;
    update public.school_staff set user_id = null where user_id = p_user;
    update public.school_guardians set user_id = null where user_id = p_user;
    update public.business_members set invited_by = null where invited_by = p_user;
    delete from public.business_invitations where invited_by = p_user;
    delete from public.business_invitations where email = v_email;
    delete from public.business_members where user_id = p_user;
    delete from auth.users where id = p_user;
  exception when foreign_key_violation then
    raise exception 'this account has recorded things that must be kept (sales, payments or stock movements), so it cannot be erased. Remove them from their businesses instead' using errcode = '23503';
  end;
  perform public._platform_log('user.delete', null, jsonb_build_object('email', v_email, 'name', v_name, 'memberships_removed', v_members), p_reason);
  return jsonb_build_object('email', v_email, 'memberships_removed', v_members);
end $$;

revoke execute on function public.platform_delete_user(uuid, text, text) from public;
grant execute on function public.platform_delete_user(uuid, text, text) to authenticated;
