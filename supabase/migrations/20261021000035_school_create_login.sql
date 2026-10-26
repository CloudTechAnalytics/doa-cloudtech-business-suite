-- Create a school staff member's login with a temporary password.
-- The principal or an admin chooses a temporary password (the page generates one) and passes it to the person. The person is asked to choose their
-- own at first sign-in (user metadata `must_change_password`). Only for an email address that has no account yet: an existing account is never touched,
-- so this cannot be used to take over or reset someone's sign-in; for those people use the invitation instead.

create function public.school_create_login(p_business uuid, p_staff uuid, p_role text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text; v_email text; v_role public.roles; v_user uuid := gen_random_uuid();
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  select btrim(name), lower(btrim(email)) into v_name, v_email from public.school_staff where id = p_staff and business_id = p_business;
  if not found then raise exception 'staff member not found' using errcode = '22023'; end if;
  if v_email is null or v_email = '' then raise exception 'add the staff member''s email address first; it is how they sign in' using errcode = '22023'; end if;
  if v_email not like '%_@_%' then raise exception 'the email address is not valid' using errcode = '22023'; end if;
  if p_role not in ('teacher', 'bursar', 'admissions_officer', 'principal') then raise exception 'choose teacher, bursar, admissions officer or principal' using errcode = '22023'; end if;
  if p_role = 'principal' and not public.has_business_permission(p_business, 'staff.manage') then raise exception 'only the owner or an admin can give the principal role' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 10 or p_password !~ '[a-z]' or p_password !~ '[A-Z]' or p_password !~ '[0-9]' then
    raise exception 'the temporary password needs at least 10 characters with a lowercase letter, an uppercase letter and a number' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'this email already has an account; send an invitation instead and they sign in with their own password' using errcode = '23505';
  end if;
  select * into v_role from public.roles where name = p_role and business_id is null;
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(), '', '', '', '',
    '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', v_name, 'must_change_password', true), now(), now());
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_user, v_user::text, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  insert into public.business_members (business_id, user_id, role_id, status, invited_by, joined_at) values (p_business, v_user, v_role.id, 'active', auth.uid(), now());
  update public.school_staff set user_id = v_user where id = p_staff and business_id = p_business;
  update public.business_invitations set status = 'revoked' where business_id = p_business and email = v_email and status = 'pending';
  return v_user;
end $$;

revoke execute on function public.school_create_login(uuid, uuid, text, text) from public;
grant execute on function public.school_create_login(uuid, uuid, text, text) to authenticated;
