// EHRICO Learning Center: email + password sign-in, protected lessons and quizzes, saved progress, admin tools.
const PASS = 0.8, QUIZ_SIZE = 10;
const $ = (s) => document.querySelector(s);
const main = $("#main");
let COURSE = [], RES = { lessons: [], mocks: [] }, courseError = "", bootMsg = "", needPassword = false;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
// Tiny markdown for quiz stems: tables, bold, paragraphs.
function md(src) {
  const lines = String(src || "").split("\n"); let out = "", tbl = [];
  const flush = () => {
    if (!tbl.length) return;
    const rows = tbl.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
    out += "<table><thead><tr>" + rows[0].map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
      rows.slice(1).map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
    tbl = [];
  };
  for (const l of lines) {
    if (l.trim().startsWith("|")) { tbl.push(l); continue; }
    flush();
    if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  flush(); return out;
}

// ---------- Course rules ----------
const byN = (n) => COURSE.find((m) => m.n === n);
const quizPassed = (m, p) => ((p.quizzes || {})[m.n] || {}).best >= PASS;
const lessonsRead = (m, p) => m.lessons.every((l) => (p.lessons || {})[l.file]);
// A module is complete when its quiz is passed, or (if it has no quiz yet) when every lesson is read.
const complete = (m, p) => (m.quiz ? quizPassed(m, p) : lessonsRead(m, p));
function prevOf(n) { const i = COURSE.findIndex((m) => m.n === n); return i > 0 ? COURSE[i - 1] : null; }
function nextOf(n) { const i = COURSE.findIndex((m) => m.n === n); return i >= 0 && i < COURSE.length - 1 ? COURSE[i + 1] : null; }
function unlocked(n, p) {
  if (Store.isAdmin()) return true; // admins can open every module to review it
  const prev = prevOf(n);
  return !prev || complete(prev, p);
}

function focusMain(title) { document.title = title + " · EHRICO Learning Center"; main.focus(); window.scrollTo(0, 0); }

// ---------- Learner pages ----------
function dashboard() {
  const p = Store.get();
  const done = COURSE.filter((m) => complete(m, p)).length, total = COURSE.length;
  main.innerHTML = `<h1>My course</h1>
    <p class="muted">EHRICO · Electronic Health Records Implementation and Clinic Operations · ${done} of ${total} modules complete</p>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Modules complete"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
    <ol class="mods" start="0">${COURSE.map((m) => {
      const prev = prevOf(m.n);
      const st = complete(m, p) ? `<span class="tag done">Complete</span>` : unlocked(m.n, p) ? `<span class="tag">Open</span>`
        : `<span class="tag lock">Locked: ${prev && prev.quiz ? `pass the Module ${prev.n} quiz` : `finish Module ${prev ? prev.n : ""}`}</span>`;
      const label = `Module ${m.n}: ${esc(m.title)}`;
      const link = unlocked(m.n, p) ? `<a href="#/m/${m.n}">${label}</a>` : `<span>${label}</span>`;
      return `<li class="mod">${link}${st}</li>`;
    }).join("")}</ol>
    ${resourcesBox(p)}`;
  focusMain("My course");
}

// Resources (roster, exam prep guide, glossary) and the mock exams, shown under the module list.
const mocksOpen = (p) => Store.isAdmin() || (COURSE.length && complete(COURSE[COURSE.length - 1], p));
function resourcesBox(p) {
  if (!RES.lessons.length && !RES.mocks.length) return "";
  const last = COURSE[COURSE.length - 1];
  return `<h2>Resources</h2><ul class="lessons">${RES.lessons.map((r, i) => `<li><a href="#/r/${i}">${esc(r.title)}</a></li>`).join("")}</ul>
    ${RES.mocks.length ? `<h2>Mock exams</h2>
    <p class="muted">Full-length practice for the partner exams, written to their test plans. ${mocksOpen(p) ? "" : `They open when you finish Module ${last ? last.n : 13}.`}</p>
    <ol class="mods">${RES.mocks.map((m) => {
      const b = (p.mocks || {})[m.exam];
      const st = b ? `<span class="tag${b.best >= 0.75 ? " done" : ""}">Best ${Math.round(b.best * 100)}%</span>` : `<span class="tag">${m.count} questions · ${m.minutes} min</span>`;
      return `<li class="mod">${mocksOpen(p) ? `<a href="#/mock/${m.exam}">${esc(m.title)}</a>` : `<span>${esc(m.title)}</span>`}${st}</li>`;
    }).join("")}</ol>` : ""}`;
}

async function resourceView(i) {
  const r = RES.lessons[i];
  if (!r) return dashboard();
  main.innerHTML = `<p class="muted">Loading…</p>`;
  let h = null;
  try { h = await Store.lessonHtml(r.file); } catch (e) { h = null; }
  if (!h) { main.innerHTML = `<p><a href="#/">← My course</a></p><p class="fb">This page couldn't load. Reload the page in a minute.</p>`; return; }
  main.innerHTML = `<p><a href="#/">← My course</a></p><div id="reader"></div><article class="lesson">${h}</article>`;
  Reader.attach(main.querySelector("article.lesson"), $("#reader"));
  focusMain(r.title);
}

// In-lesson question counts for a list of question ids: answered, and right on the first try.
function checkStats(ids, p) {
  const a = ids.map((q) => (p.checks || {})[q]).filter(Boolean);
  return { total: ids.length, answered: a.length, first: a.filter((r) => r.first_correct).length };
}

function moduleView(n) {
  const m = byN(n), p = Store.get();
  if (!m || !unlocked(n, p)) return dashboard();
  const q = (p.quizzes || {})[n];
  const all = checkStats(m.lessons.flatMap((l) => l.checks || []), p);
  main.innerHTML = `<p><a href="#/">← My course</a></p><h1>Module ${n}: ${esc(m.title)}</h1>
    <h2>Lessons</h2>
    ${all.total ? `<p class="muted">Practice questions in the lessons: ${all.answered} of ${all.total} answered, ${all.first} right on the first try.</p>` : ""}
    <ol class="lessons">${m.lessons.map((l, i) => {
      const c = checkStats(l.checks || [], p);
      return `<li><a href="#/m/${n}/l/${i}">${esc(l.title)}</a> ${(p.lessons || {})[l.file] ? "✓" : ""}${c.total ? ` <span class="muted">· ${c.answered}/${c.total} questions</span>` : ""}</li>`;
    }).join("")}</ol>
    <h2>Module quiz</h2>
    ${m.quiz ? `<p>${QUIZ_SIZE} questions in the style of the final exam, drawn at random, so each try is different. Pass mark 80%. Unlimited tries, with an explanation after every question.</p>
    <p>${q ? `Best score: <b>${Math.round(q.best * 100)}%</b> (${q.attempts} ${q.attempts === 1 ? "try" : "tries"})` : "Not taken yet."}</p>
    <a class="btn" href="#/m/${n}/quiz">${q ? "Take the quiz again" : "Start the quiz"}</a>`
    : `<p class="muted">This module's quiz is coming soon. For now, read every lesson to open the next module.</p>`}`;
  focusMain(`Module ${n}`);
}

async function lessonView(n, i) {
  const m = byN(n); const l = m && m.lessons[i];
  if (!l || !unlocked(n, Store.get())) return dashboard();
  main.innerHTML = `<p class="muted">Loading…</p>`;
  let html;
  try { html = await Store.lessonHtml(l.file); } catch (e) { html = null; }
  if (!html) { main.innerHTML = `<p><a href="#/m/${n}">← Module ${n}</a></p><p class="fb">This lesson couldn't load. Check your connection and reload the page.</p>`; return; }
  const prev = i > 0 ? `<a class="btn sec" href="#/m/${n}/l/${i - 1}">← Previous</a>` : `<a class="btn sec" href="#/m/${n}">← Module</a>`;
  const next = i < m.lessons.length - 1 ? `<a class="btn" href="#/m/${n}/l/${i + 1}">Next →</a>`
    : m.quiz ? `<a class="btn" href="#/m/${n}/quiz">Take the module quiz →</a>` : `<a class="btn" href="#/m/${n}">Back to the module →</a>`;
  main.innerHTML = `<p><a href="#/m/${n}">← Module ${n}: ${esc(m.title)}</a></p><div id="reader"></div><article class="lesson">${html}</article><div class="pager">${prev}${next}</div>`;
  const art = main.querySelector("article.lesson");
  setupChecks(art, n);
  if (/L97_lab_kit$/.test(l.file)) kitDownloads(art, n);
  Reader.attach(art, $("#reader"));
  main.querySelectorAll("img").forEach((img) => { img.loading = "lazy"; });
  Store.markLesson(n, l.file);
  focusMain(l.title);
}

// Lab kit: the module's spreadsheets (CSV) and images, downloadable one by one.
async function kitDownloads(art, n) {
  let files = null;
  try { files = await Store.courseData(`kit_M${String(n).padStart(2, "0")}`); } catch (e) { files = null; }
  const names = Object.keys(files || {});
  if (!names.length) return;
  const box = document.createElement("section");
  box.className = "q kitfiles";
  box.innerHTML = `<h2 style="margin-top:0">Download the lab files</h2><p class="muted">Each table above is also a spreadsheet file (CSV) that opens in Excel, Numbers, or Google Sheets.</p>
    <ul class="lessons">${names.map((f) => `<li><button type="button" class="linkbtn" data-f="${esc(f)}">${esc(f)}</button></li>`).join("")}</ul>`;
  art.prepend(box);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    const f = files[b.dataset.f];
    const blob = f.b64 ? new Blob([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], { type: f.type }) : new Blob([f.data], { type: f.type + ";charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = b.dataset.f; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

// ---------- Mock exams ----------
// One question per screen, answers chosen without feedback, a question map, flags, an optional countdown,
// then a score by domain and a full review with explanations. Unfinished attempts are kept on this device.
const TARGET = 0.75;
const mockSaveKey = (exam) => `ehrico-mock-${exam}-${(Store.user() || {}).email || ""}`;
const mockLoad = (exam) => { try { return JSON.parse(localStorage.getItem(mockSaveKey(exam)) || "null"); } catch (e) { return null; } };
const mockStore = (exam, st) => { try { st ? localStorage.setItem(mockSaveKey(exam), JSON.stringify(st)) : localStorage.removeItem(mockSaveKey(exam)); } catch (e) { /* storage unavailable */ } };
let mockTimer = null;

async function mockView(exam) {
  clearInterval(mockTimer);
  if (!mocksOpen(Store.get())) return dashboard();
  main.innerHTML = `<p class="muted">Loading…</p>`;
  let M = null;
  try { M = await Store.courseData(`mock_${exam}`); } catch (e) { M = null; }
  if (!M || !M.items) return dashboard();
  const saved = mockLoad(exam);
  main.innerHTML = `<p><a href="#/">← My course</a></p><h1>${esc(M.title)}</h1>
    <div class="q"><p>${M.items.length} questions. Suggested time: ${M.minutes} minutes in one sitting, with no notes. You choose answers without feedback; you see your score by domain and every explanation at the end.</p>
    <p>The course's target is <b>${Math.round(TARGET * 100)}% or better in every domain</b> before you book the real exam. That is the course's target, not the exam's published passing score.</p>
    <label><input type="checkbox" id="timed"> Take it timed (a countdown runs, and the exam is scored when time runs out)</label>
    <div class="pager">${saved ? `<button class="btn sec" id="resume">Resume your unfinished attempt (${Object.keys(saved.picks).length} answered)</button>` : "<span></span>"}<button class="btn" id="start">Start a new attempt</button></div></div>`;
  $("#start").addEventListener("click", () => run(M, { picks: {}, flags: {}, i: 0, timed: $("#timed").checked, ends: $("#timed").checked ? Date.now() + M.minutes * 60000 : 0 }));
  if (saved) $("#resume").addEventListener("click", () => run(M, saved));
  focusMain(M.title);
}

function run(M, st) {
  const exam = M.exam, N = M.items.length;
  const tick = () => {
    if (!st.timed) return;
    const left = Math.max(0, st.ends - Date.now()), el = $("#clock");
    if (el) el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} left`;
    if (!left) { clearInterval(mockTimer); finishMock(M, st); }
  };
  const show = () => {
    const q = M.items[st.i];
    mockStore(exam, st);
    main.innerHTML = `<p><a href="#/">← My course</a> <span class="muted">(your answers are kept on this device)</span></p>
      <div class="mockbar"><b>${esc(M.title)}</b><span>Question ${st.i + 1} of ${N}</span><span id="clock" class="muted"></span></div>
      <div class="q"><div>${q.stem}</div>
        <div role="group" aria-label="Answer choices">${["A", "B", "C", "D"].map((L) =>
          `<button class="opt${st.picks[q.n] === L ? " picked" : ""}" data-l="${L}" aria-pressed="${st.picks[q.n] === L}"><b>${L}.</b> ${q.options[L] || ""}</button>`).join("")}</div>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="flag" ${st.flags[q.n] ? "checked" : ""}> Flag this question to come back to</label></div>
      <div class="pager"><button class="btn sec" id="prev" ${st.i === 0 ? "disabled" : ""}>← Previous</button>
        <button class="btn sec" id="finish">Finish and score</button>
        <button class="btn" id="next" ${st.i === N - 1 ? "disabled" : ""}>Next →</button></div>
      <details class="qmap"><summary>Question map (${Object.keys(st.picks).length} of ${N} answered)</summary><div>${M.items.map((it, k) =>
        `<button class="qn${st.picks[it.n] ? " done" : ""}${st.flags[it.n] ? " flag" : ""}${k === st.i ? " cur" : ""}" data-k="${k}" aria-label="Question ${k + 1}${st.picks[it.n] ? ", answered" : ""}${st.flags[it.n] ? ", flagged" : ""}">${k + 1}</button>`).join("")}</div></details>`;
    main.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => { st.picks[q.n] = b.dataset.l; show(); }));
    $("#flag").addEventListener("change", (e) => { if (e.target.checked) st.flags[q.n] = 1; else delete st.flags[q.n]; mockStore(exam, st); });
    $("#prev").addEventListener("click", () => { st.i--; show(); });
    $("#next").addEventListener("click", () => { st.i++; show(); });
    main.querySelectorAll(".qn").forEach((b) => b.addEventListener("click", () => { st.i = +b.dataset.k; show(); }));
    $("#finish").addEventListener("click", () => {
      const left = N - Object.keys(st.picks).length;
      if (left && !confirm(`${left} question${left === 1 ? " is" : "s are"} unanswered and will count as wrong. Score the exam now?`)) return;
      clearInterval(mockTimer); finishMock(M, st);
    });
    tick();
    document.title = `${M.title} · Question ${st.i + 1}`;
  };
  clearInterval(mockTimer);
  if (st.timed) mockTimer = setInterval(tick, 1000);
  show();
}

function finishMock(M, st) {
  mockStore(M.exam, null);
  const by = {};
  let score = 0;
  M.items.forEach((q) => {
    const d = by[q.domain] = by[q.domain] || { right: 0, total: 0 };
    d.total++;
    if (st.picks[q.n] === q.key) { d.right++; score++; }
  });
  Store.recordMock(M.exam, score, M.items.length, by);
  const pct = (a, b) => Math.round((a / b) * 100);
  const review = (missedOnly) => M.items.filter((q) => !missedOnly || st.picks[q.n] !== q.key).map((q) => `<div class="q">
      <p class="muted">Question ${q.n} · ${esc(q.domain)}</p>${q.stem}
      <p>${["A", "B", "C", "D"].map((L) => `<span class="${L === q.key ? "ok" : L === st.picks[q.n] ? "no" : ""}"><b>${L}.</b> ${q.options[L] || ""}</span>`).join("<br>")}</p>
      <p><b class="${st.picks[q.n] === q.key ? "ok" : "no"}">${st.picks[q.n] === q.key ? "Correct." : st.picks[q.n] ? `You chose ${st.picks[q.n]}. The best answer is ${q.key}.` : `Not answered. The best answer is ${q.key}.`}</b></p>
      <div class="fb">${q.explain}</div></div>`).join("");
  main.innerHTML = `<p><a href="#/">← My course</a></p><h1>${esc(M.title)}: ${pct(score, M.items.length)}%</h1>
    <p>${score} of ${M.items.length} right. Target: ${Math.round(TARGET * 100)}% or better in every domain.</p>
    <table class="score"><thead><tr><th>Domain</th><th>Right</th><th>Percent</th></tr></thead><tbody>${M.domains.map((d) => {
      const r = by[d] || { right: 0, total: 0 };
      return `<tr><td>${esc(d)}</td><td>${r.right} of ${r.total}</td><td>${r.total ? pct(r.right, r.total) : 0}%${r.total && r.right / r.total >= TARGET ? " ✓" : ""}</td></tr>`;
    }).join("")}</tbody></table>
    <div class="pager"><button class="btn sec" id="rv-miss">Review the ones I missed</button><button class="btn sec" id="rv-all">Review every question</button><a class="btn" href="#/">My course</a></div>
    <div id="review"></div>`;
  $("#rv-miss").addEventListener("click", () => { $("#review").innerHTML = review(true) || `<p>You missed none.</p>`; });
  $("#rv-all").addEventListener("click", () => { $("#review").innerHTML = review(false); });
  focusMain(`${M.title} result`);
}

// ---------- In-lesson exam-style questions ----------
// Each question is graded the moment the learner picks an answer, with the full explanation.
// Answers are saved, so a returning learner sees what they chose; "Try again" clears the question.
function setupChecks(art, n) {
  art.querySelectorAll(".mcq").forEach((box) => {
    const qid = box.dataset.q, key = box.dataset.key;
    const opts = [...box.querySelectorAll(".opt")], fb = box.querySelector(".mcq-fb"), verdict = box.querySelector(".mcq-verdict");
    const show = (pick, saved) => {
      const right = pick === key;
      opts.forEach((o) => { o.disabled = true; o.classList.toggle("right", o.dataset.l === key); o.classList.toggle("wrong", o.dataset.l === pick && !right); });
      verdict.innerHTML = `<b class="${right ? "ok" : "no"}">${right ? "Correct." : `Not quite. The best answer is ${key}.`}</b>` +
        (saved ? ` <span class="muted">(your saved answer: ${pick})</span>` : "") +
        ` <button type="button" class="linkbtn" data-act="again">Try again</button>`;
      fb.hidden = false;
      verdict.querySelector("[data-act=again]").addEventListener("click", reset);
    };
    const reset = () => {
      opts.forEach((o) => { o.disabled = false; o.classList.remove("right", "wrong"); });
      fb.hidden = true; opts[0].focus();
    };
    opts.forEach((o) => o.addEventListener("click", () => {
      show(o.dataset.l, false);
      Store.saveCheck(n, qid, o.dataset.l, o.dataset.l === key);
    }));
    const prior = (Store.get().checks || {})[qid];
    if (prior) show(prior.pick, true);
  });
}

// ---------- Tap-to-define glossary ----------
const tip = document.createElement("div");
tip.className = "gloss"; tip.setAttribute("role", "dialog"); tip.hidden = true;
document.body.appendChild(tip);
const closeTip = () => { tip.hidden = true; };
document.addEventListener("click", async (e) => {
  const t = e.target.closest(".term");
  if (!t) { if (!e.target.closest(".gloss")) closeTip(); return; }
  const g = await Store.glossary();
  const items = t.dataset.g.split(",").map((i) => g[+i]).filter(Boolean);
  if (!items.length) return;
  tip.setAttribute("aria-label", "Definition of " + t.textContent);
  tip.innerHTML = items.map((it) => `<p><b>${esc(it.t)}</b>: ${it.d}${it.m != null ? ` <span class="muted">(Module ${it.m})</span>` : ""}</p>`).join("") +
    `<button type="button" class="linkbtn" data-act="close">Close</button>`;
  tip.querySelector("[data-act=close]").addEventListener("click", closeTip);
  tip.hidden = false;
  const r = t.getBoundingClientRect(), w = Math.min(420, window.innerWidth - 24);
  tip.style.width = w + "px";
  tip.style.left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 12)) + "px";
  tip.style.top = r.bottom + window.scrollY + 8 + "px";
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTip();
  if ((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest(".term")) { e.preventDefault(); e.target.click(); }
});
window.addEventListener("hashchange", closeTip);

async function quizView(n) {
  const m = byN(n);
  if (!m || !m.quiz || !unlocked(n, Store.get())) return dashboard();
  let pool = [];
  try { pool = (await Store.courseData(`quiz_M${String(n).padStart(2, "0")}`)) || []; } catch (e) { pool = []; }
  if (!pool.length) return moduleView(n);
  const qs = pool.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).slice(0, QUIZ_SIZE).map((x) => x[1]);
  let i = 0, score = 0;
  const show = () => {
    const q = qs[i];
    const letters = ["A", "B", "C", "D"].filter((L) => q.options[L]); // keep A-D order: explanations refer to the letters
    main.innerHTML = `<p><a href="#/m/${n}">← Module ${n}: ${esc(m.title)}</a></p><h1>Module ${n} quiz</h1>
      <p class="muted">Question ${i + 1} of ${qs.length} · Score so far: ${score}</p>
      <div class="q"><div>${md(q.stem)}</div>
      <div role="group" aria-label="Answer choices">${letters.map((L) =>
        `<button class="opt" data-l="${L}">${L}. ${inline(q.options[L])}</button>`).join("")}</div>
      <div class="fb" id="fb" aria-live="polite" hidden></div></div>
      <div class="pager"><span></span><button class="btn" id="next" disabled>${i < qs.length - 1 ? "Next question →" : "See my score"}</button></div>`;
    main.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      const pick = b.dataset.l, right = pick === q.key;
      if (right) score++;
      main.querySelectorAll(".opt").forEach((o) => { o.disabled = true; if (o.dataset.l === q.key) o.classList.add("right"); });
      if (!right) b.classList.add("wrong");
      const fb = $("#fb"); fb.hidden = false;
      fb.innerHTML = `<b class="${right ? "ok" : "no"}">${right ? "Correct." : `Not quite. The best answer is ${q.key}.`}</b>` +
        `<p>${inline(q.explain || "")}</p>`;
      const nx = $("#next"); nx.disabled = false; nx.focus();
    }));
    $("#next").addEventListener("click", () => { i++; i < qs.length ? show() : finish(); });
    focusMain(`Module ${n} quiz`);
  };
  const finish = () => {
    Store.recordQuiz(n, score, qs.length);
    const pct = Math.round((score / qs.length) * 100), ok = score / qs.length >= PASS, nx = nextOf(n);
    main.innerHTML = `<h1>Module ${n} quiz: ${pct}%</h1>
      <p>${ok ? "You passed." + (nx ? " The next module is open." : "") : "Not yet at 80%. Review the lessons for the questions you missed, then try again. You'll get the questions in a new order."}</p>
      <div class="pager"><a class="btn sec" href="#/m/${n}/quiz">Try again</a>${ok && nx ? `<a class="btn" href="#/m/${nx.n}">Go to Module ${nx.n} →</a>` : `<a class="btn" href="#/">My course</a>`}</div>`;
    focusMain(`Module ${n} quiz result`);
  };
  show();
}

function emptyView() {
  main.innerHTML = `<h1>My course</h1>
    <p class="fb">${courseError ? "The course couldn't load: " + esc(courseError) + ". Reload the page in a minute." : "The course content hasn't been published yet."}</p>
    ${Store.isAdmin() ? `<p><a class="btn" href="#/admin">Publish the course content</a></p>` : ""}`;
  focusMain("My course");
}

// ---------- Admin ----------
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
async function adminView() {
  if (!Store.isAdmin()) return COURSE.length ? dashboard() : emptyView();
  let built = null;
  try { built = await Store.courseData("built"); } catch (e) { built = null; }
  main.innerHTML = `<p><a href="#/">← My course</a></p><h1>Admin</h1>
    <section class="q"><h2 style="margin-top:0">Publish course content</h2>
      <p>Currently published: <b>${built ? day(built.built) + " " + new Date(built.built).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "nothing yet"}</b>.</p>
      <p>Choose the file <b>ehrico_content_bundle.json</b> from the folder <b>09 Course edition / _publish</b> on your Mac, then click Publish. Only signed-in learners can read what you publish.</p>
      <input type="file" id="bundle" accept=".json,application/json" style="margin:6px 0 12px">
      <div><button class="btn" id="pub">Publish</button></div>
      <p id="pubmsg" class="muted" aria-live="polite"></p>
    </section>
    <h2>Learners</h2><div id="learners"><p class="muted">Loading…</p></div>`;
  $("#pub").addEventListener("click", async () => {
    const f = $("#bundle").files[0], msg = $("#pubmsg");
    if (!f) { msg.textContent = "Choose the bundle file first."; return; }
    let bundle;
    try { bundle = JSON.parse(await f.text()); } catch (e) { msg.textContent = "That file isn't a course bundle (it couldn't be read as JSON)."; return; }
    if (!bundle.course || !bundle.lessons) { msg.textContent = "That file isn't a course bundle."; return; }
    $("#pub").disabled = true;
    try {
      const r = await Store.publish(bundle, (done, total) => { msg.textContent = `Uploading lessons… ${done} of ${total}`; });
      msg.textContent = `Published ${r.lessons} lessons, ${r.quizzes} quizzes, ${r.mocks} mock exams${bundle.glossary ? `, and ${bundle.glossary.length} glossary terms` : ""}.`;
      await loadCourse();
    } catch (e) {
      msg.textContent = "Publishing failed: " + (e.message || e) + (/permission|policy|denied/i.test(e.message || "") ? " (Has supabase/03_content.sql been run, and is your account an admin?)" : "");
    }
    $("#pub").disabled = false;
  });
  learnersTable();
  focusMain("Admin");
}

async function learnersTable() {
  const box = $("#learners");
  let d;
  try { d = await Store.adminData(); } catch (e) {
    box.innerHTML = `<p class="fb">Could not load learner records: ${esc(e.message || String(e))}. Run <b>supabase/03_content.sql</b> in the Supabase SQL Editor once.</p>`;
    return;
  }
  const nLessons = COURSE.reduce((s, m) => s + m.lessons.length, 0), total = COURSE.length;
  const rows = d.profiles.map((p) => {
    const les = d.lessons.filter((r) => r.user_id === p.id), qz = d.quizzes.filter((r) => r.user_id === p.id);
    const mods = COURSE.map((m) => {
      const a = qz.filter((r) => r.module === m.n);
      const best = a.length ? Math.max(...a.map((r) => r.score / r.total)) : null;
      const read = les.filter((r) => r.module === m.n).length;
      return { n: m.n, best, tries: a.length, read, of: m.lessons.length, done: m.quiz ? best !== null && best >= PASS : read >= m.lessons.length };
    });
    const doneN = mods.filter((m) => m.done).length;
    const current = (mods.find((m) => !m.done) || {}).n;
    const last = [...les.map((r) => r.read_at), ...qz.map((r) => r.taken_at)].sort().pop();
    const ck = (d.checks || []).filter((r) => r.user_id === p.id);
    const mk = {};
    (d.mocks || []).filter((r) => r.user_id === p.id).forEach((r) => { const m = mk[r.exam] = mk[r.exam] || { best: 0, tries: 0 }; m.best = Math.max(m.best, r.score / r.total); m.tries++; });
    mods.forEach((m) => { const c = ck.filter((r) => r.module === m.n); m.ck = c.length; m.ckFirst = c.filter((r) => r.first_correct).length; });
    const mockText = Object.entries(mk).map(([e, m]) => `${e} mock best ${Math.round(m.best * 100)}% (${m.tries} ${m.tries === 1 ? "try" : "tries"})`).join(" · ");
    return { p, mods, doneN, read: les.length, current, last, ck: ck.length, ckFirst: ck.filter((r) => r.first_correct).length, mockText, mk };
  }).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const learners = rows.filter((r) => !r.p.is_admin);
  const active = learners.filter((r) => r.last && Date.now() - new Date(r.last) < 7 * 864e5).length;
  const draw = (q) => {
    const show = rows.filter((r) => !q || `${r.p.full_name || ""} ${r.p.email || ""}`.toLowerCase().includes(q));
    $("#lr").innerHTML = show.map((r) => `<li class="q" style="margin:10px 0">
      <details><summary style="cursor:pointer"><b>${esc(r.p.full_name || "(no name)")}</b> · ${esc(r.p.email || "")}${r.p.is_admin ? ` <span class="tag">admin</span>` : ""}<br>
        <span class="muted">Joined ${day(r.p.created_at)} · Last active ${day(r.last)} · Lessons read ${r.read}/${nLessons} · Modules complete ${r.doneN}/${total} · Lesson questions answered ${r.ck} (${r.ck ? Math.round((r.ckFirst / r.ck) * 100) : 0}% right first try)${r.mockText ? " · " + r.mockText : ""}${r.doneN < total && r.current !== undefined ? ` · Working on Module ${r.current}` : r.doneN === total && total ? " · All modules complete" : ""}</span></summary>
        <table><thead><tr><th>Module</th><th>Lessons read</th><th>Lesson questions (right first try)</th><th>Best quiz</th><th>Tries</th></tr></thead><tbody>${r.mods.map((m) =>
          `<tr><td>${m.n}</td><td>${m.read}/${m.of}</td><td>${m.ck ? `${m.ck} (${m.ckFirst})` : "—"}</td><td>${m.best === null ? "—" : `${Math.round(m.best * 100)}%${m.best >= PASS ? " ✓" : ""}`}</td><td>${m.tries}</td></tr>`).join("")}</tbody></table>
      </details></li>`).join("") || `<li class="muted">No matches.</li>`;
  };
  box.innerHTML = `<p class="muted">${learners.length} ${learners.length === 1 ? "learner" : "learners"} · ${active} active in the last 7 days · ${learners.filter((r) => r.doneN === total && total).length} finished every module</p>
    <p class="muted">To add a learner: Supabase → Authentication → Users → Invite user. They get an email to set their password.</p>
    <div class="pager" style="margin-top:10px"><input id="lf" type="search" placeholder="Search name or email" aria-label="Search learners" style="flex:1;min-width:200px;padding:10px">
      <button class="btn sec" id="csv">Download spreadsheet (CSV)</button></div>
    <ol id="lr" style="list-style:none;padding:0"></ol>`;
  draw("");
  $("#lf").addEventListener("input", (e) => draw(e.target.value.trim().toLowerCase()));
  $("#csv").addEventListener("click", () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Name", "Email", "Joined", "Last active", "Lessons read", "Modules complete", "Lesson questions answered", "Right first try", "CEHRS mock best %", "CAHIMS mock best %", ...COURSE.map((m) => `M${m.n} best %`)];
    const lines = learners.map((r) => [r.p.full_name, r.p.email, day(r.p.created_at), day(r.last), r.read, r.doneN, r.ck, r.ckFirst, r.mk.CEHRS ? Math.round(r.mk.CEHRS.best * 100) : "", r.mk.CAHIMS ? Math.round(r.mk.CAHIMS.best * 100) : "",
      ...r.mods.map((m) => (m.best === null ? "" : Math.round(m.best * 100)))].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...lines].join("\n")], { type: "text/csv" }));
    a.download = `ehrico-learners-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  });
}

// ---------- Sign-in pages ----------
const field = (id, label, type, ac, extra = "") =>
  `<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${ac}" required ${extra} style="width:100%;padding:10px;margin:4px 0 14px">`;

function signInView(msg) {
  main.innerHTML = `<h1>Sign in to your course</h1>
    ${msg ? `<p class="fb" role="status">${msg}</p>` : ""}
    <form id="si" class="q" style="max-width:520px">
      ${field("si-email", "Email", "email", "email")}
      ${field("si-pass", "Password", "password", "current-password")}
      <button class="btn" type="submit">Sign in</button>
      <p style="margin:14px 0 0"><a href="#/forgot">Forgot your password?</a></p>
    </form>
    <p class="muted" style="max-width:520px">New to EHRICO? Accounts are by invitation. Watch for your invitation email, or <a href="../#pilot">apply for the free pilot</a>.</p>`;
  $("#si").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await Store.signIn($("#si-email").value.trim(), $("#si-pass").value);
    if (error) return signInView(/invalid/i.test(error.message) ? "That email and password don't match. Try again, or use “Forgot your password?”." : "Sorry, that didn't work: " + esc(error.message));
    await Store.load(); await loadCourse(); location.hash = "#/"; route();
  });
  focusMain("Sign in");
}

function forgotView(msg) {
  main.innerHTML = `<p><a href="#/">← Sign in</a></p><h1>Reset your password</h1>
    ${msg ? `<p class="fb" role="status">${msg}</p>` : ""}
    <form id="fp" class="q" style="max-width:520px">
      <p>Enter your email and we'll send you a link to set a new password. Open the link on any device.</p>
      ${field("fp-email", "Email", "email", "email")}
      <button class="btn" type="submit">Email me a reset link</button>
    </form>`;
  $("#fp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await Store.sendReset($("#fp-email").value.trim());
    forgotView(error ? "Sorry, that didn't work: " + esc(error.message) + " Please try again in a minute."
      : "If that email has an account, a reset link is on its way from EHRICO (check Junk too). Click it, then choose your new password.");
  });
  focusMain("Reset password");
}

function setPasswordView(msg) {
  main.innerHTML = `<h1>${Store.link.type === "invite" ? "Welcome to EHRICO. Choose your password" : "Choose a new password"}</h1>
    ${msg ? `<p class="fb" role="status">${msg}</p>` : ""}
    <form id="sp" class="q" style="max-width:520px">
      <p>Signed in as <b>${esc(Store.user().email)}</b>. Use at least 8 characters.</p>
      ${field("sp-1", "New password", "password", "new-password", 'minlength="8"')}
      ${field("sp-2", "Type it again", "password", "new-password", 'minlength="8"')}
      <button class="btn" type="submit">Save password</button>
    </form>`;
  $("#sp").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#sp-1").value !== $("#sp-2").value) return setPasswordView("The two passwords don't match. Try again.");
    const { error } = await Store.setPassword($("#sp-1").value);
    if (error) return setPasswordView("Sorry, that didn't work: " + esc(error.message));
    needPassword = false; location.hash = "#/"; route();
  });
  focusMain("Set password");
}

function showWho() {
  const u = Store.user(); const w = $("#who");
  w.innerHTML = u ? `${Store.isAdmin() ? `<a href="#/admin" style="color:#fff">Admin</a> · ` : ""}${esc(u.email)} · <a href="#/set-password" style="color:#fff">Change password</a> · <a href="#/signout" style="color:#fff">Sign out</a>` : "";
}

// ---------- Router and start-up ----------
async function loadCourse() {
  COURSE = []; RES = { lessons: [], mocks: [] }; courseError = "";
  if (!Store.user()) return;
  try { COURSE = (await Store.courseData("course")) || []; } catch (e) { courseError = e.message || String(e); }
  try { RES = (await Store.courseData("resources")) || { lessons: [], mocks: [] }; } catch (e) { RES = { lessons: [], mocks: [] }; }
}

async function route() {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (h[0] === "signout") { await Store.signOut(); COURSE = []; showWho(); location.hash = "#/"; return; }
  showWho();
  if (!Store.user()) {
    if (h[0] === "forgot") return forgotView();
    const m = bootMsg; bootMsg = ""; return signInView(m);
  }
  if (needPassword || h[0] === "set-password") return setPasswordView();
  if (h[0] === "admin") return adminView();
  if (!COURSE.length) return emptyView();
  if (h[0] === "r") return resourceView(+h[1]);
  if (h[0] === "mock") return mockView(h[1]);
  clearInterval(mockTimer);
  if (h[0] === "m" && h[2] === "l") return lessonView(+h[1], +h[3]);
  if (h[0] === "m" && h[2] === "quiz") return quizView(+h[1]);
  if (h[0] === "m") return moduleView(+h[1]);
  dashboard();
}

(async () => {
  await Store.load();
  const L = Store.link;
  if (L.error) bootMsg = "That email link didn't work (" + esc(L.error) + "). Links expire and work only once. Sign in below, or use “Forgot your password?” to get a new link.";
  if (Store.user() && ["invite", "recovery", "signup"].includes(L.type)) needPassword = true;
  if (L.hadTokens) history.replaceState(null, "", location.pathname + "#/");
  await loadCourse();
  Store.onChange(async (event) => {
    if (event === "PASSWORD_RECOVERY") { needPassword = true; await Store.load(); route(); }
    if (event === "SIGNED_OUT") { COURSE = []; route(); }
  });
  window.addEventListener("hashchange", route);
  route();
})();
