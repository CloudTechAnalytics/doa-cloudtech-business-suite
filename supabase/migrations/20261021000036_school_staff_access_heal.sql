-- A staff member whose email already belongs to an active member of the school counts as signed in, even if the link to their record was never made
-- (for example they signed up from an invitation and have not yet opened the school pages). Reading the access list now makes that link, so the
-- Teachers & Staff page tells the truth.

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
      'state', case when s.user_id is not null then 'signed_in' when i.id is not null then 'invited' else 'none' end,
      'role', coalesce(r_member.name, r_inv.name)))
    from public.school_staff s
    left join public.business_invitations i on i.business_id = s.business_id and i.email = lower(s.email) and i.status = 'pending'
    left join public.roles r_inv on r_inv.id = i.role_id
    left join public.business_members m on m.business_id = s.business_id and m.user_id = s.user_id and m.status = 'active'
    left join public.roles r_member on r_member.id = m.role_id
    where s.business_id = p_business), '[]'::jsonb);
end $$;
