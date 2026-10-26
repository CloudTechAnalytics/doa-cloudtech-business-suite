-- Changing the kind of school now reshapes the school instead of only hiding classes.
--
-- Secondary to primary (or nursery): the secondary classes that nothing uses are deleted (any that hold records are kept but not in use), the departments
-- (Science, Art, Commercial) are removed, subjects that only belonged to the old levels and have no results are deleted, and the subjects of the new levels
-- are added and given to the classes as a starting pick. Widening (for example to "all") adds what is missing and brings the retired classes back.
-- First-time setup is unaffected: it builds everything itself.

create function public._school_reshape(p_business uuid, p_old text, p_new text) returns void
language plpgsql security definer set search_path = '' as $$
declare cr record; d record; i integer; v_groups text[];
begin
  -- Classes of stages that no longer belong: delete the unused ones, keep (not in use) the ones that hold records.
  for cr in select id from public.school_classes where business_id = p_business and not public._school_stage_ok(p_new, stage) loop
    begin
      delete from public.school_timetable where business_id = p_business and class_id = cr.id;
      delete from public.school_classes where id = cr.id and business_id = p_business;
    exception when foreign_key_violation then
      update public.school_classes set active = false, department_id = null where id = cr.id;
    end;
  end loop;

  -- Departments exist only where there is senior secondary.
  if public._school_stage_ok(p_new, 'secondary') then
    if not exists (select 1 from public.school_departments where business_id = p_business) then
      insert into public.school_departments (business_id, name) values (p_business, 'Science'), (p_business, 'Art'), (p_business, 'Commercial');
    end if;
  else
    update public.school_classes set department_id = null where business_id = p_business and department_id is not null;
    update public.school_subjects set department_id = null where business_id = p_business and department_id is not null;
    delete from public.school_departments where business_id = p_business;
  end if;

  -- The standard classes of the new kind: add the missing ones, and bring back those that were retired when their stage was left out.
  for cr in select * from (values
    ('Nursery 1', 1, 'nursery'), ('Nursery 2', 2, 'nursery'), ('Primary 1', 3, 'primary'), ('Primary 2', 4, 'primary'), ('Primary 3', 5, 'primary'), ('Primary 4', 6, 'primary'), ('Primary 5', 7, 'primary'), ('Primary 6', 8, 'primary'),
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary')) as x (name, ord, kind)
    where public._school_stage_ok(p_new, x.kind) loop
    if not exists (select 1 from public.school_classes where business_id = p_business and name = cr.name) then
      insert into public.school_classes (business_id, name, level_order, stage) values (p_business, cr.name, cr.ord, cr.kind);
    elsif not public._school_stage_ok(p_old, cr.kind) then
      update public.school_classes set active = true where business_id = p_business and name = cr.name;
    end if;
  end loop;
  if public._school_stage_ok(p_new, 'secondary') then
    for i in 1..3 loop
      for d in select id, name from public.school_departments where business_id = p_business order by name loop
        if not exists (select 1 from public.school_classes where business_id = p_business and name = 'SS ' || i || ' ' || d.name) then
          insert into public.school_classes (business_id, name, level_order, stage, department_id) values (p_business, 'SS ' || i || ' ' || d.name, 11 + i, 'secondary', d.id);
        elsif not public._school_stage_ok(p_old, 'secondary') then
          update public.school_classes set active = true where business_id = p_business and name = 'SS ' || i || ' ' || d.name;
        end if;
      end loop;
    end loop;
  end if;

  select coalesce(array_agg(distinct public._school_group(c.stage, c.level_order)), '{}') into v_groups
    from public.school_classes c where c.business_id = p_business and c.active and public._school_stage_ok(p_new, c.stage);

  -- Subjects that belonged only to levels the school no longer has are removed (unless they already have results).
  for cr in select id from public.school_subjects where business_id = p_business and cardinality(levels) > 0 and not (levels && v_groups) loop
    begin
      delete from public.school_timetable where business_id = p_business and subject_id = cr.id;
      delete from public.school_subjects where id = cr.id and business_id = p_business;
    exception when foreign_key_violation then null;
    end;
  end loop;

  -- The standard subjects of the new levels: add the missing ones, and teach existing ones at the new levels too.
  insert into public.school_subjects (business_id, name, code, levels, department_id)
  select p_business, x.name, min(x.code), array_agg(distinct x.grp order by x.grp), (select dp.id from public.school_departments dp where dp.business_id = p_business and dp.name = max(x.dept))
  from public._school_catalogue() x where x.grp = any (v_groups) group by x.name
  on conflict (business_id, name) do update set levels = (select array_agg(distinct l order by l) from unnest(public.school_subjects.levels || excluded.levels) l)
    where cardinality(public.school_subjects.levels) > 0;

  -- Every class of the new kind that takes no subjects yet gets its standard ones (the school then adjusts them class by class).
  insert into public.school_class_subjects (business_id, class_id, subject_id)
  select p_business, c.id, s.id from public.school_classes c
  join public._school_catalogue() x on x.grp = public._school_group(c.stage, c.level_order) and (x.dept is null or x.dept = (select dp.name from public.school_departments dp where dp.id = c.department_id))
  join public.school_subjects s on s.business_id = p_business and s.name = x.name
  where c.business_id = p_business and c.active and public._school_stage_ok(p_new, c.stage)
    and not exists (select 1 from public.school_class_subjects cs where cs.class_id = c.id)
  on conflict do nothing;
end $$;
revoke execute on function public._school_reshape(uuid, text, text) from public;

-- Settings: when the kind of school changes, reshape the school to match.
create or replace function public.school_save_settings(p_business uuid, p_type text, p_address text, p_phone text, p_email text, p_ca numeric, p_exam numeric, p_position boolean, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_names text; v_old text;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if p_type not in ('nursery', 'primary', 'secondary', 'combined') then raise exception 'choose the type of school' using errcode = '22023'; end if;
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
  if v_old is not null and v_old is distinct from p_type and exists (select 1 from public.school_classes where business_id = p_business) then
    perform public._school_reshape(p_business, v_old, p_type);
  else
    update public.school_classes set active = false where business_id = p_business and active and not public._school_stage_ok(p_type, stage);
  end if;
end $$;
