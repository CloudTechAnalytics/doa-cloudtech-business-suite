-- Receipts that say who sold, from where, and what cash changed hands; and tighter cashier shifts.
--
-- * The business can set the address, phone and a closing line that print on every receipt (set_business_receipt).
-- * Cash given and change: the cashier types the cash the customer handed over; it is kept with the sale (sale_tenders) and printed on the receipt as
--   "Cash given" and "Change". Expected drawer cash still counts only what was paid for the sale, never the change handed back.
-- * Cash out can no longer be more than the cash that is in the drawer, so expected cash cannot go below zero.
-- * A shift opened by mistake (no cash sales, refunds or movements) can be deleted by a manager, with a reason kept in the audit trail. A shift with any
--   activity is a money record and can only be closed and reviewed.

-- ------------------------------------------------------------ settings: receipt details
do $$
declare def text;
begin
  def := pg_get_functiondef('public.validate_business_settings()'::regprocedure);
  def := replace(def, '''setup'', ''theme'') then', '''setup'', ''theme'', ''receipt'') then');
  def := replace(def, E'  if new.settings ? ''setup'' then',
    E'  if new.settings ? ''receipt'' then\n'
    || E'    if jsonb_typeof(new.settings -> ''receipt'') <> ''object'' or (select count(*) from jsonb_object_keys(new.settings -> ''receipt'')) > 3 then\n'
    || E'      raise exception ''receipt details must be an address, a phone and a closing line'' using errcode = ''22023'';\n'
    || E'    end if;\n'
    || E'    for k, v in select * from jsonb_each(new.settings -> ''receipt'') loop\n'
    || E'      if k not in (''address'', ''phone'', ''footer'') or jsonb_typeof(v) <> ''string'' or length(v #>> ''{}'') > 200 then\n'
    || E'        raise exception ''invalid receipt detail "%"'', k using errcode = ''22023'';\n'
    || E'      end if;\n'
    || E'    end loop;\n'
    || E'  end if;\n'
    || E'  if new.settings ? ''setup'' then');
  if def not like '%''receipt''%' or def not like '%invalid receipt detail%' then raise exception 'validate_business_settings not rewritten'; end if;
  execute def;
end $$;

create function public.set_business_receipt(p_business uuid, p_address text, p_phone text, p_footer text) returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb;
begin
  if not public.has_business_permission(p_business, 'settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if length(coalesce(p_address, '')) > 200 or length(coalesce(p_phone, '')) > 200 or length(coalesce(p_footer, '')) > 200 then raise exception 'each receipt detail can be up to 200 characters' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_address, '')), '') is not null then v := v || jsonb_build_object('address', btrim(p_address)); end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then v := v || jsonb_build_object('phone', btrim(p_phone)); end if;
  if nullif(btrim(coalesce(p_footer, '')), '') is not null then v := v || jsonb_build_object('footer', btrim(p_footer)); end if;
  update public.businesses set settings = case when v = '{}'::jsonb then coalesce(settings, '{}'::jsonb) - 'receipt' else jsonb_set(coalesce(settings, '{}'::jsonb), '{receipt}', v) end
   where id = p_business and status = 'active';
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
end $$;
revoke execute on function public.set_business_receipt(uuid, text, text, text) from public;
grant execute on function public.set_business_receipt(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------ cash given and change
create table public.sale_tenders (
  sale_id uuid primary key references public.sales (id) on delete cascade,
  business_id uuid not null,
  tendered numeric(14, 2) not null check (tendered > 0),
  change_given numeric(14, 2) not null check (change_given >= 0),
  created_at timestamptz not null default now()
);
alter table public.sale_tenders enable row level security;
create policy sale_tenders_select on public.sale_tenders for select to authenticated using (public.has_module_permission(business_id, 'sales', 'sales.read', 'read'));
grant select on public.sale_tenders to authenticated;

-- Records the cash the customer handed over for a sale. It must cover the cash part of the sale; the change is the difference. Once only.
create function public.record_sale_tender(p_sale uuid, p_tendered numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sales; v_cash numeric; v_change numeric;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._guard(s.business_id, 'sales', 'sales.create');
  if s.created_by is distinct from auth.uid() and not public.has_business_permission(s.business_id, 'sales.void') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_tendered is null or p_tendered <= 0 or scale(p_tendered) > 2 then raise exception 'the cash given must be above zero, with at most 2 decimals' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_cash from public.payments where sale_id = p_sale and payment_method = 'cash' and payment_type = 'sale_receipt' and status = 'successful';
  if v_cash <= 0 then raise exception 'this sale was not paid in cash' using errcode = '22023'; end if;
  if p_tendered < v_cash then raise exception 'the cash given (%) is less than the cash paid for the sale (%)', p_tendered, v_cash using errcode = '22023'; end if;
  if exists (select 1 from public.sale_tenders where sale_id = p_sale) then raise exception 'the cash given was already recorded for this sale' using errcode = '23505'; end if;
  v_change := round(p_tendered - v_cash, 2);
  insert into public.sale_tenders (sale_id, business_id, tendered, change_given) values (p_sale, s.business_id, round(p_tendered, 2), v_change);
  return jsonb_build_object('tendered', round(p_tendered, 2), 'change', v_change);
end $$;
revoke execute on function public.record_sale_tender(uuid, numeric) from public;
grant execute on function public.record_sale_tender(uuid, numeric) to authenticated;

-- the receipt now carries the shop's details, the cashier and the cash given
do $$
declare def text;
begin
  def := pg_get_functiondef('public.sale_receipt(uuid)'::regprocedure);
  def := replace(def, E'(select jsonb_build_object(''name'', name, ''currency'', default_currency) from public.businesses where id = s.business_id),',
    E'(select jsonb_build_object(''name'', name, ''currency'', default_currency, ''address'', settings #>> ''{receipt,address}'', ''phone'', settings #>> ''{receipt,phone}'', ''footer'', settings #>> ''{receipt,footer}'') from public.businesses where id = s.business_id),\n'
    || E'    ''cashier'', (select display_name from public.profiles where id = s.created_by),\n'
    || E'    ''tender'', (select jsonb_build_object(''tendered'', t.tendered, ''change'', t.change_given) from public.sale_tenders t where t.sale_id = p_sale),');
  if def not like '%sale_tenders%' then raise exception 'sale_receipt not rewritten'; end if;
  execute def;
end $$;

-- ------------------------------------------------------------ shifts
do $$
declare def text;
begin
  def := pg_get_functiondef('public.mart_cash_movement(uuid, text, numeric, text, text)'::regprocedure);
  def := replace(def, 'declare s public.cashier_shifts; v_prev jsonb;', 'declare s public.cashier_shifts; v_prev jsonb; v_drawer numeric;');
  def := replace(def, E'  insert into public.cash_movements (business_id, shift_id, direction, amount, reason, created_by, idempotency_key)',
    E'  if p_direction = ''out'' then\n'
    || E'    select expected_cash into v_drawer from public.shift_summary where id = p_shift;\n'
    || E'    if p_amount > coalesce(v_drawer, 0) then raise exception ''there is only ₦% in the drawer, so ₦% cannot be taken out'', to_char(coalesce(v_drawer, 0), ''FM999G999G999G990D00''), to_char(p_amount, ''FM999G999G999G990D00'') using errcode = ''22023''; end if;\n'
    || E'  end if;\n'
    || E'  insert into public.cash_movements (business_id, shift_id, direction, amount, reason, created_by, idempotency_key)');
  if def not like '%in the drawer, so%' then raise exception 'mart_cash_movement not rewritten'; end if;
  execute def;
end $$;

create function public.mart_delete_shift(p_shift uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; v_n integer;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(s.business_id, 'retail-shifts', 'retail.manage');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select count(*) into v_n from public.payments p where p.business_id = s.business_id and p.created_by = s.cashier_id and p.payment_method = 'cash'
     and coalesce(p.received_at, p.created_at) >= s.opened_at and coalesce(p.received_at, p.created_at) <= coalesce(s.closed_at, now());
  if v_n > 0 or exists (select 1 from public.cash_movements where shift_id = p_shift) then
    raise exception 'this shift has cash sales or cash in and out, so it is a money record and cannot be deleted; close it and mark it reviewed instead' using errcode = '22023';
  end if;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (s.business_id, auth.uid(), 'cashier_shifts.delete', 'cashier_shifts', p_shift, jsonb_build_object('number', s.shift_number, 'reason', btrim(p_reason), 'status', s.status));
  delete from public.cashier_shifts where id = p_shift;
end $$;
revoke execute on function public.mart_delete_shift(uuid, text) from public;
grant execute on function public.mart_delete_shift(uuid, text) to authenticated;
