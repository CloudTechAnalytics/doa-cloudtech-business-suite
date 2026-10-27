-- DOA Invoices on its own: a workspace that started from the Invoices app has no CRM switched on, so Invoices must be able to see and add the customers it bills.
--   * Customers can be read by whoever can read invoices (as well as by the CRM), so the customer list works without the CRM app.
--   * invoice_add_customer() adds a customer from the invoice screen. It reuses an existing active customer with the same email or phone instead of
--     making a duplicate, and needs invoices.manage. It does not give anyone access to the rest of the CRM.
-- Additive apart from replacing one policy. Rollback: restore customers_select from 0004 and drop the function.

drop policy customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read')
      or public.has_module_permission(business_id, 'invoices', 'invoices.read', 'read'));

create function public.invoice_add_customer(p_business uuid, p_name text, p_phone text, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  perform public._guard(p_business, 'invoices', 'invoices.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the customer name' using errcode = '22023'; end if;
  if length(btrim(p_name)) > 200 then raise exception 'the customer name is too long' using errcode = '22023'; end if;
  select id into v_id from public.customers
   where business_id = p_business and status = 'active'
     and ((v_email is not null and lower(email) = lower(v_email)) or (v_phone is not null and phone = v_phone))
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.customers (business_id, name, phone, email, source) values (p_business, btrim(p_name), v_phone, v_email, 'invoice') returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.invoice_add_customer(uuid, text, text, text) from public;
grant execute on function public.invoice_add_customer(uuid, text, text, text) to authenticated;
