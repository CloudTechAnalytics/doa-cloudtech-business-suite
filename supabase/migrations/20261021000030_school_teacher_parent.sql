-- Teacher and parent experience for schools.
--
-- 1. A "My Classes" page for teachers (module school-my-classes). It needs no new permission: it uses school.teach, which teachers already have, and every
--    row it shows is already limited by row-level security to the classes and subjects the teacher is assigned to.
-- 2. A parent or guardian can keep their own phone number and address up to date (school_update_my_contact). They can only change the contact record that
--    belongs to their own login, never a student's record and never another family's.

insert into public.modules (code, name, description, is_core, required_permission) values
  ('school-my-classes', 'My Classes', 'The classes and subjects a teacher is responsible for: pupils, attendance and results at a glance.', false, 'school.teach');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m where t.code = 'school' and m.code = 'school-my-classes';

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = 'school-my-classes';

-- Switch the new module on for schools that already exist.
insert into public.business_modules (business_id, module_id, status)
select b.id, m.id, 'enabled' from public.businesses b, public.modules m
where b.primary_industry_code = 'school' and m.code = 'school-my-classes'
on conflict (business_id, module_id) do nothing;

create function public.school_update_my_contact(p_business uuid, p_phone text, p_address text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform public._school_guard(p_business, 'school-portal', 'school.portal');
  if length(btrim(coalesce(p_phone, ''))) > 40 then raise exception 'the phone number is too long' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_address, ''))) > 300 then raise exception 'the address is too long' using errcode = '22023'; end if;
  update public.school_guardians set phone = nullif(btrim(coalesce(p_phone, '')), ''), address = nullif(btrim(coalesce(p_address, '')), '')
  where business_id = p_business and user_id = auth.uid();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no parent or guardian record is linked to your login yet' using errcode = '22023'; end if;
  return v_n;
end $$;

revoke execute on function public.school_update_my_contact(uuid, text, text) from public;
grant execute on function public.school_update_my_contact(uuid, text, text) to authenticated;
