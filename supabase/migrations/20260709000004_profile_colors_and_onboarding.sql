-- Per-person booking colors + name onboarding.
-- (Already applied to the Supabase project; kept here for the record.)

alter table public.profiles add column if not exists color text;

create or replace function public.pick_profile_color(seed uuid)
returns text
language sql
immutable
as $$
  select (array[
    '#4E5D46','#B85446','#2C3E52','#7A5540','#8A6D1F','#3E6B5A',
    '#7C4A63','#A85A32','#556B78','#6B7A3A','#9E4B4B','#4A6E8A'
  ])[ (abs(hashtext(seed::text)) % 12) + 1 ];
$$;

create or replace function public.set_profile_color()
returns trigger
language plpgsql
as $$
begin
  if new.color is null or new.color = '' then
    new.color := public.pick_profile_color(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_color on public.profiles;
create trigger profiles_set_color
  before insert on public.profiles
  for each row execute function public.set_profile_color();

update public.profiles set color = public.pick_profile_color(id) where color is null or color = '';

-- New sign-ups start with NO name so the app prompts them to enter one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, null)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
