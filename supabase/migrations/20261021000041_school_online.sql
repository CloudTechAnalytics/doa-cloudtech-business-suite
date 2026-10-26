-- Online school: a kind of school that offers courses instead of classes.
--
-- A course is a class with stage 'online': students enrol in it, it has units (subjects at level 'online'), teachers (instructors) are assigned to it, and
-- attendance, results, report cards, fees and receipts all work exactly as they do for a class. Nothing is created automatically: the owner or an admin adds
-- the courses the school offers, each with an optional description and duration, and sets the fee for each course under School Fees.
-- "All" (nursery, primary and secondary) never includes online courses; an online school is its own kind.

alter table public.school_settings drop constraint school_settings_school_type_check;
alter table public.school_settings add constraint school_settings_school_type_check check (school_type in ('nursery', 'primary', 'secondary', 'combined', 'online'));
alter table public.school_classes drop constraint school_classes_stage_check;
alter table public.school_classes add constraint school_classes_stage_check check (stage in ('nursery', 'primary', 'secondary', 'online'));
alter table public.school_subjects drop constraint school_subjects_levels_check;
alter table public.school_subjects add constraint school_subjects_levels_check check (levels <@ array['nursery', 'primary', 'jss', 'sss', 'online']::text[]);

alter table public.school_classes add column description text check (description is null or length(description) <= 600);
alter table public.school_classes add column duration text check (duration is null or length(duration) <= 60);

create or replace function public._school_stage_ok(p_type text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select case when coalesce(p_type, 'combined') = 'combined' then p_stage <> 'online' else p_type = p_stage end
$$;

create or replace function public._school_group(p_stage text, p_order integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_stage = 'online' then 'online' when p_stage = 'nursery' then 'nursery' when p_stage = 'primary' then 'primary' when p_order <= 11 then 'jss' else 'sss' end
$$;

-- Classes and courses: the same function, now with a description and duration, and the online stage.
drop function public.school_save_class(uuid, uuid, text, integer, text, boolean, text, uuid);
create function public.school_save_class(p_business uuid, p_id uuid, p_name text, p_level integer, p_arm text, p_active boolean, p_stage text, p_department uuid default null, p_description text default null, p_duration text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_type text; v_word text;
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  select school_type into v_type from public.school_settings where business_id = p_business;
  v_word := case when p_stage = 'online' then 'course' else 'class' end;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the % name', case when v_type = 'online' then 'course' else 'class' end using errcode = '22023'; end if;
  if p_stage is null or p_stage not in ('nursery', 'primary', 'secondary', 'online') then raise exception 'choose the stage of the class (nursery, primary, secondary or online)' using errcode = '22023'; end if;
  if coalesce(p_active, true) and not public._school_stage_ok(v_type, p_stage) then
    raise exception 'this is a % school, so it cannot have % %. Change the kind of school in Settings first', v_type, p_stage, case when p_stage = 'online' then 'courses' else 'classes' end using errcode = '22023';
  end if;
  if p_department is not null then
    if p_stage <> 'secondary' then raise exception 'only secondary classes can sit in a department' using errcode = '22023'; end if;
    if not exists (select 1 from public.school_departments where id = p_department and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  end if;
  if p_id is null then insert into public.school_classes (id, business_id, name, level_order, arm, active, stage, department_id, description, duration)
    values (v_id, p_business, btrim(p_name), coalesce(p_level, 0), nullif(btrim(coalesce(p_arm, '')), ''), coalesce(p_active, true), p_stage, p_department, nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_duration, '')), ''));
  else update public.school_classes set name = btrim(p_name), level_order = coalesce(p_level, 0), arm = nullif(btrim(coalesce(p_arm, '')), ''), active = coalesce(p_active, true), stage = p_stage, department_id = p_department,
      description = nullif(btrim(coalesce(p_description, '')), ''), duration = nullif(btrim(coalesce(p_duration, '')), '') where id = p_id and business_id = p_business;
    if not found then raise exception '% not found', v_word using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a % with this name already exists', v_word using errcode = '23505';
end $$;

-- Subjects (course units): levels may now include 'online'.
create or replace function public.school_save_subject(p_business uuid, p_id uuid, p_name text, p_code text, p_levels text[] default '{}', p_department uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_levels text[] := coalesce(p_levels, '{}');
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the subject name' using errcode = '22023'; end if;
  if not (v_levels <@ array['nursery', 'primary', 'jss', 'sss', 'online']::text[]) then raise exception 'choose levels from nursery, primary, junior secondary, senior secondary and online' using errcode = '22023'; end if;
  if p_department is not null and not exists (select 1 from public.school_departments where id = p_department and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_subjects (id, business_id, name, code, levels, department_id) values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), v_levels, p_department);
  else update public.school_subjects set name = btrim(p_name), code = nullif(btrim(coalesce(p_code, '')), ''), levels = v_levels, department_id = p_department where id = p_id and business_id = p_business;
    if not found then raise exception 'subject not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a subject with this name already exists' using errcode = '23505';
end $$;

revoke execute on function public.school_save_class(uuid, uuid, text, integer, text, boolean, text, uuid, text, text) from public;
grant execute on function public.school_save_class(uuid, uuid, text, integer, text, boolean, text, uuid, text, text) to authenticated;

-- Settings: 'online' is a kind of school, and a change of kind reshapes the school even when it has no classes yet (an online school may have no courses).
create or replace function public.school_save_settings(p_business uuid, p_type text, p_address text, p_phone text, p_email text, p_ca numeric, p_exam numeric, p_position boolean, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_names text; v_old text;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if p_type not in ('nursery', 'primary', 'secondary', 'combined', 'online') then raise exception 'choose the type of school' using errcode = '22023'; end if;
  if p_ca is null or p_exam is null or p_ca < 0 or p_exam < 0 or p_ca + p_exam <= 0 or p_ca + p_exam > 1000 then raise exception 'the continuous assessment and exam marks must be zero or more and add up to more than zero' using errcode = '22023'; end if;
  if p_days is null or cardinality(p_days) = 0 or exists (select 1 from unnest(p_days) d where d not between 1 and 7) then raise exception 'choose the days the school is open (1 = Monday ... 7 = Sunday)' using errcode = '22023'; end if;
  select school_type into v_old from public.school_settings where business_id = p_business;
  select string_agg(distinct c.name, ', ') into v_names from public.school_classes c
    where c.business_id = p_business and c.active and not public._school_stage_ok(p_type, c.stage)
      and exists (select 1 from public.school_students s where s.business_id = p_business and s.class_id = c.id and s.status = 'active');
  if v_names is not null then raise exception 'these classes still have active students: %. Move or withdraw them before changing the kind of school', v_names using errcode = '22023'; end if;
  insert into public.school_settings (business_id, school_type, address, phone, email, ca_max, exam_max, show_position, working_days)
  values (p_business, p_type, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), p_ca, p_exam, coalesce(p_position, false), p_days)
  on conflict (business_id) do update set school_type = excluded.school_type, address = excluded.address, phone = excluded.phone, email = excluded.email, ca_max = excluded.ca_max, exam_max = excluded.exam_max, show_position = excluded.show_position, working_days = excluded.working_days, updated_at = now();
  if v_old is not null and v_old is distinct from p_type and coalesce(current_setting('school.skip_reshape', true), '') <> '1' then
    perform public._school_reshape(p_business, v_old, p_type);
  else
    update public.school_classes set active = false where business_id = p_business and active and not public._school_stage_ok(p_type, stage);
  end if;
end $$;

create or replace function public.school_setup(p_business uuid, p_type text, p_session text, p_starts date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sess uuid; cr record; d record; i integer;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if exists (select 1 from public.school_classes where business_id = p_business) then raise exception 'this school already has classes; edit them instead' using errcode = '22023'; end if;
  -- Setup builds everything itself; the reshaping that follows a change of kind must not run on top of it.
  perform set_config('school.skip_reshape', '1', true);
  perform public.school_save_settings(p_business, p_type, null, null, null, 40, 60, false, '{1,2,3,4,5}');
  perform set_config('school.skip_reshape', '', true);
  if public._school_stage_ok(p_type, 'secondary') then
    insert into public.school_departments (business_id, name) values (p_business, 'Science'), (p_business, 'Art'), (p_business, 'Commercial');
  end if;
  for cr in select * from (values
    ('Nursery 1', 1, 'nursery'), ('Nursery 2', 2, 'nursery'), ('Primary 1', 3, 'primary'), ('Primary 2', 4, 'primary'), ('Primary 3', 5, 'primary'), ('Primary 4', 6, 'primary'), ('Primary 5', 7, 'primary'), ('Primary 6', 8, 'primary'),
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary')) as x (name, ord, kind)
    where public._school_stage_ok(p_type, x.kind) loop
    insert into public.school_classes (business_id, name, level_order, stage) values (p_business, cr.name, cr.ord, cr.kind);
  end loop;
  if public._school_stage_ok(p_type, 'secondary') then
    for i in 1..3 loop
      for d in select id, name from public.school_departments where business_id = p_business order by name loop
        insert into public.school_classes (business_id, name, level_order, stage, department_id) values (p_business, 'SS ' || i || ' ' || d.name, 11 + i, 'secondary', d.id);
      end loop;
    end loop;
  end if;
  -- The subjects that exist for this kind of school, then a starting pick for every class (the school changes it class by class).
  insert into public.school_subjects (business_id, name, code, levels, department_id)
  select p_business, x.name, min(x.code), array_agg(distinct x.grp order by x.grp), (select dp.id from public.school_departments dp where dp.business_id = p_business and dp.name = max(x.dept))
  from public._school_catalogue() x
  where x.grp in (select public._school_group(c.stage, c.level_order) from public.school_classes c where c.business_id = p_business) group by x.name;
  insert into public.school_class_subjects (business_id, class_id, subject_id)
  select p_business, c.id, s.id from public.school_classes c
  join public._school_catalogue() x on x.grp = public._school_group(c.stage, c.level_order) and (x.dept is null or x.dept = (select dp.name from public.school_departments dp where dp.id = c.department_id))
  join public.school_subjects s on s.business_id = p_business and s.name = x.name
  where c.business_id = p_business;
  perform public.school_save_grades(p_business, '[{"min":70,"grade":"A","remark":"Excellent"},{"min":60,"grade":"B","remark":"Very good"},{"min":50,"grade":"C","remark":"Good"},{"min":45,"grade":"D","remark":"Fair"},{"min":40,"grade":"E","remark":"Pass"},{"min":0,"grade":"F","remark":"Fail"}]'::jsonb);
  v_sess := public.school_save_session(p_business, null, coalesce(nullif(btrim(coalesce(p_session, '')), ''), 'Session'), coalesce(p_starts, current_date), coalesce(p_starts, current_date) + 330, true);
  for i in 1..3 loop
    perform public.school_save_term(p_business, null, v_sess, case i when 1 then 'First Term' when 2 then 'Second Term' else 'Third Term' end, coalesce(p_starts, current_date) + (i - 1) * 110, coalesce(p_starts, current_date) + (i - 1) * 110 + 95, i = 1);
  end loop;
end $$;
