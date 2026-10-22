-- The kind of school (nursery, primary, secondary or all) now decides which classes exist.
-- Every class belongs to a stage; a nursery school cannot have secondary classes, and so on. Narrowing the school
-- hides the classes that no longer belong (refused while they still have active students).

alter table public.school_classes add column stage text not null default 'primary' check (stage in ('nursery', 'primary', 'secondary'));
update public.school_classes set stage = case when level_order <= 2 then 'nursery' when level_order <= 8 then 'primary' else 'secondary' end;

create function public._school_stage_ok(p_type text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p_type, 'combined') = 'combined' or p_type = p_stage $$;

-- Subject groups: nursery, primary, junior secondary (jss) and senior secondary (sss).
create function public._school_group(p_stage text, p_order integer) returns text
language sql immutable set search_path = '' as $$ select case when p_stage = 'nursery' then 'nursery' when p_stage = 'primary' then 'primary' when p_order <= 11 then 'jss' else 'sss' end $$;

create function public._school_catalogue() returns table (name text, code text, grp text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('Literacy', 'LIT', 'nursery'), ('Numeracy', 'NUM', 'nursery'), ('Social and Health Habits', 'SHH', 'nursery'), ('Creative Arts', 'ART', 'nursery'), ('Rhymes and Music', 'MUS', 'nursery'),
    ('English Language', 'ENG', 'primary'), ('Mathematics', 'MTH', 'primary'), ('Basic Science', 'SCI', 'primary'), ('Social Studies', 'SOS', 'primary'), ('Civic Education', 'CVE', 'primary'),
    ('Computer Studies', 'ICT', 'primary'), ('Christian/Islamic Studies', 'CRS', 'primary'), ('Creative Arts', 'ART', 'primary'), ('Physical and Health Education', 'PHE', 'primary'),
    ('English Language', 'ENG', 'jss'), ('Mathematics', 'MTH', 'jss'), ('Basic Science', 'SCI', 'jss'), ('Basic Technology', 'BTE', 'jss'), ('Social Studies', 'SOS', 'jss'), ('Civic Education', 'CVE', 'jss'),
    ('Computer Studies', 'ICT', 'jss'), ('Christian/Islamic Studies', 'CRS', 'jss'), ('Business Studies', 'BUS', 'jss'), ('Agricultural Science', 'AGR', 'jss'), ('Physical and Health Education', 'PHE', 'jss'),
    ('English Language', 'ENG', 'sss'), ('Mathematics', 'MTH', 'sss'), ('Civic Education', 'CVE', 'sss'), ('Computer Studies', 'ICT', 'sss'), ('Biology', 'BIO', 'sss'), ('Chemistry', 'CHM', 'sss'),
    ('Physics', 'PHY', 'sss'), ('Economics', 'ECO', 'sss'), ('Government', 'GOV', 'sss'), ('Literature in English', 'LIT', 'sss'), ('Agricultural Science', 'AGR', 'sss')
  ) as x (name, code, grp)
$$;

revoke execute on function public._school_stage_ok(text, text), public._school_group(text, integer), public._school_catalogue() from public;

-- Settings: narrowing the kind of school retires the classes of other stages, but never while they still hold active students.
create or replace function public.school_save_settings(p_business uuid, p_type text, p_address text, p_phone text, p_email text, p_ca numeric, p_exam numeric, p_position boolean, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_names text;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if p_type not in ('nursery', 'primary', 'secondary', 'combined') then raise exception 'choose the type of school' using errcode = '22023'; end if;
  if p_ca is null or p_exam is null or p_ca < 0 or p_exam < 0 or p_ca + p_exam <= 0 or p_ca + p_exam > 1000 then raise exception 'the continuous assessment and exam marks must be zero or more and add up to more than zero' using errcode = '22023'; end if;
  if p_days is null or cardinality(p_days) = 0 or exists (select 1 from unnest(p_days) d where d not between 1 and 7) then raise exception 'choose the days the school is open (1 = Monday ... 7 = Sunday)' using errcode = '22023'; end if;
  select string_agg(distinct c.name, ', ') into v_names from public.school_classes c
    where c.business_id = p_business and c.active and not public._school_stage_ok(p_type, c.stage)
      and exists (select 1 from public.school_students s where s.business_id = p_business and s.class_id = c.id and s.status = 'active');
  if v_names is not null then raise exception 'these classes still have active students: %. Move or withdraw them before changing the kind of school', v_names using errcode = '22023'; end if;
  insert into public.school_settings (business_id, school_type, address, phone, email, ca_max, exam_max, show_position, working_days)
  values (p_business, p_type, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), p_ca, p_exam, coalesce(p_position, false), p_days)
  on conflict (business_id) do update set school_type = excluded.school_type, address = excluded.address, phone = excluded.phone, email = excluded.email, ca_max = excluded.ca_max, exam_max = excluded.exam_max, show_position = excluded.show_position, working_days = excluded.working_days, updated_at = now();
  update public.school_classes set active = false where business_id = p_business and active and not public._school_stage_ok(p_type, stage);
end $$;

-- Classes now carry a stage, which must belong to the kind of school.
drop function public.school_save_class(uuid, uuid, text, integer, text, boolean);
create function public.school_save_class(p_business uuid, p_id uuid, p_name text, p_level integer, p_arm text, p_active boolean, p_stage text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_type text;
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the class name' using errcode = '22023'; end if;
  if p_stage is null or p_stage not in ('nursery', 'primary', 'secondary') then raise exception 'choose the stage of the class (nursery, primary or secondary)' using errcode = '22023'; end if;
  select school_type into v_type from public.school_settings where business_id = p_business;
  if coalesce(p_active, true) and not public._school_stage_ok(v_type, p_stage) then
    raise exception 'this is a % school, so it cannot have % classes. Change the kind of school in Settings first', v_type, p_stage using errcode = '22023';
  end if;
  if p_id is null then insert into public.school_classes (id, business_id, name, level_order, arm, active, stage) values (v_id, p_business, btrim(p_name), coalesce(p_level, 0), nullif(btrim(coalesce(p_arm, '')), ''), coalesce(p_active, true), p_stage);
  else update public.school_classes set name = btrim(p_name), level_order = coalesce(p_level, 0), arm = nullif(btrim(coalesce(p_arm, '')), ''), active = coalesce(p_active, true), stage = p_stage where id = p_id and business_id = p_business;
    if not found then raise exception 'class not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a class with this name already exists' using errcode = '23505';
end $$;
revoke execute on function public.school_save_class(uuid, uuid, text, integer, text, boolean, text) from public;
grant execute on function public.school_save_class(uuid, uuid, text, integer, text, boolean, text) to authenticated;

-- First-time setup: only the classes and subjects of the chosen kind of school.
create or replace function public.school_setup(p_business uuid, p_type text, p_session text, p_starts date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sess uuid; cr record; i integer;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if exists (select 1 from public.school_classes where business_id = p_business) then raise exception 'this school already has classes; edit them instead' using errcode = '22023'; end if;
  perform public.school_save_settings(p_business, p_type, null, null, null, 40, 60, false, '{1,2,3,4,5}');
  for cr in select * from (values
    ('Nursery 1', 1, 'nursery'), ('Nursery 2', 2, 'nursery'), ('Primary 1', 3, 'primary'), ('Primary 2', 4, 'primary'), ('Primary 3', 5, 'primary'), ('Primary 4', 6, 'primary'), ('Primary 5', 7, 'primary'), ('Primary 6', 8, 'primary'),
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary'), ('SS 1', 12, 'secondary'), ('SS 2', 13, 'secondary'), ('SS 3', 14, 'secondary')) as x (name, ord, kind)
    where public._school_stage_ok(p_type, x.kind) loop
    insert into public.school_classes (business_id, name, level_order, stage) values (p_business, cr.name, cr.ord, cr.kind);
  end loop;
  insert into public.school_subjects (business_id, name, code)
  select p_business, x.name, min(x.code) from public._school_catalogue() x
  where x.grp in (select public._school_group(c.stage, c.level_order) from public.school_classes c where c.business_id = p_business) group by x.name;
  insert into public.school_class_subjects (business_id, class_id, subject_id)
  select p_business, c.id, s.id from public.school_classes c
  join public._school_catalogue() x on x.grp = public._school_group(c.stage, c.level_order)
  join public.school_subjects s on s.business_id = p_business and s.name = x.name
  where c.business_id = p_business;
  perform public.school_save_grades(p_business, '[{"min":70,"grade":"A","remark":"Excellent"},{"min":60,"grade":"B","remark":"Very good"},{"min":50,"grade":"C","remark":"Good"},{"min":45,"grade":"D","remark":"Fair"},{"min":40,"grade":"E","remark":"Pass"},{"min":0,"grade":"F","remark":"Fail"}]'::jsonb);
  v_sess := public.school_save_session(p_business, null, coalesce(nullif(btrim(coalesce(p_session, '')), ''), 'Session'), coalesce(p_starts, current_date), coalesce(p_starts, current_date) + 330, true);
  for i in 1..3 loop
    perform public.school_save_term(p_business, null, v_sess, case i when 1 then 'First Term' when 2 then 'Second Term' else 'Third Term' end, coalesce(p_starts, current_date) + (i - 1) * 110, coalesce(p_starts, current_date) + (i - 1) * 110 + 95, i = 1);
  end loop;
end $$;
