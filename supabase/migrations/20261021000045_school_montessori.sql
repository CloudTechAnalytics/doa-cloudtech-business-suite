-- Montessori school: a kind of school built around mixed-age environments, the Montessori curriculum areas, and observation instead of marks.
--
-- * Classes are "environments" (stage 'montessori'): Toddler Community, Children's House, Lower Elementary and Upper Elementary, each with its age range in the description.
-- * The curriculum areas are the subjects (level 'montessori'): Practical Life, Sensorial, Language, Mathematics, Cultural Studies, Art and Music, Grace and Courtesy.
-- * Each area has a list of works (the materials and lessons). The guide records each child's progress on each work: introduced, practising or mastered, with the date and
--   an optional note. The standard works are given to a new Montessori school and can be edited area by area.
-- * Instead of an exam report card, a progress report shows, per area, which works are mastered, being practised or introduced, plus the guide's note for the area and
--   the overall comment. Progress is seen by staff for children they may see, and by a parent for their own child.
-- "All" never includes Montessori environments; a Montessori school is its own kind.

alter table public.school_settings drop constraint school_settings_school_type_check;
alter table public.school_settings add constraint school_settings_school_type_check check (school_type in ('nursery', 'primary', 'secondary', 'combined', 'online', 'montessori'));
alter table public.school_classes drop constraint school_classes_stage_check;
alter table public.school_classes add constraint school_classes_stage_check check (stage in ('nursery', 'primary', 'secondary', 'online', 'montessori'));
alter table public.school_subjects drop constraint school_subjects_levels_check;
alter table public.school_subjects add constraint school_subjects_levels_check check (levels <@ array['nursery', 'primary', 'jss', 'sss', 'online', 'montessori']::text[]);

create or replace function public._school_stage_ok(p_type text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select case when coalesce(p_type, 'combined') = 'combined' then p_stage not in ('online', 'montessori') else p_type = p_stage end
$$;

create or replace function public._school_group(p_stage text, p_order integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_stage in ('online', 'montessori') then p_stage when p_stage = 'nursery' then 'nursery' when p_stage = 'primary' then 'primary' when p_order <= 11 then 'jss' else 'sss' end
$$;

drop function public._school_catalogue();
create function public._school_catalogue() returns table (name text, code text, grp text, dept text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('Literacy', 'LIT', 'nursery', null), ('Numeracy', 'NUM', 'nursery', null), ('Social and Health Habits', 'SHH', 'nursery', null), ('Creative Arts', 'ART', 'nursery', null), ('Rhymes and Music', 'MUS', 'nursery', null),
    ('English Language', 'ENG', 'primary', null), ('Mathematics', 'MTH', 'primary', null), ('Basic Science', 'SCI', 'primary', null), ('Social Studies', 'SOS', 'primary', null), ('Civic Education', 'CVE', 'primary', null),
    ('Computer Studies', 'ICT', 'primary', null), ('Christian/Islamic Studies', 'CRS', 'primary', null), ('Physical and Health Education', 'PHE', 'primary', null),
    ('English Language', 'ENG', 'jss', null), ('Mathematics', 'MTH', 'jss', null), ('Basic Science', 'SCI', 'jss', null), ('Basic Technology', 'BTE', 'jss', null), ('Social Studies', 'SOS', 'jss', null), ('Civic Education', 'CVE', 'jss', null),
    ('Computer Studies', 'ICT', 'jss', null), ('Christian/Islamic Studies', 'CRS', 'jss', null), ('Business Studies', 'BUS', 'jss', null), ('Agricultural Science', 'AGR', 'jss', null), ('Physical and Health Education', 'PHE', 'jss', null),
    ('English Language', 'ENG', 'sss', null), ('Mathematics', 'MTH', 'sss', null), ('Civic Education', 'CVE', 'sss', null), ('Computer Studies', 'ICT', 'sss', null), ('Agricultural Science', 'AGR', 'sss', null),
    ('Biology', 'BIO', 'sss', 'Science'), ('Chemistry', 'CHM', 'sss', 'Science'), ('Physics', 'PHY', 'sss', 'Science'), ('Further Mathematics', 'FMT', 'sss', 'Science'), ('Geography', 'GEO', 'sss', 'Science'),
    ('Literature in English', 'LIT', 'sss', 'Art'), ('Government', 'GOV', 'sss', 'Art'), ('History', 'HIS', 'sss', 'Art'), ('Visual Art', 'VAR', 'sss', 'Art'),
    ('Economics', 'ECO', 'sss', 'Commercial'), ('Financial Accounting', 'ACC', 'sss', 'Commercial'), ('Commerce', 'COM', 'sss', 'Commercial'), ('Marketing', 'MKT', 'sss', 'Commercial')
      ,
    ('Practical Life', 'PRL', 'montessori', null), ('Sensorial', 'SEN', 'montessori', null), ('Language', 'LAN', 'montessori', null), ('Mathematics', 'MTH', 'montessori', null), ('Cultural Studies', 'CUL', 'montessori', null), ('Art and Music', 'ART', 'montessori', null), ('Grace and Courtesy', 'GRC', 'montessori', null)
  ) as x (name, code, grp, dept)
$$;
revoke execute on function public._school_catalogue() from public;

-- ------------------------------------------------------------ works, progress and notes
create table public.school_works (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  subject_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  position integer not null default 0,
  unique (business_id, id), unique (subject_id, name),
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id) on delete cascade
);
create table public.school_work_progress (
  business_id uuid not null,
  student_id uuid not null,
  work_id uuid not null,
  status text not null check (status in ('introduced', 'practising', 'mastered')),
  on_date date not null default current_date,
  note text check (note is null or length(note) <= 300),
  recorded_by uuid references public.profiles (id),
  primary key (student_id, work_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id) on delete cascade,
  foreign key (business_id, work_id) references public.school_works (business_id, id) on delete cascade
);
create table public.school_progress_notes (
  business_id uuid not null,
  student_id uuid not null,
  term_id uuid not null,
  subject_id uuid not null,
  note text not null check (length(btrim(note)) between 1 and 600),
  primary key (student_id, term_id, subject_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id) on delete cascade,
  foreign key (business_id, term_id) references public.school_terms (business_id, id),
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id) on delete cascade
);
alter table public.school_works enable row level security;
alter table public.school_work_progress enable row level security;
alter table public.school_progress_notes enable row level security;
create policy school_works_select on public.school_works for select to authenticated using (public.is_active_member(business_id));
create policy school_work_progress_select on public.school_work_progress for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_progress_notes_select on public.school_progress_notes for select to authenticated using (public._school_can_see_student(business_id, student_id));
grant select on public.school_works, public.school_work_progress, public.school_progress_notes to authenticated;

-- Age ranges for the standard environments.
create function public._school_describe_environments(p_business uuid) returns void
language sql security definer set search_path = '' as $$
  update public.school_classes set description = case name when 'Toddler Community' then 'Ages 18 months to 3 years' when 'Children''s House' then 'Ages 3 to 6 years' when 'Lower Elementary' then 'Ages 6 to 9 years' when 'Upper Elementary' then 'Ages 9 to 12 years' end
   where business_id = p_business and stage = 'montessori' and description is null and name in ('Toddler Community', 'Children''s House', 'Lower Elementary', 'Upper Elementary')
$$;
revoke execute on function public._school_describe_environments(uuid) from public;

-- The standard works of each area, given to an area that has none yet.
create function public._school_seed_works(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.school_works (business_id, subject_id, name, position)
  select p_business, s.id, w.work, w.pos from (values
      ('Practical Life', 'Pouring dry materials', 1),
      ('Practical Life', 'Pouring water', 2),
      ('Practical Life', 'Spooning', 3),
      ('Practical Life', 'Transferring with tongs', 4),
      ('Practical Life', 'Opening and closing containers', 5),
      ('Practical Life', 'Folding cloths', 6),
      ('Practical Life', 'Dressing frame: buttons', 7),
      ('Practical Life', 'Dressing frame: zips', 8),
      ('Practical Life', 'Lacing', 9),
      ('Practical Life', 'Bow tying', 10),
      ('Practical Life', 'Hand washing', 11),
      ('Practical Life', 'Table washing', 12),
      ('Practical Life', 'Sweeping', 13),
      ('Practical Life', 'Polishing', 14),
      ('Practical Life', 'Flower arranging', 15),
      ('Practical Life', 'Food preparation', 16),
      ('Practical Life', 'Care of the environment', 17),
      ('Sensorial', 'Cylinder blocks', 1),
      ('Sensorial', 'Pink tower', 2),
      ('Sensorial', 'Brown stair', 3),
      ('Sensorial', 'Red rods', 4),
      ('Sensorial', 'Colour tablets', 5),
      ('Sensorial', 'Geometric solids', 6),
      ('Sensorial', 'Constructive triangles', 7),
      ('Sensorial', 'Binomial cube', 8),
      ('Sensorial', 'Sound cylinders', 9),
      ('Sensorial', 'Touch boards', 10),
      ('Sensorial', 'Fabric matching', 11),
      ('Sensorial', 'Smelling bottles', 12),
      ('Sensorial', 'Tasting bottles', 13),
      ('Language', 'Sound games (I spy)', 1),
      ('Language', 'Sandpaper letters', 2),
      ('Language', 'Moveable alphabet', 3),
      ('Language', 'Metal insets', 4),
      ('Language', 'Object boxes', 5),
      ('Language', 'Pink series reading', 6),
      ('Language', 'Blue series reading', 7),
      ('Language', 'Green series reading', 8),
      ('Language', 'Sentence building', 9),
      ('Language', 'Grammar symbols', 10),
      ('Language', 'Handwriting', 11),
      ('Language', 'Creative writing', 12),
      ('Mathematics', 'Number rods', 1),
      ('Mathematics', 'Sandpaper numerals', 2),
      ('Mathematics', 'Spindle boxes', 3),
      ('Mathematics', 'Cards and counters', 4),
      ('Mathematics', 'Golden beads: introduction', 5),
      ('Mathematics', 'Teen boards', 6),
      ('Mathematics', 'Ten boards', 7),
      ('Mathematics', 'Hundred board', 8),
      ('Mathematics', 'Short bead stair', 9),
      ('Mathematics', 'Addition strip board', 10),
      ('Mathematics', 'Subtraction strip board', 11),
      ('Mathematics', 'Multiplication bead board', 12),
      ('Mathematics', 'Division', 13),
      ('Mathematics', 'Fractions', 14),
      ('Mathematics', 'Stamp game', 15),
      ('Cultural Studies', 'Puzzle maps', 1),
      ('Cultural Studies', 'Globe: land and water', 2),
      ('Cultural Studies', 'Continents', 3),
      ('Cultural Studies', 'Flags', 4),
      ('Cultural Studies', 'Parts of a plant', 5),
      ('Cultural Studies', 'Parts of an animal', 6),
      ('Cultural Studies', 'Life cycles', 7),
      ('Cultural Studies', 'Living and non-living', 8),
      ('Cultural Studies', 'Magnetic and non-magnetic', 9),
      ('Cultural Studies', 'Sink and float', 10),
      ('Cultural Studies', 'Timeline of life', 11),
      ('Cultural Studies', 'Calendar', 12),
      ('Cultural Studies', 'Community helpers', 13),
      ('Art and Music', 'Drawing', 1),
      ('Art and Music', 'Painting', 2),
      ('Art and Music', 'Cutting and pasting', 3),
      ('Art and Music', 'Clay modelling', 4),
      ('Art and Music', 'Songs and rhymes', 5),
      ('Art and Music', 'Bells', 6),
      ('Art and Music', 'Rhythm', 7),
      ('Art and Music', 'Movement', 8),
      ('Grace and Courtesy', 'Greeting', 1),
      ('Grace and Courtesy', 'Offering help', 2),
      ('Grace and Courtesy', 'Waiting for a turn', 3),
      ('Grace and Courtesy', 'Interrupting politely', 4),
      ('Grace and Courtesy', 'Walking around work mats', 5),
      ('Grace and Courtesy', 'Using a quiet voice', 6),
      ('Grace and Courtesy', 'Saying please and thank you', 7)) as w (area, work, pos)
  join public.school_subjects s on s.business_id = p_business and s.name = w.area
  where not exists (select 1 from public.school_works x where x.subject_id = s.id)
  on conflict do nothing;
end $$;
revoke execute on function public._school_seed_works(uuid) from public;

-- The works of one area, replaced by this list (works that stay keep their progress; works taken off the list lose theirs).
create function public.school_save_works(p_business uuid, p_subject uuid, p_names text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text; n integer := 0; v_keep uuid[] := '{}'; v_id uuid;
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_subjects where id = p_subject and business_id = p_business) then raise exception 'area not found' using errcode = '22023'; end if;
  if coalesce(cardinality(p_names), 0) > 120 then raise exception 'an area can have up to 120 works' using errcode = '22023'; end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    if length(btrim(coalesce(v_name, ''))) = 0 then continue; end if;
    n := n + 1;
    insert into public.school_works (business_id, subject_id, name, position) values (p_business, p_subject, btrim(v_name), n)
      on conflict (subject_id, name) do update set position = excluded.position returning id into v_id;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.school_works where subject_id = p_subject and id <> all (v_keep);
end $$;

-- Record where children are on a work. p_items is [{student_id, status, note}]; a null status clears it. Guides record for their own environment; managers for anyone.
create function public.school_record_progress(p_business uuid, p_work uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare x jsonb; st public.school_students; v_ok boolean; v_n integer := 0; v_status text;
begin
  if not exists (select 1 from public.school_works where id = p_work and business_id = p_business) then raise exception 'work not found' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'choose the children' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into st from public.school_students where id = (x ->> 'student_id')::uuid and business_id = p_business;
    if not found then raise exception 'permission denied' using errcode = '42501'; end if;
    v_ok := public.has_module_permission(p_business, 'school-results', 'school.results.approve', 'use')
      or (public.has_module_permission(p_business, 'school-results', 'school.results.enter', 'use') and (public.has_business_permission(p_business, 'school.read') or public._school_teaches_class(p_business, st.class_id)));
    if not v_ok then raise exception 'permission denied' using errcode = '42501'; end if;
    v_status := nullif(btrim(coalesce(x ->> 'status', '')), '');
    if v_status is null then delete from public.school_work_progress where student_id = st.id and work_id = p_work;
    else
      if v_status not in ('introduced', 'practising', 'mastered') then raise exception 'choose introduced, practising or mastered' using errcode = '22023'; end if;
      insert into public.school_work_progress (business_id, student_id, work_id, status, note, recorded_by) values (p_business, st.id, p_work, v_status, nullif(btrim(coalesce(x ->> 'note', '')), ''), auth.uid())
        on conflict (student_id, work_id) do update set status = excluded.status, on_date = current_date, note = coalesce(excluded.note, public.school_work_progress.note), recorded_by = auth.uid();
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- The guide's note about one child in one area for a term (empty clears it).
create function public.school_save_progress_note(p_business uuid, p_student uuid, p_term uuid, p_subject uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_students; v_ok boolean;
begin
  select * into st from public.school_students where id = p_student and business_id = p_business;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  v_ok := public.has_module_permission(p_business, 'school-results', 'school.results.approve', 'use')
    or (public.has_module_permission(p_business, 'school-results', 'school.results.enter', 'use') and (public.has_business_permission(p_business, 'school.read') or public._school_teaches_class(p_business, st.class_id)));
  if not v_ok then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.school_terms where id = p_term and business_id = p_business) or not exists (select 1 from public.school_subjects where id = p_subject and business_id = p_business) then raise exception 'term or area not found' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then delete from public.school_progress_notes where student_id = p_student and term_id = p_term and subject_id = p_subject; return; end if;
  insert into public.school_progress_notes (business_id, student_id, term_id, subject_id, note) values (p_business, p_student, p_term, p_subject, btrim(p_note))
    on conflict (student_id, term_id, subject_id) do update set note = excluded.note;
end $$;

-- The progress report: per area, every work with where the child is, counts, and the guide's note; plus attendance, the overall comment and the next term.
create function public.school_progress_report(p_student uuid, p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.school_students; t public.school_terms; s public.school_settings; v_areas jsonb; v_att jsonb; v_rem jsonb;
begin
  select * into st from public.school_students where id = p_student;
  if not found or not public._school_can_see_student(st.business_id, p_student) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into t from public.school_terms where id = p_term and business_id = st.business_id;
  if not found then raise exception 'term not found' using errcode = '22023'; end if;
  select * into s from public.school_settings where business_id = st.business_id;
  select coalesce(jsonb_agg(jsonb_build_object('subject', a.name, 'note', (select n.note from public.school_progress_notes n where n.student_id = p_student and n.term_id = p_term and n.subject_id = a.id),
      'works', (select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'status', pr.status, 'on', pr.on_date, 'note', pr.note) order by w.position), '[]'::jsonb) from public.school_works w left join public.school_work_progress pr on pr.work_id = w.id and pr.student_id = p_student where w.subject_id = a.id)) order by a.name), '[]'::jsonb)
    into v_areas from public.school_subjects a
    where a.business_id = st.business_id and a.levels && array['montessori'] and exists (select 1 from public.school_class_subjects cs where cs.class_id = st.class_id and cs.subject_id = a.id);
  select jsonb_build_object('present', count(*) filter (where status = 'present'), 'absent', count(*) filter (where status = 'absent'), 'late', count(*) filter (where status = 'late'), 'excused', count(*) filter (where status = 'excused'), 'marked', count(*))
    into v_att from public.school_attendance where student_id = p_student and on_date between t.starts_on and t.ends_on;
  select to_jsonb(r) into v_rem from (select teacher_remark, principal_remark, promotion from public.school_remarks where student_id = p_student and term_id = p_term) r;
  return jsonb_build_object('student', jsonb_build_object('name', st.first_name || ' ' || coalesce(st.middle_name || ' ', '') || st.last_name, 'admission_no', st.admission_no, 'class', (select name from public.school_classes where id = st.class_id), 'age', (select description from public.school_classes where id = st.class_id), 'gender', st.gender, 'dob', st.date_of_birth),
    'term', t.name, 'session', (select name from public.school_sessions where id = t.session_id), 'areas', v_areas, 'attendance', v_att, 'remarks', v_rem,
    'school', jsonb_build_object('name', (select bz.name from public.businesses bz where bz.id = st.business_id), 'address', s.address, 'phone', s.phone, 'email', s.email),
    'next_term', (select jsonb_build_object('name', n.name, 'starts_on', n.starts_on) from public.school_terms n where n.business_id = st.business_id and n.starts_on > t.ends_on order by n.starts_on limit 1));
end $$;

-- ------------------------------------------------------------ the existing functions that know the kinds of school
create or replace function public.school_save_class(p_business uuid, p_id uuid, p_name text, p_level integer, p_arm text, p_active boolean, p_stage text, p_department uuid default null, p_description text default null, p_duration text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_type text; v_word text;
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  select school_type into v_type from public.school_settings where business_id = p_business;
  v_word := case when p_stage = 'online' then 'course' when p_stage = 'montessori' then 'environment' else 'class' end;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the % name', case when v_type = 'online' then 'course' when v_type = 'montessori' then 'environment' else 'class' end using errcode = '22023'; end if;
  if p_stage is null or p_stage not in ('nursery', 'primary', 'secondary', 'online', 'montessori') then raise exception 'choose the stage of the class (nursery, primary, secondary, online or montessori)' using errcode = '22023'; end if;
  if coalesce(p_active, true) and not public._school_stage_ok(v_type, p_stage) then
    raise exception 'this is a % school, so it cannot have % %. Change the kind of school in Settings first', v_type, p_stage, case when p_stage = 'online' then 'courses' when p_stage = 'montessori' then 'environments' else 'classes' end using errcode = '22023';
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

create or replace function public.school_save_subject(p_business uuid, p_id uuid, p_name text, p_code text, p_levels text[] default '{}', p_department uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_levels text[] := coalesce(p_levels, '{}');
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the subject name' using errcode = '22023'; end if;
  if not (v_levels <@ array['nursery', 'primary', 'jss', 'sss', 'online', 'montessori']::text[]) then raise exception 'choose levels from nursery, primary, junior secondary, senior secondary, online and montessori' using errcode = '22023'; end if;
  if p_department is not null and not exists (select 1 from public.school_departments where id = p_department and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_subjects (id, business_id, name, code, levels, department_id) values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), v_levels, p_department);
  else update public.school_subjects set name = btrim(p_name), code = nullif(btrim(coalesce(p_code, '')), ''), levels = v_levels, department_id = p_department where id = p_id and business_id = p_business;
    if not found then raise exception 'subject not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a subject with this name already exists' using errcode = '23505';
end $$;

create or replace function public.school_save_settings(p_business uuid, p_type text, p_address text, p_phone text, p_email text, p_ca numeric, p_exam numeric, p_position boolean, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_names text; v_old text;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if p_type not in ('nursery', 'primary', 'secondary', 'combined', 'online', 'montessori') then raise exception 'choose the type of school' using errcode = '22023'; end if;
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
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary'), ('Toddler Community', 1, 'montessori'), ('Children''s House', 2, 'montessori'), ('Lower Elementary', 3, 'montessori'), ('Upper Elementary', 4, 'montessori')) as x (name, ord, kind)
    where public._school_stage_ok(p_type, x.kind) loop
    insert into public.school_classes (business_id, name, level_order, stage) values (p_business, cr.name, cr.ord, cr.kind);
  end loop;
  perform public._school_describe_environments(p_business);
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
  if public._school_stage_ok(p_type, 'montessori') then perform public._school_seed_works(p_business); end if;
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
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary'), ('Toddler Community', 1, 'montessori'), ('Children''s House', 2, 'montessori'), ('Lower Elementary', 3, 'montessori'), ('Upper Elementary', 4, 'montessori')) as x (name, ord, kind)
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

  perform public._school_describe_environments(p_business);
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
  if public._school_stage_ok(p_new, 'montessori') then perform public._school_seed_works(p_business); end if;
  if p_new = 'online' then perform public._school_tidy_cohorts(p_business); end if;
end $$;

revoke execute on function public.school_save_works(uuid, uuid, text[]), public.school_record_progress(uuid, uuid, jsonb), public.school_save_progress_note(uuid, uuid, uuid, uuid, text), public.school_progress_report(uuid, uuid) from public;
grant execute on function public.school_save_works(uuid, uuid, text[]), public.school_record_progress(uuid, uuid, jsonb), public.school_save_progress_note(uuid, uuid, uuid, uuid, text), public.school_progress_report(uuid, uuid) to authenticated;
