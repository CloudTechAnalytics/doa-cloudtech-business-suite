-- An online school has cohorts, not three terms. Schools that were set up as online before cohorts existed (or that were switched to online) still carry the three
-- standard terms in each session. This tidies them: where nothing at all has been recorded against the three standard terms of a session, the second and third are
-- removed and the first becomes the cohort's single period (same name and dates as the session). A session with anything recorded, or with terms the owner made
-- themselves, is left exactly as it is. It runs now for every online school, and whenever a school is switched to online.

create function public._school_tidy_cohorts(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s record; v_first uuid; v_second uuid; v_third uuid;
begin
  for s in select id, name, starts_on, ends_on from public.school_sessions where business_id = p_business loop
    if (select count(*) from public.school_terms where session_id = s.id) <> 3 then continue; end if;
    select id into v_first from public.school_terms where session_id = s.id and name = 'First Term';
    select id into v_second from public.school_terms where session_id = s.id and name = 'Second Term';
    select id into v_third from public.school_terms where session_id = s.id and name = 'Third Term';
    if v_first is null or v_second is null or v_third is null then continue; end if;
    if exists (select 1 from public.school_scores where term_id in (v_first, v_second, v_third))
       or exists (select 1 from public.school_remarks where term_id in (v_first, v_second, v_third))
       or exists (select 1 from public.school_fee_items where term_id in (v_first, v_second, v_third))
       or exists (select 1 from public.school_bills where term_id in (v_first, v_second, v_third)) then continue; end if;
    delete from public.school_terms where id in (v_second, v_third);
    update public.school_terms set name = s.name, starts_on = s.starts_on, ends_on = s.ends_on where id = v_first;
  end loop;
end $$;
revoke execute on function public._school_tidy_cohorts(uuid) from public;

create or replace function public._school_reshape(p_business uuid, p_old text, p_new text) returns void
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
  if p_new = 'online' then perform public._school_tidy_cohorts(p_business); end if;
end $$;


-- Tidy the online schools that already exist.
select public._school_tidy_cohorts(business_id) from public.school_settings where school_type = 'online';
