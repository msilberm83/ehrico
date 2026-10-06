-- EHRICO Learning Center — database setup (run once in Supabase → SQL Editor → New query → paste → Run)
-- Creates learner profiles, lesson progress, quiz attempts, and capstone submissions,
-- with Row Level Security so each learner can read and write ONLY their own records.

-- 1. Learner profile (one row per signed-in user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  is_admin boolean not null default false
);

-- 2. Lessons read
create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  module int not null check (module between 1 and 13),
  lesson_file text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, lesson_file)
);

-- 3. Module quiz attempts (one row per attempt; best score is computed)
create table if not exists public.quiz_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  module int not null check (module between 1 and 13),
  score int not null check (score >= 0),
  total int not null check (total > 0),
  taken_at timestamptz not null default now()
);
create index if not exists quiz_attempts_user on public.quiz_attempts (user_id, module);

-- 4. Capstone submissions (files go to the private "capstone" storage bucket)
create table if not exists public.capstone_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  artifact text not null check (artifact in ('A','B','C')),
  file_path text not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','pass','revise')),
  reviewer_notes text
);

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user an admin? (you set is_admin = true for yourself, step 7)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 5. Row Level Security: learners see only their own rows; admins see all
alter table public.profiles enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.capstone_submissions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "update own name" on public.profiles;
create policy "update own name" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- learners may change only their name, never the is_admin flag
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "own lessons" on public.lesson_progress;
create policy "own lessons" on public.lesson_progress for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());

drop policy if exists "own quizzes read" on public.quiz_attempts;
create policy "own quizzes read" on public.quiz_attempts for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "own quizzes insert" on public.quiz_attempts;
create policy "own quizzes insert" on public.quiz_attempts for insert with check (user_id = auth.uid());

drop policy if exists "own capstone read" on public.capstone_submissions;
create policy "own capstone read" on public.capstone_submissions for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "own capstone insert" on public.capstone_submissions;
create policy "own capstone insert" on public.capstone_submissions for insert with check (user_id = auth.uid() and status = 'submitted');
drop policy if exists "admin grades capstone" on public.capstone_submissions;
create policy "admin grades capstone" on public.capstone_submissions for update using (public.is_admin());

-- 6. Private storage bucket for capstone files (each learner can only use their own folder)
insert into storage.buckets (id, name, public) values ('capstone', 'capstone', false) on conflict (id) do nothing;
drop policy if exists "capstone own upload" on storage.objects;
create policy "capstone own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'capstone' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "capstone own read" on storage.objects;
create policy "capstone own read" on storage.objects for select to authenticated
  using (bucket_id = 'capstone' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 7. AFTER you sign in to the learning center once, make yourself admin by running this
--    (replace the email with the one you signed in with):
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'admin@ehrico.org');
