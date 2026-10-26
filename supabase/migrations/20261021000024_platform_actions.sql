-- More things the platform console can do to a business and its people. Same rules as before: only the platform team, a reason for every
-- change, every change logged in platform_audit_log. Transferring ownership and deleting a business are for platform owners only.

-- Edit a business's details.
create function public.platform_update_business(p_business uuid, p_name text, p_legal_name text, p_timezone text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses; v_name text := btrim(coalesce(p_name, '')); v_legal text := nullif(btrim(coalesce(p_legal_name, '')), ''); v_tz text := btrim(coalesce(p_timezone, ''));
begin
  perform public._platform_guard('write');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'enter the business name (up to 120 characters)' using errcode = '22023'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then raise exception 'unknown time zone' using errcode = '22023'; end if;
  update public.businesses set name = v_name, legal_name = v_legal, timezone = v_tz where id = p_business;
  perform public._platform_log('business.update', p_business, jsonb_build_object('before', jsonb_build_object('name', b.name, 'legal_name', b.legal_name, 'timezone', b.timezone), 'after', jsonb_build_object('name', v_name, 'legal_name', v_legal, 'timezone', v_tz)), p_reason);
end $$;

-- Hand a business to another of its members. The old owner becomes a business admin; the new owner must already be an active member.
create function public.platform_transfer_ownership(p_business uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses; v_new uuid; v_owner_role uuid; v_admin_role uuid;
begin
  perform public._platform_guard('owner');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  select m.user_id into v_new from public.business_members m join auth.users u on u.id = m.user_id
    where m.business_id = p_business and m.status = 'active' and lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_new is null then raise exception 'that person is not an active member of this business; invite them first' using errcode = '22023'; end if;
  if v_new = b.owner_user_id then raise exception 'that person already owns this business' using errcode = '22023'; end if;
  select id into v_owner_role from public.roles where name = 'owner' and business_id is null;
  select id into v_admin_role from public.roles where name = 'business_admin' and business_id is null;
  update public.business_members set role_id = v_admin_role where business_id = p_business and user_id = b.owner_user_id;
  update public.business_members set role_id = v_owner_role where business_id = p_business and user_id = v_new;
  update public.businesses set owner_user_id = v_new where id = p_business;
  perform public._platform_log('business.transfer_ownership', p_business, jsonb_build_object('from', b.owner_user_id, 'to', v_new, 'email', lower(btrim(p_email))), p_reason);
end $$;

-- Stop (or restore, or remove) one person's access to one business. The owner cannot be removed this way: transfer ownership first.
create function public.platform_set_member_status(p_business uuid, p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses; m public.business_members;
begin
  perform public._platform_guard('write');
  perform public._platform_reason(p_reason);
  if p_status not in ('active', 'suspended', 'revoked') then raise exception 'choose active, suspended or revoked' using errcode = '22023'; end if;
  select * into b from public.businesses where id = p_business;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  select * into m from public.business_members where business_id = p_business and user_id = p_user for update;
  if not found then raise exception 'that person is not a member of this business' using errcode = '22023'; end if;
  if p_status <> 'active' and p_user = b.owner_user_id then raise exception 'this person owns the business; transfer ownership before stopping their access' using errcode = '22023'; end if;
  if m.status = p_status then return; end if;
  update public.business_members set status = p_status where business_id = p_business and user_id = p_user;
  perform public._platform_log('member.' || p_status, p_business, jsonb_build_object('user_id', p_user, 'from', m.status, 'to', p_status), p_reason);
end $$;

-- Delete a business the way its owner would: it is archived, nobody can open it, and nothing is erased.
create function public.platform_archive_business(p_business uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses;
begin
  perform public._platform_guard('owner');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  update public.businesses set status = 'archived', archived_at = now() where id = p_business;
  perform public._platform_log('business.archive', p_business, jsonb_build_object('name', b.name, 'from', b.status), p_reason);
end $$;

revoke execute on function public.platform_update_business(uuid, text, text, text, text), public.platform_transfer_ownership(uuid, text, text), public.platform_set_member_status(uuid, uuid, text, text), public.platform_archive_business(uuid, text) from public;
grant execute on function public.platform_update_business(uuid, text, text, text, text), public.platform_transfer_ownership(uuid, text, text), public.platform_set_member_status(uuid, uuid, text, text), public.platform_archive_business(uuid, text) to authenticated;
