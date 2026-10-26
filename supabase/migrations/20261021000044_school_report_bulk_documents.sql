-- Report card content, bulk operations, and student documents.
--
-- 1. Report card: affective and psychomotor ratings (a school-defined list of traits, rated 1 to 5 per term), reusable teacher and principal comments, the position
--    in each subject, and an annual (cumulative) card across the terms of a session with an annual average, grade and position.
-- 2. Bulk: graduating a group of students at once. (Importing from CSV, whole-class promotion and score import use the existing guarded functions from the app.)
-- 3. Documents: a passport photo per student (kept apart from the student row so lists stay light) and uploaded documents (birth certificate, previous results and
--    so on, up to about 1 MB each, only for people who manage students). Documents live in the database so the same row-level security protects them.

-- ------------------------------------------------------------ skills and comments
create table public.school_skill_traits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  domain text not null check (domain in ('affective', 'psychomotor')),
  name text not null check (length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  unique (business_id, domain, name), unique (business_id, id)
);
create table public.school_skill_ratings (
  business_id uuid not null,
  student_id uuid not null,
  term_id uuid not null,
  trait_id uuid not null references public.school_skill_traits (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  primary key (student_id, term_id, trait_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id) on delete cascade,
  foreign key (business_id, term_id) references public.school_terms (business_id, id)
);
create table public.school_remark_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('teacher', 'principal')),
  text text not null check (length(btrim(text)) between 1 and 300),
  unique (business_id, kind, text)
);
alter table public.school_skill_traits enable row level security;
alter table public.school_skill_ratings enable row level security;
alter table public.school_remark_templates enable row level security;
create policy school_skill_traits_select on public.school_skill_traits for select to authenticated using (public.is_active_member(business_id));
create policy school_skill_ratings_select on public.school_skill_ratings for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_remark_templates_select on public.school_remark_templates for select to authenticated using (public.has_business_permission(business_id, 'school.read') or public.has_business_permission(business_id, 'school.teach'));
grant select on public.school_skill_traits, public.school_skill_ratings, public.school_remark_templates to authenticated;

-- The standard lists, given to every school (existing ones now, new ones when their settings are first saved).
create function public._school_seed_skills(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.school_skill_traits where business_id = p_business) then
    insert into public.school_skill_traits (business_id, domain, name, position)
    select p_business, x.d, x.n, x.p from (values
      ('affective', 'Punctuality', 1), ('affective', 'Neatness', 2), ('affective', 'Honesty', 3), ('affective', 'Politeness', 4), ('affective', 'Attentiveness', 5), ('affective', 'Self control', 6), ('affective', 'Relationship with others', 7),
      ('psychomotor', 'Handwriting', 1), ('psychomotor', 'Sports and games', 2), ('psychomotor', 'Drawing and painting', 3), ('psychomotor', 'Musical skills', 4), ('psychomotor', 'Handling of tools', 5)) as x (d, n, p);
  end if;
  if not exists (select 1 from public.school_remark_templates where business_id = p_business) then
    insert into public.school_remark_templates (business_id, kind, text) values
      (p_business, 'teacher', 'An excellent result. Keep up the good work.'), (p_business, 'teacher', 'A good performance. You can do even better with more effort.'),
      (p_business, 'teacher', 'A fair result. More attention to your studies is needed.'), (p_business, 'teacher', 'Weak result. Please see me for extra help.'),
      (p_business, 'teacher', 'A well-behaved and hardworking pupil.'),
      (p_business, 'principal', 'Well done. Promoted to the next class.'), (p_business, 'principal', 'A satisfactory result. Aim higher next term.'),
      (p_business, 'principal', 'Work harder next term.'), (p_business, 'principal', 'Parents are advised to follow up closely.');
  end if;
end $$;
revoke execute on function public._school_seed_skills(uuid) from public;
create function public._school_settings_seed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public._school_seed_skills(new.business_id); return new; end $$;
revoke execute on function public._school_settings_seed() from public;
create trigger school_settings_seed after insert on public.school_settings for each row execute function public._school_settings_seed();
select public._school_seed_skills(business_id) from public.school_settings;

create function public.school_save_traits(p_business uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb; n integer := 0; v_keep uuid[] := '{}'; v_id uuid;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 40 then raise exception 'give a list of up to 40 skills' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if (x ->> 'domain') not in ('affective', 'psychomotor') or length(btrim(coalesce(x ->> 'name', ''))) = 0 then raise exception 'every skill needs a name and a group (affective or psychomotor)' using errcode = '22023'; end if;
    insert into public.school_skill_traits (business_id, domain, name, position) values (p_business, x ->> 'domain', btrim(x ->> 'name'), n)
      on conflict (business_id, domain, name) do update set position = excluded.position returning id into v_id;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.school_skill_traits where business_id = p_business and id <> all (v_keep);
end $$;

create function public.school_save_remark_templates(p_business uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 60 then raise exception 'give a list of up to 60 comments' using errcode = '22023'; end if;
  delete from public.school_remark_templates where business_id = p_business;
  for x in select * from jsonb_array_elements(p_items) loop
    if (x ->> 'kind') not in ('teacher', 'principal') or length(btrim(coalesce(x ->> 'text', ''))) = 0 then raise exception 'every comment needs its text and who writes it (teacher or principal)' using errcode = '22023'; end if;
    insert into public.school_remark_templates (business_id, kind, text) values (p_business, x ->> 'kind', btrim(x ->> 'text')) on conflict do nothing;
  end loop;
end $$;

-- Ratings for one student and term: the class teacher (or anyone who may write remarks) enters them. A null rating clears it.
create function public.school_save_ratings(p_business uuid, p_student uuid, p_term uuid, p_ratings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_students; x jsonb; v_ok boolean;
begin
  select * into st from public.school_students where id = p_student and business_id = p_business;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  v_ok := public.has_module_permission(p_business, 'school-results', 'school.results.approve', 'use')
    or (public.has_module_permission(p_business, 'school-results', 'school.results.enter', 'use') and (public.has_business_permission(p_business, 'school.read') or public._school_teaches_class(p_business, st.class_id)));
  if not v_ok then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.school_terms where id = p_term and business_id = p_business) then raise exception 'term not found' using errcode = '22023'; end if;
  if jsonb_typeof(p_ratings) is distinct from 'array' then raise exception 'give the ratings as a list' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_ratings) loop
    if not exists (select 1 from public.school_skill_traits where id = (x ->> 'trait_id')::uuid and business_id = p_business) then raise exception 'unknown skill' using errcode = '22023'; end if;
    if (x ->> 'rating') is null then delete from public.school_skill_ratings where student_id = p_student and term_id = p_term and trait_id = (x ->> 'trait_id')::uuid;
    else
      if (x ->> 'rating')::integer not between 1 and 5 then raise exception 'rate each skill from 1 to 5' using errcode = '22023'; end if;
      insert into public.school_skill_ratings (business_id, student_id, term_id, trait_id, rating) values (p_business, p_student, p_term, (x ->> 'trait_id')::uuid, (x ->> 'rating')::integer)
        on conflict (student_id, term_id, trait_id) do update set rating = excluded.rating;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------ report cards
create or replace function public.school_report_card(p_student uuid, p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.school_students; t public.school_terms; s public.school_settings; v_staff boolean; v_rows jsonb; v_avg numeric; v_att jsonb; v_rem jsonb; v_pos integer; v_size integer; v_days integer; v_skills jsonb;
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
  -- Where the student stands in each subject among the class (published scores only).
  select coalesce(jsonb_agg(e.val || jsonb_build_object('position', (
      select count(*) + 1 from (select x.student_id, coalesce(x.ca, 0) + coalesce(x.exam, 0) as tot from public.school_scores x
        where x.business_id = st.business_id and x.class_id = st.class_id and x.term_id = p_term and x.status = 'published'
          and x.subject_id = (select sj2.id from public.school_subjects sj2 where sj2.business_id = st.business_id and sj2.name = e.val ->> 'subject')) q
      where q.tot > (e.val ->> 'total')::numeric)) order by e.ord), '[]'::jsonb)
    into v_rows from (select value as val, ordinality as ord from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) with ordinality) e;
  select coalesce(jsonb_agg(jsonb_build_object('domain', tr.domain, 'name', tr.name, 'rating', r.rating) order by tr.domain, tr.position), '[]'::jsonb) into v_skills
    from public.school_skill_ratings r join public.school_skill_traits tr on tr.id = r.trait_id where r.student_id = p_student and r.term_id = p_term;
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
    'skills', v_skills,
    'next_term', (select jsonb_build_object('name', n.name, 'starts_on', n.starts_on) from public.school_terms n where n.business_id = st.business_id and n.starts_on > t.ends_on order by n.starts_on limit 1));
end $$;

-- The annual card: every subject across the terms of a session, with the annual average, its grade and the position in the class (published scores only).
create function public.school_annual_card(p_student uuid, p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.school_students; s public.school_settings; ses public.school_sessions; v_terms jsonb; v_subjects jsonb; v_avg numeric; v_pos integer; v_size integer; v_promo text;
begin
  select * into st from public.school_students where id = p_student;
  if not found or not public._school_can_see_student(st.business_id, p_student) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into ses from public.school_sessions where id = p_session and business_id = st.business_id;
  if not found then raise exception 'session not found' using errcode = '22023'; end if;
  select * into s from public.school_settings where business_id = st.business_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.starts_on), '[]'::jsonb) into v_terms from public.school_terms t where t.session_id = p_session and t.business_id = st.business_id;
  select coalesce(jsonb_agg(jsonb_build_object('subject', y.name,
      'terms', (select jsonb_agg((select (coalesce(x.ca, 0) + coalesce(x.exam, 0)) from public.school_scores x where x.student_id = p_student and x.term_id = t.id and x.subject_id = y.id and x.status = 'published') order by t.starts_on)
                from public.school_terms t where t.session_id = p_session and t.business_id = st.business_id),
      'average', y.avg_total, 'grade', public._school_grade(st.business_id, y.avg_total)) order by y.name), '[]'::jsonb), avg(y.avg_total)
    into v_subjects, v_avg
    from (select sj.id, sj.name, avg(coalesce(sc.ca, 0) + coalesce(sc.exam, 0)) as avg_total
            from public.school_scores sc join public.school_subjects sj on sj.id = sc.subject_id
            join public.school_terms tt on tt.id = sc.term_id and tt.session_id = p_session
           where sc.student_id = p_student and sc.status = 'published' group by sj.id, sj.name) y;
  v_avg := round(v_avg, 2);
  if v_avg is not null then
    select count(*) + 1 into v_pos from (select z.student_id, avg(z.a) as overall from (
        select sc.student_id, sc.subject_id, avg(coalesce(sc.ca, 0) + coalesce(sc.exam, 0)) as a from public.school_scores sc join public.school_terms tt on tt.id = sc.term_id and tt.session_id = p_session
         where sc.business_id = st.business_id and sc.class_id = st.class_id and sc.status = 'published' group by sc.student_id, sc.subject_id) z group by z.student_id) q where q.overall > v_avg;
    select count(distinct sc.student_id) into v_size from public.school_scores sc join public.school_terms tt on tt.id = sc.term_id and tt.session_id = p_session
      where sc.business_id = st.business_id and sc.class_id = st.class_id and sc.status = 'published';
  end if;
  select r.promotion into v_promo from public.school_remarks r join public.school_terms tt on tt.id = r.term_id and tt.session_id = p_session where r.student_id = p_student order by tt.starts_on desc limit 1;
  return jsonb_build_object('student', jsonb_build_object('name', st.first_name || ' ' || coalesce(st.middle_name || ' ', '') || st.last_name, 'admission_no', st.admission_no, 'class', (select name from public.school_classes where id = st.class_id), 'gender', st.gender, 'dob', st.date_of_birth),
    'session', ses.name, 'terms', v_terms, 'subjects', v_subjects, 'average', v_avg, 'position', case when s.show_position then v_pos end, 'class_size', case when s.show_position then v_size end, 'promotion', v_promo,
    'school', jsonb_build_object('name', (select bz.name from public.businesses bz where bz.id = st.business_id), 'address', s.address, 'phone', s.phone, 'email', s.email),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('min', g.min_score, 'grade', g.grade, 'remark', g.remark) order by g.min_score desc), '[]'::jsonb) from public.school_grade_bands g where g.business_id = st.business_id));
end $$;

-- ------------------------------------------------------------ bulk
create function public.school_graduate(p_business uuid, p_students uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_id uuid;
begin
  perform public._school_guard(p_business, 'school-students', 'school.students');
  if coalesce(cardinality(p_students), 0) = 0 then raise exception 'choose the students who are graduating' using errcode = '22023'; end if;
  foreach v_id in array p_students loop
    update public.school_students set status = 'graduated', status_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Graduated'), status_on = current_date where id = v_id and business_id = p_business and status = 'active';
    if found then v_n := v_n + 1; update public.school_enrollments set ended_on = current_date where student_id = v_id and ended_on is null; end if;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------ photos and documents
create table public.school_student_photos (
  student_id uuid primary key,
  business_id uuid not null,
  photo text not null check (length(photo) <= 120000 and photo ~ '^data:image/(jpeg|png|webp);base64,'),
  updated_at timestamptz not null default now(),
  foreign key (business_id, student_id) references public.school_students (business_id, id) on delete cascade
);
create table public.school_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  student_id uuid not null,
  kind text not null check (kind in ('birth_certificate', 'previous_results', 'medical', 'identification', 'other')),
  name text not null check (length(btrim(name)) between 1 and 120),
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size integer not null check (size between 1 and 1500000),
  data text not null check (length(data) <= 2100000 and data ~ '^data:'),
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, student_id) references public.school_students (business_id, id) on delete cascade
);
create index school_documents_student_idx on public.school_documents (student_id);
alter table public.school_student_photos enable row level security;
alter table public.school_documents enable row level security;
create policy school_student_photos_select on public.school_student_photos for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_documents_select on public.school_documents for select to authenticated using (public.has_business_permission(business_id, 'school.students'));
grant select on public.school_student_photos, public.school_documents to authenticated;

create function public.school_set_student_photo(p_student uuid, p_photo text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_students;
begin
  select * into st from public.school_students where id = p_student;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(st.business_id, 'school-students', 'school.students');
  if p_photo is null or btrim(p_photo) = '' then delete from public.school_student_photos where student_id = p_student; return; end if;
  if p_photo !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'the photo must be a JPEG, PNG or WebP picture' using errcode = '22023'; end if;
  if length(p_photo) > 120000 then raise exception 'the photo is too large; use a smaller picture' using errcode = '22023'; end if;
  insert into public.school_student_photos (student_id, business_id, photo) values (p_student, st.business_id, p_photo)
    on conflict (student_id) do update set photo = excluded.photo, updated_at = now();
end $$;

create function public.school_add_document(p_student uuid, p_kind text, p_name text, p_mime text, p_data text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare st public.school_students; v_id uuid;
begin
  select * into st from public.school_students where id = p_student;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(st.business_id, 'school-students', 'school.students');
  if p_kind not in ('birth_certificate', 'previous_results', 'medical', 'identification', 'other') then raise exception 'choose what kind of document it is' using errcode = '22023'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'upload a PDF or a JPEG, PNG or WebP picture' using errcode = '22023'; end if;
  if p_data is null or p_data !~ '^data:' or length(p_data) > 2100000 then raise exception 'the file is too large (the limit is about 1.5 MB)' using errcode = '22023'; end if;
  if (select count(*) from public.school_documents where student_id = p_student) >= 15 then raise exception 'a student can have up to 15 documents' using errcode = '22023'; end if;
  insert into public.school_documents (business_id, student_id, kind, name, mime, size, data, uploaded_by)
  values (st.business_id, p_student, p_kind, btrim(p_name), p_mime, (length(p_data) * 3) / 4, p_data, auth.uid()) returning id into v_id;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (st.business_id, auth.uid(), 'school_document.add', 'school_document', v_id, jsonb_build_object('student', st.admission_no, 'kind', p_kind, 'name', btrim(p_name)));
  return v_id;
end $$;

create function public.school_delete_document(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.school_documents;
begin
  select * into d from public.school_documents where id = p_id;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(d.business_id, 'school-students', 'school.students');
  delete from public.school_documents where id = p_id;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (d.business_id, auth.uid(), 'school_document.delete', 'school_document', p_id, jsonb_build_object('kind', d.kind, 'name', d.name));
end $$;

-- ------------------------------------------------------------ privileges
revoke execute on function public.school_save_traits(uuid, jsonb), public.school_save_remark_templates(uuid, jsonb), public.school_save_ratings(uuid, uuid, uuid, jsonb), public.school_annual_card(uuid, uuid),
  public.school_graduate(uuid, uuid[], text), public.school_set_student_photo(uuid, text), public.school_add_document(uuid, text, text, text, text), public.school_delete_document(uuid) from public;
grant execute on function public.school_save_traits(uuid, jsonb), public.school_save_remark_templates(uuid, jsonb), public.school_save_ratings(uuid, uuid, uuid, jsonb), public.school_annual_card(uuid, uuid),
  public.school_graduate(uuid, uuid[], text), public.school_set_student_photo(uuid, text), public.school_add_document(uuid, text, text, text, text), public.school_delete_document(uuid) to authenticated;
