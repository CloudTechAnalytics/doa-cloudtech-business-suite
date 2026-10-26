-- Senior secondary departments, subjects offered by school level, deleting a student or parent, and a fuller report card.
--
-- * Departments (Science, Art, Commercial by default) belong to the school. A senior secondary class can sit in a department, and a subject can belong to one.
-- * Subjects know which levels they are taught at (nursery, primary, junior secondary, senior secondary), so each school only sees the subjects that fit its kind.
-- * First-time setup builds the classes of the chosen kind of school, the departments, the subjects, and a sensible starting pick of subjects for every class,
--   which the school then adjusts class by class.
-- * Owners and business admins (permission school.delete) can permanently delete a student or a parent record. A student with fee payments on record cannot be
--   deleted, because records of money are never erased; withdraw them instead.
-- * The report card now carries the school's details, the grading key, the next term's start date, and each subject's class average, highest and lowest score.

insert into public.permissions (code, description) values ('school.delete', 'Permanently delete a student or a parent or guardian record');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'school.delete' where r.business_id is null and r.name in ('owner', 'business_admin');

create table public.school_departments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 40),
  unique (business_id, id), unique (business_id, name)
);
alter table public.school_classes add column department_id uuid;
alter table public.school_classes add foreign key (business_id, department_id) references public.school_departments (business_id, id);
alter table public.school_subjects add column department_id uuid;
alter table public.school_subjects add column levels text[] not null default '{}' check (levels <@ array['nursery', 'primary', 'jss', 'sss']::text[]);
alter table public.school_subjects add foreign key (business_id, department_id) references public.school_departments (business_id, id);

alter table public.school_departments enable row level security;
create policy school_departments_select on public.school_departments for select to authenticated using (public.is_active_member(business_id));
grant select on public.school_departments to authenticated;

-- ------------------------------------------------------------ departments
create function public.school_save_department(p_business uuid, p_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the department name' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_departments (id, business_id, name) values (v_id, p_business, btrim(p_name));
  else update public.school_departments set name = btrim(p_name) where id = p_id and business_id = p_business;
    if not found then raise exception 'department not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a department with this name already exists' using errcode = '23505';
end $$;

create function public.school_delete_department(p_business uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_departments where id = p_id and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  if exists (select 1 from public.school_classes where department_id = p_id) or exists (select 1 from public.school_subjects where department_id = p_id) then
    raise exception 'this department still has classes or subjects; move them first' using errcode = '22023';
  end if;
  delete from public.school_departments where id = p_id;
end $$;

-- ---------------------------------------------------------------- classes
drop function public.school_save_class(uuid, uuid, text, integer, text, boolean, text);
create function public.school_save_class(p_business uuid, p_id uuid, p_name text, p_level integer, p_arm text, p_active boolean, p_stage text, p_department uuid default null) returns uuid
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
  if p_department is not null then
    if p_stage <> 'secondary' then raise exception 'only secondary classes can sit in a department' using errcode = '22023'; end if;
    if not exists (select 1 from public.school_departments where id = p_department and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  end if;
  if p_id is null then insert into public.school_classes (id, business_id, name, level_order, arm, active, stage, department_id) values (v_id, p_business, btrim(p_name), coalesce(p_level, 0), nullif(btrim(coalesce(p_arm, '')), ''), coalesce(p_active, true), p_stage, p_department);
  else update public.school_classes set name = btrim(p_name), level_order = coalesce(p_level, 0), arm = nullif(btrim(coalesce(p_arm, '')), ''), active = coalesce(p_active, true), stage = p_stage, department_id = p_department where id = p_id and business_id = p_business;
    if not found then raise exception 'class not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a class with this name already exists' using errcode = '23505';
end $$;

-- --------------------------------------------------------------- subjects
drop function public.school_save_subject(uuid, uuid, text, text);
create function public.school_save_subject(p_business uuid, p_id uuid, p_name text, p_code text, p_levels text[] default '{}', p_department uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_levels text[] := coalesce(p_levels, '{}');
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the subject name' using errcode = '22023'; end if;
  if not (v_levels <@ array['nursery', 'primary', 'jss', 'sss']::text[]) then raise exception 'choose levels from nursery, primary, junior secondary and senior secondary' using errcode = '22023'; end if;
  if p_department is not null and not exists (select 1 from public.school_departments where id = p_department and business_id = p_business) then raise exception 'department not found' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_subjects (id, business_id, name, code, levels, department_id) values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), v_levels, p_department);
  else update public.school_subjects set name = btrim(p_name), code = nullif(btrim(coalesce(p_code, '')), ''), levels = v_levels, department_id = p_department where id = p_id and business_id = p_business;
    if not found then raise exception 'subject not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a subject with this name already exists' using errcode = '23505';
end $$;

-- The standard subjects by level, and for senior secondary by department (null = taken in every department).
-- Every subject name keeps the same department wherever it appears.
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
  ) as x (name, code, grp, dept)
$$;
revoke execute on function public._school_catalogue() from public;

-- ------------------------------------------------------------------ setup
create or replace function public.school_setup(p_business uuid, p_type text, p_session text, p_starts date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sess uuid; cr record; d record; i integer;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if exists (select 1 from public.school_classes where business_id = p_business) then raise exception 'this school already has classes; edit them instead' using errcode = '22023'; end if;
  perform public.school_save_settings(p_business, p_type, null, null, null, 40, 60, false, '{1,2,3,4,5}');
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

-- ------------------------------------------------------------ deleting
-- A student is erased with their attendance, scores, remarks, class history, parent links and unpaid bills. Fee payments are never erased: a student who has any is refused.
create function public.school_delete_student(p_student uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_students;
begin
  select * into st from public.school_students where id = p_student;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(st.business_id, 'school-students', 'school.delete');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why (it is kept in the audit trail)' using errcode = '22023'; end if;
  if exists (select 1 from public.school_payments where student_id = p_student) then
    raise exception 'this student has fee payments on record. Records of money are never erased; mark the student as withdrawn instead' using errcode = '22023';
  end if;
  delete from public.school_scores where student_id = p_student;
  delete from public.school_attendance where student_id = p_student;
  delete from public.school_remarks where student_id = p_student;
  delete from public.school_bill_items where bill_id in (select id from public.school_bills where student_id = p_student);
  delete from public.school_bills where student_id = p_student;
  delete from public.school_enrollments where student_id = p_student;
  delete from public.school_student_guardians where student_id = p_student;
  update public.school_admissions set student_id = null where student_id = p_student;
  delete from public.school_students where id = p_student;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (st.business_id, auth.uid(), 'school_student.delete', 'school_student', p_student, jsonb_build_object('name', st.first_name || ' ' || st.last_name, 'admission_no', st.admission_no, 'reason', btrim(p_reason)));
end $$;

-- A parent or guardian record is erased with its links to students. (Their login, if they had one, stays: it is an account, not a record of the school.)
create function public.school_delete_guardian(p_guardian uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.school_guardians; v_links integer;
begin
  select * into g from public.school_guardians where id = p_guardian;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(g.business_id, 'school-guardians', 'school.delete');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why (it is kept in the audit trail)' using errcode = '22023'; end if;
  select count(*) into v_links from public.school_student_guardians where guardian_id = p_guardian;
  delete from public.school_student_guardians where guardian_id = p_guardian;
  delete from public.school_guardians where id = p_guardian;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (g.business_id, auth.uid(), 'school_guardian.delete', 'school_guardian', p_guardian, jsonb_build_object('name', g.name, 'students_unlinked', v_links, 'reason', btrim(p_reason)));
end $$;

-- ------------------------------------------------------------ report card
create or replace function public.school_report_card(p_student uuid, p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.school_students; t public.school_terms; s public.school_settings; v_staff boolean; v_rows jsonb; v_avg numeric; v_att jsonb; v_rem jsonb; v_pos integer; v_size integer; v_days integer;
begin
  select * into st from public.school_students where id = p_student;
  if not found or not public._school_can_see_student(st.business_id, p_student) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into t from public.school_terms where id = p_term and business_id = st.business_id;
  if not found then raise exception 'term not found' using errcode = '22023'; end if;
  select * into s from public.school_settings where business_id = st.business_id;
  v_staff := public.has_business_permission(st.business_id, 'school.read') or public.has_business_permission(st.business_id, 'school.teach');
  select coalesce(jsonb_agg(jsonb_build_object('subject', sj.name, 'ca', sc.ca, 'exam', sc.exam, 'total', coalesce(sc.ca, 0) + coalesce(sc.exam, 0), 'grade', public._school_grade(st.business_id, coalesce(sc.ca, 0) + coalesce(sc.exam, 0)), 'remark', sc.remark, 'status', sc.status, 'class_avg', round((select avg(coalesce(x.ca, 0) + coalesce(x.exam, 0)) from public.school_scores x where x.business_id = sc.business_id and x.class_id = sc.class_id and x.subject_id = sc.subject_id and x.term_id = sc.term_id and x.status = 'published'), 1), 'highest', (select max(coalesce(x.ca, 0) + coalesce(x.exam, 0)) from public.school_scores x where x.business_id = sc.business_id and x.class_id = sc.class_id and x.subject_id = sc.subject_id and x.term_id = sc.term_id and x.status = 'published'), 'lowest', (select min(coalesce(x.ca, 0) + coalesce(x.exam, 0)) from public.school_scores x where x.business_id = sc.business_id and x.class_id = sc.class_id and x.subject_id = sc.subject_id and x.term_id = sc.term_id and x.status = 'published')) order by sj.name), '[]'::jsonb),
         avg(coalesce(sc.ca, 0) + coalesce(sc.exam, 0))
    into v_rows, v_avg from public.school_scores sc join public.school_subjects sj on sj.business_id = sc.business_id and sj.id = sc.subject_id
    where sc.student_id = p_student and sc.term_id = p_term and (sc.status = 'published' or v_staff);
  select jsonb_build_object('present', count(*) filter (where status = 'present'), 'absent', count(*) filter (where status = 'absent'), 'late', count(*) filter (where status = 'late'), 'excused', count(*) filter (where status = 'excused'), 'marked', count(*))
    into v_att from public.school_attendance where student_id = p_student and on_date between t.starts_on and t.ends_on;
  select to_jsonb(r) into v_rem from (select teacher_remark, principal_remark, promotion from public.school_remarks where student_id = p_student and term_id = p_term) r;
  if s.show_position and v_avg is not null then
    select count(*) + 1, count(*) + 1 into v_pos, v_size from (select student_id, avg(coalesce(ca, 0) + coalesce(exam, 0)) a from public.school_scores where business_id = st.business_id and class_id = st.class_id and term_id = p_term and status = 'published' group by student_id) q where q.a > v_avg;
    select count(distinct student_id) into v_size from public.school_scores where business_id = st.business_id and class_id = st.class_id and term_id = p_term and status = 'published';
  end if;
  return jsonb_build_object('student', jsonb_build_object('name', st.first_name || ' ' || coalesce(st.middle_name || ' ', '') || st.last_name, 'admission_no', st.admission_no, 'class', (select name from public.school_classes where id = st.class_id), 'gender', st.gender, 'dob', st.date_of_birth),
    'term', t.name, 'session', (select name from public.school_sessions where id = t.session_id), 'subjects', v_rows, 'average', round(v_avg, 2), 'attendance', v_att, 'remarks', v_rem,
    'position', case when s.show_position then v_pos end, 'class_size', case when s.show_position then v_size end,
    'school', jsonb_build_object('name', (select bz.name from public.businesses bz where bz.id = st.business_id), 'address', s.address, 'phone', s.phone, 'email', s.email, 'ca_max', s.ca_max, 'exam_max', s.exam_max),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('min', g.min_score, 'grade', g.grade, 'remark', g.remark) order by g.min_score desc), '[]'::jsonb) from public.school_grade_bands g where g.business_id = st.business_id),
    'next_term', (select jsonb_build_object('name', n.name, 'starts_on', n.starts_on) from public.school_terms n where n.business_id = st.business_id and n.starts_on > t.ends_on order by n.starts_on limit 1));
end $$;

-- ------------------------------------------------------------- privileges
revoke execute on function public.school_save_department(uuid, uuid, text), public.school_delete_department(uuid, uuid), public.school_save_class(uuid, uuid, text, integer, text, boolean, text, uuid),
  public.school_save_subject(uuid, uuid, text, text, text[], uuid), public.school_delete_student(uuid, text), public.school_delete_guardian(uuid, text) from public;
grant execute on function public.school_save_department(uuid, uuid, text), public.school_delete_department(uuid, uuid), public.school_save_class(uuid, uuid, text, integer, text, boolean, text, uuid),
  public.school_save_subject(uuid, uuid, text, text, text[], uuid), public.school_delete_student(uuid, text), public.school_delete_guardian(uuid, text) to authenticated;
