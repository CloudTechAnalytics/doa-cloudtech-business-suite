-- Teachers see their own work, and only teachers get "My Classes".
--
-- * New permission school.guardians: read the parents and guardians of the students you can see. Teachers get it (row-level security already limits them
--   to the guardians of pupils in their own classes), as do the roles that could already read parents. The Parents & Guardians page now uses it.
-- * school.teach (the "I teach classes" permission, which opens My Classes) belongs to teachers alone. Owners, business admins and managers have the whole school
--   through school.read and school.manage, so they no longer see a My Classes page that is empty for them.

insert into public.permissions (code, description) values ('school.guardians', 'Read the parents and guardians of the students you can see');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'school.guardians'
where r.business_id is null and r.name in ('owner', 'business_admin', 'manager', 'principal', 'bursar', 'admissions_officer', 'teacher');

update public.modules set required_permission = 'school.guardians' where code = 'school-guardians';

delete from public.role_permissions rp using public.roles r, public.permissions p
 where rp.role_id = r.id and rp.permission_id = p.id and p.code = 'school.teach' and r.business_id is null and r.name in ('owner', 'business_admin', 'manager');
