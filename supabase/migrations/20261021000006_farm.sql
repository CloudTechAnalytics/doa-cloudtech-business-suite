-- Farm industry tables and operations, ported from the design of the farm reference system (The Harvest):
--   * animal population is the sum of an append-only event ledger (never an editable number);
--   * corrections are opposite-sign rows that point at the original, never edits or deletes;
--   * fish counts can be estimates; a removal above the estimate writes an explicit adjustment;
--   * feed and produce use the SHARED inventory ledger (production_consumption / production_output movements),
--     so stock is never duplicated inside the farm module.
-- Additive only. Rollback: drop the objects created here; no earlier table depends on them.

-- ------------------------------------------------------------ permissions
insert into public.permissions (code, description) values ('farm.manage', 'Start, close and correct batches; manage production units');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'farm.manage'
where r.business_id is null and r.name in ('owner', 'business_admin', 'manager');

-- ------------------------------------------------------------------ tables
create table public.farm_units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  unit_type text not null check (unit_type in ('poultry_house', 'pond', 'tank', 'field', 'pen')),
  production_type text not null check (production_type in ('poultry', 'fish', 'crop', 'livestock')),
  capacity numeric(14, 2) check (capacity is null or capacity > 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.farm_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_unit_id uuid not null,
  batch_code text not null check (length(btrim(batch_code)) between 1 and 40),
  production_type text not null check (production_type in ('poultry', 'fish', 'crop', 'livestock')),
  species_or_crop text not null check (length(btrim(species_or_crop)) > 0),
  breed_or_variety text,
  -- exact: head counts are authoritative. estimated: counts are estimates (typical for fish)
  count_basis text not null default 'exact' check (count_basis in ('exact', 'estimated')),
  opening_quantity numeric(14, 2) not null check (opening_quantity > 0),
  start_date date not null,
  planned_end_date date,
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_at timestamptz,
  close_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, batch_code),
  foreign key (business_id, farm_unit_id) references public.farm_units (business_id, id),
  check (planned_end_date is null or planned_end_date >= start_date)
);
create index farm_batches_active_idx on public.farm_batches (business_id) where status = 'active';

create table public.farm_batch_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_batch_id uuid not null,
  event_type text not null check (event_type in ('opening', 'mortality', 'removal', 'cull', 'transfer_in', 'transfer_out', 'adjustment', 'closing', 'correction')),
  quantity numeric(14, 2) not null check (quantity <> 0),
  reason text,
  occurred_on date not null default current_date,
  reverses_event_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  foreign key (business_id, reverses_event_id) references public.farm_batch_events (business_id, id),
  check (event_type not in ('opening', 'transfer_in') or quantity > 0),
  check (event_type not in ('mortality', 'removal', 'cull', 'transfer_out', 'closing') or quantity < 0),
  check (event_type not in ('mortality', 'cull', 'adjustment', 'correction', 'closing') or length(btrim(coalesce(reason, ''))) >= 3),
  check ((event_type = 'correction') = (reverses_event_id is not null))
);
create unique index farm_batch_events_one_reversal_uq on public.farm_batch_events (reverses_event_id) where reverses_event_id is not null;
create index farm_batch_events_batch_idx on public.farm_batch_events (farm_batch_id, occurred_on desc);

create function public.farm_batch_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'batch events are immutable; post a correction' using errcode = '42501';
end $$;
create trigger farm_batch_events_no_change before update or delete on public.farm_batch_events
  for each row execute function public.farm_batch_events_immutable();

create table public.farm_feed_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_batch_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  fed_on date not null default current_date,
  notes text,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  stock_movement_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);
create index farm_feed_batch_idx on public.farm_feed_records (farm_batch_id, fed_on desc);

create table public.farm_harvests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_batch_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  harvest_date date not null default current_date,
  animals_removed numeric(14, 2) check (animals_removed is null or animals_removed > 0),
  removal_event_id uuid,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  stock_movement_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, removal_event_id) references public.farm_batch_events (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);
create index farm_harvest_batch_idx on public.farm_harvests (farm_batch_id, harvest_date desc);

create table public.farm_activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_batch_id uuid,
  farm_unit_id uuid,
  activity_type text not null check (activity_type in ('observation', 'water_check', 'cleaning', 'treatment_note', 'maintenance', 'other')),
  notes text not null check (length(btrim(notes)) between 1 and 2000),
  activity_on date not null default current_date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  foreign key (business_id, farm_unit_id) references public.farm_units (business_id, id),
  check (farm_batch_id is not null or farm_unit_id is not null)
);
create index farm_activity_day_idx on public.farm_activity_logs (business_id, activity_on desc);

create function public.farm_set_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  return new;
end $$;
create trigger farm_activity_creator before insert on public.farm_activity_logs for each row execute function public.farm_set_creator();

-- ------------------------------------------------------------------ summaries
-- Every figure is derived from the ledgers. security_invoker keeps row-level security in force.
create view public.farm_batch_summaries with (security_invoker = true) as
select b.id, b.business_id, b.farm_unit_id, b.batch_code, b.production_type, b.species_or_crop, b.breed_or_variety,
  b.count_basis, b.opening_quantity, b.start_date, b.planned_end_date, b.status,
  coalesce(e.population, 0) as current_population,
  coalesce(e.mortality, 0) as mortality_total,
  coalesce(e.entering, 0) as entering_total,
  coalesce(f.feed, 0) as feed_total,
  coalesce(h.harvest, 0) as harvest_total
from public.farm_batches b
left join lateral (
  select sum(ev.quantity) as population,
         sum(-ev.quantity) filter (where ev.event_type = 'mortality' or orig.event_type = 'mortality') as mortality,
         sum(ev.quantity) filter (where ev.event_type in ('opening', 'transfer_in')) as entering
  from public.farm_batch_events ev left join public.farm_batch_events orig on orig.id = ev.reverses_event_id
  where ev.farm_batch_id = b.id) e on true
left join lateral (select sum(quantity) as feed from public.farm_feed_records where farm_batch_id = b.id and status = 'posted') f on true
left join lateral (select sum(quantity) as harvest from public.farm_harvests where farm_batch_id = b.id and status = 'posted') h on true;

-- --------------------------------------------------------------------- RLS
alter table public.farm_units enable row level security;
alter table public.farm_batches enable row level security;
alter table public.farm_batch_events enable row level security;
alter table public.farm_feed_records enable row level security;
alter table public.farm_harvests enable row level security;
alter table public.farm_activity_logs enable row level security;

create policy farm_units_select on public.farm_units for select to authenticated using (public.has_module_permission(business_id, 'farm-units', 'farm.read', 'read'));
create policy farm_units_insert on public.farm_units for insert to authenticated with check (public.has_module_permission(business_id, 'farm-units', 'farm.manage'));
create policy farm_units_update on public.farm_units for update to authenticated
  using (public.has_module_permission(business_id, 'farm-units', 'farm.manage')) with check (public.has_module_permission(business_id, 'farm-units', 'farm.manage'));
create policy farm_batches_select on public.farm_batches for select to authenticated using (public.has_module_permission(business_id, 'farm-batches', 'farm.read', 'read'));
create policy farm_batch_events_select on public.farm_batch_events for select to authenticated using (public.has_module_permission(business_id, 'farm-batches', 'farm.read', 'read'));
create policy farm_feed_select on public.farm_feed_records for select to authenticated using (public.has_module_permission(business_id, 'farm-feeding', 'farm.read', 'read'));
create policy farm_harvests_select on public.farm_harvests for select to authenticated using (public.has_module_permission(business_id, 'farm-harvests', 'farm.read', 'read'));
create policy farm_activity_select on public.farm_activity_logs for select to authenticated using (public.has_module_permission(business_id, 'farm-daily', 'farm.read', 'read'));
create policy farm_activity_insert on public.farm_activity_logs for insert to authenticated with check (public.has_module_permission(business_id, 'farm-daily', 'farm.record'));

grant select on public.farm_units, public.farm_batches, public.farm_batch_events, public.farm_feed_records, public.farm_harvests,
  public.farm_activity_logs, public.farm_batch_summaries to authenticated;
grant insert (business_id, name, unit_type, production_type, capacity) on public.farm_units to authenticated;
grant update (name, capacity, status) on public.farm_units to authenticated;
grant insert (business_id, farm_batch_id, farm_unit_id, activity_type, notes, activity_on) on public.farm_activity_logs to authenticated;
-- Batches, population events, feeding and harvests are written only by the functions below.

-- audit
create trigger audit_farm_units after insert or update on public.farm_units for each row execute function public.audit_row_change();
create trigger audit_farm_batches after insert or update on public.farm_batches for each row execute function public.audit_row_change();
create trigger audit_farm_harvests after insert or update on public.farm_harvests for each row execute function public.audit_row_change();
create trigger audit_farm_feed after insert or update on public.farm_feed_records for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- functions
create function public._farm_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- The only writer of population events: locks the batch, then enforces the population rules.
create function public._farm_post_event(p_batch uuid, p_type text, p_qty numeric, p_reason text, p_on date, p_reverses uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_pop numeric; v_id uuid;
begin
  select * into b from public.farm_batches where id = p_batch for update;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  if b.status <> 'active' then raise exception 'batch % is closed', b.batch_code using errcode = '22023'; end if;
  select coalesce(sum(quantity), 0) into v_pop from public.farm_batch_events where farm_batch_id = p_batch;
  if v_pop + p_qty < 0 then
    if b.count_basis = 'estimated' and p_type in ('removal', 'cull', 'mortality') then
      -- estimated counts: record the shortfall openly rather than refusing or hiding it
      insert into public.farm_batch_events (business_id, farm_batch_id, event_type, quantity, reason, occurred_on, created_by)
      values (b.business_id, p_batch, 'adjustment', -(v_pop + p_qty), 'Count exceeded the estimated population', p_on, auth.uid());
    else
      raise exception 'only % remain in batch %', trim_scale(v_pop), b.batch_code using errcode = '23514';
    end if;
  end if;
  insert into public.farm_batch_events (business_id, farm_batch_id, event_type, quantity, reason, occurred_on, reverses_event_id, created_by)
  values (b.business_id, p_batch, p_type, p_qty, p_reason, p_on, p_reverses, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.farm_start_batch(
  p_business uuid, p_unit uuid, p_code text, p_species text, p_variety text, p_production_type text,
  p_opening numeric, p_start date, p_planned_end date, p_basis text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; u public.farm_units; v_id uuid := gen_random_uuid();
begin
  perform public._farm_guard(p_business, 'farm-batches', 'farm.manage');
  v_prev := public._idem_check(p_business, p_key, 'farm_start_batch'); if v_prev is not null then return v_prev; end if;
  select * into u from public.farm_units where id = p_unit and business_id = p_business and status = 'active';
  if not found then raise exception 'unknown or archived production unit' using errcode = '22023'; end if;
  if u.production_type <> p_production_type then
    raise exception 'unit "%" is for % production, not %', u.name, u.production_type, p_production_type using errcode = '22023';
  end if;
  insert into public.farm_batches (id, business_id, farm_unit_id, batch_code, production_type, species_or_crop, breed_or_variety, count_basis, opening_quantity, start_date, planned_end_date, created_by)
  values (v_id, p_business, p_unit, btrim(p_code), p_production_type, p_species, nullif(btrim(coalesce(p_variety, '')), ''), coalesce(p_basis, 'exact'), p_opening, p_start, p_planned_end, auth.uid());
  insert into public.farm_batch_events (business_id, farm_batch_id, event_type, quantity, reason, occurred_on, created_by)
  values (p_business, v_id, 'opening', p_opening, 'Opening quantity', p_start, auth.uid());
  return public._idem_store(p_business, p_key, 'farm_start_batch', jsonb_build_object('batch_id', v_id));
end $$;

create function public.farm_record_mortality(p_batch uuid, p_qty numeric, p_cause text, p_on date, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_event uuid;
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-mortality', 'farm.record');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_mortality'); if v_prev is not null then return v_prev; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_cause, ''))) < 3 then raise exception 'a cause is required' using errcode = '22023'; end if;
  v_event := public._farm_post_event(p_batch, 'mortality', -p_qty, p_cause, coalesce(p_on, current_date));
  return public._idem_store(b.business_id, p_key, 'farm_mortality', jsonb_build_object('event_id', v_event));
end $$;

-- Culling, selling live animals and manual population corrections need farm.manage.
create function public.farm_adjust_population(p_batch uuid, p_type text, p_qty numeric, p_reason text, p_on date, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_event uuid; v_signed numeric;
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-batches', 'farm.manage');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_adjust'); if v_prev is not null then return v_prev; end if;
  if p_type not in ('cull', 'removal', 'adjustment') then raise exception 'type must be cull, removal or adjustment' using errcode = '22023'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'quantity cannot be zero' using errcode = '22023'; end if;
  if p_type <> 'adjustment' and p_qty < 0 then raise exception 'enter a positive quantity' using errcode = '22023'; end if;
  v_signed := case when p_type = 'adjustment' then p_qty else -p_qty end;
  v_event := public._farm_post_event(p_batch, p_type, v_signed, p_reason, coalesce(p_on, current_date));
  return public._idem_store(b.business_id, p_key, 'farm_adjust', jsonb_build_object('event_id', v_event));
end $$;

-- Feed is taken from the shared inventory exactly once, in the same transaction as the feeding record.
create function public.farm_record_feeding(p_batch uuid, p_product uuid, p_location uuid, p_qty numeric, p_on date, p_notes text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_id uuid := gen_random_uuid(); m public.stock_movements; pr public.products;
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-feeding', 'farm.record');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_feeding'); if v_prev is not null then return v_prev; end if;
  select * into b from public.farm_batches where id = p_batch for update;
  if b.status <> 'active' then raise exception 'batch % is closed', b.batch_code using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
  select * into pr from public.products where id = p_product and business_id = b.business_id and status = 'active' and tracks_stock;
  if not found then raise exception 'invalid feed product' using errcode = '22023'; end if;
  perform public._require_location(b.business_id, p_location);
  m := public._post_movement(b.business_id, p_product, p_location, 'production_consumption', -p_qty, null, 'farm_feed', v_id, gen_random_uuid(), 'Feed ' || b.batch_code);
  insert into public.farm_feed_records (id, business_id, farm_batch_id, product_id, quantity, fed_on, notes, stock_movement_id, created_by)
  values (v_id, b.business_id, p_batch, p_product, p_qty, coalesce(p_on, current_date), p_notes, m.id, auth.uid());
  return public._idem_store(b.business_id, p_key, 'farm_feeding', jsonb_build_object('feed_id', v_id));
end $$;

-- Harvested produce enters the shared inventory as a production_output movement; live animals leaving are a batch event.
create function public.farm_record_harvest(p_batch uuid, p_product uuid, p_location uuid, p_qty numeric, p_on date, p_animals_removed numeric, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_id uuid := gen_random_uuid(); m public.stock_movements; v_event uuid;
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-harvests', 'farm.record');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_harvest'); if v_prev is not null then return v_prev; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
  if p_animals_removed is not null and p_animals_removed <= 0 then raise exception 'animals removed must be greater than zero' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and business_id = b.business_id and status = 'active' and tracks_stock) then
    raise exception 'invalid produce product' using errcode = '22023';
  end if;
  perform public._require_location(b.business_id, p_location);
  if p_animals_removed is not null then
    v_event := public._farm_post_event(p_batch, 'removal', -p_animals_removed, 'Harvest', coalesce(p_on, current_date));
  else
    select * into b from public.farm_batches where id = p_batch for update;
    if b.status <> 'active' then raise exception 'batch % is closed', b.batch_code using errcode = '22023'; end if;
  end if;
  m := public._post_movement(b.business_id, p_product, p_location, 'production_output', p_qty, null, 'farm_harvest', v_id, gen_random_uuid(), 'Harvest ' || b.batch_code);
  insert into public.farm_harvests (id, business_id, farm_batch_id, product_id, quantity, harvest_date, animals_removed, removal_event_id, stock_movement_id, created_by)
  values (v_id, b.business_id, p_batch, p_product, p_qty, coalesce(p_on, current_date), p_animals_removed, v_event, m.id, auth.uid());
  return public._idem_store(b.business_id, p_key, 'farm_harvest', jsonb_build_object('harvest_id', v_id));
end $$;

create function public.farm_reverse_event(p_event uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.farm_batch_events; v_prev jsonb; v_new uuid;
begin
  select * into e from public.farm_batch_events where id = p_event;
  if not found then raise exception 'event not found' using errcode = '22023'; end if;
  perform public._farm_guard(e.business_id, 'farm-batches', 'farm.manage');
  v_prev := public._idem_check(e.business_id, p_key, 'farm_reverse'); if v_prev is not null then return v_prev; end if;
  if e.event_type not in ('mortality', 'removal', 'cull', 'adjustment') then raise exception 'this kind of event cannot be reversed' using errcode = '22023'; end if;
  if exists (select 1 from public.farm_batch_events where reverses_event_id = p_event) then raise exception 'event was already reversed' using errcode = '23505'; end if;
  if exists (select 1 from public.farm_harvests where removal_event_id = p_event) then raise exception 'void the harvest instead' using errcode = '22023'; end if;
  v_new := public._farm_post_event(e.farm_batch_id, 'correction', -e.quantity, p_reason, current_date, p_event);
  return public._idem_store(e.business_id, p_key, 'farm_reverse', jsonb_build_object('event_id', v_new));
end $$;

create function public.farm_void_feeding(p_feed uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.farm_feed_records; v_prev jsonb; mv public.stock_movements;
begin
  select * into f from public.farm_feed_records where id = p_feed;
  if not found then raise exception 'feeding record not found' using errcode = '22023'; end if;
  perform public._farm_guard(f.business_id, 'farm-feeding', 'farm.manage');
  v_prev := public._idem_check(f.business_id, p_key, 'farm_void_feed'); if v_prev is not null then return v_prev; end if;
  if f.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into mv from public.stock_movements where id = f.stock_movement_id;
  perform public._post_movement(f.business_id, f.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'farm_void', f.id, gen_random_uuid(), 'Void feeding', now(), mv.id);
  update public.farm_feed_records set status = 'voided', void_reason = p_reason where id = p_feed;
  return public._idem_store(f.business_id, p_key, 'farm_void_feed', jsonb_build_object('feed_id', p_feed));
end $$;

create function public.farm_void_harvest(p_harvest uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.farm_harvests; v_prev jsonb; mv public.stock_movements;
begin
  select * into h from public.farm_harvests where id = p_harvest;
  if not found then raise exception 'harvest not found' using errcode = '22023'; end if;
  perform public._farm_guard(h.business_id, 'farm-harvests', 'farm.manage');
  v_prev := public._idem_check(h.business_id, p_key, 'farm_void_harvest'); if v_prev is not null then return v_prev; end if;
  if h.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into mv from public.stock_movements where id = h.stock_movement_id;
  -- removes the produce again; fails with "insufficient stock" if it has already been sold or used
  perform public._post_movement(h.business_id, h.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'farm_void', h.id, gen_random_uuid(), 'Void harvest', now(), mv.id);
  if h.removal_event_id is not null then
    perform public._farm_post_event(h.farm_batch_id, 'correction', (select -quantity from public.farm_batch_events where id = h.removal_event_id), p_reason, current_date, h.removal_event_id);
  end if;
  update public.farm_harvests set status = 'voided', void_reason = p_reason where id = p_harvest;
  return public._idem_store(h.business_id, p_key, 'farm_void_harvest', jsonb_build_object('harvest_id', p_harvest));
end $$;

create function public.farm_close_batch(p_batch uuid, p_reason text, p_write_off boolean, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_pop numeric;
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-batches', 'farm.manage');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_close'); if v_prev is not null then return v_prev; end if;
  select * into b from public.farm_batches where id = p_batch for update;
  if b.status <> 'active' then raise exception 'batch is already closed' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select coalesce(sum(quantity), 0) into v_pop from public.farm_batch_events where farm_batch_id = p_batch;
  if v_pop > 0 then
    if not coalesce(p_write_off, false) then
      raise exception '% animals remain; confirm the write-off to close the batch', trim_scale(v_pop) using errcode = '22023';
    end if;
    perform public._farm_post_event(p_batch, 'closing', -v_pop, p_reason, current_date);
  end if;
  update public.farm_batches set status = 'closed', closed_at = now(), close_reason = p_reason where id = p_batch;
  return public._idem_store(b.business_id, p_key, 'farm_close', jsonb_build_object('batch_id', p_batch, 'written_off', v_pop));
end $$;

revoke all on function public.farm_batch_events_immutable(), public.farm_set_creator(), public._farm_guard(uuid, text, text),
  public._farm_post_event(uuid, text, numeric, text, date, uuid),
  public.farm_start_batch(uuid, uuid, text, text, text, text, numeric, date, date, text, text),
  public.farm_record_mortality(uuid, numeric, text, date, text), public.farm_adjust_population(uuid, text, numeric, text, date, text),
  public.farm_record_feeding(uuid, uuid, uuid, numeric, date, text, text),
  public.farm_record_harvest(uuid, uuid, uuid, numeric, date, numeric, text),
  public.farm_reverse_event(uuid, text, text), public.farm_void_feeding(uuid, text, text), public.farm_void_harvest(uuid, text, text),
  public.farm_close_batch(uuid, text, boolean, text) from public;

grant execute on function
  public.farm_start_batch(uuid, uuid, text, text, text, text, numeric, date, date, text, text),
  public.farm_record_mortality(uuid, numeric, text, date, text), public.farm_adjust_population(uuid, text, numeric, text, date, text),
  public.farm_record_feeding(uuid, uuid, uuid, numeric, date, text, text),
  public.farm_record_harvest(uuid, uuid, uuid, numeric, date, numeric, text),
  public.farm_reverse_event(uuid, text, text), public.farm_void_feeding(uuid, text, text), public.farm_void_harvest(uuid, text, text),
  public.farm_close_batch(uuid, text, boolean, text) to authenticated;
