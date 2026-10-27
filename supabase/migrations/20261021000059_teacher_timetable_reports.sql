-- Teachers can open Timetable and Reports.
-- The two pages were closed to them by their page permission (school.manage and school.read). What a teacher sees inside is still limited by the
-- database: the timetable policy shows only the classes they teach (or lessons they give), and pupils, attendance and results are already limited to
-- their assigned classes. Changing the timetable still needs school.manage, and the fees report still needs school.fees.read.
-- dashboard.read is held by every staff role (the same gate Announcements uses), and not by parents, who have their own portal.

update public.modules set required_permission = 'dashboard.read' where code in ('school-timetable', 'school-reports');
