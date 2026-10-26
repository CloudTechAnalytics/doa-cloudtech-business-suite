-- Online schools run in cohorts, not in First, Second and Third Term.
--
-- * A cohort is a group of learners who start together (for example "January 2027 intake"). Behind the scenes it is a session with one term of the same name,
--   so results, fees and report cards keep working; the owner only ever deals with the cohort. school_save_cohort creates or updates both together.
-- * An online school's first-time setup creates one cohort (named by the owner, or "Cohort 1"), never the three standard terms.
-- * Sessions and terms can now be deleted when nothing uses them (results, bills, remarks, fee items); one that is in use is refused with a plain reason.
--   This also lets an online school that was set up with the three standard terms remove them.

create function public.school_save_cohort(p_business uuid, p_id uuid, p_name text, p_starts date, p_ends date, p_current boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_sess uuid; v_terms uuid[];
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 or p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'enter the cohort name and its dates (it must end after it starts)' using errcode = '22023'; end if;
  v_sess := public.school_save_session(p_business, p_id, p_name, p_starts, p_ends, p_current);
  select array_agg(id) into v_terms from public.school_terms where business_id = p_business and session_id = v_sess;
  if v_terms is null then perform public.school_save_term(p_business, null, v_sess, p_name, p_starts, p_ends, p_current);
  elsif cardinality(v_terms) = 1 then perform public.school_save_term(p_business, v_terms[1], v_sess, p_name, p_starts, p_ends, p_current);
  end if;
  return v_sess;
exception when unique_violation then raise exception 'duplicate key: a cohort with this name already exists' using errcode = '23505';
end $$;

create function public.school_delete_term(p_business uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_terms where id = p_id and business_id = p_business) then raise exception 'term not found' using errcode = '22023'; end if;
  begin
    delete from public.school_terms where id = p_id and business_id = p_business;
  exception when foreign_key_violation then
    raise exception 'this term already has results, fee bills or remarks recorded, so it cannot be deleted' using errcode = '23503';
  end;
end $$;

create function public.school_delete_session(p_business uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_sessions where id = p_id and business_id = p_business) then raise exception 'session not found' using errcode = '22023'; end if;
  begin
    delete from public.school_terms where session_id = p_id and business_id = p_business;
    delete from public.school_sessions where id = p_id and business_id = p_business;
  exception when foreign_key_violation then
    raise exception 'this session or cohort already has results, fee bills, remarks or students recorded, so it cannot be deleted' using errcode = '23503';
  end;
end $$;

revoke execute on function public.school_save_cohort(uuid, uuid, text, date, date, boolean), public.school_delete_term(uuid, uuid), public.school_delete_session(uuid, uuid) from public;
grant execute on function public.school_save_cohort(uuid, uuid, text, date, date, boolean), public.school_delete_term(uuid, uuid), public.school_delete_session(uuid, uuid) to authenticated;

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
  if p_type = 'online' then
    -- An online school has cohorts (intakes), not First, Second and Third Term: one cohort to start with, and the owner adds the others.
    perform public.school_save_cohort(p_business, null, coalesce(nullif(btrim(coalesce(p_session, '')), ''), 'Cohort 1'), coalesce(p_starts, current_date), coalesce(p_starts, current_date) + 120, true);
  else
    v_sess := public.school_save_session(p_business, null, coalesce(nullif(btrim(coalesce(p_session, '')), ''), 'Session'), coalesce(p_starts, current_date), coalesce(p_starts, current_date) + 330, true);
    for i in 1..3 loop
      perform public.school_save_term(p_business, null, v_sess, case i when 1 then 'First Term' when 2 then 'Second Term' else 'Third Term' end, coalesce(p_starts, current_date) + (i - 1) * 110, coalesce(p_starts, current_date) + (i - 1) * 110 + 95, i = 1);
    end loop;
  end if;
end $$;
