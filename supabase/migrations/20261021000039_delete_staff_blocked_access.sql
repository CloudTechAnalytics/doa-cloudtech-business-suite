-- Deleting staff, and a clear answer for people whose access was suspended.
--
-- * delete_member: the owner or an admin (staff.manage) removes a person from the business entirely, not just suspends or revokes them. The owner and
--   yourself cannot be removed, and only the owner can remove an administrator. Their sign-in account is untouched (it is theirs, and may belong to other
--   businesses); they simply no longer belong here. Tasks assigned to them are unassigned, their school staff record is unlinked, and it is audited.
-- * school_delete_staff: school owners and admins (school.delete) erase a staff record with its class assignments; timetable lessons they taught stay, without
--   a teacher; their access to the school is removed with it. A reason is required and kept in the audit trail.
-- * my_blocked_memberships: lets a person whose access was suspended or revoked be told so ("your access to X is suspended") instead of being sent to
--   create a new business. It returns the caller's own memberships only.
-- * school_staff_access now reports 'suspended' for a staff member whose login is suspended.

create function public.delete_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.business_members; v_role text; v_email text;
begin
  select * into v_m from public.business_members where id = p_member;
  if not found or not public.has_business_permission(v_m.business_id, 'staff.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select name into v_role from public.roles where id = v_m.role_id;
  if v_role = 'owner' or v_m.user_id = auth.uid() then raise exception 'this person cannot be removed' using errcode = '42501'; end if;
  if v_role = 'business_admin' and not exists (select 1 from public.businesses where id = v_m.business_id and owner_user_id = auth.uid()) then
    raise exception 'only the owner can remove an administrator' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = v_m.user_id;
  update public.crm_tasks set assigned_to = null where business_id = v_m.business_id and assigned_to = v_m.user_id;
  delete from public.user_branch_access where business_id = v_m.business_id and user_id = v_m.user_id;
  update public.school_staff set user_id = null where business_id = v_m.business_id and user_id = v_m.user_id;
  update public.school_guardians set user_id = null where business_id = v_m.business_id and user_id = v_m.user_id;
  update public.business_invitations set status = 'revoked' where business_id = v_m.business_id and email = v_email and status = 'pending';
  delete from public.business_members where id = p_member;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_m.business_id, auth.uid(), 'business_member.delete', 'business_member', p_member, jsonb_build_object('email', v_email, 'role', v_role));
end $$;

create function public.school_delete_staff(p_business uuid, p_staff uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_staff; v_m public.business_members; v_role text;
begin
  perform public._school_guard(p_business, 'school-staff', 'school.delete');
  select * into st from public.school_staff where id = p_staff and business_id = p_business;
  if not found then raise exception 'staff member not found' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why (it is kept in the audit trail)' using errcode = '22023'; end if;
  if st.user_id is not null then
    select * into v_m from public.business_members where business_id = p_business and user_id = st.user_id;
    if found then
      select name into v_role from public.roles where id = v_m.role_id;
      if v_role = 'owner' or v_m.user_id = auth.uid() then raise exception 'this person cannot be removed' using errcode = '42501'; end if;
      if v_role = 'business_admin' and not exists (select 1 from public.businesses where id = p_business and owner_user_id = auth.uid()) then
        raise exception 'only the owner can remove an administrator' using errcode = '42501';
      end if;
      perform public.delete_member(v_m.id);
    end if;
  end if;
  update public.business_invitations set status = 'revoked' where business_id = p_business and email = lower(btrim(coalesce(st.email, ''))) and status = 'pending';
  update public.school_timetable set staff_id = null where business_id = p_business and staff_id = p_staff;
  delete from public.school_staff where id = p_staff and business_id = p_business;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_business, auth.uid(), 'school_staff.delete', 'school_staff', p_staff, jsonb_build_object('name', st.name, 'staff_no', st.staff_no, 'reason', btrim(p_reason)));
end $$;

create function public.my_blocked_memberships() returns table (business_id uuid, business_name text, status text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name, m.status from public.business_members m join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid() and m.status in ('suspended', 'revoked') order by b.name
$$;

create or replace function public.school_staff_access(p_business uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  update public.school_staff s set user_id = u.id
    from auth.users u join public.business_members m on m.user_id = u.id and m.business_id = p_business and m.status = 'active'
   where s.business_id = p_business and s.user_id is null and s.email is not null and lower(btrim(s.email)) = lower(u.email)
     and not exists (select 1 from public.school_staff o where o.business_id = p_business and o.user_id = u.id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('staff_id', s.id,
      'state', case when s.user_id is not null and m.status in ('suspended', 'revoked') then 'suspended' when s.user_id is not null then 'signed_in' when i.id is not null then 'invited' else 'none' end,
      'role', coalesce(r_member.name, r_inv.name)))
    from public.school_staff s
    left join public.business_invitations i on i.business_id = s.business_id and i.email = lower(s.email) and i.status = 'pending'
    left join public.roles r_inv on r_inv.id = i.role_id
    left join public.business_members m on m.business_id = s.business_id and m.user_id = s.user_id
    left join public.roles r_member on r_member.id = m.role_id
    where s.business_id = p_business), '[]'::jsonb);
end $$;

revoke execute on function public.delete_member(uuid), public.school_delete_staff(uuid, uuid, text), public.my_blocked_memberships() from public;
grant execute on function public.delete_member(uuid), public.school_delete_staff(uuid, uuid, text), public.my_blocked_memberships() to authenticated;
