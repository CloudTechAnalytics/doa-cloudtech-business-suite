-- School admin: the person who runs the school office (secretary, registrar).
--
-- * New role school_admin. It registers and updates pupils and parents, handles admissions, takes attendance for any class, sets up the timetable and posts
--   announcements, sees reports and records fee payments at the desk. It cannot approve or publish results, set up fees, manage staff or settings, or delete.
-- * New permission school.office: "run the timetable and post announcements". Until now those two needed school.manage, which also opens staff and settings,
--   too much for an office role. The owner, business admin, manager and principal get it, so nothing changes for them.
-- * The staff sign-in functions accept the new role.

insert into public.permissions (code, description) values ('school.office', 'Run the timetable and post announcements');
insert into public.roles (name, description, is_system_role) values ('school_admin', 'Runs the school office: records, attendance, timetable, announcements and fee receipts', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'school.office'
where r.business_id is null and r.name in ('owner', 'business_admin', 'manager', 'principal', 'school_admin');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('dashboard.read', 'school.read', 'school.students', 'school.attendance', 'school.guardians', 'school.fees.record')
where r.business_id is null and r.name = 'school_admin';

-- The timetable and announcement writes now need school.office. The functions are rewritten from their stored definitions so nothing else in them changes.
do $$
declare f record; def text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('school_save_periods', 'school_set_slot', 'school_publish_announcement') loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''school-timetable'', ''school.manage''', '''school-timetable'', ''school.office''');
    def := replace(def, '''school-announcements'', ''school.manage''', '''school-announcements'', ''school.office''');
    if def not like '%school.office%' then raise exception 'guard not found in %', f.proname; end if;
    execute def;
  end loop;
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('school_give_login', 'school_create_login') loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''admissions_officer'', ''principal'')', '''admissions_officer'', ''school_admin'', ''principal'')');
    def := replace(def, 'choose teacher, bursar, admissions officer or principal', 'choose teacher, bursar, school admin, admissions officer or principal');
    if def not like '%school_admin%' then raise exception 'role list not found in %', f.proname; end if;
    execute def;
  end loop;
end $$;
