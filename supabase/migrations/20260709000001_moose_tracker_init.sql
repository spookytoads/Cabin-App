-- ============================================================
-- Moose Tracker — family cabin app schema
-- (This is the schema already applied to the Supabase project.
--  Kept here for version control / reproducibility.)
-- ============================================================

create extension if not exists btree_gist;

-- ---------- Owners (admins) ----------
create table if not exists public.owners (
  email text primary key
);
alter table public.owners enable row level security; -- locked: no policies, only reachable via is_owner()

insert into public.owners (email) values ('malcolm.johnson3@gmail.com')
  on conflict (email) do nothing;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.owners o
    where lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  news_seen_at timestamptz default '2000-01-01',
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

-- ---------- Bookings (calendar) ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guest_name text not null,
  start_date date not null,
  end_date date not null,
  notes text,
  created_at timestamptz default now(),
  constraint valid_dates check (end_date >= start_date),
  -- hard safety net: the single cabin cannot be double-booked
  constraint no_overlap exclude using gist (daterange(start_date, end_date, '[]') with &&)
);
alter table public.bookings enable row level security;

create policy "bookings readable by authenticated"
  on public.bookings for select to authenticated using (true);
create policy "users create own bookings"
  on public.bookings for insert to authenticated
  with check (auth.uid() = user_id);
create policy "users manage own bookings or owner"
  on public.bookings for update to authenticated
  using (auth.uid() = user_id or public.is_owner())
  with check (auth.uid() = user_id or public.is_owner());
create policy "users delete own bookings or owner"
  on public.bookings for delete to authenticated
  using (auth.uid() = user_id or public.is_owner());

-- ---------- Work orders ----------
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  location text,
  description text,
  category text not null default 'repair' check (category in ('repair','update')),
  status text not null default 'open' check (status in ('open','in_progress','done')),
  created_at timestamptz default now()
);
alter table public.work_orders enable row level security;

create policy "work_orders readable by authenticated"
  on public.work_orders for select to authenticated using (true);
create policy "authenticated create work_orders"
  on public.work_orders for insert to authenticated
  with check (auth.uid() = created_by);
create policy "authenticated update work_orders"
  on public.work_orders for update to authenticated using (true) with check (true);
create policy "creator or owner delete work_orders"
  on public.work_orders for delete to authenticated
  using (auth.uid() = created_by or public.is_owner());

-- ---------- Supplies ----------
create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity text,
  status text not null default 'needed' check (status in ('needed','stocked')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.supplies enable row level security;

create policy "supplies readable by authenticated"
  on public.supplies for select to authenticated using (true);
create policy "authenticated create supplies"
  on public.supplies for insert to authenticated
  with check (auth.uid() = added_by);
create policy "authenticated update supplies"
  on public.supplies for update to authenticated using (true) with check (true);
create policy "creator or owner delete supplies"
  on public.supplies for delete to authenticated
  using (auth.uid() = added_by or public.is_owner());

-- ---------- Maintenance (PRIVATE — owner only) ----------
create table if not exists public.maintenance (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  vendor text,
  cost numeric(10,2),
  service_date date,
  notes text,
  created_at timestamptz default now()
);
alter table public.maintenance enable row level security;

create policy "maintenance owner only select"
  on public.maintenance for select to authenticated using (public.is_owner());
create policy "maintenance owner only insert"
  on public.maintenance for insert to authenticated with check (public.is_owner());
create policy "maintenance owner only update"
  on public.maintenance for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "maintenance owner only delete"
  on public.maintenance for delete to authenticated using (public.is_owner());

-- ---------- News ----------
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.news enable row level security;

create policy "news readable by authenticated"
  on public.news for select to authenticated using (true);
create policy "owner manage news insert"
  on public.news for insert to authenticated with check (public.is_owner());
create policy "owner manage news update"
  on public.news for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manage news delete"
  on public.news for delete to authenticated using (public.is_owner());

-- ---------- Procedures (opening / closing) ----------
create table if not exists public.procedures (
  kind text primary key check (kind in ('opening','closing')),
  content text not null default '',
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.procedures enable row level security;

create policy "procedures readable by authenticated"
  on public.procedures for select to authenticated using (true);
create policy "owner update procedures"
  on public.procedures for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner insert procedures"
  on public.procedures for insert to authenticated with check (public.is_owner());

-- Seed the procedures (owner can edit any time from the Guide tab).
insert into public.procedures (kind, content) values
  ('opening', 'OPENING THE CABIN

(The owner can edit this any time from the Procedures tab.)

1. Turn on the main water valve in the utility room.
2. Turn on the water heater and give it ~30 minutes.
3. Flip the main breakers back on in the garage panel.
4. Check for any frozen or burst pipes before leaving water running.
5. Turn on the propane at the tank.
6. Set the thermostat to a comfortable temperature.
7. Confirm the internet / Wi-Fi is on and connected.
8. Check smoke and carbon-monoxide detectors.'),
  ('closing', 'CLOSING THE CABIN

(The owner can edit this any time from the Procedures tab.)

1. Strip beds and start any final laundry.
2. Empty the fridge and take out all trash.
3. Run the dishwasher and empty it.
4. Turn the thermostat down to 55F (winterize setting).
5. Shut off the main water valve and open faucets to drain.
6. Turn off the water heater.
7. Turn off propane at the tank.
8. Lock all doors and windows, close blinds.
9. Take garbage to the collection point.')
on conflict (kind) do nothing;

-- ---------- Grants (RLS still gates all access) ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.bookings, public.work_orders,
  public.supplies, public.maintenance, public.news, public.procedures
  to authenticated;
