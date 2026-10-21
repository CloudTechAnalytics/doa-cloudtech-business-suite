-- Prompt 5: customers, suppliers, sales/POS, payments, returns, purchasing.
-- Rules (adapted from the farm reference system's invoicing and procurement design):
--   * Totals are always computed here; browser totals are never trusted. Prices come from the catalogue
--     (a stale client price is rejected, not silently overridden).
--   * A sale deducts stock exactly once, in the same transaction that creates it.
--   * Only 'successful' payments count; payments can never exceed the balance; refunds are separate payments.
--   * A purchase order never changes stock; only a goods receipt does, at the order's unit cost.
--   * Every write is a SECURITY DEFINER function with permission, module/plan and idempotency checks.

-- ------------------------------------------------------------ permissions
insert into public.permissions (code, description) values
  ('sales.discount', 'Apply discounts on sales'),
  ('sales.void', 'Void posted sales'),
  ('customers.manage', 'Create and edit customers'),
  ('customers.credit', 'Set customer credit limits'),
  ('suppliers.manage', 'Create and edit suppliers'),
  ('purchases.manage', 'Create and cancel purchase orders'),
  ('purchases.receive', 'Receive goods against purchase orders'),
  ('purchases.pay', 'Record supplier payments');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  (r.name in ('owner', 'business_admin', 'manager') and p.code in
     ('sales.discount', 'sales.void', 'customers.manage', 'customers.credit', 'suppliers.manage', 'purchases.manage', 'purchases.receive', 'purchases.pay'))
  or (r.name = 'accountant' and p.code in ('purchases.pay', 'customers.credit'))
  or (r.name = 'cashier' and p.code = 'customers.manage')
  or (r.name = 'inventory_officer' and p.code in ('purchases.manage', 'purchases.receive', 'suppliers.manage'))
) where r.business_id is null
on conflict do nothing;

-- ------------------------------------------------------- parties and numbering
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  phone text, email text, address text,
  credit_limit numeric(14, 2) not null default 0 check (credit_limit >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create index customers_name_idx on public.customers (business_id, lower(name));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  contact_name text, phone text, email text, address text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create index suppliers_name_idx on public.suppliers (business_id, lower(name));

create table public.document_sequences (
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null,
  last_value bigint not null default 0,
  primary key (business_id, kind)
);

create function public._next_number(p_business uuid, p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.document_sequences (business_id, kind, last_value) values (p_business, p_kind, 1)
  on conflict (business_id, kind) do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end $$;

-- ----------------------------------------------------------------- sales
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  location_id uuid not null,
  sale_number text not null,
  customer_id uuid,
  status text not null default 'posted' check (status in ('posted', 'refunded', 'voided')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  currency text not null check (length(currency) = 3),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  grand_total numeric(14, 2) not null check (grand_total >= 0),
  amount_paid numeric(14, 2) not null default 0,
  returned_total numeric(14, 2) not null default 0 check (returned_total >= 0),
  balance_due numeric(14, 2) not null default 0 check (balance_due >= 0),
  refund_due numeric(14, 2) not null default 0 check (refund_due >= 0),
  note text,
  sold_at timestamptz not null default now(),
  voided_at timestamptz, void_reason text,
  created_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, sale_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);
create index sales_recent_idx on public.sales (business_id, sold_at desc);
create index sales_customer_idx on public.sales (business_id, customer_id) where customer_id is not null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  description_snapshot text not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  unit_cost_snapshot numeric(14, 4),
  stock_movement_id uuid,
  unique (business_id, id),
  foreign key (business_id, sale_id) references public.sales (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);
create index sale_items_sale_idx on public.sale_items (sale_id);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  return_number text not null,
  status text not null default 'posted' check (status in ('posted')),
  reason text not null check (length(btrim(reason)) >= 3),
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, return_number),
  foreign key (business_id, sale_id) references public.sales (business_id, id)
);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_return_id uuid not null,
  sale_item_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  refund_amount numeric(14, 2) not null check (refund_amount >= 0),
  disposition text not null check (disposition in ('restock', 'discard')),
  foreign key (business_id, sale_return_id) references public.sale_returns (business_id, id) on delete cascade,
  foreign key (business_id, sale_item_id) references public.sale_items (business_id, id)
);

-- -------------------------------------------------------------- purchasing
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  supplier_id uuid not null,
  purchase_number text not null,
  supplier_reference text,
  status text not null default 'ordered' check (status in ('ordered', 'partially_received', 'received', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  currency text not null check (length(currency) = 3),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  purchased_at timestamptz not null default now(),
  cancelled_at timestamptz, cancel_reason text,
  created_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, purchase_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id)
);
create index purchases_recent_idx on public.purchases (business_id, purchased_at desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_id uuid not null,
  product_id uuid not null,
  quantity_ordered numeric(18, 4) not null check (quantity_ordered > 0),
  quantity_received numeric(18, 4) not null default 0 check (quantity_received >= 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  unique (business_id, id),
  check (quantity_received <= quantity_ordered),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_id uuid not null,
  receipt_number text not null,
  location_id uuid not null,
  note text,
  received_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  unique (business_id, id),
  unique (business_id, receipt_number),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id),
  foreign key (business_id, location_id) references public.inventory_locations (business_id, id)
);

create table public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_receipt_id uuid not null,
  purchase_item_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null,
  stock_movement_id uuid,
  foreign key (business_id, purchase_receipt_id) references public.purchase_receipts (business_id, id) on delete cascade,
  foreign key (business_id, purchase_item_id) references public.purchase_items (business_id, id),
  foreign key (business_id, stock_movement_id) references public.stock_movements (business_id, id)
);

-- ---------------------------------------------------------------- payments
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  sale_id uuid,
  purchase_id uuid,
  sale_return_id uuid,
  payment_type text not null check (payment_type in ('sale_receipt', 'refund', 'purchase_payment')),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'card', 'pos', 'other')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (length(currency) = 3),
  status text not null check (status in ('pending', 'successful', 'reversed')),
  provider_reference text,
  idempotency_key text not null,
  received_at timestamptz,
  reversed_at timestamptz, reversal_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  check ((sale_id is not null)::int + (purchase_id is not null)::int = 1),
  check ((payment_type = 'purchase_payment') = (purchase_id is not null)),
  foreign key (business_id, sale_id) references public.sales (business_id, id),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id),
  foreign key (business_id, sale_return_id) references public.sale_returns (business_id, id)
);
create index payments_sale_idx on public.payments (sale_id) where sale_id is not null;
create index payments_purchase_idx on public.payments (purchase_id) where purchase_id is not null;

-- Payments are financial records: only the status may change (pending -> successful/reversed, successful -> reversed).
create function public.payments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'payments cannot be deleted; reverse them' using errcode = '42501'; end if;
  if (new.business_id, new.sale_id, new.purchase_id, new.payment_type, new.payment_method, new.amount, new.currency, new.idempotency_key)
     is distinct from (old.business_id, old.sale_id, old.purchase_id, old.payment_type, old.payment_method, old.amount, old.currency, old.idempotency_key) then
    raise exception 'payment details are immutable' using errcode = '42501';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then raise exception 'a reversed payment cannot be reopened' using errcode = '42501'; end if;
  return new;
end $$;
create trigger payments_guard_trg before update or delete on public.payments
  for each row execute function public.payments_guard();

-- --------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['customers', 'suppliers', 'sales', 'sale_items', 'sale_returns', 'sale_return_items',
    'purchases', 'purchase_items', 'purchase_receipts', 'purchase_receipt_items', 'payments', 'document_sequences'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy customers_select on public.customers for select to authenticated
  using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_module_permission(business_id, 'customers', 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (public.has_module_permission(business_id, 'customers', 'customers.manage'))
  with check (public.has_module_permission(business_id, 'customers', 'customers.manage'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_module_permission(business_id, 'suppliers', 'suppliers.read', 'read'));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (public.has_module_permission(business_id, 'suppliers', 'suppliers.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_module_permission(business_id, 'suppliers', 'suppliers.manage'))
  with check (public.has_module_permission(business_id, 'suppliers', 'suppliers.manage'));

do $$
declare t text;
begin
  foreach t in array array['sales', 'sale_items', 'sale_returns', 'sale_return_items'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (public.has_module_permission(business_id, 'sales', 'sales.read', 'read'))$f$, t || '_select', t);
  end loop;
  foreach t in array array['purchases', 'purchase_items', 'purchase_receipts', 'purchase_receipt_items'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (public.has_module_permission(business_id, 'purchases', 'purchases.read', 'read'))$f$, t || '_select', t);
  end loop;
end $$;

create policy payments_select on public.payments for select to authenticated using (
  (sale_id is not null and public.has_module_permission(business_id, 'sales', 'sales.read', 'read'))
  or (purchase_id is not null and public.has_module_permission(business_id, 'purchases', 'purchases.read', 'read')));

grant select on public.customers, public.suppliers, public.sales, public.sale_items, public.sale_returns,
  public.sale_return_items, public.purchases, public.purchase_items, public.purchase_receipts,
  public.purchase_receipt_items, public.payments to authenticated;
grant insert (business_id, name, phone, email, address) on public.customers to authenticated;
grant update (name, phone, email, address, status) on public.customers to authenticated;
grant insert (business_id, name, contact_name, phone, email, address) on public.suppliers to authenticated;
grant update (name, contact_name, phone, email, address, status) on public.suppliers to authenticated;
-- No other writes: everything else goes through the functions below.

-- ----------------------------------------------------------------- helpers
create function public._guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- Recomputes every derived money figure of a sale from its payments and returns.
create function public._recompute_sale(p_sale uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sales; v_paid numeric; v_refunded numeric; v_returned numeric; v_net numeric; v_amount_paid numeric;
begin
  select * into s from public.sales where id = p_sale for update;
  select coalesce(sum(amount) filter (where payment_type = 'sale_receipt'), 0), coalesce(sum(amount) filter (where payment_type = 'refund'), 0)
    into v_paid, v_refunded from public.payments where sale_id = p_sale and status = 'successful';
  select coalesce(sum(total_amount), 0) into v_returned from public.sale_returns where sale_id = p_sale;
  v_amount_paid := v_paid - v_refunded;
  v_net := s.grand_total - v_returned;
  if s.status = 'voided' then
    update public.sales set amount_paid = v_amount_paid, returned_total = v_returned, balance_due = 0, refund_due = 0, payment_status = 'unpaid' where id = p_sale;
    return;
  end if;
  update public.sales set
    amount_paid = v_amount_paid,
    returned_total = v_returned,
    balance_due = greatest(v_net - v_amount_paid, 0),
    refund_due = greatest(v_amount_paid - v_net, 0),
    payment_status = case when v_net - v_amount_paid <= 0 then 'paid' when v_amount_paid > 0 then 'partially_paid' else 'unpaid' end,
    status = case when s.grand_total > 0 and v_returned >= s.grand_total then 'refunded' else 'posted' end
  where id = p_sale;
end $$;

create function public._recompute_purchase(p_purchase uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.purchases; v_paid numeric;
begin
  select * into p from public.purchases where id = p_purchase for update;
  select coalesce(sum(amount), 0) into v_paid from public.payments where purchase_id = p_purchase and status = 'successful';
  update public.purchases set amount_paid = v_paid,
    payment_status = case when v_paid >= p.total_amount and p.total_amount > 0 then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end
  where id = p_purchase;
end $$;

-- Single entry point for recording a payment on a sale or purchase; enforces the balance cap.
create function public._record_payment(
  p_business uuid, p_sale uuid, p_purchase uuid, p_type text, p_method text, p_amount numeric, p_status text,
  p_reference text, p_key text, p_return uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_currency text; v_balance numeric; v_pending numeric; s public.sales; pu public.purchases;
begin
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then
    raise exception 'payment amount must be positive with at most 2 decimals' using errcode = '22023';
  end if;
  if p_status not in ('pending', 'successful') then raise exception 'invalid payment status' using errcode = '22023'; end if;

  if p_sale is not null then
    select * into s from public.sales where id = p_sale and business_id = p_business for update;
    if not found or s.status = 'voided' then raise exception 'sale not found or voided' using errcode = '22023'; end if;
    v_currency := s.currency;
    if p_type = 'sale_receipt' then
      select coalesce(sum(amount), 0) into v_pending from public.payments
       where sale_id = p_sale and status = 'pending' and payment_type = 'sale_receipt';
      v_balance := s.balance_due - case when p_status = 'pending' then v_pending else 0 end;
      if p_amount > v_balance then raise exception 'payment exceeds the amount due (%)', v_balance using errcode = '22023'; end if;
    elsif p_type = 'refund' then
      if p_amount > s.refund_due then raise exception 'refund exceeds the amount paid (%)', s.refund_due using errcode = '22023'; end if;
    end if;
  else
    select * into pu from public.purchases where id = p_purchase and business_id = p_business for update;
    if not found or pu.status = 'cancelled' then raise exception 'purchase not found or cancelled' using errcode = '22023'; end if;
    v_currency := pu.currency;
    if p_amount > pu.total_amount - pu.amount_paid then
      raise exception 'payment exceeds the amount due (%)', pu.total_amount - pu.amount_paid using errcode = '22023';
    end if;
  end if;

  insert into public.payments (business_id, sale_id, purchase_id, sale_return_id, payment_type, payment_method, amount, currency,
    status, provider_reference, idempotency_key, received_at, created_by)
  values (p_business, p_sale, p_purchase, p_return, p_type, p_method, p_amount, v_currency, p_status, p_reference, p_key,
    case when p_status = 'successful' then now() end, auth.uid())
  returning id into v_id;

  if p_sale is not null then perform public._recompute_sale(p_sale); else perform public._recompute_purchase(p_purchase); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- sales API
create function public.post_sale(
  p_business uuid, p_location uuid, p_customer uuid, p_items jsonb, p_payments jsonb, p_key text,
  p_note text default null, p_branch uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev jsonb; b public.businesses; v_rate numeric; v_item jsonb; pr public.products; v_group uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid(); v_number text; v_lines jsonb := '[]'::jsonb;
  v_qty numeric; v_price numeric; v_disc numeric; v_gross numeric; v_net numeric; v_tax numeric;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_grand numeric;
  l jsonb; m public.stock_movements; v_item_id uuid; v_pay jsonb; v_paid numeric := 0; v_balance numeric;
  v_outstanding numeric; v_limit numeric; v_i int := 0;
begin
  perform public._guard(p_business, 'sales', 'sales.create');
  v_prev := public._idem_check(p_business, p_key, 'sale_post'); if v_prev is not null then return v_prev; end if;
  select * into b from public.businesses where id = p_business;
  perform public._require_location(p_business, p_location);
  if p_branch is not null and not public.can_access_branch(p_business, p_branch) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and business_id = p_business and status = 'active') then
    raise exception 'unknown customer' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'a sale needs 1 to 100 lines' using errcode = '22023';
  end if;
  v_rate := coalesce((b.settings ->> 'tax_rate_percent')::numeric, 0);
  if v_rate < 0 or v_rate > 100 then raise exception 'invalid tax rate configured' using errcode = '22023'; end if;

  -- pass 1: validate and price every line on the server
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid and business_id = p_business;
    if not found or pr.status <> 'active' then raise exception 'invalid product on line %', v_i + 1 using errcode = '22023'; end if;
    if pr.currency <> b.default_currency then raise exception 'product % is priced in %, business currency is %', pr.name, pr.currency, b.default_currency using errcode = '22023'; end if;
    v_qty := round((v_item ->> 'quantity')::numeric, 4);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    v_price := pr.selling_price;
    if (v_item ->> 'unit_price') is not null and (v_item ->> 'unit_price')::numeric <> v_price then
      raise exception 'the price of % has changed to %; refresh and retry', pr.name, v_price using errcode = '22023';
    end if;
    v_gross := round(v_qty * v_price, 2);
    v_disc := coalesce((v_item ->> 'discount_amount')::numeric, 0);
    if v_disc < 0 or v_disc > v_gross or scale(v_disc) > 2 then raise exception 'invalid discount on line %', v_i + 1 using errcode = '22023'; end if;
    if v_disc > 0 and not public.has_business_permission(p_business, 'sales.discount') then
      raise exception 'you are not allowed to give discounts' using errcode = '42501';
    end if;
    v_net := v_gross - v_disc;
    v_tax := round(v_net * v_rate / 100, 2);
    v_sub := v_sub + v_gross; v_disc_total := v_disc_total + v_disc; v_tax_total := v_tax_total + v_tax;
    v_lines := v_lines || jsonb_build_object('product_id', pr.id, 'name', pr.name, 'tracks', pr.tracks_stock, 'qty', v_qty,
      'price', v_price, 'disc', v_disc, 'tax', v_tax, 'total', v_net + v_tax);
    v_i := v_i + 1;
  end loop;
  v_grand := v_sub - v_disc_total + v_tax_total;
  v_number := public._next_number(p_business, 'sale', 'SAL');

  insert into public.sales (id, business_id, branch_id, location_id, sale_number, customer_id, currency, subtotal, discount_total,
    tax_total, grand_total, balance_due, note, created_by, idempotency_key)
  values (v_sale, p_business, p_branch, p_location, v_number, p_customer, b.default_currency, v_sub, v_disc_total, v_tax_total, v_grand,
    v_grand, p_note, auth.uid(), p_key);

  -- pass 2: lines and stock (a failed stock check rolls the whole sale back)
  for l in select * from jsonb_array_elements(v_lines) loop
    m := null;
    if (l ->> 'tracks')::boolean then
      m := public._post_movement(p_business, (l ->> 'product_id')::uuid, p_location, 'sale', -(l ->> 'qty')::numeric, null,
                                 'sale', v_sale, v_group, null);
    end if;
    insert into public.sale_items (business_id, sale_id, product_id, description_snapshot, quantity, unit_price, discount_amount,
      tax_amount, line_total, unit_cost_snapshot, stock_movement_id)
    values (p_business, v_sale, (l ->> 'product_id')::uuid, l ->> 'name', (l ->> 'qty')::numeric, (l ->> 'price')::numeric,
      (l ->> 'disc')::numeric, (l ->> 'tax')::numeric, (l ->> 'total')::numeric, m.unit_cost, m.id);
  end loop;

  -- payments taken at the till
  v_i := 0;
  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    perform public._record_payment(p_business, v_sale, null, 'sale_receipt', v_pay ->> 'method', (v_pay ->> 'amount')::numeric,
      coalesce(v_pay ->> 'status', 'successful'), v_pay ->> 'reference', p_key || ':pay' || v_i);
    v_i := v_i + 1;
  end loop;

  select balance_due into v_balance from public.sales where id = v_sale;
  if v_balance > 0 then
    if p_customer is null then raise exception 'a sale with a balance due needs a customer (credit sale)' using errcode = '22023'; end if;
    select credit_limit into v_limit from public.customers where id = p_customer;
    select coalesce(sum(balance_due), 0) into v_outstanding from public.sales
     where business_id = p_business and customer_id = p_customer and id <> v_sale and status <> 'voided';
    if v_outstanding + v_balance > v_limit then
      raise exception 'credit limit exceeded: limit %, outstanding %, this sale adds %', v_limit, v_outstanding, v_balance using errcode = '22023';
    end if;
  end if;

  select amount_paid into v_paid from public.sales where id = v_sale;
  return public._idem_store(p_business, p_key, 'sale_post', jsonb_build_object(
    'sale_id', v_sale, 'sale_number', v_number, 'grand_total', v_grand, 'amount_paid', v_paid, 'balance_due', v_balance));
end $$;

create function public.record_sale_payment(
  p_sale uuid, p_method text, p_amount numeric, p_status text, p_reference text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sales; v_prev jsonb; v_id uuid;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = '22023'; end if;
  perform public._guard(s.business_id, 'sales', 'sales.create');
  v_prev := public._idem_check(s.business_id, p_key, 'sale_payment'); if v_prev is not null then return v_prev; end if;
  v_id := public._record_payment(s.business_id, p_sale, null, 'sale_receipt', p_method, p_amount, coalesce(p_status, 'successful'), p_reference, p_key);
  return public._idem_store(s.business_id, p_key, 'sale_payment', jsonb_build_object('payment_id', v_id));
end $$;

create function public.confirm_payment(p_payment uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.payments; v_prev jsonb; s public.sales; pu public.purchases;
begin
  select * into p from public.payments where id = p_payment;
  if not found then raise exception 'payment not found' using errcode = '22023'; end if;
  if p.sale_id is not null then perform public._guard(p.business_id, 'sales', 'sales.create');
  else perform public._guard(p.business_id, 'purchases', 'purchases.pay'); end if;
  v_prev := public._idem_check(p.business_id, p_key, 'payment_confirm'); if v_prev is not null then return v_prev; end if;
  if p.status <> 'pending' then raise exception 'only pending payments can be confirmed' using errcode = '22023'; end if;
  if p.sale_id is not null then
    select * into s from public.sales where id = p.sale_id for update;
    if s.status = 'voided' then raise exception 'sale is voided' using errcode = '22023'; end if;
    if p.amount > s.balance_due then raise exception 'payment exceeds the amount due (%)', s.balance_due using errcode = '22023'; end if;
  else
    select * into pu from public.purchases where id = p.purchase_id for update;
    if p.amount > pu.total_amount - pu.amount_paid then raise exception 'payment exceeds the amount due' using errcode = '22023'; end if;
  end if;
  update public.payments set status = 'successful', received_at = now() where id = p_payment;
  if p.sale_id is not null then perform public._recompute_sale(p.sale_id); else perform public._recompute_purchase(p.purchase_id); end if;
  return public._idem_store(p.business_id, p_key, 'payment_confirm', jsonb_build_object('payment_id', p_payment));
end $$;

-- Pending payments can be cancelled by whoever can take payments; successful ones need refund/pay authority.
create function public.reverse_payment(p_payment uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.payments; v_prev jsonb; s public.sales;
begin
  select * into p from public.payments where id = p_payment;
  if not found then raise exception 'payment not found' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p.sale_id is not null then
    perform public._guard(p.business_id, 'sales', case when p.status = 'pending' then 'sales.create' else 'sales.refund' end);
  else
    perform public._guard(p.business_id, 'purchases', 'purchases.pay');
  end if;
  v_prev := public._idem_check(p.business_id, p_key, 'payment_reverse'); if v_prev is not null then return v_prev; end if;
  if p.status = 'reversed' then raise exception 'payment already reversed' using errcode = '22023'; end if;
  if p.payment_type = 'refund' then raise exception 'refunds cannot be reversed' using errcode = '22023'; end if;
  if p.sale_id is not null then
    select * into s from public.sales where id = p.sale_id for update;
    if p.status = 'successful' and s.amount_paid - p.amount < 0 then
      raise exception 'cannot reverse: refunds already paid out exceed the remaining payments' using errcode = '22023';
    end if;
  end if;
  update public.payments set status = 'reversed', reversed_at = now(), reversal_reason = p_reason where id = p_payment;
  if p.sale_id is not null then perform public._recompute_sale(p.sale_id); else perform public._recompute_purchase(p.purchase_id); end if;
  return public._idem_store(p.business_id, p_key, 'payment_reverse', jsonb_build_object('payment_id', p_payment));
end $$;

create function public.return_sale(
  p_sale uuid, p_items jsonb, p_reason text, p_refund jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sales; v_prev jsonb; v_it jsonb; si public.sale_items; v_qty numeric; v_prior_qty numeric; v_prior_amt numeric;
  v_refund numeric; v_total numeric := 0; v_ret uuid := gen_random_uuid(); v_number text; v_group uuid := gen_random_uuid();
  v_disp text; v_tracks boolean; v_lines jsonb := '[]'::jsonb; l jsonb; v_due numeric;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = '22023'; end if;
  perform public._guard(s.business_id, 'sales', 'sales.refund');
  v_prev := public._idem_check(s.business_id, p_key, 'sale_return'); if v_prev is not null then return v_prev; end if;
  select * into s from public.sales where id = p_sale for update;
  if s.status = 'voided' then raise exception 'a voided sale cannot be returned' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a return reason is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'select at least one item to return' using errcode = '22023';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select * into si from public.sale_items where id = (v_it ->> 'sale_item_id')::uuid and sale_id = p_sale and business_id = s.business_id;
    if not found then raise exception 'item does not belong to this sale' using errcode = '22023'; end if;
    v_qty := round((v_it ->> 'quantity')::numeric, 4);
    if v_qty is null or v_qty <= 0 then raise exception 'return quantity must be greater than zero' using errcode = '22023'; end if;
    select coalesce(sum(quantity), 0), coalesce(sum(refund_amount), 0) into v_prior_qty, v_prior_amt
      from public.sale_return_items where sale_item_id = si.id;
    -- earlier lines for the same item inside this request count against eligibility and the remainder too
    select v_prior_qty + coalesce(sum((x ->> 'quantity')::numeric), 0), v_prior_amt + coalesce(sum((x ->> 'refund')::numeric), 0)
      into v_prior_qty, v_prior_amt
      from jsonb_array_elements(v_lines) x where (x ->> 'sale_item_id')::uuid = si.id;
    if v_qty > si.quantity - v_prior_qty then
      raise exception 'only % of % remain returnable for %', si.quantity - v_prior_qty, si.quantity, si.description_snapshot using errcode = '22023';
    end if;
    v_disp := coalesce(v_it ->> 'disposition', 'restock');
    if v_disp not in ('restock', 'discard') then raise exception 'disposition must be restock or discard' using errcode = '22023'; end if;
    -- the last returnable unit takes the remainder so cents never drift
    v_refund := case when v_qty = si.quantity - v_prior_qty then si.line_total - v_prior_amt
                     else round(si.line_total * v_qty / si.quantity, 2) end;
    v_total := v_total + v_refund;
    v_lines := v_lines || jsonb_build_object('sale_item_id', si.id, 'quantity', v_qty, 'refund', v_refund, 'disposition', v_disp);
  end loop;

  v_number := public._next_number(s.business_id, 'return', 'RET');
  insert into public.sale_returns (id, business_id, sale_id, return_number, reason, total_amount, created_by)
  values (v_ret, s.business_id, p_sale, v_number, p_reason, v_total, auth.uid());

  for l in select * from jsonb_array_elements(v_lines) loop
    select * into si from public.sale_items where id = (l ->> 'sale_item_id')::uuid;
    insert into public.sale_return_items (business_id, sale_return_id, sale_item_id, quantity, refund_amount, disposition)
    values (s.business_id, v_ret, si.id, (l ->> 'quantity')::numeric, (l ->> 'refund')::numeric, l ->> 'disposition');
    select tracks_stock into v_tracks from public.products where id = si.product_id;
    if l ->> 'disposition' = 'restock' and si.stock_movement_id is not null and v_tracks then
      perform public._post_movement(s.business_id, si.product_id, s.location_id, 'return_in', (l ->> 'quantity')::numeric,
        si.unit_cost_snapshot, 'sale_return', v_ret, v_group, 'Return ' || v_number);
    end if;
  end loop;

  perform public._recompute_sale(p_sale);

  if p_refund is not null and p_refund ->> 'amount' is not null then
    select refund_due into v_due from public.sales where id = p_sale;
    perform public._record_payment(s.business_id, p_sale, null, 'refund', p_refund ->> 'method', (p_refund ->> 'amount')::numeric,
      'successful', p_refund ->> 'reference', p_key || ':refund', v_ret);
  end if;

  return public._idem_store(s.business_id, p_key, 'sale_return', jsonb_build_object(
    'return_id', v_ret, 'return_number', v_number, 'total_amount', v_total));
end $$;

create function public.void_sale(p_sale uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sales; v_prev jsonb; si record; v_group uuid := gen_random_uuid(); v_mv public.stock_movements;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = '22023'; end if;
  perform public._guard(s.business_id, 'sales', 'sales.void');
  v_prev := public._idem_check(s.business_id, p_key, 'sale_void'); if v_prev is not null then return v_prev; end if;
  select * into s from public.sales where id = p_sale for update;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if s.status <> 'posted' then raise exception 'only posted sales can be voided' using errcode = '22023'; end if;
  if exists (select 1 from public.sale_returns where sale_id = p_sale) then
    raise exception 'a sale with returns cannot be voided' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where sale_id = p_sale and status = 'successful') then
    raise exception 'reverse the successful payments before voiding this sale' using errcode = '22023';
  end if;
  update public.payments set status = 'reversed', reversed_at = now(), reversal_reason = 'Sale voided'
   where sale_id = p_sale and status = 'pending';

  for si in select * from public.sale_items where sale_id = p_sale and stock_movement_id is not null loop
    select * into v_mv from public.stock_movements where id = si.stock_movement_id;
    perform public._post_movement(s.business_id, si.product_id, v_mv.location_id, 'reversal', -v_mv.quantity_delta, v_mv.unit_cost,
      'sale_void', p_sale, v_group, 'Void ' || s.sale_number, now(), v_mv.id);
  end loop;
  update public.sales set status = 'voided', voided_at = now(), void_reason = p_reason where id = p_sale;
  perform public._recompute_sale(p_sale);
  return public._idem_store(s.business_id, p_key, 'sale_void', jsonb_build_object('sale_id', p_sale));
end $$;

create function public.set_customer_credit_limit(p_customer uuid, p_limit numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'customer not found' using errcode = '22023'; end if;
  perform public._guard(c.business_id, 'customers', 'customers.credit');
  if p_limit is null or p_limit < 0 then raise exception 'invalid credit limit' using errcode = '22023'; end if;
  update public.customers set credit_limit = round(p_limit, 2) where id = p_customer;
end $$;

-- Everything needed to print a receipt, in one call.
create function public.sale_receipt(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found or not public.has_module_permission(s.business_id, 'sales', 'sales.read', 'read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'business', (select jsonb_build_object('name', name, 'currency', default_currency) from public.businesses where id = s.business_id),
    'sale', to_jsonb(s) - 'idempotency_key' - 'created_by',
    'customer', (select jsonb_build_object('name', name, 'phone', phone) from public.customers where id = s.customer_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', description_snapshot, 'quantity', quantity, 'unit_price', unit_price,
        'discount', discount_amount, 'tax', tax_amount, 'total', line_total) order by id) from public.sale_items where sale_id = p_sale), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', payment_method, 'amount', amount, 'status', status, 'type', payment_type, 'at', coalesce(received_at, created_at)) order by created_at)
        from public.payments where sale_id = p_sale), '[]'));
end $$;

-- ----------------------------------------------------------- purchasing API
create function public.create_purchase(
  p_business uuid, p_supplier uuid, p_items jsonb, p_reference text, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev jsonb; b public.businesses; v_item jsonb; pr public.products; v_qty numeric; v_cost numeric; v_line numeric;
  v_sub numeric := 0; v_id uuid := gen_random_uuid(); v_number text; v_lines jsonb := '[]'::jsonb; l jsonb;
begin
  perform public._guard(p_business, 'purchases', 'purchases.manage');
  v_prev := public._idem_check(p_business, p_key, 'purchase_create'); if v_prev is not null then return v_prev; end if;
  select * into b from public.businesses where id = p_business;
  if not exists (select 1 from public.suppliers where id = p_supplier and business_id = p_business and status = 'active') then
    raise exception 'unknown supplier' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'a purchase needs 1 to 100 lines' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid and business_id = p_business;
    if not found or pr.status <> 'active' then raise exception 'invalid product' using errcode = '22023'; end if;
    v_qty := round((v_item ->> 'quantity')::numeric, 4);
    v_cost := coalesce((v_item ->> 'unit_cost')::numeric, pr.default_purchase_cost);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'a unit cost is required for %', pr.name using errcode = '22023'; end if;
    v_line := round(v_qty * v_cost, 2);
    v_sub := v_sub + v_line;
    v_lines := v_lines || jsonb_build_object('product_id', pr.id, 'qty', v_qty, 'cost', v_cost, 'line', v_line);
  end loop;
  v_number := public._next_number(p_business, 'purchase', 'PO');
  insert into public.purchases (id, business_id, supplier_id, purchase_number, supplier_reference, currency, subtotal, total_amount, created_by, idempotency_key)
  values (v_id, p_business, p_supplier, v_number, p_reference, b.default_currency, v_sub, v_sub, auth.uid(), p_key);
  for l in select * from jsonb_array_elements(v_lines) loop
    insert into public.purchase_items (business_id, purchase_id, product_id, quantity_ordered, unit_cost, line_total)
    values (p_business, v_id, (l ->> 'product_id')::uuid, (l ->> 'qty')::numeric, (l ->> 'cost')::numeric, (l ->> 'line')::numeric);
  end loop;
  return public._idem_store(p_business, p_key, 'purchase_create', jsonb_build_object('purchase_id', v_id, 'purchase_number', v_number, 'total_amount', v_sub));
end $$;

-- The only way a purchase touches stock.
create function public.receive_purchase(p_purchase uuid, p_location uuid, p_lines jsonb, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pu public.purchases; v_prev jsonb; v_line jsonb; pi public.purchase_items; v_qty numeric; v_rec uuid := gen_random_uuid();
  v_number text; v_group uuid := gen_random_uuid(); m public.stock_movements; v_tracks boolean; v_open numeric;
begin
  select * into pu from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found' using errcode = '22023'; end if;
  perform public._guard(pu.business_id, 'purchases', 'purchases.receive');
  v_prev := public._idem_check(pu.business_id, p_key, 'purchase_receive'); if v_prev is not null then return v_prev; end if;
  select * into pu from public.purchases where id = p_purchase for update;
  if pu.status not in ('ordered', 'partially_received') then raise exception 'purchase is % and cannot receive goods', pu.status using errcode = '22023'; end if;
  perform public._require_location(pu.business_id, p_location);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'select at least one line to receive' using errcode = '22023';
  end if;
  v_number := public._next_number(pu.business_id, 'receipt', 'GRN');
  insert into public.purchase_receipts (id, business_id, purchase_id, receipt_number, location_id, note, created_by)
  values (v_rec, pu.business_id, p_purchase, v_number, p_location, p_note, auth.uid());

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into pi from public.purchase_items
     where id = (v_line ->> 'purchase_item_id')::uuid and purchase_id = p_purchase and business_id = pu.business_id for update;
    if not found then raise exception 'line does not belong to this purchase' using errcode = '22023'; end if;
    v_qty := round((v_line ->> 'quantity')::numeric, 4);
    v_open := pi.quantity_ordered - pi.quantity_received;
    if v_qty is null or v_qty <= 0 then raise exception 'received quantity must be greater than zero' using errcode = '22023'; end if;
    if v_qty > v_open then raise exception 'only % remain to be received on this line', v_open using errcode = '22023'; end if;
    m := null;
    select tracks_stock into v_tracks from public.products where id = pi.product_id;
    if v_tracks then
      m := public._post_movement(pu.business_id, pi.product_id, p_location, 'receipt', v_qty, pi.unit_cost,
             'purchase_receipt', v_rec, v_group, pu.purchase_number);
    end if;
    insert into public.purchase_receipt_items (business_id, purchase_receipt_id, purchase_item_id, quantity, unit_cost, stock_movement_id)
    values (pu.business_id, v_rec, pi.id, v_qty, pi.unit_cost, m.id);
    update public.purchase_items set quantity_received = quantity_received + v_qty where id = pi.id;
  end loop;

  update public.purchases set status = case when not exists (
      select 1 from public.purchase_items where purchase_id = p_purchase and quantity_received < quantity_ordered)
    then 'received' else 'partially_received' end where id = p_purchase;
  return public._idem_store(pu.business_id, p_key, 'purchase_receive', jsonb_build_object('receipt_id', v_rec, 'receipt_number', v_number));
end $$;

create function public.pay_purchase(p_purchase uuid, p_method text, p_amount numeric, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pu public.purchases; v_prev jsonb; v_id uuid;
begin
  select * into pu from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found' using errcode = '22023'; end if;
  perform public._guard(pu.business_id, 'purchases', 'purchases.pay');
  v_prev := public._idem_check(pu.business_id, p_key, 'purchase_payment'); if v_prev is not null then return v_prev; end if;
  v_id := public._record_payment(pu.business_id, null, p_purchase, 'purchase_payment', p_method, p_amount, 'successful', p_reference, p_key);
  return public._idem_store(pu.business_id, p_key, 'purchase_payment', jsonb_build_object('payment_id', v_id));
end $$;

create function public.cancel_purchase(p_purchase uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pu public.purchases; v_prev jsonb;
begin
  select * into pu from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found' using errcode = '22023'; end if;
  perform public._guard(pu.business_id, 'purchases', 'purchases.manage');
  v_prev := public._idem_check(pu.business_id, p_key, 'purchase_cancel'); if v_prev is not null then return v_prev; end if;
  select * into pu from public.purchases where id = p_purchase for update;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if pu.status <> 'ordered' then raise exception 'only an order with nothing received can be cancelled' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where purchase_id = p_purchase and status = 'successful') then
    raise exception 'reverse the supplier payments before cancelling' using errcode = '22023';
  end if;
  update public.purchases set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_purchase;
  return public._idem_store(pu.business_id, p_key, 'purchase_cancel', jsonb_build_object('purchase_id', p_purchase));
end $$;

-- ----------------------------------------------------------------- grants
revoke all on function
  public._next_number(uuid, text, text), public._guard(uuid, text, text), public._recompute_sale(uuid), public._recompute_purchase(uuid),
  public._record_payment(uuid, uuid, uuid, text, text, numeric, text, text, text, uuid), public.payments_guard(),
  public.post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid),
  public.record_sale_payment(uuid, text, numeric, text, text, text), public.confirm_payment(uuid, text),
  public.reverse_payment(uuid, text, text), public.return_sale(uuid, jsonb, text, jsonb, text), public.void_sale(uuid, text, text),
  public.set_customer_credit_limit(uuid, numeric), public.sale_receipt(uuid),
  public.create_purchase(uuid, uuid, jsonb, text, text), public.receive_purchase(uuid, uuid, jsonb, text, text),
  public.pay_purchase(uuid, text, numeric, text, text), public.cancel_purchase(uuid, text, text)
from public;

grant execute on function
  public.post_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid),
  public.record_sale_payment(uuid, text, numeric, text, text, text), public.confirm_payment(uuid, text),
  public.reverse_payment(uuid, text, text), public.return_sale(uuid, jsonb, text, jsonb, text), public.void_sale(uuid, text, text),
  public.set_customer_credit_limit(uuid, numeric), public.sale_receipt(uuid),
  public.create_purchase(uuid, uuid, jsonb, text, text), public.receive_purchase(uuid, uuid, jsonb, text, text),
  public.pay_purchase(uuid, text, numeric, text, text), public.cancel_purchase(uuid, text, text)
to authenticated;
