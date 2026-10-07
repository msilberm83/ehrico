// EHRICO Learning Center data layer: Supabase sign-in (email + password), protected course content, saved progress.
// Accounts are invite-only. Course content (lessons, quizzes) lives in the database and only signed-in
// learners can read it; only admins can publish it (Row Level Security in supabase/03_content.sql).
// The publishable key below is meant to be public; it cannot bypass those rules.
const SUPABASE_URL = "https://ryctzlhhqthgtebyktjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_vmibEIKqsBPxcHqN68uOog_5QkyVMOI";

// Read what kind of email link brought the learner here (invite or password reset) before Supabase clears the URL.
const LINK = (() => {
  const h = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
  const q = new URLSearchParams(location.search);
  return {
    type: h.get("type") || q.get("type") || "",
    error: (h.get("error_description") || q.get("error_description") || "").replace(/\+/g, " "),
    hadTokens: h.has("access_token") || h.has("error") || q.has("error"),
  };
})();

const Store = (() => {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true },
  });
  let user = null, admin = false;
  let cache = { lessons: {}, quizzes: {}, checks: {}, mocks: {} }, glossary = null;

  async function load() {
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    cache = { lessons: {}, quizzes: {}, checks: {}, mocks: {} }; admin = false;
    if (!user) return;
    const [les, qz, me, ck, mk] = await Promise.all([
      sb.from("lesson_progress").select("lesson_file, read_at").eq("user_id", user.id),
      sb.from("quiz_attempts").select("module, score, total").eq("user_id", user.id),
      sb.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
      sb.from("check_answers").select("qid, pick, correct, first_correct, tries").eq("user_id", user.id),
      sb.from("mock_attempts").select("exam, score, total, taken_at").eq("user_id", user.id),
    ]);
    (mk.data || []).forEach((r) => { const m = cache.mocks[r.exam] || { best: 0, attempts: 0 }; cache.mocks[r.exam] = { best: Math.max(m.best, r.score / r.total), attempts: m.attempts + 1 }; });
    admin = !!(me.data && me.data.is_admin);
    (ck.data || []).forEach((r) => { cache.checks[r.qid] = r; }); // empty until supabase/04_checks.sql has been run
    (les.data || []).forEach((r) => { cache.lessons[r.lesson_file] = r.read_at; });
    (qz.data || []).forEach((r) => {
      const q = cache.quizzes[r.module] || { best: 0, attempts: 0 };
      cache.quizzes[r.module] = { best: Math.max(q.best, r.score / r.total), attempts: q.attempts + 1 };
    });
  }

  const all = async (table, cols) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  };

  return {
    load,
    link: LINK,
    user: () => user,
    isAdmin: () => admin,
    get: () => cache,

    // Sign-in
    signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
    sendReset: (email) => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/learn/" }),
    setPassword: (password) => sb.auth.updateUser({ password }),
    async signOut() { await sb.auth.signOut(); user = null; admin = false; cache = { lessons: {}, quizzes: {}, checks: {}, mocks: {} }; },
    onChange(cb) { sb.auth.onAuthStateChange((event) => cb(event)); },

    // Course content (signed-in only)
    async courseData(key) {
      const { data, error } = await sb.from("course_data").select("data").eq("key", key).maybeSingle();
      if (error) throw error;
      return data ? data.data : null;
    },
    async glossary() {
      if (!glossary) { try { glossary = (await this.courseData("glossary")) || []; } catch (e) { glossary = []; } }
      return glossary;
    },
    async lessonHtml(file) {
      const { data, error } = await sb.from("lessons").select("html").eq("file", file).maybeSingle();
      if (error) throw error;
      return data ? data.html : null;
    },

    // Admin only: publish a content bundle made by build_bundle.py (Row Level Security refuses anyone else).
    async publish(bundle, progress) {
      const now = new Date().toISOString();
      const data = [{ key: "course", data: bundle.course, updated_at: now }, { key: "built", data: { built: bundle.built }, updated_at: now }]
        .concat(Object.entries(bundle.quizzes || {}).map(([key, d]) => ({ key, data: d, updated_at: now })))
        .concat(bundle.glossary ? [{ key: "glossary", data: bundle.glossary, updated_at: now }] : []);
      let r = await sb.from("course_data").upsert(data);
      if (r.error) throw r.error;
      // Large extras (lab kit downloads, mock exams, resource list) go one row at a time to stay under request limits.
      for (const [key, d] of Object.entries(bundle.extra || {})) {
        r = await sb.from("course_data").upsert({ key, data: d, updated_at: now });
        if (r.error) throw r.error;
      }
      const rows = bundle.lessons.map((l) => ({ file: l.file, title: l.title, html: l.html, updated_at: now }));
      for (let i = 0; i < rows.length; i += 15) {
        r = await sb.from("lessons").upsert(rows.slice(i, i + 15));
        if (r.error) throw r.error;
        if (progress) progress(Math.min(i + 15, rows.length), rows.length);
      }
      glossary = null;
    return { lessons: rows.length, quizzes: Object.keys(bundle.quizzes || {}).length, mocks: Object.keys(bundle.extra || {}).filter((k) => k.startsWith("mock_")).length };
    },

    // Admin only: every learner's rows (others only ever get their own).
    async adminData() {
      const [profiles, lessons, quizzes, checks, mocks] = await Promise.all([
        all("profiles", "id, full_name, email, created_at, is_admin"),
        all("lesson_progress", "user_id, module, read_at"),
        all("quiz_attempts", "user_id, module, score, total, taken_at"),
        all("check_answers", "user_id, module, qid, correct, first_correct").catch(() => []),
        all("mock_attempts", "user_id, exam, score, total, taken_at").catch(() => []),
      ]);
      return { profiles, lessons, quizzes, checks, mocks };
    },

    // Progress
    async markLesson(mod, file) {
      if (!user || cache.lessons[file]) return;
      cache.lessons[file] = new Date().toISOString();
      await sb.from("lesson_progress").upsert({ user_id: user.id, module: mod, lesson_file: file });
    },
    // In-lesson questions: keep the latest pick, and whether the first try was right.
    async saveCheck(mod, qid, pick, correct) {
      const old = cache.checks[qid];
      const row = { qid, pick, correct, first_correct: old ? old.first_correct : correct, tries: old ? old.tries + 1 : 1 };
      cache.checks[qid] = row;
      if (!user) return;
      const { error } = await sb.from("check_answers").upsert({ user_id: user.id, module: mod, ...row, answered_at: new Date().toISOString() });
      if (error) console.error("answer save failed", error);
    },
    async recordMock(exam, score, total, byDomain) {
      const m = cache.mocks[exam] || { best: 0, attempts: 0 };
      cache.mocks[exam] = { best: Math.max(m.best, score / total), attempts: m.attempts + 1 };
      if (!user) return;
      const { error } = await sb.from("mock_attempts").insert({ user_id: user.id, exam, score, total, by_domain: byDomain });
      if (error) console.error("mock exam save failed", error);
    },
    async recordQuiz(mod, score, total) {
      const q = cache.quizzes[mod] || { best: 0, attempts: 0 };
      cache.quizzes[mod] = { best: Math.max(q.best, score / total), attempts: q.attempts + 1 };
      if (user) {
        const { error } = await sb.from("quiz_attempts").insert({ user_id: user.id, module: mod, score, total });
        if (error) console.error("quiz save failed", error);
      }
    },
  };
})();
