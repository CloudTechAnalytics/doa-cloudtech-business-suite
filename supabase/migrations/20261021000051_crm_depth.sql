-- CRM depth, informed by what Zoho, Odoo, Dynamics 365 and HubSpot all do: editable pipeline stages with a win probability (so the pipeline has a weighted forecast), deal
-- owners, activities (calls, meetings, emails, tasks) that can sit on a deal, lead rating and owner, a safe contact import, and a report that shows the funnel, the
-- forecast by month, results by owner and by lead source, and deals that have gone quiet.
--   * Stages are per business and editable (name, order, probability). "Won" and "Lost" are always there, last, and cannot be removed. A stage with deals in it cannot
--     be deleted. Existing deals keep their stage: the six fixed stages become each business's starting stages.
--   * Activities: crm_tasks gains a kind (to do, call, meeting, email), a deal link and an outcome; interactions gain a deal link. Everything is still business-scoped.
--   * Import (crm_import) takes up to 500 rows, skips duplicates by email or phone (against what exists and inside the file), and is all or nothing, so a plan limit
--     or a bad row never leaves half a file imported.
-- Replaces crm_save_deal, crm_move_deal (now takes a stage id) and crm_report (existing keys kept, keys added). Rollback: restore those from 0046 and drop what is added.

-- ------------------------------------------------------------------- stages
create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  position integer not null,
  probability integer not null default 0 check (probability between 0 and 100),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  unique (business_id, id)
);
create unique index crm_stages_name_uq on public.crm_stages (business_id, lower(name));
create unique index crm_stages_kind_uq on public.crm_stages (business_id, kind) where kind <> 'open';
alter table public.crm_stages enable row level security;
create policy crm_stages_select on public.crm_stages for select to authenticated using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'));
grant select on public.crm_stages to authenticated;

create function public._crm_ensure_stages(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.crm_stages where business_id = p_business) then return; end if;
  insert into public.crm_stages (business_id, name, position, probability, kind) values
    (p_business, 'New', 1, 10, 'open'), (p_business, 'Qualified', 2, 25, 'open'), (p_business, 'Proposal', 3, 50, 'open'),
    (p_business, 'Negotiation', 4, 75, 'open'), (p_business, 'Won', 1000, 100, 'won'), (p_business, 'Lost', 1001, 0, 'lost');
end $$;

-- Deals move to a stage row instead of a fixed word. Existing deals keep the stage they are in.
alter table public.crm_deals add column stage_id uuid, add column stage_kind text;
do $$
declare b uuid;
begin
  for b in select distinct business_id from public.crm_deals loop perform public._crm_ensure_stages(b); end loop;
end $$;
update public.crm_deals d set stage_id = s.id, stage_kind = s.kind from public.crm_stages s where s.business_id = d.business_id and lower(s.name) = d.stage;
alter table public.crm_deals drop column stage; -- takes its checks and index with it
alter table public.crm_deals alter column stage_id set not null, alter column stage_kind set not null;
alter table public.crm_deals add foreign key (business_id, stage_id) references public.crm_stages (business_id, id);
alter table public.crm_deals add check (stage_kind in ('open', 'won', 'lost'));
alter table public.crm_deals add check (stage_kind <> 'lost' or lost_reason is not null);
alter table public.crm_deals add check ((stage_kind in ('won', 'lost')) = (closed_at is not null));
create index crm_deals_stage_idx on public.crm_deals (business_id, stage_id);
alter table public.crm_deals add column next_step text not null default '';
alter table public.crm_deals add column last_moved_at timestamptz not null default now();

-- ------------------------------------------------------- activities and leads
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.crm_tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%customer_id IS NOT NULL%' loop
    execute format('alter table public.crm_tasks drop constraint %I', c);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.crm_interactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%customer_id IS NOT NULL%' loop
    execute format('alter table public.crm_interactions drop constraint %I', c);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.crm_interactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.crm_interactions drop constraint %I', c);
  end loop;
end $$;
alter table public.crm_tasks add column kind text not null default 'todo' check (kind in ('todo', 'call', 'meeting', 'email')), add column deal_id uuid, add column outcome text;
alter table public.crm_tasks add foreign key (business_id, deal_id) references public.crm_deals (business_id, id);
alter table public.crm_tasks add check (customer_id is not null or lead_id is not null or deal_id is not null);
alter table public.crm_interactions add column deal_id uuid;
alter table public.crm_interactions add foreign key (business_id, deal_id) references public.crm_deals (business_id, id);
alter table public.crm_interactions add check (customer_id is not null or lead_id is not null or deal_id is not null);
alter table public.crm_interactions add check (kind in ('note', 'call', 'visit', 'message', 'meeting', 'email', 'other'));
create index crm_tasks_deal_idx on public.crm_tasks (business_id, deal_id) where deal_id is not null;
create index crm_interactions_deal_idx on public.crm_interactions (business_id, deal_id) where deal_id is not null;
grant insert (deal_id, kind) on public.crm_tasks to authenticated;
grant update (kind, outcome) on public.crm_tasks to authenticated;
grant insert (deal_id) on public.crm_interactions to authenticated;

alter table public.crm_leads add column rating text check (rating in ('hot', 'warm', 'cold')), add column owner_id uuid;
alter table public.crm_leads add foreign key (business_id, owner_id) references public.business_members (business_id, user_id);
grant insert (rating, owner_id) on public.crm_leads to authenticated;
grant update (rating, owner_id) on public.crm_leads to authenticated;

-- ---------------------------------------------------------- stage functions
create function public.crm_list_stages(p_business uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, 'customers', 'customers.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._crm_ensure_stages(p_business);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'probability', s.probability, 'kind', s.kind,
            'deals', (select count(*) from public.crm_deals d where d.stage_id = s.id)) order by s.position), '[]'::jsonb) from public.crm_stages s where s.business_id = p_business);
end $$;

create function public.crm_save_stage(p_business uuid, p_id uuid, p_name text, p_probability integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); s public.crm_stages; v_pos integer;
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  perform public._crm_ensure_stages(p_business);
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter a name for the stage' using errcode = '22023'; end if;
  if length(btrim(p_name)) > 40 then raise exception 'the stage name is too long' using errcode = '22023'; end if;
  if p_probability is null or p_probability < 0 or p_probability > 100 then raise exception 'the chance of winning must be between 0 and 100' using errcode = '22023'; end if;
  if p_id is null then
    select coalesce(max(position), 0) + 1 into v_pos from public.crm_stages where business_id = p_business and kind = 'open';
    insert into public.crm_stages (id, business_id, name, position, probability, kind) values (v_id, p_business, btrim(p_name), v_pos, p_probability, 'open');
  else
    select * into s from public.crm_stages where id = p_id and business_id = p_business for update;
    if not found then raise exception 'stage not found' using errcode = '22023'; end if;
    -- Won is always 100 and Lost always 0: only the name can change
    update public.crm_stages set name = btrim(p_name), probability = case s.kind when 'won' then 100 when 'lost' then 0 else p_probability end where id = p_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'there is already a stage with this name' using errcode = '23505';
end $$;

create function public.crm_reorder_stages(p_business uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_open integer; i integer;
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  select count(*) into v_open from public.crm_stages where business_id = p_business and kind = 'open';
  if coalesce(array_length(p_ids, 1), 0) <> v_open or (select count(distinct x) from unnest(p_ids) x) <> v_open
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.crm_stages where id = x and business_id = p_business and kind = 'open')) then
    raise exception 'list every open stage once, in the order you want' using errcode = '22023';
  end if;
  for i in 1 .. v_open loop update public.crm_stages set position = i where id = p_ids[i]; end loop;
end $$;

create function public.crm_delete_stage(p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.crm_stages;
begin
  select * into s from public.crm_stages where id = p_stage;
  if not found then raise exception 'stage not found' using errcode = '22023'; end if;
  perform public._guard(s.business_id, 'customers', 'customers.manage');
  if s.kind <> 'open' then raise exception 'Won and Lost are always part of the pipeline' using errcode = '22023'; end if;
  if exists (select 1 from public.crm_deals where stage_id = p_stage) then raise exception 'move the deals out of this stage before removing it' using errcode = '22023'; end if;
  if (select count(*) from public.crm_stages where business_id = s.business_id and kind = 'open') <= 1 then raise exception 'a pipeline needs at least one open stage' using errcode = '22023'; end if;
  delete from public.crm_stages where id = p_stage;
end $$;

-- ------------------------------------------------------------ deal functions
drop function public.crm_move_deal(uuid, text, text);
create or replace function public.crm_save_deal(p_business uuid, p_id uuid, p_title text, p_customer uuid, p_lead uuid, p_value numeric, p_expected date, p_owner uuid, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_first public.crm_stages;
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  perform public._crm_ensure_stages(p_business);
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'enter what the deal is for' using errcode = '22023'; end if;
  if p_customer is null and p_lead is null then raise exception 'choose the customer or lead this deal is with' using errcode = '22023'; end if;
  if coalesce(p_value, 0) < 0 then raise exception 'the deal value cannot be negative' using errcode = '22023'; end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and business_id = p_business) then raise exception 'customer not found' using errcode = '22023'; end if;
  if p_lead is not null and not exists (select 1 from public.crm_leads where id = p_lead and business_id = p_business) then raise exception 'lead not found' using errcode = '22023'; end if;
  if p_owner is not null and not exists (select 1 from public.business_members where business_id = p_business and user_id = p_owner and status = 'active') then raise exception 'that person is not on this business' using errcode = '22023'; end if;
  if p_id is null then
    select * into v_first from public.crm_stages where business_id = p_business and kind = 'open' order by position limit 1;
    insert into public.crm_deals (id, business_id, title, customer_id, lead_id, value, expected_close, owner_id, notes, stage_id, stage_kind)
    values (v_id, p_business, btrim(p_title), p_customer, p_lead, round(coalesce(p_value, 0), 2), p_expected, coalesce(p_owner, auth.uid()), coalesce(p_notes, ''), v_first.id, 'open');
    insert into public.crm_deal_events (business_id, deal_id, from_stage, to_stage, by_user) values (p_business, v_id, null, v_first.name, auth.uid());
  else
    if not exists (select 1 from public.crm_deals where id = p_id and business_id = p_business) then raise exception 'deal not found' using errcode = '22023'; end if;
    update public.crm_deals set title = btrim(p_title), customer_id = p_customer, lead_id = p_lead, value = round(coalesce(p_value, 0), 2), expected_close = p_expected, owner_id = p_owner, notes = coalesce(p_notes, '')
     where id = p_id and business_id = p_business;
  end if;
  return v_id;
end $$;

create function public.crm_set_next_step(p_deal uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.crm_deals;
begin
  select * into d from public.crm_deals where id = p_deal;
  if not found then raise exception 'deal not found' using errcode = '22023'; end if;
  perform public._guard(d.business_id, 'customers', 'customers.manage');
  if length(coalesce(p_text, '')) > 300 then raise exception 'the next step is too long' using errcode = '22023'; end if;
  update public.crm_deals set next_step = btrim(coalesce(p_text, '')) where id = p_deal;
end $$;

create function public.crm_move_deal(p_deal uuid, p_stage uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.crm_deals; s public.crm_stages; v_from text;
begin
  select * into d from public.crm_deals where id = p_deal;
  if not found then raise exception 'deal not found' using errcode = '22023'; end if;
  perform public._guard(d.business_id, 'customers', 'customers.manage');
  select * into s from public.crm_stages where id = p_stage and business_id = d.business_id;
  if not found then raise exception 'choose one of this pipeline''s stages' using errcode = '22023'; end if;
  select * into d from public.crm_deals where id = p_deal for update;
  if d.stage_id = p_stage then return; end if;
  if s.kind = 'lost' and length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'say why the deal was lost' using errcode = '22023'; end if;
  select name into v_from from public.crm_stages where id = d.stage_id;
  update public.crm_deals set stage_id = p_stage, stage_kind = s.kind, last_moved_at = now(),
    lost_reason = case when s.kind = 'lost' then btrim(p_reason) else null end,
    closed_at = case when s.kind in ('won', 'lost') then now() else null end
   where id = p_deal;
  insert into public.crm_deal_events (business_id, deal_id, from_stage, to_stage, note, by_user) values (d.business_id, p_deal, v_from, s.name, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
end $$;

-- ------------------------------------------------------------------- import
-- Rows are objects with name, phone, email, company, city, source, category, notes. A match on email (any case) or phone is a duplicate and is skipped.
create function public.crm_import(p_business uuid, p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; i integer := 0; v_name text; v_phone text; v_email text; v_created integer := 0; v_dups jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb;
  v_seen_email text[] := '{}'; v_seen_phone text[] := '{}';
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  if p_kind not in ('customers', 'leads') then raise exception 'import customers or leads' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'there are no rows to import' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'import at most 500 rows at a time' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := btrim(coalesce(r ->> 'name', '')); v_phone := nullif(btrim(coalesce(r ->> 'phone', '')), ''); v_email := nullif(lower(btrim(coalesce(r ->> 'email', ''))), '');
    if v_name = '' then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'no name'); continue; end if;
    if length(v_name) > 200 then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'name is too long'); continue; end if;
    if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then v_bad := v_bad || jsonb_build_object('row', i, 'reason', 'email is not valid'); continue; end if;
    if (v_email is not null and v_email = any (v_seen_email)) or (v_phone is not null and v_phone = any (v_seen_phone))
       or exists (select 1 from public.customers c where c.business_id = p_business and c.status = 'active' and ((v_email is not null and lower(c.email) = v_email) or (v_phone is not null and c.phone = v_phone)))
       or (p_kind = 'leads' and exists (select 1 from public.crm_leads l where l.business_id = p_business and ((v_email is not null and lower(l.email) = v_email) or (v_phone is not null and l.phone = v_phone)))) then
      v_dups := v_dups || to_jsonb(i); continue;
    end if;
    if v_email is not null then v_seen_email := v_seen_email || v_email; end if;
    if v_phone is not null then v_seen_phone := v_seen_phone || v_phone; end if;
    if p_kind = 'customers' then
      insert into public.customers (business_id, name, phone, email, source, category, company, city, notes)
      values (p_business, v_name, v_phone, v_email, coalesce(nullif(btrim(coalesce(r ->> 'source', '')), ''), 'import'), nullif(btrim(coalesce(r ->> 'category', '')), ''), nullif(btrim(coalesce(r ->> 'company', '')), ''), nullif(btrim(coalesce(r ->> 'city', '')), ''), nullif(btrim(coalesce(r ->> 'notes', '')), ''));
    else
      insert into public.crm_leads (business_id, name, phone, email, source, notes)
      values (p_business, v_name, v_phone, v_email, coalesce(nullif(btrim(coalesce(r ->> 'source', '')), ''), 'import'), coalesce(btrim(r ->> 'notes'), ''));
    end if;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'duplicates', v_dups, 'invalid', v_bad);
end $$;

-- ------------------------------------------------------------------- report
create or replace function public.crm_report(p_business uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_month timestamptz := date_trunc('month', now()); v_won int; v_lost int;
begin
  if not public.has_module_permission(p_business, 'customers', 'customers.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._crm_ensure_stages(p_business);
  select count(*) filter (where stage_kind = 'won'), count(*) filter (where stage_kind = 'lost') into v_won, v_lost from public.crm_deals where business_id = p_business;
  return jsonb_build_object(
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'stage', s.name, 'kind', s.kind, 'probability', s.probability, 'deals', coalesce(x.n, 0), 'value', coalesce(x.v, 0)) order by s.position)
        from public.crm_stages s left join (select stage_id, count(*) n, sum(value) v from public.crm_deals where business_id = p_business group by stage_id) x on x.stage_id = s.id
       where s.business_id = p_business), '[]'::jsonb),
    'open_value', (select coalesce(sum(value), 0) from public.crm_deals where business_id = p_business and stage_kind = 'open'),
    'open_deals', (select count(*) from public.crm_deals where business_id = p_business and stage_kind = 'open'),
    'weighted_value', (select coalesce(round(sum(d.value * s.probability / 100.0), 2), 0) from public.crm_deals d join public.crm_stages s on s.id = d.stage_id where d.business_id = p_business and d.stage_kind = 'open'),
    'won_this_month', (select coalesce(sum(value), 0) from public.crm_deals where business_id = p_business and stage_kind = 'won' and closed_at >= v_month),
    'won_deals_this_month', (select count(*) from public.crm_deals where business_id = p_business and stage_kind = 'won' and closed_at >= v_month),
    'win_rate', case when v_won + v_lost = 0 then null else round(v_won * 100.0 / (v_won + v_lost), 1) end,
    'avg_cycle_days', (select round(avg(extract(epoch from (closed_at - created_at)) / 86400)::numeric, 1) from public.crm_deals where business_id = p_business and stage_kind = 'won'),
    'leads', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.crm_leads where business_id = p_business group by status) l), '{}'::jsonb),
    'overdue_tasks', (select count(*) from public.crm_tasks where business_id = p_business and status = 'open' and due_at < now()),
    'due_today', (select count(*) from public.crm_tasks where business_id = p_business and status = 'open' and due_at::date = current_date),
    'activities_done_30d', (select count(*) from public.crm_tasks where business_id = p_business and status = 'done' and completed_at >= now() - interval '30 days'),
    'stale_deals', (select count(*) from public.crm_deals where business_id = p_business and stage_kind = 'open' and last_moved_at < now() - interval '14 days'
                      and not exists (select 1 from public.crm_interactions i where i.deal_id = crm_deals.id and i.occurred_at >= now() - interval '14 days')),
    'lost_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', r, 'deals', n) order by n desc) from (select lost_reason as r, count(*) as n from public.crm_deals where business_id = p_business and stage_kind = 'lost' group by 1 order by 2 desc limit 5) z), '[]'::jsonb),
    'forecast', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'deals', n, 'value', v, 'weighted', w) order by m) from (
        select coalesce(to_char(d.expected_close, 'YYYY-MM'), 'none') as m, count(*) n, sum(d.value) v, round(sum(d.value * s.probability / 100.0), 2) w
          from public.crm_deals d join public.crm_stages s on s.id = d.stage_id where d.business_id = p_business and d.stage_kind = 'open' group by 1) f), '[]'::jsonb),
    'by_owner', coalesce((select jsonb_agg(jsonb_build_object('owner', o, 'open_deals', od, 'open_value', ov, 'won_this_month', wm) order by ov desc) from (
        select coalesce(pr.display_name, 'Unassigned') as o, count(*) filter (where d.stage_kind = 'open') od, coalesce(sum(d.value) filter (where d.stage_kind = 'open'), 0) ov,
               coalesce(sum(d.value) filter (where d.stage_kind = 'won' and d.closed_at >= v_month), 0) wm
          from public.crm_deals d left join public.profiles pr on pr.id = d.owner_id where d.business_id = p_business group by 1) q), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', src, 'leads', ln, 'deals', dn, 'won', wn, 'won_value', wv) order by ln desc) from (
        select coalesce(l.source, 'Not recorded') as src, count(distinct l.id) as ln, count(d.id) as dn, count(d.id) filter (where d.stage_kind = 'won') as wn, coalesce(sum(d.value) filter (where d.stage_kind = 'won'), 0) as wv
          from public.crm_leads l left join public.crm_deals d on d.lead_id = l.id where l.business_id = p_business group by 1) q), '[]'::jsonb)
  );
end $$;

revoke execute on function public._crm_ensure_stages(uuid), public.crm_list_stages(uuid), public.crm_save_stage(uuid, uuid, text, integer), public.crm_reorder_stages(uuid, uuid[]), public.crm_delete_stage(uuid),
  public.crm_set_next_step(uuid, text), public.crm_move_deal(uuid, uuid, text), public.crm_import(uuid, text, jsonb) from public;
grant execute on function public.crm_list_stages(uuid), public.crm_save_stage(uuid, uuid, text, integer), public.crm_reorder_stages(uuid, uuid[]), public.crm_delete_stage(uuid),
  public.crm_set_next_step(uuid, text), public.crm_move_deal(uuid, uuid, text), public.crm_import(uuid, text, jsonb) to authenticated;
