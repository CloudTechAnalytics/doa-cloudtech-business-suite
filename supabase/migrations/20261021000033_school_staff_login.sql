-- School staff and sign-in access.
-- A staff record is a person who works at the school; most need no login (cleaners, drivers, security). Giving someone a login is a separate, optional
-- step: the school invites their email address with a school role, and the person sets their OWN password when they first sign up. Nobody else ever
-- sees or chooses a password. When they sign in, the invitation is accepted and their staff record is linked by email (school_claim_links).

create function public.school_give_login(p_business uuid, p_staff uuid, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text; v_role public.roles; v_id uuid; v_user uuid;
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  select lower(btrim(email)) into v_email from public.school_staff where id = p_staff and business_id = p_business;
  if not found then raise exception 'staff member not found' using errcode = '22023'; end if;
  if v_email is null or v_email = '' then raise exception 'add the staff member''s email address first; it is how they sign in' using errcode = '22023'; end if;
  if v_email not like '%_@_%' then raise exception 'the email address is not valid' using errcode = '22023'; end if;
  if p_role not in ('teacher', 'bursar', 'admissions_officer', 'principal') then raise exception 'choose teacher, bursar, admissions officer or principal' using errcode = '22023'; end if;
  if p_role = 'principal' and not public.has_business_permission(p_business, 'staff.manage') then raise exception 'only the owner or an admin can give the principal role' using errcode = '42501'; end if;
  select * into v_role from public.roles where name = p_role and business_id is null;
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null and exists (select 1 from public.business_members m where m.business_id = p_business and m.user_id = v_user and m.status = 'active') then
    raise exception 'this person already has a login for the school' using errcode = '23505';
  end if;

  update public.business_invitations set status = 'revoked' where business_id = p_business and email = v_email and status = 'pending';
  insert into public.business_invitations (business_id, email, role_id, invited_by) values (p_business, v_email, v_role.id, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.school_cancel_login(p_business uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  select lower(btrim(email)) into v_email from public.school_staff where id = p_staff and business_id = p_business;
  if not found then raise exception 'staff member not found' using errcode = '22023'; end if;
  update public.business_invitations set status = 'revoked' where business_id = p_business and email = v_email and status = 'pending';
end $$;

-- Per staff member: 'signed_in' (their login is linked), 'invited' (waiting for them to sign up) or 'none' (a record only), with the role.
create function public.school_staff_access(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('staff_id', s.id,
      'state', case when s.user_id is not null then 'signed_in' when i.id is not null then 'invited' else 'none' end,
      'role', coalesce(r_member.name, r_inv.name)))
    from public.school_staff s
    left join public.business_invitations i on i.business_id = s.business_id and i.email = lower(s.email) and i.status = 'pending'
    left join public.roles r_inv on r_inv.id = i.role_id
    left join public.business_members m on m.business_id = s.business_id and m.user_id = s.user_id and m.status = 'active'
    left join public.roles r_member on r_member.id = m.role_id
    where s.business_id = p_business), '[]'::jsonb);
end $$;

revoke execute on function public.school_give_login(uuid, uuid, text), public.school_cancel_login(uuid, uuid), public.school_staff_access(uuid) from public;
grant execute on function public.school_give_login(uuid, uuid, text), public.school_cancel_login(uuid, uuid), public.school_staff_access(uuid) to authenticated;
