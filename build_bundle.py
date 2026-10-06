#!/usr/bin/env python3
"""Package the EHRICO course (modules 0-13) into one private content bundle for upload.

The bundle is written OUTSIDE the website repo, so no lesson text is ever published on GitHub:
    ../09 Course edition/_publish/ehrico_content_bundle.json
Upload it from the learning center: sign in as admin -> Learners -> "Publish course content".

Only figure images go into the public site (learn/img/), rendered from the SVGs.
Usage:  python3 build_bundle.py            (lessons + quizzes + images)
        python3 build_bundle.py --no-images
"""
import re, os, sys, json, csv, html, glob, subprocess, datetime

H = os.path.dirname(os.path.abspath(__file__))
CE = os.path.join(H, "..", "09 Course edition")
OUT_DIR = os.path.join(CE, "_publish")
IMG = os.path.join(H, "learn", "img")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CAP = 1900  # target words per lesson page
cap = {r[0]: r[1] for r in csv.reader(open(os.path.join(CE, "images", "captions.tsv"), encoding="utf-8"), delimiter="\t") if len(r) > 1}
used_figs = set()


def figure(m):
    i = m.group(1)
    if not os.path.exists(os.path.join(CE, "images", i + ".svg")):
        return ""  # figure not drawn yet; skip it rather than show a broken image
    used_figs.add(i)
    num = f"{int(i[1:3])}.{int(i[4:6])}"
    c = html.escape(cap.get(i, ""))
    return f'\n<figure><img src="img/{i}.png" alt="Figure {num}. {c}" loading="lazy"><figcaption><b>Figure {num}.</b> {c}</figcaption></figure>\n'


def md2html(md):
    md = re.sub(r"^> \[ILLUSTRATION ([A-Z0-9-]+): .*\]\s*$", figure, md, flags=re.M)
    md = md.replace('<div style="page-break-before: always;"></div>', "")
    return subprocess.run(["pandoc", "-f", "gfm", "-t", "html"], input=md, capture_output=True, text=True).stdout


def split_h2(text):
    return re.split(r"\n(?=## )", "\n" + text)[1:]


def parse_quiz(practice, answers, n):
    items = []
    keys = {m.group(1): (m.group(2), m.group(3).strip())
            for m in re.finditer(r"^\*\*(P\d+-\d+) — ([ABCD])\.\*\*\s*(.+?)(?=^\*\*P\d+-\d+ — |\Z)", answers, re.S | re.M)}
    for b in re.split(r"\n(?=### Question )", "\n" + practice)[1:]:
        qid = re.match(r"### Question (P\d+-\d+)", b.strip())
        if not qid:
            continue
        qid = qid.group(1)
        pre = b.split("\nA. ")[0]
        stem = "\n".join(pre.strip().split("\n")[1:]).strip()
        opts = dict(re.findall(r"^([ABCD])\. (.+?)\s*$", b, re.M))
        if qid not in keys or len(opts) != 4:
            print(f"  warning: M{n} {qid} skipped (missing key or options)")
            continue
        key, explain = keys[qid]
        items.append({"id": qid, "stem": stem, "options": opts, "key": key, "explain": explain})
    return items


def build_module(n):
    t = open(os.path.join(CE, f"module{n:02d}_v2.md"), encoding="utf-8").read()
    title = t.split("\n", 1)[0].lstrip("# ").strip()
    title = re.sub(r"^Module \d+ — ", "", title)
    practice = answers_q = ""
    if "\n## Practice exam questions" in t:
        t, rest = t.split("\n## Practice exam questions", 1)
        if "\n## Answers and explanations" in rest:
            practice, answers_q = rest.split("\n## Answers and explanations", 1)
        else:
            practice = rest
    core, _, answers = t.partition("\n## Answers for this module")
    parts = split_h2(core.split("\n", 1)[1])
    start = [p for p in parts if p.startswith("## Chapter outline") or p.startswith("## The problem")]
    body = [p for p in parts if p not in start and not p.startswith("**EHRICO course")]
    sources = []
    for k, p in enumerate(body):
        if "### Sources for this module" in p:
            a, b = p.split("### Sources for this module", 1)
            body[k] = a
            sources.append("### Sources for this module" + b)
    groups, cur, w = [], [], 0
    for p in body:
        pw = len(p.split())
        if cur and w + pw > CAP:
            groups.append(cur); cur, w = [], 0
        cur.append(p); w += pw
    if cur:
        groups.append(cur)
    lessons = []

    def add(name, ltitle, md):
        lessons.append({"file": f"M{n:02d}/{name}", "title": ltitle, "html": f"<h1>{html.escape(ltitle)}</h1>\n" + md2html(md)})

    add("L00_start_here", f"Module {n} — Start here: outline and the problem", "\n\n".join(start))
    for k, g in enumerate(groups, 1):
        first = g[0].split("\n", 1)[0].lstrip("# ").strip()
        add(f"L{k:02d}", f"Module {n}, Lesson {k}: {first}", "\n\n".join(g))
    if answers.strip():
        add("L98_answers", f"Module {n} — Answers", "## Answers for this module" + answers)
    if sources:
        add("L99_sources", f"Module {n} — Sources", "\n\n".join(sources))
    quiz = parse_quiz(practice, answers_q, n) if practice else []
    return {"n": n, "title": title, "lessons": lessons, "quiz": quiz}


def render_images():
    os.makedirs(IMG, exist_ok=True)
    for i in sorted(used_figs):
        svg = os.path.join(CE, "images", i + ".svg")
        png = os.path.join(IMG, i + ".png")
        if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(svg):
            continue
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,1080",
                        f"--screenshot={png}", "file://" + svg], capture_output=True)
        subprocess.run(["sips", "-Z", "1600", png], capture_output=True)


if __name__ == "__main__":
    mods = [build_module(n) for n in range(0, 14)]
    course = [{"n": m["n"], "title": m["title"], "quiz": bool(m["quiz"]),
               "lessons": [{"file": l["file"], "title": l["title"]} for l in m["lessons"]]} for m in mods]
    bundle = {
        "built": datetime.datetime.now().isoformat(timespec="seconds"),
        "course": course,
        "quizzes": {f"quiz_M{m['n']:02d}": m["quiz"] for m in mods if m["quiz"]},
        "lessons": [l for m in mods for l in m["lessons"]],
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "ehrico_content_bundle.json")
    json.dump(bundle, open(out, "w", encoding="utf-8"))
    print(f"modules: {len(mods)}  lessons: {len(bundle['lessons'])}  quizzes: {len(bundle['quizzes'])} "
          f"({sum(len(v) for v in bundle['quizzes'].values())} questions)  figures: {len(used_figs)}")
    print(f"bundle: {out} ({os.path.getsize(out) // 1024} KB)")
    if "--no-images" not in sys.argv:
        render_images()
        print("images rendered:", len(used_figs))
