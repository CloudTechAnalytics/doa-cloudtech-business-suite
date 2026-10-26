-- The school timetable: the periods of the school day, and for every class and school day which subject is taught in each period and by whom.
--
-- * Managed by people who manage the school (module school-timetable, permission school.manage).
-- * Seen by them, by each teacher for their own lessons and classes, and by a parent for their own child's class. Other classes' timetables stay private to staff.
-- * Cannot be inconsistent: a lesson must be in a period that is not a break, on a school day, for a subject the class takes, taught by a teacher who is
--   assigned to that class and subject; and a teacher cannot be in two classes at the same time.

insert into public.modules (code, name, description, is_core, required_permission) values
  ('school-timetable', 'Timetable', 'The periods of the school day and the weekly timetable of every class.', false, 'school.manage');
insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, false from public.industry_templates t, public.modules m where t.code = 'school' and m.code = 'school-timetable';
insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = 'school-timetable';
insert into public.business_modules (business_id, module_id, status)
select b.id, m.id, 'enabled' from public.businesses b, public.modules m where b.primary_industry_code = 'school' and m.code = 'school-timetable'
on conflict (business_id, module_id) do nothing;

create table public.school_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  position integer not null check (position between 1 and 200), -- 1 to 30 in use; the rest is room for renumbering
  check (ends_at > starts_at),
  unique (business_id, id), unique (business_id, position)
);

create table public.school_timetable (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  class_id uuid not null, day integer not null check (day between 1 and 7), period_id uuid not null,
  subject_id uuid not null, staff_id uuid, room text check (room is null or length(room) <= 40),
  unique (business_id, class_id, day, period_id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id),
  foreign key (business_id, period_id) references public.school_periods (business_id, id),
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id),
  foreign key (business_id, staff_id) references public.school_staff (business_id, id)
);
-- A teacher can only be in one place at a time.
create unique index school_timetable_teacher_uq on public.school_timetable (business_id, staff_id, day, period_id) where staff_id is not null;

alter table public.school_periods enable row level security;
alter table public.school_timetable enable row level security;
create policy school_periods_select on public.school_periods for select to authenticated using (public.is_active_member(business_id));
create policy school_timetable_select on public.school_timetable for select to authenticated using (
  public.is_active_member(business_id) and (
    public.has_business_permission(business_id, 'school.read')
    or public._school_teaches_class(business_id, class_id)
    or exists (select 1 from public.school_staff s where s.business_id = school_timetable.business_id and s.id = school_timetable.staff_id and s.user_id = auth.uid())
    or exists (select 1 from public.school_students st where st.business_id = school_timetable.business_id and st.class_id = school_timetable.class_id and public._school_is_guardian_of(st.business_id, st.id))));
grant select on public.school_periods, public.school_timetable to authenticated;

-- Periods: [{id?, label, starts, ends, is_break}] in order. Replaces the list; a period that is in use cannot be dropped, and periods must not overlap.
create function public.school_save_periods(p_business uuid, p_periods jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb; i integer := 0; v_id uuid; v_keep uuid[] := '{}'; v_prev time; v_start time; v_end time; r record;
begin
  perform public._school_guard(p_business, 'school-timetable', 'school.manage');
  if jsonb_typeof(p_periods) is distinct from 'array' or jsonb_array_length(p_periods) not between 1 and 30 then raise exception 'add between 1 and 30 periods' using errcode = '22023'; end if;
  -- Validate first: names, times, order, no overlap.
  for x in select * from jsonb_array_elements(p_periods) loop
    v_start := (x ->> 'starts')::time; v_end := (x ->> 'ends')::time;
    if length(btrim(coalesce(x ->> 'label', ''))) = 0 then raise exception 'every period needs a name' using errcode = '22023'; end if;
    if v_start is null or v_end is null or v_end <= v_start then raise exception 'period "%" must end after it starts', x ->> 'label' using errcode = '22023'; end if;
    if v_prev is not null and v_start < v_prev then raise exception 'period "%" starts before the one above it ends', x ->> 'label' using errcode = '22023'; end if;
    v_prev := v_end;
  end loop;
  -- Positions are unique, so move the existing ones out of the way before renumbering.
  update public.school_periods set position = position + 100 where business_id = p_business;
  for x in select * from jsonb_array_elements(p_periods) loop
    i := i + 1; v_id := nullif(x ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.school_periods where id = v_id and business_id = p_business) then
      update public.school_periods set label = btrim(x ->> 'label'), starts_at = (x ->> 'starts')::time, ends_at = (x ->> 'ends')::time, is_break = coalesce((x ->> 'is_break')::boolean, false), position = i where id = v_id;
      if coalesce((x ->> 'is_break')::boolean, false) and exists (select 1 from public.school_timetable where period_id = v_id) then raise exception 'period "%" has lessons in the timetable, so it cannot become a break', x ->> 'label' using errcode = '22023'; end if;
    else
      insert into public.school_periods (business_id, label, starts_at, ends_at, is_break, position) values (p_business, btrim(x ->> 'label'), (x ->> 'starts')::time, (x ->> 'ends')::time, coalesce((x ->> 'is_break')::boolean, false), i) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  for r in select id, label from public.school_periods where business_id = p_business and id <> all (v_keep) loop
    if exists (select 1 from public.school_timetable where period_id = r.id) then raise exception 'period "%" has lessons in the timetable; clear them before removing it', r.label using errcode = '22023'; end if;
    delete from public.school_periods where id = r.id;
  end loop;
end $$;

-- Puts one subject (and, optionally, its teacher and room) in one slot, or empties the slot when no subject is given.
create function public.school_set_slot(p_business uuid, p_class uuid, p_day integer, p_period uuid, p_subject uuid, p_staff uuid, p_room text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_break boolean; v_days integer[];
begin
  perform public._school_guard(p_business, 'school-timetable', 'school.manage');
  if not exists (select 1 from public.school_classes where id = p_class and business_id = p_business and active) then raise exception 'choose a class that is open' using errcode = '22023'; end if;
  select is_break into v_break from public.school_periods where id = p_period and business_id = p_business;
  if v_break is null then raise exception 'period not found' using errcode = '22023'; end if;
  if p_subject is null then delete from public.school_timetable where business_id = p_business and class_id = p_class and day = p_day and period_id = p_period; return; end if;
  select working_days into v_days from public.school_settings where business_id = p_business;
  if p_day is null or p_day <> all (coalesce(v_days, '{1,2,3,4,5}')) then raise exception 'that day is not a school day' using errcode = '22023'; end if;
  if v_break then raise exception 'a break cannot have a lesson' using errcode = '22023'; end if;
  if not exists (select 1 from public.school_class_subjects where business_id = p_business and class_id = p_class and subject_id = p_subject) then raise exception 'this class does not take that subject' using errcode = '22023'; end if;
  if p_staff is not null and not exists (select 1 from public.school_assignments a join public.school_staff s on s.business_id = a.business_id and s.id = a.staff_id
      where a.business_id = p_business and a.class_id = p_class and a.subject_id = p_subject and a.staff_id = p_staff and s.status = 'active') then
    raise exception 'that teacher is not assigned to this subject in this class (assign them under Teachers & Staff first)' using errcode = '22023';
  end if;
  insert into public.school_timetable (business_id, class_id, day, period_id, subject_id, staff_id, room)
  values (p_business, p_class, p_day, p_period, p_subject, p_staff, nullif(btrim(coalesce(p_room, '')), ''))
  on conflict (business_id, class_id, day, period_id) do update set subject_id = excluded.subject_id, staff_id = excluded.staff_id, room = excluded.room;
exception when unique_violation then raise exception 'that teacher already has a lesson at this time in another class' using errcode = '23505';
end $$;

revoke execute on function public.school_save_periods(uuid, jsonb), public.school_set_slot(uuid, uuid, integer, uuid, uuid, uuid, text) from public;
grant execute on function public.school_save_periods(uuid, jsonb), public.school_set_slot(uuid, uuid, integer, uuid, uuid, uuid, text) to authenticated;
