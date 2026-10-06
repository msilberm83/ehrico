-- EHRICO Learning Center — admin page support (run once in Supabase → SQL Editor → New query → paste → Run)
-- Adds each learner's email to their profile so the admin page can list learners.
-- Learners still see only their own profile; only admins (is_admin = true) can see everyone.

-- 1. Email column on profiles
alter table public.profiles add column if not exists email text;

-- 2. Fill it for people who already signed in
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- 3. Fill it automatically for new sign-ups
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email) values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

-- 4. Keep it current if a learner's sign-in email changes
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end; $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 5. Make yourself admin (change the email to the one you signed in with):
update public.profiles set is_admin = true where email = 'admin@ehrico.org';
