# EHRICO website

Public site and learning center for **EHRICO — Electronic Health Records Implementation and Clinic Operations** (MAS Publishing Company, a business name of PrintPros Inc). Live at https://ehrico.org.

- `index.html` — public program page and pilot application.
- `learn/` — the learning center app (sign-in, lessons, quizzes, progress, admin). It holds **no course content**.
- Course content (lessons and quizzes) lives in Supabase and is readable only by signed-in, invited learners. Build the bundle with `python3 build_bundle.py` (written outside this repo, to `09 Course edition/_publish/`), then upload it from the learning center: Admin → Publish course content.
- `supabase/` — database setup scripts (run in the Supabase SQL Editor).
