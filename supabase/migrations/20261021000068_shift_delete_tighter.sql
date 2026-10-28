-- A shift can only be deleted while it is open and nothing has happened in it.
--
-- Before, a closed shift with no cash activity could also be deleted. A closed shift carries the count the cashier signed off, so it is a record; and a shift
-- where only card or transfer payments were taken still has sales in it. Now: the shift must be open, with no payment of any kind taken by that cashier since it
-- opened and no cash in or out. That is a shift opened by mistake, which a manager can remove, with a reason kept in the audit trail.

create or replace function public.mart_delete_shift(p_shift uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; v_n integer;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._mart_guard(s.business_id, 'retail-shifts', 'retail.manage');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if s.status <> 'open' then
    raise exception 'a closed shift carries the cash count and is a record, so it cannot be deleted; mark it reviewed instead' using errcode = '22023';
  end if;
  select count(*) into v_n from public.payments p where p.business_id = s.business_id and p.created_by = s.cashier_id and p.status = 'successful'
     and coalesce(p.received_at, p.created_at) >= s.opened_at;
  if v_n > 0 or exists (select 1 from public.cash_movements where shift_id = p_shift) then
    raise exception 'this shift has sales or cash in and out, so it is a money record and cannot be deleted; close it and mark it reviewed instead' using errcode = '22023';
  end if;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (s.business_id, auth.uid(), 'cashier_shifts.delete', 'cashier_shifts', p_shift, jsonb_build_object('number', s.shift_number, 'reason', btrim(p_reason), 'status', s.status));
  delete from public.cashier_shifts where id = p_shift;
end $$;
