-- DOA Calendar: a standalone app (any business, any industry that allows it) for appointments, meetings, deadlines, reminders and team events.
--   * An event has a title, a start and an end (or a whole day), a place, an optional meeting link, a kind, who is invited and a visibility: "business" (everyone who can read
--     the calendar sees it) or "private" (only the person who made it and the people invited).
--   * A repeating event is one row with a rule (daily, weekdays, weekly, monthly, yearly) and an optional last date. The screens work out the occurrences; one occurrence can be
--     skipped without losing the rest (skip_dates). Changing the event changes the whole series.
--   * Writes only go through the functions below (permission, who owns the event and the audit log are checked here); the tables are read-only to the browser.
--   * People invited must be active members of the business, and each can accept, decline or say maybe for themselves.
-- Additive, apart from replacing three platform functions and two checks so the new app is counted like the others. Rollback: drop the objects created here and restore 0050.

insert into public.permissions (code, description) values
  ('calendar.read', 'See the calendar and the events shared with you'),
  ('calendar.manage', 'Create, change and delete calendar events');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('calendar.read', 'calendar.manage')
  and r.name in ('owner', 'business_admin', 'manager', 'accountant', 'cashier', 'inventory_officer', 'operations_staff', 'pharmacist', 'pharmacy_technician') where r.business_id is null;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'calendar.read' and r.name = 'viewer' where r.business_id is null;

insert into public.modules (code, name, description, is_core, required_permission) values
  ('calendar', 'Calendar', 'Appointments, meetings, deadlines and reminders, on your own or with the team.', false, 'calendar.read');

-- Business apps uses it by default; the shared-app industries may switch it on.
insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, t.code = 'general', false
from public.industry_templates t join public.modules m on m.code = 'calendar'
where t.code in ('general', 'retail', 'farm', 'bakery', 'pharmacy')
on conflict do nothing;

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = 'calendar';

-- ------------------------------------------------------------------ tables
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  location text not null default '' check (length(location) <= 300),
  meeting_url text check (meeting_url is null or (meeting_url ~* '^https?://' and length(meeting_url) <= 500)),
  kind text not null default 'meeting' check (kind in ('meeting', 'appointment', 'deadline', 'task', 'reminder', 'other')),
  all_day boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  repeat_until date,
  skip_dates date[] not null default '{}',
  visibility text not null default 'business' check (visibility in ('business', 'private')),
  remind_minutes integer check (remind_minutes is null or remind_minutes between 0 and 10080),
  related_type text check (related_type is null or related_type in ('customer', 'lead', 'deal', 'invoice')),
  related_id uuid,
  related_label text not null default '' check (length(related_label) <= 200),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (ends_at >= starts_at),
  check (repeat = 'none' or repeat_until is null or repeat_until >= (starts_at at time zone 'UTC')::date)
);
create index calendar_events_range_idx on public.calendar_events (business_id, starts_at);
create trigger calendar_events_updated before update on public.calendar_events for each row execute function public.set_updated_at();
create trigger calendar_events_creator before insert on public.calendar_events for each row execute function public.crm_set_creator();

create table public.calendar_attendees (
  business_id uuid not null,
  event_id uuid not null,
  user_id uuid not null,
  response text not null default 'invited' check (response in ('invited', 'accepted', 'declined', 'maybe')),
  primary key (event_id, user_id),
  foreign key (business_id, event_id) references public.calendar_events (business_id, id) on delete cascade,
  foreign key (business_id, user_id) references public.business_members (business_id, user_id)
);
create index calendar_attendees_user_idx on public.calendar_attendees (business_id, user_id);

alter table public.calendar_events enable row level security;
alter table public.calendar_attendees enable row level security;
-- Whether the signed-in person is invited to an event. It reads the invitations without going through their policy (which looks back at the events), so the two policies cannot chase each other.
create function public.calendar_is_invited(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.calendar_attendees a where a.event_id = p_event and a.user_id = auth.uid());
$$;
revoke execute on function public.calendar_is_invited(uuid) from public;
grant execute on function public.calendar_is_invited(uuid) to authenticated;

-- A shared event is visible to everyone who can read the calendar; a private one only to whoever made it and whoever is invited.
create policy calendar_events_select on public.calendar_events for select to authenticated using (
  public.has_module_permission(business_id, 'calendar', 'calendar.read', 'read')
  and (visibility = 'business' or created_by = auth.uid() or public.calendar_is_invited(id)));
create policy calendar_attendees_select on public.calendar_attendees for select to authenticated using (
  exists (select 1 from public.calendar_events e where e.id = calendar_attendees.event_id));
grant select on public.calendar_events, public.calendar_attendees to authenticated;

create trigger audit_calendar_events after insert or update on public.calendar_events for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- functions
-- Whoever made an event may change or delete it, and so may someone who manages the business's settings.
create function public._calendar_can_edit(e public.calendar_events) returns boolean
language sql stable security definer set search_path = '' as $$
  select e.created_by = auth.uid() or public.has_business_permission(e.business_id, 'settings.manage');
$$;

create function public.calendar_save_event(
  p_business uuid, p_id uuid, p_title text, p_description text, p_location text, p_meeting_url text, p_kind text, p_all_day boolean,
  p_starts timestamptz, p_ends timestamptz, p_repeat text, p_repeat_until date, p_visibility text, p_remind integer,
  p_related_type text, p_related_id uuid, p_related_label text, p_attendees uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_old public.calendar_events; v_att uuid[] := coalesce(p_attendees, '{}');
begin
  perform public._guard(p_business, 'calendar', 'calendar.manage');
  if p_starts is null or p_ends is null then raise exception 'choose when the event starts and ends' using errcode = '22023'; end if;
  if p_ends < p_starts then raise exception 'the event cannot end before it starts' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'give the event a title' using errcode = '22023'; end if;
  if p_repeat <> 'none' and p_repeat_until is not null and p_repeat_until < (p_starts at time zone 'UTC')::date then raise exception 'the repeat cannot end before the first event' using errcode = '22023'; end if;
  if cardinality(v_att) > 50 then raise exception 'invite at most 50 people to one event' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_att) u where not exists (select 1 from public.business_members m where m.business_id = p_business and m.user_id = u and m.status = 'active')) then
    raise exception 'you can only invite people who are on this business' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.calendar_events (id, business_id, title, description, location, meeting_url, kind, all_day, starts_at, ends_at, repeat, repeat_until, visibility, remind_minutes, related_type, related_id, related_label)
    values (v_id, p_business, btrim(p_title), coalesce(p_description, ''), coalesce(p_location, ''), nullif(btrim(coalesce(p_meeting_url, '')), ''), p_kind, coalesce(p_all_day, false), p_starts, p_ends, p_repeat, case when p_repeat = 'none' then null else p_repeat_until end,
            p_visibility, p_remind, p_related_type, p_related_id, coalesce(p_related_label, ''));
  else
    select * into v_old from public.calendar_events where id = p_id and business_id = p_business for update;
    if not found then raise exception 'event not found' using errcode = '22023'; end if;
    if not public._calendar_can_edit(v_old) then raise exception 'only the person who made this event can change it' using errcode = '42501'; end if;
    update public.calendar_events set title = btrim(p_title), description = coalesce(p_description, ''), location = coalesce(p_location, ''), meeting_url = nullif(btrim(coalesce(p_meeting_url, '')), ''),
      kind = p_kind, all_day = coalesce(p_all_day, false), starts_at = p_starts, ends_at = p_ends, repeat = p_repeat, repeat_until = case when p_repeat = 'none' then null else p_repeat_until end,
      skip_dates = case when p_repeat = 'none' then '{}' else skip_dates end, visibility = p_visibility, remind_minutes = p_remind, related_type = p_related_type, related_id = p_related_id, related_label = coalesce(p_related_label, '')
     where id = p_id;
  end if;
  -- The invited people: keep the answers of those who stay, add the new ones, drop the rest.
  delete from public.calendar_attendees where event_id = v_id and user_id <> all (v_att);
  insert into public.calendar_attendees (business_id, event_id, user_id) select p_business, v_id, u from unnest(v_att) u on conflict do nothing;
  return v_id;
end $$;

create function public.calendar_delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.calendar_events;
begin
  select * into e from public.calendar_events where id = p_event;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._guard(e.business_id, 'calendar', 'calendar.manage');
  if not public._calendar_can_edit(e) then raise exception 'only the person who made this event can delete it' using errcode = '42501'; end if;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (e.business_id, auth.uid(), 'calendar_events.delete', 'calendar_events', e.id, jsonb_strip_nulls(jsonb_build_object('name', e.title)));
  delete from public.calendar_events where id = p_event;
end $$;

-- Takes one day out of a repeating event, leaving every other day as it was.
create function public.calendar_skip_occurrence(p_event uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.calendar_events;
begin
  select * into e from public.calendar_events where id = p_event for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._guard(e.business_id, 'calendar', 'calendar.manage');
  if not public._calendar_can_edit(e) then raise exception 'only the person who made this event can change it' using errcode = '42501'; end if;
  if e.repeat = 'none' then raise exception 'this event does not repeat; delete it instead' using errcode = '22023'; end if;
  if p_date is null then raise exception 'choose the day to skip' using errcode = '22023'; end if;
  update public.calendar_events set skip_dates = array(select distinct d from unnest(skip_dates || p_date) d order by d) where id = p_event;
end $$;

-- An invited person answers for themselves.
create function public.calendar_respond(p_event uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.calendar_events;
begin
  select * into e from public.calendar_events where id = p_event;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.has_module_permission(e.business_id, 'calendar', 'calendar.read', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_response not in ('accepted', 'declined', 'maybe') then raise exception 'answer accepted, declined or maybe' using errcode = '22023'; end if;
  update public.calendar_attendees set response = p_response where event_id = p_event and user_id = auth.uid();
  if not found then raise exception 'you were not invited to this event' using errcode = '22023'; end if;
end $$;

revoke execute on function public._calendar_can_edit(public.calendar_events),
  public.calendar_save_event(uuid, uuid, text, text, text, text, text, boolean, timestamptz, timestamptz, text, date, text, integer, text, uuid, text, uuid[]),
  public.calendar_delete_event(uuid), public.calendar_skip_occurrence(uuid, date), public.calendar_respond(uuid, text) from public;
grant execute on function
  public.calendar_save_event(uuid, uuid, text, text, text, text, text, boolean, timestamptz, timestamptz, text, date, text, integer, text, uuid, text, uuid[]),
  public.calendar_delete_event(uuid), public.calendar_skip_occurrence(uuid, date), public.calendar_respond(uuid, text) to authenticated;

-- --------------------------------------------- counted like the other apps
alter table public.app_modules drop constraint app_modules_app_check;
alter table public.app_modules add constraint app_modules_app_check check (app in ('crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance', 'calendar'));
alter table public.businesses drop constraint businesses_started_with_app_check;
alter table public.businesses add constraint businesses_started_with_app_check check (started_with_app in ('crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance', 'calendar'));
insert into public.app_modules (app, module) values ('calendar', 'calendar');

create or replace function public._business_apps(p_business uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.app order by array_position(array['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance', 'calendar'], a.app)), '{}'::text[]) from (
    select am.app from public.app_modules am
     group by am.app
    having bool_and(exists (select 1 from public.business_modules bm join public.modules m on m.id = bm.module_id
                             where bm.business_id = p_business and bm.status = 'enabled' and m.code = am.module))) a;
$$;

create or replace function public._app_activity(p_business uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'crm', (select jsonb_build_object('records', c.n + l.n + d.n + q.n, 'last_at', nullif(greatest(c.t, l.t, d.t, q.t), '-infinity'::timestamptz)) from
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.customers where business_id = p_business) c,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_leads where business_id = p_business) l,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_deals where business_id = p_business) d,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_quotes where business_id = p_business) q),
    'pos', (select jsonb_build_object('records', count(*), 'last_at', max(sold_at)) from public.sales where business_id = p_business),
    'inventory', (select jsonb_build_object('records', count(*), 'last_at', max(occurred_at)) from public.stock_movements where business_id = p_business),
    'invoices', (select jsonb_build_object('records', count(*), 'last_at', max(created_at)) from public.invoices where business_id = p_business),
    'expenses', (select jsonb_build_object('records', count(*), 'last_at', max(created_at)) from public.expenses where business_id = p_business),
    'finance', jsonb_build_object('records', 0, 'last_at', null),
    'calendar', (select jsonb_build_object('records', count(*), 'last_at', max(created_at)) from public.calendar_events where business_id = p_business));
$$;

create or replace function public.platform_app_adoption() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('app', x.app, 'workspaces', coalesce(s.using_now, 0), 'started', coalesce(s.started, 0), 'grew', coalesce(s.grew, 0), 'active_30d', coalesce(s.active, 0)) order by x.o)
    from (values ('crm', 1), ('pos', 2), ('inventory', 3), ('invoices', 4), ('expenses', 5), ('finance', 6), ('calendar', 7)) as x (app, o)
    left join lateral (
      select count(*) filter (where x.app = any (w.apps)) as using_now,
             count(*) filter (where w.started_with_app = x.app) as started,
             count(*) filter (where w.started_with_app = x.app and cardinality(w.apps) > 1) as grew,
             count(*) filter (where x.app = any (w.apps) and (w.act -> x.app ->> 'last_at')::timestamptz >= now() - interval '30 days') as active
        from (select b.started_with_app, public._business_apps(b.id) as apps, public._app_activity(b.id) as act
                from public.businesses b where b.primary_industry_code = 'general' and b.status <> 'archived') w) s on true), '[]'::jsonb);
end $$;
