-- Owner-only maintenance schedule: what was done, when, by whom, and next due.
-- (Already applied to the Supabase project; kept here for the record.)
create table if not exists public.upkeep (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  last_done date,
  done_by text,
  interval_months int,
  next_due date,
  notes text,
  created_at timestamptz default now()
);
alter table public.upkeep enable row level security;

create policy "upkeep owner only select" on public.upkeep for select to authenticated using (public.is_owner());
create policy "upkeep owner only insert" on public.upkeep for insert to authenticated with check (public.is_owner());
create policy "upkeep owner only update" on public.upkeep for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "upkeep owner only delete" on public.upkeep for delete to authenticated using (public.is_owner());

grant select, insert, update, delete on public.upkeep to authenticated;

-- Pin search_path on the color helpers (linter tidy-up).
alter function public.pick_profile_color(uuid) set search_path = public;
alter function public.set_profile_color() set search_path = public;
