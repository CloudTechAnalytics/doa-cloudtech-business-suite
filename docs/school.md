# School

Industry `school` inside the CloudTech Business Suite: a basic school management system. It reuses tenancy, roles, subscriptions, audit and the shared
expenses module. Migration: `supabase/migrations/20261021000019_school.sql`. Demo mirror: `src/demo/demoSchool.ts`.

## What it does

| Area | Notes |
|---|---|
| Kind of school | Nursery only, primary only, secondary only, or all. Only that kind of school's classes and subjects exist and are shown; a class of another stage is refused, and narrowing the school is refused while pupils are still in the stages it would hide |
| Setup | "Start from the standard structure" creates classes for the school type, three terms, subjects, grading scale and 40/60 marks; everything is editable |
| Students | Admission numbers are generated and never reused; class history is kept as enrolments; leaving is a status (transferred, withdrawn, graduated), never a delete |
| Admissions | Shown as the Applications tab on the Students page. Applications are accepted or declined; accepting creates the student, links the parent and raises the admission bill in one step |
| Parents | Guardians link to students; a parent's login is matched by email the first time they open the school |
| Attendance | Per class and date; no future days, non-school days or holidays; corrections are audited; teachers only their own classes |
| Results | Class-work and exam marks validated against the school's maximums; draft, submitted, approved, published; report cards print; remarks and promotion decision |
| Fees | Fee items, bills per student and term (re-running skips existing bills), discounts and extra charges, partial payments capped at the balance, receipts, reversals with a reason |
| Teachers | **My Classes** (their own page): the classes and subjects assigned to them, with today's register status and results status per subject. Open a class for its pupils (today's mark, attendance rate this term, parent name and phone) and a printable class list. Row-level security already limits every row to their own classes |
| Parents | The **Parent Portal** has six tabs: Overview (attendance rate, absences, fees owing, latest notices), Attendance (a month calendar), Results (report card with printing, plus the average for every term), Fees (each bill with items, payments and receipts, printable statement), Notices, and My details (keep their own phone and address up to date) |
| Timetable | School managers set the periods of the school day and, class by class, the subject and teacher for every period of every school day. The database refuses a lesson in a break, on a non-school day, for a subject the class does not take, by a teacher who is not assigned to it, or with a teacher in two classes at once. Teachers see their own **My week** on My Classes; a parent sees their child's class timetable in the portal |
| Set up at registration | Choosing the kind of school when registering the business builds its classes, terms, grading scale, departments and subjects for that kind straight away, with no sample students or fees |
| Classes & Subjects page | Three steps on one page: 1. Classes (grouped by nursery, primary, junior and senior secondary; open one to tick its subjects), 2. Subjects (each listed once, with the levels and department it is for), then departments, terms and holidays. Classes, subjects and departments can all be deleted when unused; a class with students, attendance, results or fees (or a subject with results) is refused, and a class can be marked not in use instead |
| Departments | Senior secondary classes belong to a department (Science, Art, Commercial); schools can add, rename or delete departments (only unused ones can be deleted). Each SS class starts with its department's subjects plus the common ones, then the school picks what each class takes |
| Subjects by level | Each subject is tagged with the levels it is taught at (nursery, primary, junior secondary, senior secondary) and optionally a department. The class subject picker lists subjects that fit the class first and the rest under "Other subjects" |
| Deleting | Owner and business admin can delete a student or a parent/guardian, with a reason. A student's attendance, results and class history go with them; a student with fee payments is refused, since money records are never erased. Everything is audited |
| Report card | Designed for A4: school heading, pupil details, class work/exam/total/grade per subject with class average, highest and lowest, average and position, attendance, remarks, next term date, grading key and signature lines. Print one card, or **Print all report cards** for a class (one per page) |
| Staff sign-in | A staff record is just a person; cleaners, drivers and security need no login. To let a teacher, bursar or admissions officer sign in, record their email and press **Give sign-in access**: they are invited by email, sign up and confirm their email, and choose their own password. They are then joined to the school and linked to their record automatically. No one else ever sets or sees a password |
| Reports | Enrolment, attendance, results and fees, each exportable to CSV |
| Announcements | By audience: everyone, parents, teachers, staff or one class |

## Security

* Roles: `principal`, `teacher`, `bursar`, `admissions_officer`, `parent`. The SQL role permissions must equal `src/core/permissions/roles.ts` (checked by `registry-consistency.test.ts`).
* Row-level security: teachers read only students, attendance and scores of classes assigned to them; parents read only their linked children, published results and their own bills and payments; fees need `school.fees.read`.
* There are no direct write grants. Every write goes through a guarded function; money is append-only and corrected by reversal.
* Audit triggers cover students, attendance, scores (including corrections to published results), bills, payments, admissions, settings and staff.

## Tests

`tests/integration/school.test.ts` (database, PGlite) and `tests/integration/demo-school.test.ts` (browser mirror).

## Limitations

No photo or document upload, no online payments, no email or SMS, minimal holiday handling, one set of grading bands per school, and results positions are optional.
Concurrent payments are guarded by a row lock, but the single-connection test database does not exercise that path.

## Deployment

Apply migrations in order (the school migration is last), then create a business of type School. Invite staff with the roles above; parents are invited
with the `parent` role using the email recorded on their child's guardian record.
