-- A business owner can choose the colour theme of their workspace. It is stored in businesses.settings ->> 'theme'. Only the named themes are accepted,
-- both by set_business_theme and by the settings validation trigger (so even a direct update cannot store anything else).

create or replace function public.validate_business_settings() returns trigger
language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(new.settings) is distinct from 'object' then raise exception 'settings must be an object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(new.settings) loop
    if k not in ('tax_rate_percent', 'allow_negative_stock', 'setup', 'theme') then
      raise exception 'unknown business setting "%"', k using errcode = '22023';
    end if;
  end loop;
  if new.settings ? 'tax_rate_percent' then
    if jsonb_typeof(new.settings -> 'tax_rate_percent') <> 'number' or (new.settings ->> 'tax_rate_percent')::numeric not between 0 and 100 then
      raise exception 'tax_rate_percent must be a number between 0 and 100' using errcode = '22023';
    end if;
  end if;
  if new.settings ? 'allow_negative_stock' and jsonb_typeof(new.settings -> 'allow_negative_stock') <> 'boolean' then
    raise exception 'allow_negative_stock must be true or false' using errcode = '22023';
  end if;
  if new.settings ? 'theme' and (jsonb_typeof(new.settings -> 'theme') <> 'string' or new.settings ->> 'theme' not in ('ocean', 'teal', 'emerald', 'violet', 'sunset', 'rose', 'slate')) then
    raise exception 'choose one of the colour themes' using errcode = '22023';
  end if;
  if new.settings ? 'setup' then
    if jsonb_typeof(new.settings -> 'setup') <> 'object' or (select count(*) from jsonb_object_keys(new.settings -> 'setup')) > 30 then
      raise exception 'setup must be an object of at most 30 answers' using errcode = '22023';
    end if;
    for k, v in select * from jsonb_each(new.settings -> 'setup') loop
      if k !~ '^[a-z_]{1,40}$' or jsonb_typeof(v) not in ('string', 'number', 'boolean') or length(v::text) > 200 then
        raise exception 'invalid setup answer "%"', k using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

create function public.set_business_theme(p_business uuid, p_theme text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(p_business, 'settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_theme is null or p_theme not in ('ocean', 'teal', 'emerald', 'violet', 'sunset', 'rose', 'slate') then raise exception 'choose one of the colour themes' using errcode = '22023'; end if;
  update public.businesses set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{theme}', to_jsonb(p_theme)) where id = p_business and status = 'active';
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
end $$;

revoke execute on function public.set_business_theme(uuid, text) from public;
grant execute on function public.set_business_theme(uuid, text) to authenticated;
