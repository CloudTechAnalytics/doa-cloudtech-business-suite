-- The platform Users page lists each person once, with a details page showing every business they belong to.
--
-- * platform_users() also says, per business, whether the person owns it, when they joined and whether the business is archived.
-- * platform_user(p_user) returns one person in the same shape, for the details page.
-- * platform_remove_user_everywhere(p_user, p_reason) takes the person out of every business at once. Their account and everything they
--   recorded stay. Businesses they own are skipped (ownership has to be moved first), and if they own every business they are in, it is refused.

create or replace function public._platform_user_businesses(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('business_id', b.id, 'business', b.name, 'role', ro.name, 'status', m.status, 'joined_at', m.joined_at,
      'is_owner', b.owner_user_id = p_user, 'business_status', b.status) order by b.name), '[]'::jsonb)
  from public.business_members m join public.businesses b on b.id = m.business_id join public.roles ro on ro.id = m.role_id where m.user_id = p_user
$$;
revoke execute on function public._platform_user_businesses(uuid) from public, anon, authenticated;

create or replace function public.platform_users(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select pr.id, pr.display_name as name, u.email, pr.created_at, (to_jsonb(u) ->> 'last_sign_in_at') as last_sign_in, pa.role as platform_role,
      public._platform_user_businesses(pr.id) as businesses
    from public.profiles pr left join auth.users u on u.id = pr.id left join public.platform_admins pa on pa.user_id = pr.id
    where nullif(btrim(coalesce(p_search, '')), '') is null or pr.display_name ilike '%' || btrim(p_search) || '%' or u.email ilike '%' || btrim(p_search) || '%'
    order by pr.created_at desc limit 500) x), '[]'::jsonb);
end $$;

create function public.platform_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public._platform_guard('read');
  select to_jsonb(x) into r from (
    select pr.id, pr.display_name as name, u.email, pr.created_at, (to_jsonb(u) ->> 'last_sign_in_at') as last_sign_in, pa.role as platform_role,
      public._platform_user_businesses(pr.id) as businesses
    from public.profiles pr left join auth.users u on u.id = pr.id left join public.platform_admins pa on pa.user_id = pr.id where pr.id = p_user) x;
  if r is null then raise exception 'user not found' using errcode = '22023'; end if;
  return r;
end $$;

create function public.platform_remove_user_everywhere(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m record; v_removed integer := 0; v_owned text;
begin
  perform public._platform_guard('write');
  perform public._platform_reason(p_reason);
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot remove yourself' using errcode = '42501'; end if;
  select string_agg(b.name, ', ' order by b.name) into v_owned from public.business_members bm join public.businesses b on b.id = bm.business_id
    where bm.user_id = p_user and b.owner_user_id = p_user and b.status <> 'archived' and bm.status <> 'revoked';
  for m in select bm.business_id, bm.status from public.business_members bm join public.businesses b on b.id = bm.business_id
    where bm.user_id = p_user and bm.status <> 'revoked' and b.status <> 'archived' and b.owner_user_id is distinct from p_user for update of bm loop
    update public.business_members set status = 'revoked' where business_id = m.business_id and user_id = p_user;
    perform public._platform_log('member.revoked', m.business_id, jsonb_build_object('user_id', p_user, 'from', m.status, 'to', 'revoked', 'everywhere', true), p_reason);
    v_removed := v_removed + 1;
  end loop;
  if v_removed = 0 and v_owned is not null then
    raise exception 'this person owns %. Transfer the ownership before removing them', v_owned using errcode = '22023';
  end if;
  return jsonb_build_object('removed', v_removed, 'kept_owned', v_owned);
end $$;

revoke execute on function public.platform_user(uuid), public.platform_remove_user_everywhere(uuid, text) from public;
grant execute on function public.platform_user(uuid), public.platform_remove_user_everywhere(uuid, text) to authenticated;
