-- Prompt 2: identity, multi-business ownership, memberships, roles, permissions, branches.
-- Security model: RLS on every table; no direct writes to membership/ownership tables;
-- sensitive changes go through SECURITY DEFINER functions with fixed search_path.

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end $$;
revoke all on function public.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------- permissions, roles
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default ''
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  legal_name text,
  slug text unique,
  primary_industry_code text not null check (primary_industry_code in ('retail', 'farm', 'bakery', 'pharmacy')),
  country_code text not null default 'NG' check (length(country_code) = 2),
  default_currency text not null default 'NGN' check (length(default_currency) = 3),
  timezone text not null default 'Africa/Lagos',
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index businesses_owner_idx on public.businesses (owner_user_id);
create trigger businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  name text not null,
  description text not null default '',
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  check (is_system_role = (business_id is null))
);
create unique index roles_system_name_uq on public.roles (name) where business_id is null;
create unique index roles_business_name_uq on public.roles (business_id, name) where business_id is not null;

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ------------------------------------------------------------- members
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid references public.profiles (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id) where status = 'active';
create trigger business_members_updated before update on public.business_members
  for each row execute function public.set_updated_at();

-- A member's role must be a system role or belong to the same business.
create function public.enforce_member_role_scope() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.roles r
    where r.id = new.role_id and (r.business_id is null or r.business_id = new.business_id)
  ) then
    raise exception 'role does not belong to this business';
  end if;
  return new;
end $$;
create trigger business_members_role_scope before insert or update of role_id, business_id
  on public.business_members for each row execute function public.enforce_member_role_scope();

-- -------------------------------------------------------------- branches
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  code text not null,
  address text,
  timezone text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id)
);
create trigger branches_updated before update on public.branches
  for each row execute function public.set_updated_at();

-- Only used when a user is restricted to specific branches.
-- Composite FKs make cross-business assignment impossible.
create table public.user_branch_access (
  business_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (business_id, branch_id, user_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade,
  foreign key (business_id, user_id) references public.business_members (business_id, user_id) on delete cascade
);

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role_id uuid not null references public.roles (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index business_invitations_pending_uq
  on public.business_invitations (business_id, email) where status = 'pending';
create index business_invitations_email_idx on public.business_invitations (email) where status = 'pending';

-- --------------------------------------------------- authorisation helpers
create function public.is_active_member(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    where m.business_id = p_business and m.user_id = auth.uid()
      and m.status = 'active' and b.status = 'active'
  );
$$;

create function public.has_business_permission(p_business uuid, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    join public.role_permissions rp on rp.role_id = m.role_id
    join public.permissions p on p.id = rp.permission_id
    where m.business_id = p_business and m.user_id = auth.uid()
      and m.status = 'active' and b.status = 'active' and p.code = p_code
  );
$$;

-- True when the user has no branch restrictions in the business, or is assigned to the branch.
create function public.can_access_branch(p_business uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_member(p_business) and (
    p_branch is null
    or not exists (select 1 from public.user_branch_access a where a.business_id = p_business and a.user_id = auth.uid())
    or exists (select 1 from public.user_branch_access a
               where a.business_id = p_business and a.branch_id = p_branch and a.user_id = auth.uid())
  );
$$;

create function public.shares_business_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members me
    join public.business_members other on other.business_id = me.business_id
    where me.user_id = auth.uid() and me.status = 'active'
      and other.user_id = p_user and other.status = 'active'
  );
$$;

revoke all on function public.is_active_member(uuid), public.has_business_permission(uuid, text),
  public.can_access_branch(uuid, uuid), public.shares_business_with(uuid) from public;
grant execute on function public.is_active_member(uuid), public.has_business_permission(uuid, text),
  public.can_access_branch(uuid, uuid), public.shares_business_with(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.businesses enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.business_members enable row level security;
alter table public.branches enable row level security;
alter table public.user_branch_access enable row level security;
alter table public.business_invitations enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_business_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated
  using (business_id is null or public.is_active_member(business_id));

create policy businesses_select on public.businesses for select to authenticated
  using (public.is_active_member(id));
create policy businesses_update on public.businesses for update to authenticated
  using (public.has_business_permission(id, 'settings.manage'))
  with check (public.has_business_permission(id, 'settings.manage'));

create policy members_select on public.business_members for select to authenticated
  using (user_id = auth.uid() or public.has_business_permission(business_id, 'staff.read'));

create policy branches_select on public.branches for select to authenticated
  using (public.can_access_branch(business_id, id));
create policy branches_insert on public.branches for insert to authenticated
  with check (public.has_business_permission(business_id, 'settings.manage'));
create policy branches_update on public.branches for update to authenticated
  using (public.has_business_permission(business_id, 'settings.manage'))
  with check (public.has_business_permission(business_id, 'settings.manage'));

create policy branch_access_select on public.user_branch_access for select to authenticated
  using (user_id = auth.uid() or public.has_business_permission(business_id, 'staff.read'));
create policy branch_access_insert on public.user_branch_access for insert to authenticated
  with check (public.has_business_permission(business_id, 'staff.manage'));
create policy branch_access_delete on public.user_branch_access for delete to authenticated
  using (public.has_business_permission(business_id, 'staff.manage'));

create policy invitations_select on public.business_invitations for select to authenticated
  using (public.has_business_permission(business_id, 'staff.manage'));

-- Least privilege: RLS is the filter, grants are the outer wall.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.permissions, public.role_permissions, public.roles,
  public.businesses, public.business_members, public.branches, public.user_branch_access,
  public.business_invitations to authenticated;
grant update (display_name, phone, avatar_path) on public.profiles to authenticated;
grant update (name, legal_name, timezone, settings) on public.businesses to authenticated;
grant insert (business_id, name, code, address, timezone) on public.branches to authenticated;
grant update (name, code, address, timezone, status) on public.branches to authenticated;
grant insert (business_id, branch_id, user_id), delete on public.user_branch_access to authenticated;

-- ----------------------------------------------------- reference data
insert into public.permissions (code, description) values
  ('dashboard.read', 'View dashboard'),
  ('settings.read', 'View business settings'),
  ('settings.manage', 'Change business settings and branches'),
  ('staff.read', 'View staff and invitations'),
  ('staff.manage', 'Invite, suspend and change staff roles'),
  ('inventory.read', 'View inventory'),
  ('inventory.adjust', 'Adjust and count stock'),
  ('sales.read', 'View sales'),
  ('sales.create', 'Create sales'),
  ('sales.refund', 'Refund sales'),
  ('purchases.read', 'View purchases'),
  ('suppliers.read', 'View suppliers'),
  ('customers.read', 'View customers'),
  ('expenses.read', 'View expenses'),
  ('expenses.approve', 'Approve expenses'),
  ('reports.read', 'View operational reports'),
  ('reports.finance.read', 'View financial reports'),
  ('farm.read', 'View farm records'),
  ('farm.record', 'Record farm activity'),
  ('bakery.read', 'View bakery records'),
  ('bakery.record', 'Record bakery production');

insert into public.roles (name, description, is_system_role) values
  ('owner', 'Full control of the business', true),
  ('business_admin', 'Administers the business and its staff', true),
  ('manager', 'Runs daily operations', true),
  ('accountant', 'Finance and purchasing review', true),
  ('cashier', 'Records sales', true),
  ('inventory_officer', 'Manages stock', true),
  ('operations_staff', 'Records farm and production activity', true),
  ('viewer', 'Read-only access', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  r.name in ('owner', 'business_admin')
  or (r.name = 'manager' and p.code not in ('staff.manage', 'settings.manage'))
  or (r.name = 'accountant' and p.code in ('dashboard.read', 'expenses.read', 'expenses.approve', 'reports.read',
        'reports.finance.read', 'purchases.read', 'suppliers.read', 'sales.read', 'inventory.read'))
  or (r.name = 'cashier' and p.code in ('dashboard.read', 'sales.read', 'sales.create', 'customers.read', 'inventory.read'))
  or (r.name = 'inventory_officer' and p.code in ('dashboard.read', 'inventory.read', 'inventory.adjust', 'purchases.read', 'suppliers.read'))
  or (r.name = 'operations_staff' and p.code in ('dashboard.read', 'farm.read', 'farm.record', 'bakery.read', 'bakery.record', 'inventory.read'))
  or (r.name = 'viewer' and p.code like '%.read' and p.code not in ('staff.read', 'settings.read', 'reports.finance.read'))
) where r.business_id is null;

-- ------------------------------------------------ sensitive operations
create function public.create_business(
  p_name text, p_industry text, p_country text default 'NG',
  p_currency text default 'NGN', p_timezone text default 'Africa/Lagos'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_business uuid;
  v_owner_role uuid;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_industry not in ('retail', 'farm', 'bakery') then
    raise exception 'industry % is not available', p_industry using errcode = '22023';
  end if;
  select id into v_owner_role from public.roles where name = 'owner' and business_id is null;

  insert into public.businesses (owner_user_id, name, primary_industry_code, country_code, default_currency, timezone)
  values (v_user, btrim(p_name), p_industry, upper(p_country), upper(p_currency), p_timezone)
  returning id into v_business;

  insert into public.business_members (business_id, user_id, role_id, status, joined_at)
  values (v_business, v_user, v_owner_role, 'active', now());

  insert into public.branches (business_id, name, code) values (v_business, 'Main', 'MAIN');
  return v_business;
end $$;

create function public.invite_member(p_business uuid, p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_id uuid;
begin
  if not public.has_business_permission(p_business, 'staff.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_role from public.roles
   where name = p_role and (business_id is null or business_id = p_business);
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;
  if v_role.name = 'owner' then raise exception 'owner role cannot be assigned' using errcode = '42501'; end if;
  if v_role.name = 'business_admin' and not exists (
    select 1 from public.businesses where id = p_business and owner_user_id = auth.uid()
  ) then
    raise exception 'only the owner can assign business_admin' using errcode = '42501';
  end if;

  insert into public.business_invitations (business_id, email, role_id, invited_by)
  values (p_business, lower(btrim(p_email)), v_role.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_business uuid;
begin
  select business_id into v_business from public.business_invitations where id = p_invitation;
  if v_business is null or not public.has_business_permission(v_business, 'staff.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.business_invitations set status = 'revoked' where id = p_invitation and status = 'pending';
end $$;

-- Accepts pending invitations addressed to the caller's CONFIRMED email.
create function public.accept_my_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_inv public.business_invitations;
  v_owner_role uuid;
  v_count integer := 0;
begin
  select lower(email) into v_email from auth.users
   where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  select id into v_owner_role from public.roles where name = 'owner' and business_id is null;

  for v_inv in
    select * from public.business_invitations where email = v_email and status = 'pending' for update
  loop
    insert into public.business_members (business_id, user_id, role_id, status, invited_by, joined_at)
    values (v_inv.business_id, auth.uid(), v_inv.role_id, 'active', v_inv.invited_by, now())
    on conflict (business_id, user_id) do update
      set role_id = excluded.role_id, status = 'active', joined_at = now()
      where public.business_members.role_id <> v_owner_role;
    update public.business_invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.set_member_status(p_member uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.business_members; v_role_name text;
begin
  if p_status not in ('active', 'suspended', 'revoked') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_m from public.business_members where id = p_member;
  if not found or not public.has_business_permission(v_m.business_id, 'staff.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select name into v_role_name from public.roles where id = v_m.role_id;
  if v_role_name = 'owner' or v_m.user_id = auth.uid() then
    raise exception 'this membership cannot be changed' using errcode = '42501';
  end if;
  if v_role_name = 'business_admin' and not exists (
    select 1 from public.businesses where id = v_m.business_id and owner_user_id = auth.uid()
  ) then
    raise exception 'only the owner can change an administrator' using errcode = '42501';
  end if;
  update public.business_members set status = p_status where id = p_member;
end $$;

create function public.set_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.business_members; v_cur text; v_new public.roles; v_is_owner boolean;
begin
  select * into v_m from public.business_members where id = p_member;
  if not found or not public.has_business_permission(v_m.business_id, 'staff.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select name into v_cur from public.roles where id = v_m.role_id;
  select * into v_new from public.roles
   where name = p_role and (business_id is null or business_id = v_m.business_id);
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;
  select owner_user_id = auth.uid() into v_is_owner from public.businesses where id = v_m.business_id;
  if v_cur = 'owner' or v_new.name = 'owner' or v_m.user_id = auth.uid() then
    raise exception 'this membership cannot be changed' using errcode = '42501';
  end if;
  if (v_cur = 'business_admin' or v_new.name = 'business_admin') and not v_is_owner then
    raise exception 'only the owner can assign or change administrators' using errcode = '42501';
  end if;
  update public.business_members set role_id = v_new.id where id = p_member;
end $$;

revoke all on function public.create_business(text, text, text, text, text), public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.accept_my_invitations(),
  public.set_member_status(uuid, text), public.set_member_role(uuid, text) from public;
grant execute on function public.create_business(text, text, text, text, text), public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.accept_my_invitations(),
  public.set_member_status(uuid, text), public.set_member_role(uuid, text) to authenticated;
