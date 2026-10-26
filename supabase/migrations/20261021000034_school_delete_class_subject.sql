-- Delete a class or a subject that nobody is using. Anything that already holds records (students, attendance, results, fees, applications)
-- keeps the class or subject; the school can mark a class "not in use" instead. Timetable lessons, subject choices and teacher assignments
-- of the deleted item go with it.

create function public.school_delete_class(p_business uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_classes where id = p_id and business_id = p_business) then raise exception 'class not found' using errcode = '22023'; end if;
  if exists (select 1 from public.school_students where business_id = p_business and class_id = p_id and status = 'active') then
    raise exception 'this class still has students; move them to another class first' using errcode = '22023';
  end if;
  begin
    delete from public.school_timetable where business_id = p_business and class_id = p_id;
    delete from public.school_classes where id = p_id and business_id = p_business;
  exception when foreign_key_violation then
    raise exception 'this class has records (past students, attendance, results or fees), so it cannot be deleted; mark it as not in use instead' using errcode = '23503';
  end;
end $$;

create function public.school_delete_subject(p_business uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._school_guard(p_business, 'school-classes', 'school.manage');
  if not exists (select 1 from public.school_subjects where id = p_id and business_id = p_business) then raise exception 'subject not found' using errcode = '22023'; end if;
  begin
    delete from public.school_timetable where business_id = p_business and subject_id = p_id;
    delete from public.school_subjects where id = p_id and business_id = p_business;
  exception when foreign_key_violation then
    raise exception 'this subject already has results recorded, so it cannot be deleted; take it off the classes that no longer study it instead' using errcode = '23503';
  end;
end $$;

revoke execute on function public.school_delete_class(uuid, uuid), public.school_delete_subject(uuid, uuid) from public;
grant execute on function public.school_delete_class(uuid, uuid), public.school_delete_subject(uuid, uuid) to authenticated;
