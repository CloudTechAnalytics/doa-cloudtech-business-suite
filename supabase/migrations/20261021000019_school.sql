-- Basic school management: students, admissions, parents and guardians, classes and subjects, teachers and staff, attendance, results
-- and report cards, fees with payments and receipts, announcements, and a parent portal. Expenses reuse the shared expenses module.
--   * Everything is business-scoped (a school is a CloudTech business of industry "school") and goes through security-definer functions
--     that check the permission, the module, the teacher's assignment, and the data rules; tables have no direct write grants.
--   * Teachers see and change only the classes and subjects they are assigned; parents see only the children linked to them, and only
--     published results; money is visible only with the fees permission.
--   * History is kept: a student who leaves is marked transferred or withdrawn, never deleted; promotion adds an enrollment and keeps
--     the old ones; results store the class and term they were earned in; payments are reversed, never edited or deleted.
-- Additive apart from the industry list on businesses. Rollback: drop the objects created here and restore the businesses check.

-- ------------------------------------------------------------ industry, roles, permissions, modules
alter table public.businesses drop constraint businesses_primary_industry_code_check;
alter table public.businesses add constraint businesses_primary_industry_code_check check (primary_industry_code in ('retail', 'farm', 'bakery', 'pharmacy', 'school'));

insert into public.industry_templates (code, name, description, status) values
  ('school', 'School', 'Nursery, primary and secondary schools: students, attendance, results, fees and parents.', 'active');

insert into public.permissions (code, description) values
  ('school.read', 'View students, classes, attendance and results across the school'),
  ('school.manage', 'Set up the academic year, classes, subjects, staff, assignments and announcements'),
  ('school.students', 'Register and update students, decide admissions, manage parents and guardians'),
  ('school.teach', 'Teacher access to the classes and subjects assigned to them'),
  ('school.attendance', 'Take attendance'),
  ('school.results.enter', 'Enter and submit examination scores'),
  ('school.results.approve', 'Approve, publish and correct published results'),
  ('school.fees.read', 'View fee bills, payments and balances'),
  ('school.fees.manage', 'Set fees, generate bills, give discounts and reverse payments'),
  ('school.fees.record', 'Record fee payments and print receipts'),
  ('school.portal', 'Parent portal: see only the children linked to this account');

insert into public.roles (name, description, is_system_role) values
  ('principal', 'Head of the school: academics, results approval and oversight', true),
  ('teacher', 'Teaches assigned classes and subjects', true),
  ('bursar', 'School fees, payments and expenses', true),
  ('admissions_officer', 'Admissions, student records and fee receipts', true),
  ('parent', 'Parent or guardian with access to their own children only', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code like 'school.%' and (
  (r.name in ('owner', 'business_admin', 'manager') and p.code <> 'school.portal')
  or (r.name = 'principal' and p.code in ('school.read', 'school.manage', 'school.students', 'school.attendance', 'school.results.enter', 'school.results.approve', 'school.fees.read'))
  or (r.name = 'teacher' and p.code in ('school.teach', 'school.attendance', 'school.results.enter'))
  or (r.name = 'bursar' and p.code in ('school.read', 'school.fees.read', 'school.fees.manage', 'school.fees.record'))
  or (r.name = 'admissions_officer' and p.code in ('school.read', 'school.students', 'school.fees.record'))
  or (r.name = 'parent' and p.code = 'school.portal')
) where r.business_id is null;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
  (r.name in ('principal', 'teacher', 'bursar', 'admissions_officer') and p.code = 'dashboard.read')
  or (r.name = 'principal' and p.code in ('expenses.read'))
  or (r.name = 'bursar' and p.code in ('expenses.read', 'expenses.record'))
) where r.business_id is null;

insert into public.modules (code, name, description, is_core, required_permission) values
  ('school-students', 'Students', 'Student records, profiles, promotion, transfers and withdrawals.', false, 'school.read'),
  ('school-admissions', 'Admissions', 'Applications, decisions and admission numbers.', false, 'school.students'),
  ('school-guardians', 'Parents & Guardians', 'Parents and guardians linked to students.', false, 'school.read'),
  ('school-classes', 'Classes & Subjects', 'Sessions, terms, classes and subjects.', false, 'school.read'),
  ('school-staff', 'Teachers & Staff', 'Staff directory and class and subject assignments.', false, 'school.manage'),
  ('school-attendance', 'Attendance', 'Daily attendance by class.', false, 'school.attendance'),
  ('school-results', 'Results & Report Cards', 'Score entry, approval, publishing and report cards.', false, 'school.results.enter'),
  ('school-fees', 'School Fees', 'Fee items and student fee bills.', false, 'school.fees.read'),
  ('school-payments', 'Payments & Receipts', 'Recording payments and printing receipts.', false, 'school.fees.read'),
  ('school-announcements', 'Announcements', 'Notices for parents, teachers and classes.', false, 'dashboard.read'),
  ('school-reports', 'Reports', 'Enrolment, attendance, results and fees reports.', false, 'school.read'),
  ('school-settings', 'School Settings', 'Grading, assessment marks and working days.', false, 'school.manage'),
  ('school-portal', 'Parent Portal', 'Children, attendance, results, fees and announcements for parents.', false, 'school.portal');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, m.is_core or m.code = 'school-students'
from public.industry_templates t join public.modules m on m.is_core or m.code like 'school-%' or m.code = 'expenses'
where t.code = 'school';

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code like 'school-%';

-- ----------------------------------------------------------------- tables
create table public.school_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  school_type text not null default 'primary' check (school_type in ('nursery', 'primary', 'secondary', 'combined')),
  address text, phone text, email text,
  ca_max numeric(6, 2) not null default 40 check (ca_max >= 0),
  exam_max numeric(6, 2) not null default 60 check (exam_max >= 0),
  show_position boolean not null default false,
  working_days integer[] not null default '{1,2,3,4,5}',
  updated_at timestamptz not null default now(),
  check (ca_max + exam_max > 0 and ca_max + exam_max <= 1000)
);
create table public.school_grade_bands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  min_score numeric(6, 2) not null check (min_score >= 0),
  grade text not null check (length(btrim(grade)) between 1 and 6),
  remark text,
  unique (business_id, grade), unique (business_id, min_score)
);
create table public.school_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  starts_on date not null, ends_on date not null,
  is_current boolean not null default false,
  unique (business_id, id), unique (business_id, name), check (ends_on >= starts_on)
);
create table public.school_terms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  session_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  starts_on date not null, ends_on date not null,
  is_current boolean not null default false,
  unique (business_id, id), unique (business_id, session_id, name), check (ends_on >= starts_on),
  foreign key (business_id, session_id) references public.school_sessions (business_id, id)
);
create table public.school_classes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  level_order integer not null default 0 check (level_order between 0 and 99),
  arm text,
  active boolean not null default true,
  unique (business_id, id), unique (business_id, name)
);
create table public.school_subjects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  code text,
  unique (business_id, id), unique (business_id, name)
);
create table public.school_class_subjects (
  business_id uuid not null, class_id uuid not null, subject_id uuid not null,
  primary key (class_id, subject_id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id) on delete cascade,
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id) on delete cascade
);
create table public.school_students (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  admission_no text not null,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  middle_name text, last_name text not null check (length(btrim(last_name)) between 1 and 80),
  date_of_birth date check (date_of_birth is null or date_of_birth <= current_date),
  gender text check (gender is null or gender in ('female', 'male')),
  admitted_on date not null default current_date,
  admission_session_id uuid,
  class_id uuid,
  status text not null default 'active' check (status in ('active', 'transferred', 'withdrawn', 'graduated')),
  status_reason text, status_on date,
  emergency_name text, emergency_phone text, notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id), unique (business_id, admission_no),
  foreign key (business_id, class_id) references public.school_classes (business_id, id),
  foreign key (business_id, admission_session_id) references public.school_sessions (business_id, id)
);
create index school_students_class_idx on public.school_students (business_id, class_id) where status = 'active';
create table public.school_enrollments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  student_id uuid not null, class_id uuid not null, session_id uuid,
  started_on date not null default current_date, ended_on date,
  reason text,
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id)
);
create index school_enrollments_student_idx on public.school_enrollments (student_id, started_on);
create table public.school_guardians (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  phone text, email text, address text,
  user_id uuid references public.profiles (id),
  unique (business_id, id)
);
create table public.school_student_guardians (
  business_id uuid not null, student_id uuid not null, guardian_id uuid not null,
  relationship text not null default 'parent' check (length(btrim(relationship)) between 1 and 40),
  is_primary boolean not null default false,
  authorised boolean not null default true,
  primary key (student_id, guardian_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, guardian_id) references public.school_guardians (business_id, id)
);
create table public.school_admissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  applicant_first text not null check (length(btrim(applicant_first)) between 1 and 80),
  applicant_last text not null check (length(btrim(applicant_last)) between 1 and 80),
  date_of_birth date, gender text check (gender is null or gender in ('female', 'male')),
  applying_class_id uuid,
  guardian_name text not null, guardian_phone text, guardian_email text, guardian_relationship text default 'parent',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by uuid references public.profiles (id), decided_on date, decision_note text,
  student_id uuid,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id), unique (business_id, idempotency_key),
  foreign key (business_id, applying_class_id) references public.school_classes (business_id, id),
  foreign key (business_id, student_id) references public.school_students (business_id, id)
);
create table public.school_staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_no text not null,
  name text not null check (length(btrim(name)) between 2 and 160),
  phone text, email text, job_title text, department text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  user_id uuid references public.profiles (id),
  unique (business_id, id), unique (business_id, staff_no)
);
create table public.school_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id uuid not null, class_id uuid not null, subject_id uuid,
  is_class_teacher boolean not null default false,
  foreign key (business_id, staff_id) references public.school_staff (business_id, id) on delete cascade,
  foreign key (business_id, class_id) references public.school_classes (business_id, id) on delete cascade,
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id) on delete cascade
);
create unique index school_assignments_uq on public.school_assignments (staff_id, class_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), is_class_teacher);
create table public.school_holidays (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  on_date date not null, name text not null,
  unique (business_id, on_date)
);
create table public.school_attendance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  student_id uuid not null, class_id uuid not null, on_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  marked_by uuid references public.profiles (id), marked_at timestamptz not null default now(),
  unique (student_id, on_date),
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id)
);
create index school_attendance_class_idx on public.school_attendance (business_id, class_id, on_date);
create table public.school_scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  student_id uuid not null, class_id uuid not null, subject_id uuid not null, term_id uuid not null,
  ca numeric(6, 2) check (ca is null or ca >= 0), exam numeric(6, 2) check (exam is null or exam >= 0),
  remark text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'published')),
  entered_by uuid references public.profiles (id),
  reviewed_by uuid references public.profiles (id), reviewed_at timestamptz, review_note text,
  unique (student_id, subject_id, term_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id),
  foreign key (business_id, subject_id) references public.school_subjects (business_id, id),
  foreign key (business_id, term_id) references public.school_terms (business_id, id)
);
create table public.school_remarks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  student_id uuid not null, term_id uuid not null,
  teacher_remark text, principal_remark text,
  promotion text check (promotion is null or promotion in ('promoted', 'repeat', 'graduate')),
  unique (student_id, term_id),
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, term_id) references public.school_terms (business_id, id)
);
create table public.school_fee_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  amount numeric(14, 2) not null check (amount >= 0),
  class_id uuid, term_id uuid,
  on_admission boolean not null default false,
  active boolean not null default true,
  unique (business_id, id),
  foreign key (business_id, class_id) references public.school_classes (business_id, id),
  foreign key (business_id, term_id) references public.school_terms (business_id, id)
);
create table public.school_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  bill_number text not null,
  student_id uuid not null, term_id uuid not null,
  total numeric(14, 2) not null check (total >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  discount_reason text,
  due_on date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id), unique (business_id, bill_number), unique (student_id, term_id),
  check (discount <= total),
  foreign key (business_id, student_id) references public.school_students (business_id, id),
  foreign key (business_id, term_id) references public.school_terms (business_id, id)
);
create table public.school_bill_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, bill_id uuid not null,
  name text not null, amount numeric(14, 2) not null check (amount >= 0),
  foreign key (business_id, bill_id) references public.school_bills (business_id, id) on delete cascade
);
create table public.school_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  receipt_number text not null,
  bill_id uuid not null, student_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'bank_transfer', 'card', 'pos', 'other')),
  reference text,
  paid_on date not null default current_date,
  recorded_by uuid references public.profiles (id),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  reversal_reason text, reversed_by uuid references public.profiles (id), reversed_at timestamptz,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (business_id, id), unique (business_id, receipt_number), unique (business_id, idempotency_key),
  check (status = 'posted' or reversal_reason is not null),
  foreign key (business_id, bill_id) references public.school_bills (business_id, id),
  foreign key (business_id, student_id) references public.school_students (business_id, id)
);
create table public.school_announcements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 160),
  body text not null check (length(btrim(body)) >= 2),
  audience text not null check (audience in ('everyone', 'parents', 'teachers', 'staff', 'class')),
  class_id uuid,
  publish_on date not null default current_date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, class_id) references public.school_classes (business_id, id)
);

-- ------------------------------------------------------------------- helpers
create function public._school_guard(p_business uuid, p_module text, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, p_module, p_permission, 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
end $$;

-- A teacher is tied to a class (class teacher or subject teacher) through an active staff record linked to their login.
create function public._school_teaches_class(p_business uuid, p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.school_assignments a join public.school_staff s on s.business_id = a.business_id and s.id = a.staff_id
    where a.business_id = p_business and a.class_id = p_class and s.user_id = auth.uid() and s.status = 'active');
$$;
create function public._school_teaches_subject(p_business uuid, p_class uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.school_assignments a join public.school_staff s on s.business_id = a.business_id and s.id = a.staff_id
    where a.business_id = p_business and a.class_id = p_class and a.subject_id = p_subject and s.user_id = auth.uid() and s.status = 'active');
$$;
create function public._school_is_guardian_of(p_business uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.school_student_guardians sg join public.school_guardians g on g.business_id = sg.business_id and g.id = sg.guardian_id
    where sg.business_id = p_business and sg.student_id = p_student and sg.authorised and g.user_id = auth.uid());
$$;
-- Staff with the school-wide read permission, the class's own teachers, and a student's own parents may see that student's data.
create function public._school_can_see_student(p_business uuid, p_student uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_class uuid;
begin
  if not public.is_active_member(p_business) then return false; end if;
  if public.has_business_permission(p_business, 'school.read') then return true; end if;
  select class_id into v_class from public.school_students where id = p_student and business_id = p_business;
  if public.has_business_permission(p_business, 'school.teach') and v_class is not null and public._school_teaches_class(p_business, v_class) then return true; end if;
  return public.has_business_permission(p_business, 'school.portal') and public._school_is_guardian_of(p_business, p_student);
end $$;
create function public._school_current_session(p_business uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select id from public.school_sessions where business_id = p_business and is_current limit 1 $$;
create function public._school_current_term(p_business uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select id from public.school_terms where business_id = p_business and is_current limit 1 $$;

-- --------------------------------------------------------------------- RLS
alter table public.school_settings enable row level security;
alter table public.school_grade_bands enable row level security;
alter table public.school_sessions enable row level security;
alter table public.school_terms enable row level security;
alter table public.school_classes enable row level security;
alter table public.school_subjects enable row level security;
alter table public.school_class_subjects enable row level security;
alter table public.school_students enable row level security;
alter table public.school_enrollments enable row level security;
alter table public.school_guardians enable row level security;
alter table public.school_student_guardians enable row level security;
alter table public.school_admissions enable row level security;
alter table public.school_staff enable row level security;
alter table public.school_assignments enable row level security;
alter table public.school_holidays enable row level security;
alter table public.school_attendance enable row level security;
alter table public.school_scores enable row level security;
alter table public.school_remarks enable row level security;
alter table public.school_fee_items enable row level security;
alter table public.school_bills enable row level security;
alter table public.school_bill_items enable row level security;
alter table public.school_payments enable row level security;
alter table public.school_announcements enable row level security;

-- structure (settings, grades, sessions, classes, subjects, holidays) is readable by every member of the school
do $$
declare t text;
begin
  foreach t in array array['school_settings', 'school_grade_bands', 'school_sessions', 'school_terms', 'school_classes', 'school_subjects', 'school_class_subjects', 'school_holidays'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_member(business_id))', t || '_select', t);
  end loop;
end $$;
create policy school_students_select on public.school_students for select to authenticated using (public._school_can_see_student(business_id, id));
create policy school_enrollments_select on public.school_enrollments for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_guardians_select on public.school_guardians for select to authenticated using (
  public.is_active_member(business_id) and (public.has_business_permission(business_id, 'school.read') or user_id = auth.uid()
    or exists (select 1 from public.school_student_guardians sg where sg.guardian_id = school_guardians.id and sg.business_id = school_guardians.business_id and public._school_can_see_student(sg.business_id, sg.student_id))));
create policy school_student_guardians_select on public.school_student_guardians for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_admissions_select on public.school_admissions for select to authenticated using (public.has_business_permission(business_id, 'school.students'));
create policy school_staff_select on public.school_staff for select to authenticated using (public.has_business_permission(business_id, 'school.manage') or user_id = auth.uid());
create policy school_assignments_select on public.school_assignments for select to authenticated using (
  public.has_business_permission(business_id, 'school.manage') or exists (select 1 from public.school_staff s where s.id = school_assignments.staff_id and s.business_id = school_assignments.business_id and s.user_id = auth.uid()));
create policy school_attendance_select on public.school_attendance for select to authenticated using (public._school_can_see_student(business_id, student_id));
-- parents see only published results; staff see every state
create policy school_scores_select on public.school_scores for select to authenticated using (
  public._school_can_see_student(business_id, student_id)
  and (status = 'published' or public.has_business_permission(business_id, 'school.read') or public.has_business_permission(business_id, 'school.teach')));
create policy school_remarks_select on public.school_remarks for select to authenticated using (public._school_can_see_student(business_id, student_id));
create policy school_fee_items_select on public.school_fee_items for select to authenticated using (public.is_active_member(business_id) and (public.has_business_permission(business_id, 'school.fees.read') or public.has_business_permission(business_id, 'school.portal')));
create policy school_bills_select on public.school_bills for select to authenticated using (
  public.has_business_permission(business_id, 'school.fees.read') or (public.has_business_permission(business_id, 'school.portal') and public._school_is_guardian_of(business_id, student_id)));
create policy school_bill_items_select on public.school_bill_items for select to authenticated using (exists (select 1 from public.school_bills b where b.id = school_bill_items.bill_id and b.business_id = school_bill_items.business_id));
create policy school_payments_select on public.school_payments for select to authenticated using (
  public.has_business_permission(business_id, 'school.fees.read') or (public.has_business_permission(business_id, 'school.portal') and public._school_is_guardian_of(business_id, student_id)));
create policy school_announcements_select on public.school_announcements for select to authenticated using (
  public.is_active_member(business_id) and (
    public.has_business_permission(business_id, 'school.manage')
    or (publish_on <= current_date and (
      audience = 'everyone'
      or (audience = 'teachers' and public.has_business_permission(business_id, 'school.teach'))
      or (audience = 'staff' and (public.has_business_permission(business_id, 'school.read') or public.has_business_permission(business_id, 'school.teach')))
      or (audience = 'parents' and public.has_business_permission(business_id, 'school.portal'))
      or (audience = 'class' and (public.has_business_permission(business_id, 'school.read') or public._school_teaches_class(business_id, class_id)
          or (public.has_business_permission(business_id, 'school.portal') and exists (select 1 from public.school_students st where st.business_id = school_announcements.business_id and st.class_id = school_announcements.class_id and public._school_is_guardian_of(st.business_id, st.id)))))))));

grant select on public.school_settings, public.school_grade_bands, public.school_sessions, public.school_terms, public.school_classes, public.school_subjects, public.school_class_subjects,
  public.school_students, public.school_enrollments, public.school_guardians, public.school_student_guardians, public.school_admissions, public.school_staff, public.school_assignments,
  public.school_holidays, public.school_attendance, public.school_scores, public.school_remarks, public.school_fee_items, public.school_bills, public.school_bill_items,
  public.school_payments, public.school_announcements to authenticated;

create trigger audit_school_students after insert or update on public.school_students for each row execute function public.audit_row_change();
create trigger audit_school_attendance after insert or update on public.school_attendance for each row execute function public.audit_row_change();
create trigger audit_school_scores after insert or update on public.school_scores for each row execute function public.audit_row_change('remark');
create trigger audit_school_bills after insert or update on public.school_bills for each row execute function public.audit_row_change();
create trigger audit_school_payments after insert or update on public.school_payments for each row execute function public.audit_row_change();
create trigger audit_school_admissions after insert or update on public.school_admissions for each row execute function public.audit_row_change();
create trigger audit_school_settings after insert or update on public.school_settings for each row execute function public.audit_row_change();
create trigger audit_school_staff after insert or update on public.school_staff for each row execute function public.audit_row_change();

-- ------------------------------------------------------------------- views
create view public.school_student_list with (security_invoker = true) as
select s.*, c.name as class_name,
  s.first_name || ' ' || coalesce(s.middle_name || ' ', '') || s.last_name as full_name
from public.school_students s left join public.school_classes c on c.business_id = s.business_id and c.id = s.class_id;

-- A bill's paid amount and balance come from the posted payments, so they always reconcile.
create view public.school_bill_summary with (security_invoker = true) as
select b.id, b.business_id, b.bill_number, b.student_id, b.term_id, b.total, b.discount, b.discount_reason, b.due_on, b.created_at,
  (b.total - b.discount) as payable,
  coalesce(p.paid, 0) as paid,
  (b.total - b.discount - coalesce(p.paid, 0)) as balance,
  case when b.total - b.discount - coalesce(p.paid, 0) <= 0 then 'paid'
       when b.due_on is not null and b.due_on < current_date then 'overdue'
       when coalesce(p.paid, 0) > 0 then 'partially_paid' else 'unpaid' end as status
from public.school_bills b
left join lateral (select sum(amount) as paid from public.school_payments x where x.bill_id = b.id and x.status = 'posted') p on true;
grant select on public.school_student_list, public.school_bill_summary to authenticated;

-- ------------------------------------------------------- setup functions
create function public.school_save_settings(p_business uuid, p_type text, p_address text, p_phone text, p_email text, p_ca numeric, p_exam numeric, p_position boolean, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if p_type not in ('nursery', 'primary', 'secondary', 'combined') then raise exception 'choose the type of school' using errcode = '22023'; end if;
  if p_ca is null or p_exam is null or p_ca < 0 or p_exam < 0 or p_ca + p_exam <= 0 or p_ca + p_exam > 1000 then raise exception 'the continuous assessment and exam marks must be zero or more and add up to more than zero' using errcode = '22023'; end if;
  if p_days is null or cardinality(p_days) = 0 or exists (select 1 from unnest(p_days) d where d not between 1 and 7) then raise exception 'choose the days the school is open (1 = Monday ... 7 = Sunday)' using errcode = '22023'; end if;
  insert into public.school_settings (business_id, school_type, address, phone, email, ca_max, exam_max, show_position, working_days)
  values (p_business, p_type, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), p_ca, p_exam, coalesce(p_position, false), p_days)
  on conflict (business_id) do update set school_type = excluded.school_type, address = excluded.address, phone = excluded.phone, email = excluded.email, ca_max = excluded.ca_max, exam_max = excluded.exam_max, show_position = excluded.show_position, working_days = excluded.working_days, updated_at = now();
end $$;

-- Grade bands: [{min, grade, remark}], replacing the current ones. The lowest band must start at 0.
create function public.school_save_grades(p_business uuid, p_bands jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare b jsonb; v_zero boolean := false;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if jsonb_typeof(p_bands) is distinct from 'array' or jsonb_array_length(p_bands) not between 2 and 12 then raise exception 'a grading system needs 2 to 12 grades' using errcode = '22023'; end if;
  for b in select * from jsonb_array_elements(p_bands) loop
    if length(btrim(coalesce(b ->> 'grade', ''))) = 0 or (b ->> 'min') is null or (b ->> 'min')::numeric < 0 then raise exception 'every grade needs a name and a minimum score of 0 or more' using errcode = '22023'; end if;
    if (b ->> 'min')::numeric = 0 then v_zero := true; end if;
  end loop;
  if not v_zero then raise exception 'the lowest grade must start at 0 so every score has a grade' using errcode = '22023'; end if;
  delete from public.school_grade_bands where business_id = p_business;
  insert into public.school_grade_bands (business_id, min_score, grade, remark) select p_business, (x ->> 'min')::numeric, btrim(x ->> 'grade'), nullif(btrim(coalesce(x ->> 'remark', '')), '') from jsonb_array_elements(p_bands) x;
exception when unique_violation then raise exception 'two grades share the same name or minimum score' using errcode = '23505';
end $$;

create function public.school_save_session(p_business uuid, p_id uuid, p_name text, p_starts date, p_ends date, p_current boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 or p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'enter the session name and its dates (it must end after it starts)' using errcode = '22023'; end if;
  if coalesce(p_current, false) then update public.school_sessions set is_current = false where business_id = p_business and id <> v_id; end if;
  if p_id is null then insert into public.school_sessions (id, business_id, name, starts_on, ends_on, is_current) values (v_id, p_business, btrim(p_name), p_starts, p_ends, coalesce(p_current, false));
  else update public.school_sessions set name = btrim(p_name), starts_on = p_starts, ends_on = p_ends, is_current = coalesce(p_current, false) where id = p_id and business_id = p_business;
    if not found then raise exception 'session not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a session with this name already exists' using errcode = '23505';
end $$;

create function public.school_save_term(p_business uuid, p_id uuid, p_session uuid, p_name text, p_starts date, p_ends date, p_current boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_sessions where id = p_session and business_id = p_business) then raise exception 'choose the academic session' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 or p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'enter the term name and its dates (it must end after it starts)' using errcode = '22023'; end if;
  if coalesce(p_current, false) then update public.school_terms set is_current = false where business_id = p_business and id <> v_id; end if;
  if p_id is null then insert into public.school_terms (id, business_id, session_id, name, starts_on, ends_on, is_current) values (v_id, p_business, p_session, btrim(p_name), p_starts, p_ends, coalesce(p_current, false));
  else update public.school_terms set session_id = p_session, name = btrim(p_name), starts_on = p_starts, ends_on = p_ends, is_current = coalesce(p_current, false) where id = p_id and business_id = p_business;
    if not found then raise exception 'term not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: this session already has a term with that name' using errcode = '23505';
end $$;

create function public.school_save_class(p_business uuid, p_id uuid, p_name text, p_level integer, p_arm text, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the class name' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_classes (id, business_id, name, level_order, arm, active) values (v_id, p_business, btrim(p_name), coalesce(p_level, 0), nullif(btrim(coalesce(p_arm, '')), ''), coalesce(p_active, true));
  else update public.school_classes set name = btrim(p_name), level_order = coalesce(p_level, 0), arm = nullif(btrim(coalesce(p_arm, '')), ''), active = coalesce(p_active, true) where id = p_id and business_id = p_business;
    if not found then raise exception 'class not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a class with this name already exists' using errcode = '23505';
end $$;

create function public.school_save_subject(p_business uuid, p_id uuid, p_name text, p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the subject name' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_subjects (id, business_id, name, code) values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''));
  else update public.school_subjects set name = btrim(p_name), code = nullif(btrim(coalesce(p_code, '')), '') where id = p_id and business_id = p_business;
    if not found then raise exception 'subject not found' using errcode = '22023'; end if; end if;
  return v_id;
exception when unique_violation then raise exception 'duplicate key: a subject with this name already exists' using errcode = '23505';
end $$;

create function public.school_set_class_subjects(p_business uuid, p_class uuid, p_subjects uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_classes where id = p_class and business_id = p_business) then raise exception 'class not found' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_subjects, '{}')) s where not exists (select 1 from public.school_subjects x where x.id = s and x.business_id = p_business)) then raise exception 'unknown subject' using errcode = '22023'; end if;
  delete from public.school_class_subjects where class_id = p_class and business_id = p_business;
  insert into public.school_class_subjects (business_id, class_id, subject_id) select p_business, p_class, s from unnest(coalesce(p_subjects, '{}')) s;
end $$;

create function public.school_save_holiday(p_business uuid, p_date date, p_name text, p_remove boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if p_remove then delete from public.school_holidays where business_id = p_business and on_date = p_date; return; end if;
  if p_date is null or length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the date and the name of the holiday' using errcode = '22023'; end if;
  insert into public.school_holidays (business_id, on_date, name) values (p_business, p_date, btrim(p_name)) on conflict (business_id, on_date) do update set name = excluded.name;
end $$;

-- Starts a new school from the standard Nigerian structure for the chosen school type: classes, subjects, grades and one session with three terms.
create function public.school_setup(p_business uuid, p_type text, p_session text, p_starts date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sess uuid; cr record; i integer;
begin
  perform public._school_guard(p_business, 'school-settings', 'school.manage');
  if exists (select 1 from public.school_classes where business_id = p_business) then raise exception 'this school already has classes; edit them instead' using errcode = '22023'; end if;
  perform public.school_save_settings(p_business, p_type, null, null, null, 40, 60, false, '{1,2,3,4,5}');
  for cr in select * from (values
    ('Nursery 1', 1, 'nursery'), ('Nursery 2', 2, 'nursery'), ('Primary 1', 3, 'primary'), ('Primary 2', 4, 'primary'), ('Primary 3', 5, 'primary'), ('Primary 4', 6, 'primary'), ('Primary 5', 7, 'primary'), ('Primary 6', 8, 'primary'),
    ('JSS 1', 9, 'secondary'), ('JSS 2', 10, 'secondary'), ('JSS 3', 11, 'secondary'), ('SS 1', 12, 'secondary'), ('SS 2', 13, 'secondary'), ('SS 3', 14, 'secondary')) as x (name, ord, kind)
    where p_type = 'combined' or (p_type = 'nursery' and kind = 'nursery') or (p_type = 'primary' and kind in ('nursery', 'primary')) or (p_type = 'secondary' and kind = 'secondary') loop
    insert into public.school_classes (business_id, name, level_order) values (p_business, cr.name, cr.ord);
  end loop;
  insert into public.school_subjects (business_id, name, code)
  select p_business, x.name, x.code from (values ('English Language', 'ENG'), ('Mathematics', 'MTH'), ('Basic Science', 'SCI'), ('Social Studies', 'SOS'), ('Civic Education', 'CVE'), ('Computer Studies', 'ICT'), ('Christian/Islamic Studies', 'CRS'), ('Creative Arts', 'ART')) as x (name, code);
  insert into public.school_class_subjects (business_id, class_id, subject_id) select p_business, c.id, s.id from public.school_classes c, public.school_subjects s where c.business_id = p_business and s.business_id = p_business;
  perform public.school_save_grades(p_business, '[{"min":70,"grade":"A","remark":"Excellent"},{"min":60,"grade":"B","remark":"Very good"},{"min":50,"grade":"C","remark":"Good"},{"min":45,"grade":"D","remark":"Fair"},{"min":40,"grade":"E","remark":"Pass"},{"min":0,"grade":"F","remark":"Fail"}]'::jsonb);
  v_sess := public.school_save_session(p_business, null, coalesce(nullif(btrim(coalesce(p_session, '')), ''), 'Session'), coalesce(p_starts, current_date), coalesce(p_starts, current_date) + 330, true);
  for i in 1..3 loop
    perform public.school_save_term(p_business, null, v_sess, case i when 1 then 'First Term' when 2 then 'Second Term' else 'Third Term' end, coalesce(p_starts, current_date) + (i - 1) * 110, coalesce(p_starts, current_date) + (i - 1) * 110 + 95, i = 1);
  end loop;
end $$;

-- ----------------------------------------------------------- students
-- v: {first, middle, last, dob, gender, class_id, admitted_on, emergency_name, emergency_phone, notes}; guardians: [{name, phone, email, relationship, primary}]
create function public._school_make_student(p_business uuid, v jsonb, p_guardians jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_no text; g jsonb; v_g uuid; v_session uuid := public._school_current_session(p_business); v_class uuid := nullif(v ->> 'class_id', '')::uuid;
begin
  if length(btrim(coalesce(v ->> 'first', ''))) = 0 or length(btrim(coalesce(v ->> 'last', ''))) = 0 then raise exception 'enter the student''s first and last name' using errcode = '22023'; end if;
  if nullif(v ->> 'dob', '') is not null and (v ->> 'dob')::date > current_date then raise exception 'the date of birth cannot be in the future' using errcode = '22023'; end if;
  if v_class is not null and not exists (select 1 from public.school_classes where id = v_class and business_id = p_business and active) then raise exception 'choose a class that is open' using errcode = '22023'; end if;
  v_no := public._next_number(p_business, 'school_student', 'ADM');
  insert into public.school_students (id, business_id, admission_no, first_name, middle_name, last_name, date_of_birth, gender, admitted_on, admission_session_id, class_id, emergency_name, emergency_phone, notes, created_by)
  values (v_id, p_business, v_no, btrim(v ->> 'first'), nullif(btrim(coalesce(v ->> 'middle', '')), ''), btrim(v ->> 'last'), nullif(v ->> 'dob', '')::date, nullif(v ->> 'gender', ''), coalesce(nullif(v ->> 'admitted_on', '')::date, current_date), v_session, v_class,
    nullif(btrim(coalesce(v ->> 'emergency_name', '')), ''), nullif(btrim(coalesce(v ->> 'emergency_phone', '')), ''), nullif(btrim(coalesce(v ->> 'notes', '')), ''), auth.uid());
  if v_class is not null then insert into public.school_enrollments (business_id, student_id, class_id, session_id, started_on, reason) values (p_business, v_id, v_class, v_session, coalesce(nullif(v ->> 'admitted_on', '')::date, current_date), 'Admitted'); end if;
  for g in select * from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb)) loop
    if length(btrim(coalesce(g ->> 'name', ''))) < 2 then continue; end if;
    select id into v_g from public.school_guardians where business_id = p_business and nullif(btrim(coalesce(g ->> 'phone', '')), '') is not null and phone = btrim(g ->> 'phone') limit 1;
    if v_g is null then insert into public.school_guardians (business_id, name, phone, email, address) values (p_business, btrim(g ->> 'name'), nullif(btrim(coalesce(g ->> 'phone', '')), ''), nullif(btrim(coalesce(g ->> 'email', '')), ''), nullif(btrim(coalesce(g ->> 'address', '')), '')) returning id into v_g; end if;
    insert into public.school_student_guardians (business_id, student_id, guardian_id, relationship, is_primary) values (p_business, v_id, v_g, coalesce(nullif(btrim(coalesce(g ->> 'relationship', '')), ''), 'parent'), coalesce((g ->> 'primary')::boolean, false)) on conflict do nothing;
    v_g := null;
  end loop;
  return v_id;
end $$;

create function public.school_register_student(p_business uuid, v jsonb, p_guardians jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid;
begin
  perform public._school_guard(p_business, 'school-students', 'school.students');
  v_prev := public._idem_check(p_business, p_key, 'school_register'); if v_prev is not null then return v_prev; end if;
  v_id := public._school_make_student(p_business, v, p_guardians);
  return public._idem_store(p_business, p_key, 'school_register', jsonb_build_object('student_id', v_id, 'admission_no', (select admission_no from public.school_students where id = v_id)));
end $$;

create function public.school_update_student(p_student uuid, v jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.school_students;
begin
  select * into s from public.school_students where id = p_student;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(s.business_id, 'school-students', 'school.students');
  if length(btrim(coalesce(v ->> 'first', ''))) = 0 or length(btrim(coalesce(v ->> 'last', ''))) = 0 then raise exception 'enter the student''s first and last name' using errcode = '22023'; end if;
  if nullif(v ->> 'dob', '') is not null and (v ->> 'dob')::date > current_date then raise exception 'the date of birth cannot be in the future' using errcode = '22023'; end if;
  update public.school_students set first_name = btrim(v ->> 'first'), middle_name = nullif(btrim(coalesce(v ->> 'middle', '')), ''), last_name = btrim(v ->> 'last'), date_of_birth = nullif(v ->> 'dob', '')::date, gender = nullif(v ->> 'gender', ''),
    emergency_name = nullif(btrim(coalesce(v ->> 'emergency_name', '')), ''), emergency_phone = nullif(btrim(coalesce(v ->> 'emergency_phone', '')), ''), notes = nullif(btrim(coalesce(v ->> 'notes', '')), '') where id = p_student;
end $$;

-- A student who leaves is marked transferred, withdrawn or graduated (never deleted); reinstating makes them active again.
create function public.school_set_student_status(p_student uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.school_students;
begin
  select * into s from public.school_students where id = p_student;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(s.business_id, 'school-students', 'school.students');
  if p_status not in ('active', 'transferred', 'withdrawn', 'graduated') then raise exception 'choose a status' using errcode = '22023'; end if;
  if p_status <> 'active' and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the student is leaving' using errcode = '22023'; end if;
  update public.school_students set status = p_status, status_reason = nullif(btrim(coalesce(p_reason, '')), ''), status_on = current_date where id = p_student;
  if p_status <> 'active' then update public.school_enrollments set ended_on = current_date where student_id = p_student and ended_on is null; end if;
end $$;

-- Moves students to a class (promotion or a change of class). The old enrollment is closed and kept; results stay with the class and term they were earned in.
-- Moves: [{student_id, class_id}]
create function public.school_promote(p_business uuid, p_moves jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare m jsonb; v_n integer := 0; v_session uuid := public._school_current_session(p_business); v_class uuid; s public.school_students;
begin
  perform public._school_guard(p_business, 'school-students', 'school.students');
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) = 0 then raise exception 'choose the students to move' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    select * into s from public.school_students where id = (m ->> 'student_id')::uuid and business_id = p_business for update;
    if not found or s.status <> 'active' then raise exception 'only active students can be moved' using errcode = '22023'; end if;
    v_class := (m ->> 'class_id')::uuid;
    if not exists (select 1 from public.school_classes where id = v_class and business_id = p_business and active) then raise exception 'choose a class that is open' using errcode = '22023'; end if;
    if s.class_id is not distinct from v_class then continue; end if;
    update public.school_enrollments set ended_on = current_date where student_id = s.id and ended_on is null;
    insert into public.school_enrollments (business_id, student_id, class_id, session_id, reason) values (p_business, s.id, v_class, v_session, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Moved'));
    update public.school_students set class_id = v_class where id = s.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------- admissions, guardians, staff
create function public.school_apply(p_business uuid, v jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid();
begin
  perform public._school_guard(p_business, 'school-admissions', 'school.students');
  v_prev := public._idem_check(p_business, p_key, 'school_apply'); if v_prev is not null then return v_prev; end if;
  if length(btrim(coalesce(v ->> 'first', ''))) = 0 or length(btrim(coalesce(v ->> 'last', ''))) = 0 then raise exception 'enter the applicant''s first and last name' using errcode = '22023'; end if;
  if length(btrim(coalesce(v ->> 'guardian_name', ''))) < 2 then raise exception 'enter a parent or guardian' using errcode = '22023'; end if;
  insert into public.school_admissions (id, business_id, applicant_first, applicant_last, date_of_birth, gender, applying_class_id, guardian_name, guardian_phone, guardian_email, guardian_relationship, idempotency_key)
  values (v_id, p_business, btrim(v ->> 'first'), btrim(v ->> 'last'), nullif(v ->> 'dob', '')::date, nullif(v ->> 'gender', ''), nullif(v ->> 'class_id', '')::uuid, btrim(v ->> 'guardian_name'), nullif(btrim(coalesce(v ->> 'guardian_phone', '')), ''), nullif(btrim(coalesce(v ->> 'guardian_email', '')), ''), coalesce(nullif(btrim(coalesce(v ->> 'relationship', '')), ''), 'parent'), p_key);
  return public._idem_store(p_business, p_key, 'school_apply', jsonb_build_object('admission_id', v_id));
end $$;

-- Accepting creates the student with the next admission number, assigns the class and bills any fee marked as an admission fee for the current term.
create function public.school_decide_admission(p_admission uuid, p_decision text, p_class uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.school_admissions; v_student uuid; v_term uuid; v_bill uuid; v_total numeric; v_cls uuid;
begin
  select * into a from public.school_admissions where id = p_admission for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(a.business_id, 'school-admissions', 'school.students');
  if a.status <> 'pending' then raise exception 'this application has already been % ', a.status using errcode = '22023'; end if;
  if p_decision not in ('accept', 'reject') then raise exception 'choose accept or reject' using errcode = '22023'; end if;
  if p_decision = 'reject' then
    if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why the application is rejected' using errcode = '22023'; end if;
    update public.school_admissions set status = 'rejected', decided_by = auth.uid(), decided_on = current_date, decision_note = btrim(p_note) where id = p_admission;
    return jsonb_build_object('status', 'rejected');
  end if;
  v_cls := coalesce(p_class, a.applying_class_id);
  if v_cls is null then raise exception 'choose the class the student joins' using errcode = '22023'; end if;
  v_student := public._school_make_student(a.business_id, jsonb_build_object('first', a.applicant_first, 'last', a.applicant_last, 'dob', a.date_of_birth, 'gender', a.gender, 'class_id', v_cls), jsonb_build_array(jsonb_build_object('name', a.guardian_name, 'phone', a.guardian_phone, 'email', a.guardian_email, 'relationship', a.guardian_relationship, 'primary', true)));
  update public.school_admissions set status = 'accepted', decided_by = auth.uid(), decided_on = current_date, decision_note = nullif(btrim(coalesce(p_note, '')), ''), student_id = v_student where id = p_admission;
  v_term := public._school_current_term(a.business_id);
  select coalesce(sum(amount), 0) into v_total from public.school_fee_items where business_id = a.business_id and on_admission and active and (class_id is null or class_id = v_cls) and (term_id is null or term_id = v_term);
  if v_term is not null and v_total > 0 then
    v_bill := gen_random_uuid();
    insert into public.school_bills (id, business_id, bill_number, student_id, term_id, total, created_by) values (v_bill, a.business_id, public._next_number(a.business_id, 'school_bill', 'BILL'), v_student, v_term, v_total, auth.uid());
    insert into public.school_bill_items (business_id, bill_id, name, amount) select a.business_id, v_bill, name, amount from public.school_fee_items where business_id = a.business_id and on_admission and active and (class_id is null or class_id = v_cls) and (term_id is null or term_id = v_term);
  end if;
  return jsonb_build_object('status', 'accepted', 'student_id', v_student, 'admission_no', (select admission_no from public.school_students where id = v_student));
end $$;

create function public.school_save_guardian(p_business uuid, p_id uuid, p_name text, p_phone text, p_email text, p_address text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-guardians', 'school.students');
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the parent or guardian''s name' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_guardians (id, business_id, name, phone, email, address) values (v_id, p_business, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_address, '')), ''));
  else update public.school_guardians set name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), email = nullif(btrim(coalesce(p_email, '')), ''), address = nullif(btrim(coalesce(p_address, '')), '') where id = p_id and business_id = p_business;
    if not found then raise exception 'guardian not found' using errcode = '22023'; end if; end if;
  return v_id;
end $$;

create function public.school_link_guardian(p_business uuid, p_student uuid, p_guardian uuid, p_relationship text, p_primary boolean, p_unlink boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-guardians', 'school.students');
  if not exists (select 1 from public.school_students where id = p_student and business_id = p_business) or not exists (select 1 from public.school_guardians where id = p_guardian and business_id = p_business) then raise exception 'unknown student or guardian' using errcode = '22023'; end if;
  if p_unlink then delete from public.school_student_guardians where student_id = p_student and guardian_id = p_guardian; return; end if;
  insert into public.school_student_guardians (business_id, student_id, guardian_id, relationship, is_primary) values (p_business, p_student, p_guardian, coalesce(nullif(btrim(coalesce(p_relationship, '')), ''), 'parent'), coalesce(p_primary, false))
  on conflict (student_id, guardian_id) do update set relationship = excluded.relationship, is_primary = excluded.is_primary;
end $$;

-- Links the signed-in parent or teacher to the guardian or staff record that carries their email address (done when they open the portal).
create function public.school_claim_links(p_business uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_n integer := 0; r integer;
begin
  if not public.is_active_member(p_business) then raise exception 'permission denied' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  if public.has_business_permission(p_business, 'school.portal') then
    update public.school_guardians set user_id = auth.uid() where business_id = p_business and user_id is null and lower(email) = v_email; get diagnostics r = row_count; v_n := v_n + r;
  end if;
  update public.school_staff set user_id = auth.uid() where business_id = p_business and user_id is null and lower(email) = v_email; get diagnostics r = row_count; v_n := v_n + r;
  return v_n;
end $$;

create function public.school_save_staff(p_business uuid, p_id uuid, p_name text, p_phone text, p_email text, p_title text, p_department text, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the staff member''s name' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_staff (id, business_id, staff_no, name, phone, email, job_title, department, status) values (v_id, p_business, public._next_number(p_business, 'school_staff', 'STF'), btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_department, '')), ''), case when coalesce(p_active, true) then 'active' else 'inactive' end);
  else update public.school_staff set name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), email = nullif(btrim(coalesce(p_email, '')), ''), job_title = nullif(btrim(coalesce(p_title, '')), ''), department = nullif(btrim(coalesce(p_department, '')), ''), status = case when coalesce(p_active, true) then 'active' else 'inactive' end where id = p_id and business_id = p_business;
    if not found then raise exception 'staff member not found' using errcode = '22023'; end if; end if;
  return v_id;
end $$;

-- Assignments: [{class_id, subject_id (null for the class teacher), class_teacher}]; replaces the staff member's assignments.
create function public.school_set_assignments(p_business uuid, p_staff uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare it jsonb;
begin
  perform public._school_guard(p_business, 'school-staff', 'school.manage');
  if not exists (select 1 from public.school_staff where id = p_staff and business_id = p_business) then raise exception 'staff member not found' using errcode = '22023'; end if;
  delete from public.school_assignments where staff_id = p_staff and business_id = p_business;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.school_assignments (business_id, staff_id, class_id, subject_id, is_class_teacher) values (p_business, p_staff, (it ->> 'class_id')::uuid, nullif(it ->> 'subject_id', '')::uuid, coalesce((it ->> 'class_teacher')::boolean, false)) on conflict do nothing;
  end loop;
end $$;

-- ------------------------------------------------------------ attendance
-- Rows: [{student_id, status, note}]. Teachers take attendance only for classes they are assigned to. A saved mark can be corrected the same day by the
-- person who made it, or at any time by someone who manages the school; every change is in the audit log.
create function public.school_mark_attendance(p_business uuid, p_class uuid, p_date date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n integer := 0; st public.school_students; ex public.school_attendance; v_days integer[];
begin
  perform public._school_guard(p_business, 'school-attendance', 'school.attendance');
  if not public.has_business_permission(p_business, 'school.read') and not (public.has_business_permission(p_business, 'school.teach') and public._school_teaches_class(p_business, p_class)) then
    raise exception 'you can only take attendance for the classes assigned to you' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date then raise exception 'attendance cannot be taken for a future date' using errcode = '22023'; end if;
  select working_days into v_days from public.school_settings where business_id = p_business;
  if not (extract(isodow from p_date)::integer = any (coalesce(v_days, '{1,2,3,4,5}'))) then raise exception 'the school is not open on that day' using errcode = '22023'; end if;
  if exists (select 1 from public.school_holidays where business_id = p_business and on_date = p_date) then raise exception 'that day is a school holiday' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'there is no attendance to save' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into st from public.school_students where id = (r ->> 'student_id')::uuid and business_id = p_business;
    if not found or st.class_id is distinct from p_class or st.status <> 'active' then raise exception 'every student must be an active member of this class' using errcode = '22023'; end if;
    if (r ->> 'status') not in ('present', 'absent', 'late', 'excused') then raise exception 'choose present, absent, late or excused' using errcode = '22023'; end if;
    select * into ex from public.school_attendance where student_id = st.id and on_date = p_date;
    if found then
      if ex.status = (r ->> 'status') and ex.note is not distinct from nullif(btrim(coalesce(r ->> 'note', '')), '') then continue; end if;
      if not (public.has_business_permission(p_business, 'school.manage') or (ex.marked_by = auth.uid() and p_date = current_date)) then raise exception 'attendance already saved for % can only be corrected by someone who manages the school', st.first_name using errcode = '42501'; end if;
      update public.school_attendance set status = r ->> 'status', note = nullif(btrim(coalesce(r ->> 'note', '')), ''), marked_by = auth.uid(), marked_at = now() where id = ex.id;
    else
      insert into public.school_attendance (business_id, student_id, class_id, on_date, status, note, marked_by) values (p_business, st.id, p_class, p_date, r ->> 'status', nullif(btrim(coalesce(r ->> 'note', '')), ''), auth.uid());
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- results
create function public._school_grade(p_business uuid, p_total numeric) returns text
language sql stable security definer set search_path = '' as $$
  select grade from public.school_grade_bands where business_id = p_business and min_score <= p_total order by min_score desc limit 1
$$;

-- Rows: [{student_id, ca, exam, remark}]. Scores are checked against the school's maximum marks. A teacher saves drafts and submits results only for
-- the subjects they teach; once submitted, only someone who approves results can change them.
create function public.school_save_scores(p_business uuid, p_class uuid, p_subject uuid, p_term uuid, p_rows jsonb, p_submit boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n integer := 0; ex public.school_scores; v_ca numeric; v_exam numeric; s public.school_settings; st public.school_students; v_approver boolean; v_status text;
begin
  perform public._school_guard(p_business, 'school-results', 'school.results.enter');
  v_approver := public.has_business_permission(p_business, 'school.results.approve');
  if not (public.has_business_permission(p_business, 'school.manage') or v_approver or (public.has_business_permission(p_business, 'school.teach') and public._school_teaches_subject(p_business, p_class, p_subject))) then
    raise exception 'you can only enter results for the subjects you teach in your own classes' using errcode = '42501';
  end if;
  select * into s from public.school_settings where business_id = p_business;
  if not found then raise exception 'set the assessment marks in the school settings first' using errcode = '22023'; end if;
  if not exists (select 1 from public.school_terms where id = p_term and business_id = p_business) then raise exception 'choose the term' using errcode = '22023'; end if;
  if not exists (select 1 from public.school_class_subjects where class_id = p_class and subject_id = p_subject and business_id = p_business) then raise exception 'this subject is not taught in this class' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'there are no scores to save' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into st from public.school_students where id = (r ->> 'student_id')::uuid and business_id = p_business;
    if not found or st.class_id is distinct from p_class then raise exception 'every student must be in this class' using errcode = '22023'; end if;
    v_ca := nullif(r ->> 'ca', '')::numeric; v_exam := nullif(r ->> 'exam', '')::numeric;
    if v_ca is not null and (v_ca < 0 or v_ca > s.ca_max or scale(v_ca) > 2) then raise exception 'continuous assessment for % must be between 0 and %', st.first_name, s.ca_max using errcode = '22023'; end if;
    if v_exam is not null and (v_exam < 0 or v_exam > s.exam_max or scale(v_exam) > 2) then raise exception 'the exam score for % must be between 0 and %', st.first_name, s.exam_max using errcode = '22023'; end if;
    if p_submit and (v_ca is null or v_exam is null) then raise exception 'enter both scores for % before submitting', st.first_name using errcode = '22023'; end if;
    select * into ex from public.school_scores where student_id = st.id and subject_id = p_subject and term_id = p_term;
    v_status := case when p_submit then 'submitted' else 'draft' end;
    if found then
      if ex.status in ('submitted', 'approved', 'published') and not v_approver then raise exception 'results for % are already %; only someone who approves results can change them', st.first_name, ex.status using errcode = '42501'; end if;
      update public.school_scores set ca = v_ca, exam = v_exam, remark = nullif(btrim(coalesce(r ->> 'remark', '')), ''), status = case when ex.status in ('approved', 'published') then ex.status else v_status end, entered_by = auth.uid() where id = ex.id;
    else
      insert into public.school_scores (business_id, student_id, class_id, subject_id, term_id, ca, exam, remark, status, entered_by) values (p_business, st.id, p_class, p_subject, p_term, v_ca, v_exam, nullif(btrim(coalesce(r ->> 'remark', '')), ''), v_status, auth.uid());
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- action: approve (submitted -> approved), publish (approved -> published), reject (submitted -> draft, note required), unpublish (published -> approved).
create function public.school_review_scores(p_business uuid, p_class uuid, p_subject uuid, p_term uuid, p_action text, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_from text; v_to text; v_n integer;
begin
  perform public._school_guard(p_business, 'school-results', 'school.results.approve');
  select case p_action when 'approve' then 'submitted' when 'publish' then 'approved' when 'reject' then 'submitted' when 'unpublish' then 'published' end,
         case p_action when 'approve' then 'approved' when 'publish' then 'published' when 'reject' then 'draft' when 'unpublish' then 'approved' end into v_from, v_to;
  if v_from is null then raise exception 'choose approve, publish, reject or unpublish' using errcode = '22023'; end if;
  if p_action in ('reject', 'unpublish') and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why' using errcode = '22023'; end if;
  update public.school_scores set status = v_to, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
  where business_id = p_business and class_id = p_class and subject_id = p_subject and term_id = p_term and status = v_from;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'there are no % results for this class and subject to %', v_from, p_action using errcode = '22023'; end if;
  return v_n;
end $$;

create function public.school_save_remarks(p_business uuid, p_student uuid, p_term uuid, p_teacher text, p_principal text, p_promotion text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.school_students; v_teacher_ok boolean; v_head boolean;
begin
  select * into st from public.school_students where id = p_student and business_id = p_business;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  v_head := public.has_module_permission(p_business, 'school-results', 'school.results.approve', 'use');
  v_teacher_ok := public.has_module_permission(p_business, 'school-results', 'school.results.enter', 'use') and (public.has_business_permission(p_business, 'school.read') or public._school_teaches_class(p_business, st.class_id));
  if not (v_head or v_teacher_ok) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_promotion is not null and p_promotion not in ('promoted', 'repeat', 'graduate') then raise exception 'choose promoted, repeat or graduate' using errcode = '22023'; end if;
  insert into public.school_remarks (business_id, student_id, term_id, teacher_remark, principal_remark, promotion) values (p_business, p_student, p_term, nullif(btrim(coalesce(p_teacher, '')), ''), case when v_head then nullif(btrim(coalesce(p_principal, '')), '') end, case when v_head then p_promotion end)
  on conflict (student_id, term_id) do update set teacher_remark = excluded.teacher_remark,
    principal_remark = case when v_head then excluded.principal_remark else public.school_remarks.principal_remark end,
    promotion = case when v_head then excluded.promotion else public.school_remarks.promotion end;
end $$;

-- A report card for one student and term: scores, totals and grades by the school's rules, the attendance summary for the term, remarks and (if the school
-- turned it on) the position in class. Parents get published results only.
create function public.school_report_card(p_student uuid, p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.school_students; t public.school_terms; s public.school_settings; v_staff boolean; v_rows jsonb; v_avg numeric; v_att jsonb; v_rem jsonb; v_pos integer; v_size integer; v_days integer;
begin
  select * into st from public.school_students where id = p_student;
  if not found or not public._school_can_see_student(st.business_id, p_student) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into t from public.school_terms where id = p_term and business_id = st.business_id;
  if not found then raise exception 'term not found' using errcode = '22023'; end if;
  select * into s from public.school_settings where business_id = st.business_id;
  v_staff := public.has_business_permission(st.business_id, 'school.read') or public.has_business_permission(st.business_id, 'school.teach');
  select coalesce(jsonb_agg(jsonb_build_object('subject', sj.name, 'ca', sc.ca, 'exam', sc.exam, 'total', coalesce(sc.ca, 0) + coalesce(sc.exam, 0), 'grade', public._school_grade(st.business_id, coalesce(sc.ca, 0) + coalesce(sc.exam, 0)), 'remark', sc.remark, 'status', sc.status) order by sj.name), '[]'::jsonb),
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
  return jsonb_build_object('student', jsonb_build_object('name', st.first_name || ' ' || coalesce(st.middle_name || ' ', '') || st.last_name, 'admission_no', st.admission_no, 'class', (select name from public.school_classes where id = st.class_id)),
    'term', t.name, 'session', (select name from public.school_sessions where id = t.session_id), 'subjects', v_rows, 'average', round(v_avg, 2), 'attendance', v_att, 'remarks', v_rem,
    'position', case when s.show_position then v_pos end, 'class_size', case when s.show_position then v_size end);
end $$;

-- ------------------------------------------------------------------- fees
create function public.school_save_fee_item(p_business uuid, p_id uuid, p_name text, p_amount numeric, p_class uuid, p_term uuid, p_admission boolean, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._school_guard(p_business, 'school-fees', 'school.fees.manage');
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'enter the fee name' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 or scale(p_amount) > 2 then raise exception 'the amount must be zero or more with at most 2 decimals' using errcode = '22023'; end if;
  if p_id is null then insert into public.school_fee_items (id, business_id, name, amount, class_id, term_id, on_admission, active) values (v_id, p_business, btrim(p_name), p_amount, p_class, p_term, coalesce(p_admission, false), coalesce(p_active, true));
  else update public.school_fee_items set name = btrim(p_name), amount = p_amount, class_id = p_class, term_id = p_term, on_admission = coalesce(p_admission, false), active = coalesce(p_active, true) where id = p_id and business_id = p_business;
    if not found then raise exception 'fee not found' using errcode = '22023'; end if; end if;
  return v_id;
end $$;

-- Bills every active student in the class (or the whole school) for the term, once: students who already have a bill for the term are skipped.
create function public.school_generate_bills(p_business uuid, p_term uuid, p_class uuid, p_due date, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; st record; v_bill uuid; v_total numeric; v_made integer := 0; v_skipped integer := 0;
begin
  perform public._school_guard(p_business, 'school-fees', 'school.fees.manage');
  v_prev := public._idem_check(p_business, p_key, 'school_bills'); if v_prev is not null then return v_prev; end if;
  if not exists (select 1 from public.school_terms where id = p_term and business_id = p_business) then raise exception 'choose the term' using errcode = '22023'; end if;
  for st in select id, class_id from public.school_students where business_id = p_business and status = 'active' and class_id is not null and (p_class is null or class_id = p_class) order by admission_no loop
    if exists (select 1 from public.school_bills where student_id = st.id and term_id = p_term) then v_skipped := v_skipped + 1; continue; end if;
    select coalesce(sum(amount), 0) into v_total from public.school_fee_items where business_id = p_business and active and not on_admission and (class_id is null or class_id = st.class_id) and (term_id is null or term_id = p_term);
    if v_total <= 0 then v_skipped := v_skipped + 1; continue; end if;
    v_bill := gen_random_uuid();
    insert into public.school_bills (id, business_id, bill_number, student_id, term_id, total, due_on, created_by) values (v_bill, p_business, public._next_number(p_business, 'school_bill', 'BILL'), st.id, p_term, v_total, p_due, auth.uid());
    insert into public.school_bill_items (business_id, bill_id, name, amount) select p_business, v_bill, name, amount from public.school_fee_items where business_id = p_business and active and not on_admission and (class_id is null or class_id = st.class_id) and (term_id is null or term_id = p_term);
    v_made := v_made + 1;
  end loop;
  return public._idem_store(p_business, p_key, 'school_bills', jsonb_build_object('created', v_made, 'skipped', v_skipped));
end $$;

create function public.school_adjust_bill(p_bill uuid, p_discount numeric, p_reason text, p_charge_name text, p_charge_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.school_bills; v_total numeric;
begin
  select * into b from public.school_bills where id = p_bill for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(b.business_id, 'school-fees', 'school.fees.manage');
  if p_charge_amount is not null and p_charge_amount > 0 then
    if length(btrim(coalesce(p_charge_name, ''))) = 0 then raise exception 'name the extra charge' using errcode = '22023'; end if;
    insert into public.school_bill_items (business_id, bill_id, name, amount) values (b.business_id, p_bill, btrim(p_charge_name), p_charge_amount);
    update public.school_bills set total = total + p_charge_amount where id = p_bill;
  end if;
  if p_discount is not null then
    select total into v_total from public.school_bills where id = p_bill;
    if p_discount < 0 or p_discount > v_total then raise exception 'a discount cannot be more than the bill total' using errcode = '22023'; end if;
    if p_discount > 0 and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the discount or waiver is given' using errcode = '22023'; end if;
    update public.school_bills set discount = p_discount, discount_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_bill;
  end if;
end $$;

create function public.school_record_payment(p_bill uuid, p_amount numeric, p_method text, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.school_bills; v_prev jsonb; v_paid numeric; v_balance numeric; v_id uuid := gen_random_uuid(); v_no text;
begin
  select * into b from public.school_bills where id = p_bill for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(b.business_id, 'school-payments', 'school.fees.record');
  v_prev := public._idem_check(b.business_id, p_key, 'school_payment'); if v_prev is not null then return v_prev; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then raise exception 'the amount must be more than zero with at most 2 decimals' using errcode = '22023'; end if;
  if p_method not in ('cash', 'bank_transfer', 'card', 'pos', 'other') then raise exception 'choose how it was paid' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.school_payments where bill_id = p_bill and status = 'posted';
  v_balance := b.total - b.discount - v_paid;
  if p_amount > v_balance then raise exception 'the payment is more than the balance of %', v_balance using errcode = '22023'; end if;
  v_no := public._next_number(b.business_id, 'school_receipt', 'RCT');
  insert into public.school_payments (id, business_id, receipt_number, bill_id, student_id, amount, method, reference, recorded_by, idempotency_key) values (v_id, b.business_id, v_no, p_bill, b.student_id, p_amount, p_method, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid(), p_key);
  return public._idem_store(b.business_id, p_key, 'school_payment', jsonb_build_object('payment_id', v_id, 'receipt_number', v_no, 'balance', v_balance - p_amount));
end $$;

create function public.school_reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.school_payments;
begin
  select * into p from public.school_payments where id = p_payment for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public._school_guard(p.business_id, 'school-payments', 'school.fees.manage');
  if p.status <> 'posted' then raise exception 'this payment is already reversed' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the payment is reversed' using errcode = '22023'; end if;
  update public.school_payments set status = 'reversed', reversal_reason = btrim(p_reason), reversed_by = auth.uid(), reversed_at = now() where id = p_payment;
end $$;

-- ------------------------------------------------------------ announcements, overview
create function public.school_publish_announcement(p_business uuid, p_title text, p_body text, p_audience text, p_class uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public._school_guard(p_business, 'school-announcements', 'school.manage');
  if p_audience not in ('everyone', 'parents', 'teachers', 'staff', 'class') then raise exception 'choose who the announcement is for' using errcode = '22023'; end if;
  if p_audience = 'class' and not exists (select 1 from public.school_classes where id = p_class and business_id = p_business) then raise exception 'choose the class' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 or length(btrim(coalesce(p_body, ''))) < 2 then raise exception 'enter a title and a message' using errcode = '22023'; end if;
  insert into public.school_announcements (id, business_id, title, body, audience, class_id, publish_on, created_by) values (v_id, p_business, btrim(p_title), btrim(p_body), p_audience, case when p_audience = 'class' then p_class end, coalesce(p_date, current_date), auth.uid());
  return v_id;
end $$;

-- Dashboard figures for the chosen term (default: the current one). Money only for those who may read fees; attendance is today's, over active students.
create function public.school_overview(p_business uuid, p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_term uuid := coalesce(p_term, public._school_current_term(p_business)); v_money boolean; v_students integer; v_staff integer; v_classes integer; v_new integer; v_marked integer; v_present integer; v_absent integer;
  v_billed numeric := 0; v_collected numeric := 0; v_out numeric := 0; v_recent jsonb := '[]'::jsonb; v_enrol jsonb; v_att jsonb; v_fees jsonb := '[]'::jsonb; t public.school_terms;
begin
  perform public._school_guard(p_business, 'dashboard', 'dashboard.read');
  if not (public.has_business_permission(p_business, 'school.read') or public.has_business_permission(p_business, 'school.manage')) then raise exception 'permission denied' using errcode = '42501'; end if;
  v_money := public.has_business_permission(p_business, 'school.fees.read');
  select count(*) into v_students from public.school_students where business_id = p_business and status = 'active';
  select count(*) into v_staff from public.school_staff where business_id = p_business and status = 'active';
  select count(*) into v_classes from public.school_classes where business_id = p_business and active;
  select * into t from public.school_terms where id = v_term;
  select count(*) into v_new from public.school_students where business_id = p_business and admitted_on >= coalesce(t.starts_on, current_date - 90);
  select count(*), count(*) filter (where status in ('present', 'late')), count(*) filter (where status = 'absent') into v_marked, v_present, v_absent from public.school_attendance where business_id = p_business and on_date = current_date;
  select coalesce(jsonb_agg(jsonb_build_object('class', c.name, 'students', n) order by c.level_order, c.name), '[]'::jsonb) into v_enrol from public.school_classes c
    left join lateral (select count(*) n from public.school_students s where s.business_id = c.business_id and s.class_id = c.id and s.status = 'active') x on true where c.business_id = p_business and c.active;
  select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'marked', coalesce(m.marked, 0), 'present', coalesce(m.present, 0)) order by d), '[]'::jsonb) into v_att from generate_series(current_date - 6, current_date, '1 day') d
    left join lateral (select count(*) marked, count(*) filter (where status in ('present', 'late')) present from public.school_attendance a where a.business_id = p_business and a.on_date = d::date) m on true;
  if v_money and v_term is not null then
    select coalesce(sum(payable), 0), coalesce(sum(paid), 0), coalesce(sum(greatest(balance, 0)), 0) into v_billed, v_collected, v_out from public.school_bill_summary where business_id = p_business and term_id = v_term;
    select coalesce(jsonb_agg(jsonb_build_object('receipt', receipt_number, 'student', student, 'amount', amount, 'paid_on', paid_on)), '[]'::jsonb) into v_recent from (
      select p.receipt_number, s.first_name || ' ' || s.last_name as student, p.amount, p.paid_on from public.school_payments p join public.school_students s on s.id = p.student_id where p.business_id = p_business and p.status = 'posted' order by p.created_at desc limit 5) q;
    select coalesce(jsonb_agg(jsonb_build_object('class', cname, 'billed', billed, 'collected', collected) order by ord), '[]'::jsonb) into v_fees from (
      select c.name cname, c.level_order ord, sum(b.payable) billed, sum(b.paid) collected from public.school_bill_summary b join public.school_students s on s.id = b.student_id join public.school_classes c on c.id = s.class_id where b.business_id = p_business and b.term_id = v_term group by c.name, c.level_order) q;
  end if;
  return jsonb_build_object('term_id', v_term, 'term', t.name, 'students', v_students, 'staff', v_staff, 'classes', v_classes, 'new_admissions', v_new, 'pending_applications', (select count(*) from public.school_admissions where business_id = p_business and status = 'pending'),
    'marked_today', v_marked, 'present_today', v_present, 'absent_today', v_absent, 'attendance_rate', case when v_marked > 0 then round(v_present::numeric * 100 / v_marked, 1) end,
    'enrolment', v_enrol, 'attendance_week', v_att, 'results_awaiting', (select count(distinct (class_id, subject_id, term_id)) from public.school_scores where business_id = p_business and status = 'submitted'),
    'billed', case when v_money then v_billed end, 'collected', case when v_money then v_collected end, 'outstanding', case when v_money then v_out end, 'recent_payments', case when v_money then v_recent end, 'fees_by_class', case when v_money then v_fees end);
end $$;

-- ------------------------------------------------------------ privileges
revoke execute on function public._school_guard(uuid, text, text), public._school_teaches_class(uuid, uuid), public._school_teaches_subject(uuid, uuid, uuid), public._school_is_guardian_of(uuid, uuid),
  public._school_can_see_student(uuid, uuid), public._school_current_session(uuid), public._school_current_term(uuid), public._school_make_student(uuid, jsonb, jsonb), public._school_grade(uuid, numeric) from public;
grant execute on function public._school_teaches_class(uuid, uuid), public._school_teaches_subject(uuid, uuid, uuid), public._school_is_guardian_of(uuid, uuid), public._school_can_see_student(uuid, uuid) to authenticated;
revoke execute on function
  public.school_save_settings(uuid, text, text, text, text, numeric, numeric, boolean, integer[]), public.school_save_grades(uuid, jsonb), public.school_save_session(uuid, uuid, text, date, date, boolean),
  public.school_save_term(uuid, uuid, uuid, text, date, date, boolean), public.school_save_class(uuid, uuid, text, integer, text, boolean), public.school_save_subject(uuid, uuid, text, text),
  public.school_set_class_subjects(uuid, uuid, uuid[]), public.school_save_holiday(uuid, date, text, boolean), public.school_setup(uuid, text, text, date),
  public.school_register_student(uuid, jsonb, jsonb, text), public.school_update_student(uuid, jsonb), public.school_set_student_status(uuid, text, text), public.school_promote(uuid, jsonb, text),
  public.school_apply(uuid, jsonb, text), public.school_decide_admission(uuid, text, uuid, text), public.school_save_guardian(uuid, uuid, text, text, text, text),
  public.school_link_guardian(uuid, uuid, uuid, text, boolean, boolean), public.school_claim_links(uuid), public.school_save_staff(uuid, uuid, text, text, text, text, text, boolean),
  public.school_set_assignments(uuid, uuid, jsonb), public.school_mark_attendance(uuid, uuid, date, jsonb), public.school_save_scores(uuid, uuid, uuid, uuid, jsonb, boolean),
  public.school_review_scores(uuid, uuid, uuid, uuid, text, text), public.school_save_remarks(uuid, uuid, uuid, text, text, text), public.school_report_card(uuid, uuid),
  public.school_save_fee_item(uuid, uuid, text, numeric, uuid, uuid, boolean, boolean), public.school_generate_bills(uuid, uuid, uuid, date, text), public.school_adjust_bill(uuid, numeric, text, text, numeric),
  public.school_record_payment(uuid, numeric, text, text, text), public.school_reverse_payment(uuid, text), public.school_publish_announcement(uuid, text, text, text, uuid, date), public.school_overview(uuid, uuid) from public;
grant execute on function
  public.school_save_settings(uuid, text, text, text, text, numeric, numeric, boolean, integer[]), public.school_save_grades(uuid, jsonb), public.school_save_session(uuid, uuid, text, date, date, boolean),
  public.school_save_term(uuid, uuid, uuid, text, date, date, boolean), public.school_save_class(uuid, uuid, text, integer, text, boolean), public.school_save_subject(uuid, uuid, text, text),
  public.school_set_class_subjects(uuid, uuid, uuid[]), public.school_save_holiday(uuid, date, text, boolean), public.school_setup(uuid, text, text, date),
  public.school_register_student(uuid, jsonb, jsonb, text), public.school_update_student(uuid, jsonb), public.school_set_student_status(uuid, text, text), public.school_promote(uuid, jsonb, text),
  public.school_apply(uuid, jsonb, text), public.school_decide_admission(uuid, text, uuid, text), public.school_save_guardian(uuid, uuid, text, text, text, text),
  public.school_link_guardian(uuid, uuid, uuid, text, boolean, boolean), public.school_claim_links(uuid), public.school_save_staff(uuid, uuid, text, text, text, text, text, boolean),
  public.school_set_assignments(uuid, uuid, jsonb), public.school_mark_attendance(uuid, uuid, date, jsonb), public.school_save_scores(uuid, uuid, uuid, uuid, jsonb, boolean),
  public.school_review_scores(uuid, uuid, uuid, uuid, text, text), public.school_save_remarks(uuid, uuid, uuid, text, text, text), public.school_report_card(uuid, uuid),
  public.school_save_fee_item(uuid, uuid, text, numeric, uuid, uuid, boolean, boolean), public.school_generate_bills(uuid, uuid, uuid, date, text), public.school_adjust_bill(uuid, numeric, text, text, numeric),
  public.school_record_payment(uuid, numeric, text, text, text), public.school_reverse_payment(uuid, text), public.school_publish_announcement(uuid, text, text, text, uuid, date), public.school_overview(uuid, uuid) to authenticated;
