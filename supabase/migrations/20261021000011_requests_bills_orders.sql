-- Procurement and customer orders, ported from the farm reference system and built on the existing sales and purchases:
--   * Purchase request -> approval -> purchase order. A request never changes stock or money; ordering it creates a normal
--     purchase order through create_purchase, so every purchasing rule still applies.
--   * Supplier bill: the supplier's invoice for a purchase order. Duplicate numbers per supplier are rejected and the bills
--     for an order can never add up to more than the order. Paying is recorded on the purchase order (payments cap there).
--   * Sales order: what a customer has asked for. It reserves nothing. Fulfilment creates a normal sale through post_sale
--     (stock, pricing, payments and credit limit all apply), and "fulfilled" is derived from the non-voided sales linked to
--     the order, so voiding a sale reopens the order automatically.
-- Additive only, plus one nullable column on sales. Rollback: drop the objects created here.

-- ----------------------------------------------------------- purchase requests
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  request_number text not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'ordered', 'cancelled')),
  note text,
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  purchase_id uuid,
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, request_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id)
);

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  request_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  estimated_unit_cost numeric(14, 4) check (estimated_unit_cost is null or estimated_unit_cost >= 0),
  unique (request_id, product_id),
  foreign key (business_id, request_id) references public.purchase_requests (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);

-- ------------------------------------------------------------- supplier bills
create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null,
  purchase_id uuid not null,
  bill_number text not null check (length(btrim(bill_number)) between 1 and 60),
  bill_date date not null,
  due_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'voided')),
  void_reason text,
  voided_at timestamptz,
  created_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  check (due_date >= bill_date),
  check (status = 'open' or void_reason is not null),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, purchase_id) references public.purchases (business_id, id)
);
-- A supplier's bill number is unique among their live bills.
create unique index supplier_bills_number_uq on public.supplier_bills (business_id, supplier_id, lower(btrim(bill_number))) where status = 'open';

-- --------------------------------------------------------------- sales orders
create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_number text not null,
  customer_id uuid not null,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  expected_date date,
  note text,
  cancel_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id),
  unique (business_id, order_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  quoted_unit_price numeric(14, 2) not null check (quoted_unit_price >= 0),
  unique (order_id, product_id),
  foreign key (business_id, order_id) references public.sales_orders (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id)
);

alter table public.sales add column sales_order_id uuid;
alter table public.sales add foreign key (business_id, sales_order_id) references public.sales_orders (business_id, id);
create index sales_order_link_idx on public.sales (sales_order_id) where sales_order_id is not null;

-- Ordered, fulfilled and remaining per line, from the non-voided sales linked to the order.
create view public.sales_order_line_status with (security_invoker = true) as
select l.id as line_id, l.order_id, l.business_id, l.product_id, l.quantity, l.quoted_unit_price,
  coalesce(f.qty, 0) as fulfilled, l.quantity - coalesce(f.qty, 0) as remaining
from public.sales_order_lines l
left join lateral (
  select sum(si.quantity) as qty from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
  where s.sales_order_id = l.order_id and si.product_id = l.product_id and s.status <> 'voided') f on true;

create view public.sales_order_status with (security_invoker = true) as
select o.id, o.business_id, o.order_number, o.customer_id, o.expected_date, o.note, o.created_at, o.cancel_reason,
  case when o.status = 'cancelled' then 'cancelled'
       when not exists (select 1 from public.sales_order_line_status s where s.order_id = o.id and s.remaining > 0) then 'fulfilled'
       when exists (select 1 from public.sales_order_line_status s where s.order_id = o.id and s.fulfilled > 0) then 'partially_fulfilled'
       else 'open' end as status,
  (select coalesce(sum(round(l.quantity * l.quoted_unit_price, 2)), 0) from public.sales_order_lines l where l.order_id = o.id) as quoted_total
from public.sales_orders o;

-- Bills with what the purchase order has been paid so far.
create view public.supplier_bill_status with (security_invoker = true) as
select b.id, b.business_id, b.supplier_id, sp.name as supplier_name, b.purchase_id, p.purchase_number, b.bill_number, b.bill_date, b.due_date,
  b.amount, b.status, b.void_reason, p.total_amount as purchase_total, p.amount_paid as purchase_paid, p.payment_status,
  (b.status = 'open' and p.payment_status <> 'paid' and b.due_date < current_date) as overdue
from public.supplier_bills b
join public.suppliers sp on sp.business_id = b.business_id and sp.id = b.supplier_id
join public.purchases p on p.business_id = b.business_id and p.id = b.purchase_id;

-- --------------------------------------------------------------------- RLS
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.supplier_bills enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;

create policy purchase_requests_select on public.purchase_requests for select to authenticated
  using (public.has_module_permission(business_id, 'farm-purchase-requests', 'procurement.request', 'read'));
create policy purchase_request_items_select on public.purchase_request_items for select to authenticated
  using (public.has_module_permission(business_id, 'farm-purchase-requests', 'procurement.request', 'read'));
create policy supplier_bills_select on public.supplier_bills for select to authenticated
  using (public.has_module_permission(business_id, 'farm-supplier-bills', 'purchases.read', 'read'));
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (public.has_module_permission(business_id, 'farm-sales-orders', 'sales.read', 'read'));
create policy sales_order_lines_select on public.sales_order_lines for select to authenticated
  using (public.has_module_permission(business_id, 'farm-sales-orders', 'sales.read', 'read'));
grant select on public.purchase_requests, public.purchase_request_items, public.supplier_bills, public.sales_orders, public.sales_order_lines,
  public.sales_order_line_status, public.sales_order_status, public.supplier_bill_status to authenticated;

create trigger audit_purchase_requests after insert or update on public.purchase_requests for each row execute function public.audit_row_change();
create trigger audit_supplier_bills after insert or update on public.supplier_bills for each row execute function public.audit_row_change();
create trigger audit_sales_orders after insert or update on public.sales_orders for each row execute function public.audit_row_change();

-- ------------------------------------------------------ purchase request API
create function public.create_purchase_request(p_business uuid, p_items jsonb, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; v_item jsonb; pr public.products; v_qty numeric; v_cost numeric;
begin
  perform public._guard_any(p_business, array['farm-purchase-requests'], 'procurement.request');
  v_prev := public._idem_check(p_business, p_key, 'pr_create'); if v_prev is not null then return v_prev; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'a request needs 1 to 50 lines' using errcode = '22023';
  end if;
  v_number := public._next_number(p_business, 'purchase_request', 'PRQ');
  insert into public.purchase_requests (id, business_id, request_number, note, requested_by, idempotency_key)
  values (v_id, p_business, v_number, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_key);
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid and business_id = p_business;
    if not found or pr.status <> 'active' then raise exception 'invalid product' using errcode = '22023'; end if;
    v_qty := round((v_item ->> 'quantity')::numeric, 4);
    v_cost := nullif(v_item ->> 'estimated_unit_cost', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if v_cost is not null and v_cost < 0 then raise exception 'estimated cost cannot be negative' using errcode = '22023'; end if;
    begin
      insert into public.purchase_request_items (business_id, request_id, product_id, quantity, estimated_unit_cost)
      values (p_business, v_id, pr.id, v_qty, v_cost);
    exception when unique_violation then
      raise exception 'each product can appear once per request' using errcode = '22023';
    end;
  end loop;
  return public._idem_store(p_business, p_key, 'pr_create', jsonb_build_object('request_id', v_id, 'request_number', v_number));
end $$;

-- Approve or reject. Someone else decides your request, unless you own the business.
create function public.decide_purchase_request(p_request uuid, p_approve boolean, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; v_prev jsonb; v_owner boolean;
begin
  select * into r from public.purchase_requests where id = p_request;
  if not found then raise exception 'request not found' using errcode = '22023'; end if;
  perform public._guard_any(r.business_id, array['farm-purchase-requests'], 'procurement.approve');
  v_prev := public._idem_check(r.business_id, p_key, 'pr_decide'); if v_prev is not null then return v_prev; end if;
  select * into r from public.purchase_requests where id = p_request for update;
  if r.status <> 'requested' then raise exception 'only a request that is awaiting a decision can be decided' using errcode = '22023'; end if;
  select owner_user_id = auth.uid() into v_owner from public.businesses where id = r.business_id;
  if r.requested_by = auth.uid() and not v_owner then raise exception 'another approver must decide your own request' using errcode = '42501'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why the request is rejected' using errcode = '22023'; end if;
  update public.purchase_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_request;
  return public._idem_store(r.business_id, p_key, 'pr_decide', jsonb_build_object('request_id', p_request, 'approved', p_approve));
end $$;

create function public.cancel_purchase_request(p_request uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; v_prev jsonb;
begin
  select * into r from public.purchase_requests where id = p_request;
  if not found then raise exception 'request not found' using errcode = '22023'; end if;
  perform public._guard_any(r.business_id, array['farm-purchase-requests'], 'procurement.request');
  v_prev := public._idem_check(r.business_id, p_key, 'pr_cancel'); if v_prev is not null then return v_prev; end if;
  select * into r from public.purchase_requests where id = p_request for update;
  if r.status not in ('requested', 'approved') then raise exception 'this request can no longer be cancelled' using errcode = '22023'; end if;
  if r.requested_by <> auth.uid() and not public.has_business_permission(r.business_id, 'procurement.approve') then
    raise exception 'only the requester or an approver can cancel a request' using errcode = '42501';
  end if;
  update public.purchase_requests set status = 'cancelled' where id = p_request;
  return public._idem_store(r.business_id, p_key, 'pr_cancel', jsonb_build_object('request_id', p_request));
end $$;

-- Turns an approved request into a purchase order. The order is created by create_purchase, so its permission, supplier,
-- product and cost rules apply (the Purchases module must be on, and the user must be allowed to create orders).
create function public.order_purchase_request(p_request uuid, p_supplier uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; v_prev jsonb; v_items jsonb; v_po jsonb;
begin
  select * into r from public.purchase_requests where id = p_request;
  if not found then raise exception 'request not found' using errcode = '22023'; end if;
  perform public._guard_any(r.business_id, array['farm-purchase-requests'], 'procurement.approve');
  v_prev := public._idem_check(r.business_id, p_key, 'pr_order'); if v_prev is not null then return v_prev; end if;
  select * into r from public.purchase_requests where id = p_request for update;
  if r.status <> 'approved' then raise exception 'only an approved request can be ordered' using errcode = '22023'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity, 'unit_cost', estimated_unit_cost)) into v_items
    from public.purchase_request_items where request_id = p_request;
  v_po := public.create_purchase(r.business_id, p_supplier, v_items, r.request_number, p_key || ':po');
  update public.purchase_requests set status = 'ordered', purchase_id = (v_po ->> 'purchase_id')::uuid where id = p_request;
  return public._idem_store(r.business_id, p_key, 'pr_order', jsonb_build_object('request_id', p_request, 'purchase_id', v_po ->> 'purchase_id', 'purchase_number', v_po ->> 'purchase_number'));
end $$;

-- ---------------------------------------------------------- supplier bill API
create function public.record_supplier_bill(
  p_business uuid, p_purchase uuid, p_bill_number text, p_bill_date date, p_due_date date, p_amount numeric, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; pu public.purchases; v_id uuid := gen_random_uuid(); v_billed numeric;
begin
  perform public._guard_any(p_business, array['farm-supplier-bills'], 'purchases.pay');
  v_prev := public._idem_check(p_business, p_key, 'bill_record'); if v_prev is not null then return v_prev; end if;
  select * into pu from public.purchases where id = p_purchase and business_id = p_business for update;
  if not found or pu.status = 'cancelled' then raise exception 'purchase order not found or cancelled' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_bill_number, ''))) = 0 then raise exception 'enter the supplier''s bill number' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then raise exception 'amount must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if p_bill_date is null or p_due_date is null or p_due_date < p_bill_date then raise exception 'the due date cannot be before the bill date' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_billed from public.supplier_bills where purchase_id = p_purchase and status = 'open';
  if v_billed + p_amount > pu.total_amount then
    raise exception 'bills for this order would exceed its total: order %, already billed %', pu.total_amount, v_billed using errcode = '22023';
  end if;
  begin
    insert into public.supplier_bills (id, business_id, supplier_id, purchase_id, bill_number, bill_date, due_date, amount, created_by, idempotency_key)
    values (v_id, p_business, pu.supplier_id, p_purchase, btrim(p_bill_number), p_bill_date, p_due_date, p_amount, auth.uid(), p_key);
  exception when unique_violation then
    raise exception 'duplicate key: this supplier already has a bill numbered %', btrim(p_bill_number) using errcode = '23505';
  end;
  return public._idem_store(p_business, p_key, 'bill_record', jsonb_build_object('bill_id', v_id));
end $$;

create function public.void_supplier_bill(p_bill uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.supplier_bills; v_prev jsonb;
begin
  select * into b from public.supplier_bills where id = p_bill;
  if not found then raise exception 'bill not found' using errcode = '22023'; end if;
  perform public._guard_any(b.business_id, array['farm-supplier-bills'], 'purchases.pay');
  v_prev := public._idem_check(b.business_id, p_key, 'bill_void'); if v_prev is not null then return v_prev; end if;
  select * into b from public.supplier_bills where id = p_bill for update;
  if b.status = 'voided' then raise exception 'bill is already voided' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.supplier_bills set status = 'voided', void_reason = btrim(p_reason), voided_at = now() where id = p_bill;
  return public._idem_store(b.business_id, p_key, 'bill_void', jsonb_build_object('bill_id', p_bill));
end $$;

-- ---------------------------------------------------------- sales order API
create function public.create_sales_order(p_business uuid, p_customer uuid, p_items jsonb, p_expected date, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text; v_item jsonb; pr public.products; v_qty numeric;
begin
  perform public._guard_any(p_business, array['farm-sales-orders'], 'sales.create');
  v_prev := public._idem_check(p_business, p_key, 'so_create'); if v_prev is not null then return v_prev; end if;
  if not exists (select 1 from public.customers where id = p_customer and business_id = p_business and status = 'active') then
    raise exception 'unknown customer' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'an order needs 1 to 50 lines' using errcode = '22023';
  end if;
  v_number := public._next_number(p_business, 'sales_order', 'SO');
  insert into public.sales_orders (id, business_id, order_number, customer_id, expected_date, note, created_by, idempotency_key)
  values (v_id, p_business, v_number, p_customer, p_expected, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_key);
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid and business_id = p_business;
    if not found or pr.status <> 'active' then raise exception 'invalid product' using errcode = '22023'; end if;
    v_qty := round((v_item ->> 'quantity')::numeric, 4);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    begin
      insert into public.sales_order_lines (business_id, order_id, product_id, quantity, quoted_unit_price) values (p_business, v_id, pr.id, v_qty, pr.selling_price);
    exception when unique_violation then
      raise exception 'each product can appear once per order' using errcode = '22023';
    end;
  end loop;
  return public._idem_store(p_business, p_key, 'so_create', jsonb_build_object('order_id', v_id, 'order_number', v_number));
end $$;

-- Delivers some or all of what is still outstanding by posting a normal sale at today's catalogue prices. The sale is
-- linked to the order, so "fulfilled" always matches the live, non-voided sales.
create function public.fulfil_sales_order(p_order uuid, p_location uuid, p_lines jsonb, p_payments jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.sales_orders; v_prev jsonb; v_line jsonb; ls public.sales_order_line_status; v_qty numeric; v_items jsonb := '[]'::jsonb; v_sale jsonb;
begin
  select * into o from public.sales_orders where id = p_order;
  if not found then raise exception 'order not found' using errcode = '22023'; end if;
  perform public._guard_any(o.business_id, array['farm-sales-orders'], 'sales.create');
  v_prev := public._idem_check(o.business_id, p_key, 'so_fulfil'); if v_prev is not null then return v_prev; end if;
  select * into o from public.sales_orders where id = p_order for update;
  if o.status = 'cancelled' then raise exception 'order is cancelled' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'select at least one line to deliver' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into ls from public.sales_order_line_status where line_id = (v_line ->> 'line_id')::uuid and order_id = p_order;
    if not found then raise exception 'line does not belong to this order' using errcode = '22023'; end if;
    v_qty := round((v_line ->> 'quantity')::numeric, 4);
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be greater than zero' using errcode = '22023'; end if;
    if v_qty > ls.remaining then raise exception 'only % remain to be delivered on this line', trim_scale(ls.remaining) using errcode = '22023'; end if;
    v_items := v_items || jsonb_build_object('product_id', ls.product_id, 'quantity', v_qty);
  end loop;
  v_sale := public.post_sale(o.business_id, p_location, o.customer_id, v_items, coalesce(p_payments, '[]'::jsonb), p_key || ':sale', 'Order ' || o.order_number);
  update public.sales set sales_order_id = p_order where id = (v_sale ->> 'sale_id')::uuid;
  return public._idem_store(o.business_id, p_key, 'so_fulfil', jsonb_build_object('sale_id', v_sale ->> 'sale_id', 'sale_number', v_sale ->> 'sale_number'));
end $$;

create function public.cancel_sales_order(p_order uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; v_prev jsonb;
begin
  select * into o from public.sales_orders where id = p_order;
  if not found then raise exception 'order not found' using errcode = '22023'; end if;
  perform public._guard_any(o.business_id, array['farm-sales-orders'], 'sales.create');
  v_prev := public._idem_check(o.business_id, p_key, 'so_cancel'); if v_prev is not null then return v_prev; end if;
  select * into o from public.sales_orders where id = p_order for update;
  if o.status = 'cancelled' then raise exception 'order is already cancelled' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.sales_orders set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_order;
  return public._idem_store(o.business_id, p_key, 'so_cancel', jsonb_build_object('order_id', p_order));
end $$;

revoke all on function
  public.create_purchase_request(uuid, jsonb, text, text), public.decide_purchase_request(uuid, boolean, text, text),
  public.cancel_purchase_request(uuid, text), public.order_purchase_request(uuid, uuid, text),
  public.record_supplier_bill(uuid, uuid, text, date, date, numeric, text), public.void_supplier_bill(uuid, text, text),
  public.create_sales_order(uuid, uuid, jsonb, date, text, text), public.fulfil_sales_order(uuid, uuid, jsonb, jsonb, text),
  public.cancel_sales_order(uuid, text, text) from public;
grant execute on function
  public.create_purchase_request(uuid, jsonb, text, text), public.decide_purchase_request(uuid, boolean, text, text),
  public.cancel_purchase_request(uuid, text), public.order_purchase_request(uuid, uuid, text),
  public.record_supplier_bill(uuid, uuid, text, date, date, numeric, text), public.void_supplier_bill(uuid, text, text),
  public.create_sales_order(uuid, uuid, jsonb, date, text, text), public.fulfil_sales_order(uuid, uuid, jsonb, jsonb, text),
  public.cancel_sales_order(uuid, text, text) to authenticated;
