-- EHRICO Learning Center — saved answers to the questions inside lessons, mock exam attempts, and each learner's exam track (run once: Supabase → SQL Editor → New query → paste all → Run)
-- Each learner can read and save only their own answers; admins can read everyone's for the Learners page.

create table if not exists public.check_answers (
  user_id uuid not null references auth.users(id) on delete cascade,
  module int not null check (module between 0 and 13),
  qid text not null,
  pick text not null check (pick in ('A', 'B', 'C', 'D')),
  correct boolean not null,
  first_correct boolean not null,
  tries int not null default 1,
  answered_at timestamptz not null default now(),
  primary key (user_id, qid)
);

alter table public.check_answers enable row level security;
drop policy if exists "own check answers read" on public.check_answers;
create policy "own check answers read" on public.check_answers for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "own check answers insert" on public.check_answers;
create policy "own check answers insert" on public.check_answers for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own check answers update" on public.check_answers;
create policy "own check answers update" on public.check_answers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.check_answers from anon;
grant select, insert, update on public.check_answers to authenticated;

-- Mock exam attempts (one row per finished attempt, for example exam = 'CEHRS_A', with the score in each domain)
create table if not exists public.mock_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam text not null check (exam ~ '^[A-Z]+_[A-Z]$'),
  score int not null,
  total int not null,
  by_domain jsonb,
  taken_at timestamptz not null default now()
);
alter table public.mock_attempts enable row level security;
drop policy if exists "own mock attempts read" on public.mock_attempts;
create policy "own mock attempts read" on public.mock_attempts for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "own mock attempts insert" on public.mock_attempts;
create policy "own mock attempts insert" on public.mock_attempts for insert to authenticated with check (user_id = auth.uid());
revoke all on public.mock_attempts from anon;
grant select, insert on public.mock_attempts to authenticated;

-- Each learner's exam plan: EHRICO plus the national exams they add (chosen on their dashboard, changeable anytime)
alter table public.profiles add column if not exists track text;
alter table public.profiles drop constraint if exists profiles_track_check;
alter table public.profiles add constraint profiles_track_check check (track is null or track ~ '^(UNDECIDED|EHRICO|[A-Z]+(,[A-Z]+)*)$');
grant update (track) on public.profiles to authenticated;

-- Shows both new tables are ready (the result appears below after you click Run)
select (select count(*) from public.check_answers) as saved_answers, (select count(*) from public.mock_attempts) as mock_attempts;
