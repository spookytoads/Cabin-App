-- Lock down the SECURITY DEFINER helper functions so they can't be called
-- directly over the REST API by anonymous users.

-- handle_new_user is a trigger function only; it must not be callable via RPC.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- is_owner is used inside RLS policies for the authenticated role only.
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
