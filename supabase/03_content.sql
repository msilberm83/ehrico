-- EHRICO Learning Center — protected course content (run once: Supabase → SQL Editor → New query → paste all → Run)
-- After this, lessons and quizzes live in the database and only signed-in learners can read them.
-- Only admins can publish or change course content.

-- 1. Allow Module 0 in progress records (modules are now 0 to 13)
alter table public.lesson_progress drop constraint if exists lesson_progress_module_check;
alter table public.lesson_progress add constraint lesson_progress_module_check check (module between 0 and 13);
alter table public.quiz_attempts drop constraint if exists quiz_attempts_module_check;
alter table public.quiz_attempts add constraint quiz_attempts_module_check check (module between 0 and 13);

-- 2. Course content tables
create table if not exists public.lessons (
  file text primary key,
  title text not null,
  html text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.course_data (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3. Row Level Security: signed-in learners can read; only admins can write
alter table public.lessons enable row level security;
alter table public.course_data enable row level security;
drop policy if exists "signed-in learners read lessons" on public.lessons;
create policy "signed-in learners read lessons" on public.lessons for select to authenticated using (true);
drop policy if exists "admins manage lessons" on public.lessons;
create policy "admins manage lessons" on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "signed-in learners read course data" on public.course_data;
create policy "signed-in learners read course data" on public.course_data for select to authenticated using (true);
drop policy if exists "admins manage course data" on public.course_data;
create policy "admins manage course data" on public.course_data for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.lessons, public.course_data from anon;
grant select, insert, update, delete on public.lessons, public.course_data to authenticated;

-- 4. Learner emails on profiles (for the admin page)
alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email) values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end; $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 5. Make the owner an admin (covers the emails the owner has used)
update public.profiles set is_admin = true
where id in (select id from auth.users where lower(email) in ('imikesilberman@icloud.com', 'admin@ehrico.org', 'admin@ehric.org'));

-- 6. Show who is an admin now (the result appears below after you click Run)
select email, is_admin from public.profiles where is_admin;
