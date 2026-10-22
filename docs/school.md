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
