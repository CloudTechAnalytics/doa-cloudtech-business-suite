-- Stock locations (Main store, Shelf 1, Cold room...) can be added, renamed and archived by staff who may adjust stock.
-- Archiving is the only way to remove one (history keeps pointing at it), and it is refused while the location still holds stock
-- or when it is the last active location, so stock is never left somewhere no screen can reach.
-- Additive. Rollback: drop the trigger and function.

create function public.inventory_locations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'archived' and old.status = 'active' then
    if exists (select 1 from public.inventory_balances b where b.business_id = old.business_id and b.location_id = old.id and b.quantity_on_hand <> 0) then
      raise exception 'move or sell the stock in "%" before archiving it', old.name using errcode = '22023';
    end if;
    if not exists (select 1 from public.inventory_locations l where l.business_id = old.business_id and l.id <> old.id and l.status = 'active') then
      raise exception 'keep at least one active location' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.inventory_locations_guard() from public;
create trigger inventory_locations_guard before update on public.inventory_locations for each row execute function public.inventory_locations_guard();
