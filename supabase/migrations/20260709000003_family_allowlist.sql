-- ============================================================
-- Family-only access: an allowlist of member emails, enforced by RLS.
-- Anyone can magic-link in, but non-members can read/write nothing.
-- (Already applied to the Supabase project; kept here for the record.)
-- ============================================================

create table if not exists public.members (
  email text primary key,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.members enable row level security;

insert into public.members (email) values ('malcolm.johnson3@gmail.com')
  on conflict (email) do nothing;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner()
      or exists (
        select 1 from public.members m
        where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

create policy "owner reads members"   on public.members for select to authenticated using (public.is_owner());
create policy "owner adds members"    on public.members for insert to authenticated with check (public.is_owner());
create policy "owner removes members" on public.members for delete to authenticated using (public.is_owner());
grant select, insert, delete on public.members to authenticated;

-- Re-gate reads/writes behind family membership.
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by members"
  on public.profiles for select to authenticated using (public.is_member());

drop policy if exists "bookings readable by authenticated" on public.bookings;
create policy "bookings readable by members"
  on public.bookings for select to authenticated using (public.is_member());
drop policy if exists "users create own bookings" on public.bookings;
create policy "members create own bookings"
  on public.bookings for insert to authenticated
  with check (auth.uid() = user_id and public.is_member());

drop policy if exists "work_orders readable by authenticated" on public.work_orders;
create policy "work_orders readable by members"
  on public.work_orders for select to authenticated using (public.is_member());
drop policy if exists "authenticated create work_orders" on public.work_orders;
create policy "members create work_orders"
  on public.work_orders for insert to authenticated
  with check (auth.uid() = created_by and public.is_member());
drop policy if exists "authenticated update work_orders" on public.work_orders;
create policy "members update work_orders"
  on public.work_orders for update to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists "supplies readable by authenticated" on public.supplies;
create policy "supplies readable by members"
  on public.supplies for select to authenticated using (public.is_member());
drop policy if exists "authenticated create supplies" on public.supplies;
create policy "members create supplies"
  on public.supplies for insert to authenticated
  with check (auth.uid() = added_by and public.is_member());
drop policy if exists "authenticated update supplies" on public.supplies;
create policy "members update supplies"
  on public.supplies for update to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists "news readable by authenticated" on public.news;
create policy "news readable by members"
  on public.news for select to authenticated using (public.is_member());

drop policy if exists "procedures readable by authenticated" on public.procedures;
create policy "procedures readable by members"
  on public.procedures for select to authenticated using (public.is_member());
