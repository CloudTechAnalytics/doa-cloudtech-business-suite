-- A person's own description of what they are called at work (Principal, Director, Manager...). It is shown under their name at the top of the app in place of the
-- system role ("Owner"). It is free text of up to 60 characters, only the person themselves can change it (the profile update policy already limits updates to their
-- own row), and it has no effect on what they are allowed to do.

alter table public.profiles add column job_title text check (job_title is null or length(btrim(job_title)) between 1 and 60);
grant update (job_title) on public.profiles to authenticated;
