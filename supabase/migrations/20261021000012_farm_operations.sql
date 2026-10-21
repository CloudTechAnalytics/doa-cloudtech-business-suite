-- Farm operations from the reference farm system: workers, tasks, health and biosecurity (with withdrawal periods),
-- equipment and maintenance, per-batch costs, and live alerts.
--   * Withdrawal: produce harvested or animals removed from a batch that is under an active treatment withdrawal are
--     refused by triggers, so no screen or function can bypass it.
--   * Maintenance costs create a normal expense (source 'maintenance') in the same transaction, so money is counted once.
--   * Alerts are computed from the records on request, so there is no stored alert state to go stale.
-- Additive only. Rollback: drop the objects created here.

-- ------------------------------------------------------------------ workers
create table public.farm_workers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text,
  role_title text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index farm_workers_name_uq on public.farm_workers (business_id, lower(btrim(name)));

-- ------------------------------------------------------------------- tasks
create table public.farm_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  title text not null check (length(btrim(title)) between 2 and 200),
  description text,
  due_date date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done', 'cancelled')),
  assignee_worker_id uuid,
  farm_batch_id uuid,
  requires_review boolean not null default false,
  created_by uuid references public.profiles (id),
  completed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, assignee_worker_id) references public.farm_workers (business_id, id),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id)
);
create index farm_tasks_open_idx on public.farm_tasks (business_id, due_date) where status in ('todo', 'in_progress', 'review');

-- ------------------------------------------------------------------ health
create table public.farm_health_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  farm_batch_id uuid not null,
  record_type text not null check (record_type in ('treatment', 'vaccination', 'inspection', 'quarantine')),
  title text not null check (length(btrim(title)) between 2 and 200),
  product_id uuid,
  quantity numeric(18, 4) check (quantity is null or quantity > 0),
  stock_movement_id uuid,
  performed_on date not null,
  withdrawal_days integer not null default 0 check (withdrawal_days between 0 and 365),
  withdrawal_ends_on date,
  notes text,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  check (record_type in ('treatment', 'vaccination') or (withdrawal_days = 0 and product_id is null)),
  check (status = 'posted' or void_reason is not null),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);
create index farm_health_batch_idx on public.farm_health_records (farm_batch_id, performed_on desc);

-- ----------------------------------------------------------------- equipment
create table public.farm_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  asset_type text not null check (asset_type in ('tractor', 'pump', 'generator', 'vehicle', 'feeder', 'tool', 'other')),
  serial_number text,
  purchase_date date,
  purchase_cost numeric(14, 2) check (purchase_cost is null or purchase_cost >= 0),
  status text not null default 'active' check (status in ('active', 'under_repair', 'retired')),
  service_interval_days integer check (service_interval_days is null or service_interval_days between 1 and 3650),
  notes text,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, idempotency_key)
);
create unique index farm_assets_name_uq on public.farm_assets (business_id, lower(btrim(name)));

create table public.farm_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  asset_id uuid not null,
  kind text not null check (kind in ('service', 'repair', 'inspection')),
  performed_on date not null,
  cost numeric(14, 2) not null default 0 check (cost >= 0),
  description text not null check (length(btrim(description)) between 2 and 300),
  expense_id uuid,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  check (status = 'posted' or void_reason is not null),
  foreign key (business_id, asset_id) references public.farm_assets (business_id, id),
  foreign key (business_id, expense_id) references public.expenses (business_id, id)
);

-- --------------------------------------------------------------------- views
-- Names only, so field staff can see who a task is assigned to without seeing worker details.
create view public.farm_worker_names as
select w.id, w.business_id, w.name, w.status from public.farm_workers w
where public.has_module_permission(w.business_id, 'farm-tasks', 'farm.read', 'read');

-- Treatments whose withdrawal period is still running.
create view public.farm_withdrawals with (security_invoker = true) as
select h.business_id, h.farm_batch_id, b.batch_code, b.species_or_crop, h.id as health_record_id, h.title, h.withdrawal_ends_on
from public.farm_health_records h join public.farm_batches b on b.business_id = h.business_id and b.id = h.farm_batch_id
where h.status = 'posted' and h.withdrawal_ends_on >= current_date;

create view public.farm_asset_status with (security_invoker = true) as
select a.id, a.business_id, a.name, a.asset_type, a.serial_number, a.purchase_date, a.purchase_cost, a.status, a.service_interval_days, a.notes,
  m.last_service_on, m.total_cost,
  case when a.service_interval_days is not null then coalesce(m.last_service_on, a.purchase_date) + a.service_interval_days end as next_service_on,
  (a.status <> 'retired' and a.service_interval_days is not null
    and coalesce(m.last_service_on, a.purchase_date) + a.service_interval_days < current_date) as service_overdue
from public.farm_assets a
left join lateral (
  select max(performed_on) filter (where kind = 'service') as last_service_on, coalesce(sum(cost), 0) as total_cost
  from public.farm_maintenance_records r where r.asset_id = a.id and r.status = 'posted') m on true;

-- Money charged to each batch, from posted expenses.
create view public.farm_batch_costs with (security_invoker = true) as
select e.business_id, e.farm_batch_id, sum(e.amount) as expenses_total
from public.expenses e where e.status = 'posted' and e.farm_batch_id is not null group by e.business_id, e.farm_batch_id;

-- --------------------------------------------------------------------- RLS
alter table public.farm_workers enable row level security;
alter table public.farm_tasks enable row level security;
alter table public.farm_health_records enable row level security;
alter table public.farm_assets enable row level security;
alter table public.farm_maintenance_records enable row level security;

create policy farm_workers_select on public.farm_workers for select to authenticated using (public.has_module_permission(business_id, 'farm-workers', 'farm.manage', 'read'));
create policy farm_tasks_select on public.farm_tasks for select to authenticated using (public.has_module_permission(business_id, 'farm-tasks', 'farm.read', 'read'));
create policy farm_health_select on public.farm_health_records for select to authenticated using (public.has_module_permission(business_id, 'farm-health', 'farm.read', 'read'));
create policy farm_assets_select on public.farm_assets for select to authenticated using (public.has_module_permission(business_id, 'farm-equipment', 'farm.read', 'read'));
create policy farm_maintenance_select on public.farm_maintenance_records for select to authenticated using (public.has_module_permission(business_id, 'farm-equipment', 'farm.read', 'read'));
grant select on public.farm_workers, public.farm_tasks, public.farm_health_records, public.farm_assets, public.farm_maintenance_records,
  public.farm_worker_names, public.farm_withdrawals, public.farm_asset_status, public.farm_batch_costs to authenticated;

create trigger audit_farm_workers after insert or update on public.farm_workers for each row execute function public.audit_row_change();
create trigger audit_farm_tasks after insert or update on public.farm_tasks for each row execute function public.audit_row_change();
create trigger audit_farm_health after insert or update on public.farm_health_records for each row execute function public.audit_row_change();
create trigger audit_farm_assets after insert or update on public.farm_assets for each row execute function public.audit_row_change();
create trigger audit_farm_maintenance after insert or update on public.farm_maintenance_records for each row execute function public.audit_row_change();

-- ------------------------------------------------- withdrawal-period enforcement
create function public._farm_withdrawal_until(p_batch uuid, p_on date) returns date
language sql stable security definer set search_path = '' as $$
  select max(withdrawal_ends_on) from public.farm_health_records
  where farm_batch_id = p_batch and status = 'posted' and performed_on <= p_on and withdrawal_ends_on >= p_on;
$$;

create function public.farm_withdrawal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_until date; v_batch uuid; v_on date;
begin
  if tg_table_name = 'farm_harvests' then
    v_batch := new.farm_batch_id; v_on := new.harvest_date;
  else
    -- Animals leaving the batch for sale or harvest (a plain removal). Mortality, culls, adjustments and corrections are not sales.
    if new.event_type <> 'removal' or new.quantity >= 0 then return new; end if;
    v_batch := new.farm_batch_id; v_on := new.occurred_on;
  end if;
  v_until := public._farm_withdrawal_until(v_batch, v_on);
  if v_until is not null then
    raise exception 'this batch is under a treatment withdrawal until %; produce and animals cannot be sold or harvested yet', v_until using errcode = '22023';
  end if;
  return new;
end $$;
create trigger farm_harvests_withdrawal before insert on public.farm_harvests for each row execute function public.farm_withdrawal_guard();
create trigger farm_events_withdrawal before insert on public.farm_batch_events for each row execute function public.farm_withdrawal_guard();

-- ------------------------------------------------------------- worker API
create function public.save_farm_worker(p_business uuid, p_id uuid, p_name text, p_phone text, p_role_title text, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._farm_guard(p_business, 'farm-workers', 'farm.manage');
  if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'enter the worker''s name' using errcode = '22023'; end if;
  begin
    if p_id is null then
      insert into public.farm_workers (id, business_id, name, phone, role_title, status)
      values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_role_title, '')), ''), case when coalesce(p_active, true) then 'active' else 'inactive' end);
    else
      update public.farm_workers set name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), role_title = nullif(btrim(coalesce(p_role_title, '')), ''),
        status = case when coalesce(p_active, true) then 'active' else 'inactive' end
      where id = p_id and business_id = p_business;
      if not found then raise exception 'worker not found' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'duplicate key: a worker with this name already exists' using errcode = '23505';
  end;
  return v_id;
end $$;

-- --------------------------------------------------------------- task API
create function public.save_farm_task(
  p_business uuid, p_id uuid, p_title text, p_description text, p_due date, p_priority text, p_assignee uuid, p_batch uuid, p_requires_review boolean, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); t public.farm_tasks;
begin
  perform public._farm_guard(p_business, 'farm-tasks', 'farm.manage');
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'enter a task title (at least 2 characters)' using errcode = '22023'; end if;
  if p_assignee is not null and not exists (select 1 from public.farm_workers where id = p_assignee and business_id = p_business and status = 'active') then
    raise exception 'unknown or inactive worker' using errcode = '22023';
  end if;
  if p_batch is not null and not exists (select 1 from public.farm_batches where id = p_batch and business_id = p_business) then
    raise exception 'unknown batch' using errcode = '22023';
  end if;
  if p_id is null then
    v_prev := public._idem_check(p_business, p_key, 'task_create'); if v_prev is not null then return v_prev; end if;
    insert into public.farm_tasks (id, business_id, title, description, due_date, priority, assignee_worker_id, farm_batch_id, requires_review, created_by, idempotency_key)
    values (v_id, p_business, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_due, coalesce(p_priority, 'normal'), p_assignee, p_batch, coalesce(p_requires_review, false), auth.uid(), p_key);
    return public._idem_store(p_business, p_key, 'task_create', jsonb_build_object('task_id', v_id));
  end if;
  select * into t from public.farm_tasks where id = p_id and business_id = p_business for update;
  if not found then raise exception 'task not found' using errcode = '22023'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'a finished task cannot be edited; reopen it first' using errcode = '22023'; end if;
  update public.farm_tasks set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''), due_date = p_due,
    priority = coalesce(p_priority, priority), assignee_worker_id = p_assignee, farm_batch_id = p_batch, requires_review = coalesce(p_requires_review, requires_review)
  where id = p_id;
  return jsonb_build_object('task_id', p_id);
end $$;

-- Field staff move work forward; only a manager approves reviewed work, sends it back, cancels or reopens.
create function public.set_farm_task_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.farm_tasks; v_manage boolean; v_record boolean; v_next text;
begin
  select * into t from public.farm_tasks where id = p_task for update;
  if not found then raise exception 'task not found' using errcode = '22023'; end if;
  v_manage := public.has_module_permission(t.business_id, 'farm-tasks', 'farm.manage', 'use');
  v_record := public.has_module_permission(t.business_id, 'farm-tasks', 'farm.record', 'use');
  if not (v_manage or v_record) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('todo', 'in_progress', 'review', 'done', 'cancelled') then raise exception 'unknown status' using errcode = '22023'; end if;
  if p_status = t.status then raise exception 'the task is already %', replace(t.status, '_', ' ') using errcode = '22023'; end if;
  v_next := case when t.requires_review then 'review' else 'done' end;
  if t.status in ('done', 'cancelled') then
    if not (v_manage and p_status = 'todo') then raise exception 'only a manager can reopen a finished task' using errcode = '42501'; end if;
  elsif p_status = 'cancelled' then
    if not v_manage then raise exception 'only a manager can cancel a task' using errcode = '42501'; end if;
  elsif t.status = 'review' then
    if not (v_manage and p_status in ('done', 'in_progress')) then raise exception 'only a manager can approve or send back reviewed work' using errcode = '42501'; end if;
  elsif t.status in ('todo', 'in_progress') then
    if not (p_status = 'in_progress' or p_status = v_next) then
      if t.requires_review then raise exception 'this task needs review: send it for review instead of marking it done' using errcode = '22023'; end if;
      raise exception 'invalid status change' using errcode = '22023';
    end if;
  end if;
  update public.farm_tasks set status = p_status,
    completed_at = case when p_status = 'done' then now() else null end,
    reviewed_by = case when t.status = 'review' and p_status = 'done' then auth.uid() else null end
  where id = p_task;
end $$;

-- --------------------------------------------------------------- health API
create function public.farm_record_health(
  p_batch uuid, p_type text, p_title text, p_product uuid, p_location uuid, p_qty numeric, p_on date, p_withdrawal_days integer, p_notes text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.farm_batches; v_prev jsonb; v_id uuid := gen_random_uuid(); m public.stock_movements; v_on date := coalesce(p_on, current_date); v_days integer := coalesce(p_withdrawal_days, 0);
begin
  select * into b from public.farm_batches where id = p_batch;
  if not found then raise exception 'batch not found' using errcode = '22023'; end if;
  perform public._farm_guard(b.business_id, 'farm-health', 'farm.record');
  v_prev := public._idem_check(b.business_id, p_key, 'farm_health'); if v_prev is not null then return v_prev; end if;
  select * into b from public.farm_batches where id = p_batch for update;
  if b.status <> 'active' then raise exception 'batch % is closed', b.batch_code using errcode = '22023'; end if;
  if p_type not in ('treatment', 'vaccination', 'inspection', 'quarantine') then raise exception 'unknown record type' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'describe what was done (at least 2 characters)' using errcode = '22023'; end if;
  if v_on > current_date then raise exception 'the date cannot be in the future' using errcode = '22023'; end if;
  if v_days < 0 or v_days > 365 then raise exception 'withdrawal days must be between 0 and 365' using errcode = '22023'; end if;
  if p_type not in ('treatment', 'vaccination') and (v_days > 0 or p_product is not null) then
    raise exception 'only treatments and vaccinations use medicine stock or a withdrawal period' using errcode = '22023';
  end if;
  if p_product is not null then
    if p_qty is null or p_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if not exists (select 1 from public.products where id = p_product and business_id = b.business_id and status = 'active' and tracks_stock) then
      raise exception 'invalid medicine product' using errcode = '22023';
    end if;
    perform public._require_location(b.business_id, p_location);
    m := public._post_movement(b.business_id, p_product, p_location, 'production_consumption', -p_qty, null, 'farm_health', v_id, gen_random_uuid(), 'Health ' || b.batch_code);
  elsif p_qty is not null then
    raise exception 'choose the medicine used, or leave the quantity empty' using errcode = '22023';
  end if;
  insert into public.farm_health_records (id, business_id, farm_batch_id, record_type, title, product_id, quantity, stock_movement_id, performed_on, withdrawal_days, withdrawal_ends_on, notes, created_by, idempotency_key)
  values (v_id, b.business_id, p_batch, p_type, btrim(p_title), p_product, p_qty, m.id, v_on, v_days, case when v_days > 0 then v_on + v_days end, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), p_key);
  return public._idem_store(b.business_id, p_key, 'farm_health', jsonb_build_object('record_id', v_id));
end $$;

create function public.farm_void_health(p_record uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.farm_health_records; v_prev jsonb; mv public.stock_movements;
begin
  select * into h from public.farm_health_records where id = p_record;
  if not found then raise exception 'record not found' using errcode = '22023'; end if;
  perform public._farm_guard(h.business_id, 'farm-health', 'farm.manage');
  v_prev := public._idem_check(h.business_id, p_key, 'farm_void_health'); if v_prev is not null then return v_prev; end if;
  if h.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if h.stock_movement_id is not null then
    select * into mv from public.stock_movements where id = h.stock_movement_id;
    perform public._post_movement(h.business_id, h.product_id, mv.location_id, 'reversal', -mv.quantity_delta, mv.unit_cost, 'farm_void', h.id, gen_random_uuid(), 'Void health record', now(), mv.id);
  end if;
  update public.farm_health_records set status = 'voided', void_reason = btrim(p_reason) where id = p_record;
  return public._idem_store(h.business_id, p_key, 'farm_void_health', jsonb_build_object('record_id', p_record));
end $$;

-- ------------------------------------------------------------ equipment API
create function public.save_farm_asset(
  p_business uuid, p_id uuid, p_name text, p_type text, p_serial text, p_purchase_date date, p_cost numeric, p_status text, p_interval integer, p_notes text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid();
begin
  perform public._farm_guard(p_business, 'farm-equipment', 'farm.manage');
  if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'enter the equipment name' using errcode = '22023'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'cost cannot be negative' using errcode = '22023'; end if;
  if p_purchase_date is not null and p_purchase_date > current_date then raise exception 'the purchase date cannot be in the future' using errcode = '22023'; end if;
  begin
    if p_id is null then
      v_prev := public._idem_check(p_business, p_key, 'asset_create'); if v_prev is not null then return v_prev; end if;
      insert into public.farm_assets (id, business_id, name, asset_type, serial_number, purchase_date, purchase_cost, status, service_interval_days, notes, idempotency_key)
      values (v_id, p_business, btrim(p_name), p_type, nullif(btrim(coalesce(p_serial, '')), ''), p_purchase_date, p_cost, coalesce(p_status, 'active'), p_interval, nullif(btrim(coalesce(p_notes, '')), ''), p_key);
      return public._idem_store(p_business, p_key, 'asset_create', jsonb_build_object('asset_id', v_id));
    end if;
    update public.farm_assets set name = btrim(p_name), asset_type = p_type, serial_number = nullif(btrim(coalesce(p_serial, '')), ''), purchase_date = p_purchase_date,
      purchase_cost = p_cost, status = coalesce(p_status, status), service_interval_days = p_interval, notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_id and business_id = p_business;
    if not found then raise exception 'equipment not found' using errcode = '22023'; end if;
    return jsonb_build_object('asset_id', p_id);
  exception when unique_violation then
    raise exception 'duplicate key: equipment with this name already exists' using errcode = '23505';
  end;
end $$;

-- A maintenance cost becomes an expense (repairs) in the same transaction, so it is counted once.
create function public.record_maintenance(p_asset uuid, p_kind text, p_on date, p_cost numeric, p_description text, p_method text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.farm_assets; v_prev jsonb; v_id uuid := gen_random_uuid(); v_expense uuid; v_number text;
begin
  select * into a from public.farm_assets where id = p_asset;
  if not found then raise exception 'equipment not found' using errcode = '22023'; end if;
  perform public._farm_guard(a.business_id, 'farm-equipment', 'farm.manage');
  v_prev := public._idem_check(a.business_id, p_key, 'maintenance_record'); if v_prev is not null then return v_prev; end if;
  if a.status = 'retired' then raise exception 'retired equipment cannot be serviced' using errcode = '22023'; end if;
  if p_kind not in ('service', 'repair', 'inspection') then raise exception 'unknown maintenance type' using errcode = '22023'; end if;
  if p_on is null or p_on > current_date then raise exception 'the date cannot be in the future' using errcode = '22023'; end if;
  if p_cost is null or p_cost < 0 or scale(p_cost) > 2 then raise exception 'cost must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_description, ''))) < 2 then raise exception 'describe the work (at least 2 characters)' using errcode = '22023'; end if;
  if p_cost > 0 then
    if p_method not in ('cash', 'bank_transfer', 'card', 'pos', 'other') then raise exception 'choose how it was paid' using errcode = '22023'; end if;
    v_number := public._next_number(a.business_id, 'expense', 'EXP');
    v_expense := gen_random_uuid();
    insert into public.expenses (id, business_id, expense_number, category, amount, payment_method, description, expense_date, source, created_by, idempotency_key)
    values (v_expense, a.business_id, v_number, 'repairs', p_cost, p_method, a.name || ': ' || btrim(p_description), p_on, 'maintenance', auth.uid(), p_key || ':expense');
  end if;
  insert into public.farm_maintenance_records (id, business_id, asset_id, kind, performed_on, cost, description, expense_id, created_by, idempotency_key)
  values (v_id, a.business_id, p_asset, p_kind, p_on, p_cost, btrim(p_description), v_expense, auth.uid(), p_key);
  return public._idem_store(a.business_id, p_key, 'maintenance_record', jsonb_build_object('record_id', v_id));
end $$;

create function public.void_maintenance(p_record uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.farm_maintenance_records; v_prev jsonb;
begin
  select * into r from public.farm_maintenance_records where id = p_record;
  if not found then raise exception 'record not found' using errcode = '22023'; end if;
  perform public._farm_guard(r.business_id, 'farm-equipment', 'farm.manage');
  v_prev := public._idem_check(r.business_id, p_key, 'maintenance_void'); if v_prev is not null then return v_prev; end if;
  if r.status <> 'posted' then raise exception 'record is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.farm_maintenance_records set status = 'voided', void_reason = btrim(p_reason) where id = p_record;
  if r.expense_id is not null then
    update public.expenses set status = 'voided', void_reason = 'Maintenance record voided: ' || btrim(p_reason), voided_at = now() where id = r.expense_id;
  end if;
  return public._idem_store(r.business_id, p_key, 'maintenance_void', jsonb_build_object('record_id', p_record));
end $$;

-- ------------------------------------------------------------------- alerts
-- Computed on request from the records. Thresholds: weekly mortality above 2% of the batch, harvest due within 7 days.
create function public.farm_alerts(p_business uuid) returns table (kind text, severity text, title text, detail text, ref_module text, ref_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._farm_guard(p_business, 'farm-alerts', 'farm.read');
  return query
  select 'low_stock'::text, case when s.on_hand <= 0 then 'critical' else 'warning' end, p.name || ' is running low',
    'On hand ' || trim_scale(s.on_hand) || ', reorder level ' || trim_scale(p.reorder_level), 'inventory'::text, p.id
  from public.products p
  cross join lateral (select coalesce(sum(ib.quantity_on_hand), 0) as on_hand from public.inventory_balances ib where ib.product_id = p.id) s
  where p.business_id = p_business and p.status = 'active' and p.tracks_stock and p.reorder_level > 0 and s.on_hand <= p.reorder_level
  union all
  select 'high_mortality', 'critical', 'High mortality in ' || x.batch_code,
    x.deaths || ' deaths in the last 7 days (' || round(x.deaths * 100.0 / (x.pop + x.deaths), 1) || '% of the batch)', 'farm-mortality', x.id
  from (
    select b.id, b.batch_code,
      coalesce((select sum(-ev.quantity) from public.farm_batch_events ev left join public.farm_batch_events o on o.id = ev.reverses_event_id
                where ev.farm_batch_id = b.id and (ev.event_type = 'mortality' or o.event_type = 'mortality') and ev.occurred_on >= current_date - 7), 0) as deaths,
      coalesce((select sum(ev.quantity) from public.farm_batch_events ev where ev.farm_batch_id = b.id), 0) as pop
    from public.farm_batches b where b.business_id = p_business and b.status = 'active' and b.production_type in ('poultry', 'fish', 'livestock')) x
  where x.deaths > 0 and x.deaths * 100.0 / nullif(x.pop + x.deaths, 0) > 2
  union all
  select 'overdue_task', case when t.priority = 'high' then 'critical' else 'warning' end, 'Overdue: ' || t.title, 'Was due ' || t.due_date, 'farm-tasks', t.id
  from public.farm_tasks t where t.business_id = p_business and t.status in ('todo', 'in_progress', 'review') and t.due_date < current_date
  union all
  select 'withdrawal_active', 'info', w.batch_code || ' is under a treatment withdrawal', w.title || ' until ' || w.withdrawal_ends_on, 'farm-health', w.farm_batch_id
  from public.farm_withdrawals w where w.business_id = p_business
  union all
  select 'harvest_due', case when b.planned_end_date < current_date then 'warning' else 'info' end, b.batch_code || ' (' || b.species_or_crop || ') harvest ' ||
    case when b.planned_end_date < current_date then 'is overdue' else 'is due soon' end, 'Expected ' || b.planned_end_date, 'farm-crops', b.id
  from public.farm_batches b where b.business_id = p_business and b.status = 'active' and b.production_type = 'crop' and b.planned_end_date is not null and b.planned_end_date <= current_date + 7
  union all
  select 'service_due', 'warning', a.name || ' needs servicing', 'Was due ' || a.next_service_on, 'farm-equipment', a.id
  from public.farm_asset_status a where a.business_id = p_business and a.service_overdue
  union all
  select 'overdue_bill', 'warning', 'Supplier bill ' || bs.bill_number || ' is overdue', bs.supplier_name || ', due ' || bs.due_date, 'farm-supplier-bills', bs.id
  from public.supplier_bill_status bs where bs.business_id = p_business and bs.overdue;
end $$;

revoke all on function public._farm_withdrawal_until(uuid, date), public.farm_withdrawal_guard(),
  public.save_farm_worker(uuid, uuid, text, text, text, boolean),
  public.save_farm_task(uuid, uuid, text, text, date, text, uuid, uuid, boolean, text), public.set_farm_task_status(uuid, text),
  public.farm_record_health(uuid, text, text, uuid, uuid, numeric, date, integer, text, text), public.farm_void_health(uuid, text, text),
  public.save_farm_asset(uuid, uuid, text, text, text, date, numeric, text, integer, text, text),
  public.record_maintenance(uuid, text, date, numeric, text, text, text), public.void_maintenance(uuid, text, text),
  public.farm_alerts(uuid) from public;
grant execute on function
  public.save_farm_worker(uuid, uuid, text, text, text, boolean),
  public.save_farm_task(uuid, uuid, text, text, date, text, uuid, uuid, boolean, text), public.set_farm_task_status(uuid, text),
  public.farm_record_health(uuid, text, text, uuid, uuid, numeric, date, integer, text, text), public.farm_void_health(uuid, text, text),
  public.save_farm_asset(uuid, uuid, text, text, text, date, numeric, text, integer, text, text),
  public.record_maintenance(uuid, text, date, numeric, text, text, text), public.void_maintenance(uuid, text, text),
  public.farm_alerts(uuid) to authenticated;
