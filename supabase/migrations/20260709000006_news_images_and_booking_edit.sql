-- News images (Supabase Storage) + editable bookings.
-- (Already applied to the Supabase project; kept here for the record.)

alter table public.news add column if not exists image_url text;

-- Public bucket for announcement images; only the owner may write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-images', 'news-images', true, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true;

drop policy if exists "news images public read" on storage.objects;
create policy "news images public read" on storage.objects
  for select using (bucket_id = 'news-images');
drop policy if exists "news images owner insert" on storage.objects;
create policy "news images owner insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'news-images' and public.is_owner());
drop policy if exists "news images owner update" on storage.objects;
create policy "news images owner update" on storage.objects
  for update to authenticated using (bucket_id = 'news-images' and public.is_owner())
  with check (bucket_id = 'news-images' and public.is_owner());
drop policy if exists "news images owner delete" on storage.objects;
create policy "news images owner delete" on storage.objects
  for delete to authenticated using (bucket_id = 'news-images' and public.is_owner());

-- Editable bookings: owner edits any; a user edits stays they created OR that
-- are booked under their display name.
drop policy if exists "users manage own bookings or owner" on public.bookings;
create policy "edit own or matching bookings"
  on public.bookings for update to authenticated
  using (
    auth.uid() = user_id or public.is_owner()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.full_name is not null
                 and lower(btrim(p.full_name)) = lower(btrim(guest_name)))
  )
  with check (
    auth.uid() = user_id or public.is_owner()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.full_name is not null
                 and lower(btrim(p.full_name)) = lower(btrim(guest_name)))
  );

drop policy if exists "users delete own bookings or owner" on public.bookings;
create policy "delete own or matching bookings"
  on public.bookings for delete to authenticated
  using (
    auth.uid() = user_id or public.is_owner()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.full_name is not null
                 and lower(btrim(p.full_name)) = lower(btrim(guest_name)))
  );
