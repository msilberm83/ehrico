#!/usr/bin/env python3
"""Package the EHRICO course (modules 0-13) into one private content bundle for upload.

The bundle is written OUTSIDE the website repo, so no lesson text is ever published on GitHub:
    ../09 Course edition/_publish/ehrico_content_bundle.json
Upload it from the learning center: sign in as admin -> Learners -> "Publish course content".

Only figure images go into the public site (learn/img/), rendered from the SVGs.
In-lesson questions (Cn-NN Check yourself, Kn-NN Knowledge check) become clickable exam-style questions
graded on the spot, and glossary terms become tap-to-define buttons (first use per lesson).
Usage:  python3 build_bundle.py            (lessons + quizzes + images)
        python3 build_bundle.py --no-images
"""
import re, os, sys, json, csv, html, glob, shutil, subprocess, datetime

H = os.path.dirname(os.path.abspath(__file__))
CE = os.path.join(H, "..", "09 Course edition")
OUT_DIR = os.path.join(CE, "_publish")
IMG = os.path.join(H, "learn", "img")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CAP = 1900  # target words per lesson page
V3 = os.path.join(CE, "images_v3")  # new-style pictures (PNG, generated from prompts_v3) and their captions
read_caps = lambda p: {r[0]: r[1] for r in csv.reader(open(p, encoding="utf-8"), delimiter="\t") if len(r) > 1} if os.path.exists(p) else {}
cap = {**read_caps(os.path.join(CE, "images", "captions.tsv")), **read_caps(os.path.join(V3, "captions.tsv"))}
used_figs = set()
ORDER = {}  # figure id -> its number in page order within its module


def fig_source(i):
    """The new PNG if it has been made. A figure with a new prompt never falls back to its old drawing,
    because the old drawing no longer matches the new caption."""
    new = os.path.join(V3, i + ".png")
    if os.path.exists(new):
        return new
    if os.path.exists(os.path.join(CE, "prompts_v3", i + ".txt")):
        return None
    old = os.path.join(CE, "images", i + ".svg")
    return old if os.path.exists(old) else None


def figure(m):
    i = m.group(1)
    if not fig_source(i):
        return ""  # figure not drawn yet; skip it rather than show a broken image
    used_figs.add(i)
    num = f"{int(i[1:3])}.{ORDER.get(i, int(i[4:6]))}"
    c = html.escape(cap.get(i, ""))
    return f'\n<figure><img src="img/{i}.png" alt="Figure {num}. {c}" loading="lazy"><figcaption><b>Figure {num}.</b> {c}</figcaption></figure>\n'


def pandoc(md):
    return subprocess.run(["pandoc", "-f", "gfm", "-t", "html", "--wrap=none"], input=md, capture_output=True, text=True).stdout


def md_batch(pieces):
    """Convert many small markdown pieces with one pandoc call."""
    if not pieces:
        return []
    out = re.split(r"<p>@@CUT@@</p>\n?", pandoc("\n\n@@CUT@@\n\n".join(pieces)))
    assert len(out) == len(pieces), "pandoc batch split failed"
    return [o.strip() for o in out]


# ---------- In-lesson exam-style questions ----------
QRE = re.compile(r"^\*\*([CK]\d+-\d+)\.\*\*[ \t]*(.*?)\n[ \t]*\n+A\. ([^\n]+)\n+B\. ([^\n]+)\n+C\. ([^\n]+)\n+D\. ([^\n]+?)[ \t]*$", re.S | re.M)
ARE = re.compile(r"^\*\*([CK]\d+-\d+) — ([ABCD])\.\*\*[ \t]*(.+?)(?=^\*\*[CKP]\d+-\d+ — |^#|\Z)", re.S | re.M)


def exam_of(ids):
    exams = [e for e in ("CEHRS", "CAHIMS") if any(i.startswith(e) for i in ids)]
    return " · ".join(exams) or "EHRICO"


def parse_checks(answers, n):
    """Pull the Cn-NN / Kn-NN answers out of the module's answer section; return them and what's left."""
    keys = {}
    for m in ARE.finditer(answers):
        body = m.group(3).strip()
        ids = []
        c = re.search(r"^\*Checklist: (.+?)\*\s*$", body, re.M)
        if c:
            ids = [x.strip() for x in c.group(1).split(",")]
            body = (body[:c.start()] + body[c.end():]).strip()
        keys[m.group(1)] = {"key": m.group(2), "explain": body, "exam": exam_of(ids)}
    rest = ARE.sub("", answers)
    # drop the bold section labels that grouped those answers, now that nothing sits under them
    rest = re.sub(r"^\*\*[^*\n]+\*\*[ \t]*\n\s*(?=^\*\*[^*\n]+\*\*[ \t]*$|^#|\Z)", "", rest + "\n", flags=re.M)
    rest = re.sub(r"^\*\*[^*\n]+\*\*[ \t]*\n\s*(?=^#|\Z)", "", rest, flags=re.M)
    # drop subsection headings left with nothing under them
    rest = re.sub(r"^### [^\n]+\n\s*(?=^#|\Z)", "", rest, flags=re.M)
    return keys, rest


def check_html(q, a, parts):
    stem, opts, explain = parts
    label = "Warm-up" if q["id"].endswith("-00") else f'Question {q["id"]}'
    unwrap = lambda h: re.sub(r"^<p>(.*)</p>$", r"\1", h, flags=re.S)
    buttons = "".join(f'<button type="button" class="opt" data-l="{L}"><b>{L}.</b> {unwrap(o)}</button>' for L, o in zip("ABCD", opts))
    return (f'<section class="mcq" data-q="{q["id"]}" data-key="{a["key"]}">'
            f'<header class="mcq-head"><span class="mcq-id">{label}</span> <span class="mcq-exam">{a["exam"]} style</span></header>'
            f'<div class="mcq-stem">{stem}</div><div class="mcq-opts" role="group" aria-label="Answer choices">{buttons}</div>'
            f'<div class="mcq-fb" aria-live="polite" hidden><p class="mcq-verdict"></p><div class="mcq-explain">{explain}</div></div></section>')


def md2html(md, keys=None, n=0, found=None):
    md = re.sub(r"^> \[ILLUSTRATION ([A-Z0-9-]+): .*\]\s*$", figure, md, flags=re.M)
    md = md.replace('<div style="page-break-before: always;"></div>', "")
    qs = []

    def slot(m):
        qid = m.group(1)
        if keys is None or qid not in keys:
            print(f"  warning: M{n} {qid} has no answer; left as plain text")
            return m.group(0)
        if re.search(r"^\*\*[CK]\d+-\d+\.\*\*", m.group(2), re.M):
            print(f"  warning: M{n} {qid} looks malformed (options missing?)")
        qs.append({"id": qid, "stem": m.group(2).strip(), "opts": [m.group(k) for k in range(3, 7)]})
        return f'\n<div class="mcq-slot" data-q="{qid}"></div>\n'

    md = QRE.sub(slot, md)
    out = pandoc(md)
    if qs:
        pieces = []
        for q in qs:
            pieces += [q["stem"], *q["opts"], keys[q["id"]]["explain"]]
        conv = md_batch(pieces)
        for k, q in enumerate(qs):
            c = conv[k * 6:(k + 1) * 6]
            out = out.replace(f'<div class="mcq-slot" data-q="{q["id"]}"></div>', check_html(q, keys[q["id"]], (c[0], c[1:5], c[5])), 1)
            if found is not None:
                found.append(q["id"])
    return gloss_mark(out)


# ---------- Tap-to-define glossary ----------
GLOSS, FORMS = [], {}   # entries [{t, d, m}], first-word index -> [(form, case_sensitive, [ids])]
BLOCK = {"Go", "Low", "SUM", "U"}
# Everyday words that are also glossary terms: marking them would flag ordinary uses, so they are never marked.
COMMON = set("""ability accept accountable adopt alert application arrived assessment assumption avoid awareness block build
category cell charge client configure consulted critical delay desire developer development direct disable discovered domains
driver drivers edits environment extract field filter frequency guidelines hardware header high homework impact informed issue
knowledge lean license low mean medium memory middle modeling objective order park partner phases plan pool post premium
priority production proposal quality query recall record recovery reduce refresh release required requirements resource
responsible retest risk root rounds route rule segment server signal slack slip software sort storage styles switch table
testing threshold transfer trend values void weight with""".split())


def inline_md(s):
    s = html.escape(s, quote=False)
    return re.sub(r"\*(.+?)\*", r"<i>\1</i>", re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s))


def load_glossary():
    t = open(os.path.join(CE, "98_glossary_v2.md"), encoding="utf-8").read()
    raw = re.findall(r"^\*\*(.+?)\*\* — (.+)$", t, re.M)
    ids = {}
    for term, d in raw:
        m = re.search(r"\s*\*First used: Module (\d+)\.\*\s*$", d)
        mod = int(m.group(1)) if m else None
        d = d[:m.start()] if m else d
        ids[term] = len(GLOSS)
        GLOSS.append({"t": term, "d": inline_md(d.strip()), "m": mod})
    forms = {}
    for term, d in raw:
        i = ids[term]
        see = re.match(r"See \*(.+?)\*\.?$", d.strip())
        if see and see.group(1) in ids:
            i = ids[see.group(1)]
        cand = [term]
        p = re.match(r"^(.+?) \(([^()]+)\)$", term)
        if p:
            cand += [p.group(1), p.group(2)]
        for f in cand:
            if len(f) < 2 or f in BLOCK or f.lower() in COMMON or f.isdigit():
                continue
            lst = forms.setdefault(f, [])
            if i not in lst:
                lst.append(i)
    for f, lst in forms.items():
        ef = html.escape(f, quote=False)
        first = re.match(r"\w+", ef)
        if not first:
            continue
        cs = any(ch.isupper() for ch in f[1:])
        FORMS.setdefault(first.group(0).lower(), []).append((ef, cs, lst))
    for k in FORMS:
        FORMS[k].sort(key=lambda x: -len(x[0]))


SKIP_TAGS = {"header", "h1", "h2", "h3", "h4", "h5", "h6", "a", "button", "code", "pre", "script", "style"}


def gloss_mark(out):
    """Wrap the first use of each glossary term in this lesson in a tap-to-define button."""
    if not FORMS:
        return out
    seen, depth, res = set(), [], []
    for tok in re.split(r"(<[^>]+>)", out):
        if tok.startswith("<"):
            tm = re.match(r"<(/?)([a-zA-Z0-9]+)", tok)
            if tm and tm.group(2).lower() in SKIP_TAGS and not tok.endswith("/>"):
                if tm.group(1):
                    if depth: depth.pop()
                else:
                    depth.append(tm.group(2).lower())
            res.append(tok)
            continue
        if depth or not tok.strip():
            res.append(tok)
            continue
        low, pos, buf = tok.lower(), 0, []
        for wm in re.finditer(r"\w+", tok):
            s0 = wm.start()
            if s0 < pos or (s0 and (tok[s0 - 1] in "&#-/" or tok[s0 - 1].isalnum())):
                continue
            for ef, cs, lst in FORMS.get(wm.group(0).lower(), ()):
                e = s0 + len(ef)
                if not low.startswith(ef.lower(), s0) or (cs and not tok.startswith(ef, s0)):
                    continue
                if e < len(tok) and tok[e] in "s" and (e + 1 == len(tok) or not (tok[e + 1].isalnum() or tok[e + 1] == "-")):
                    e += 1  # plural
                elif e < len(tok) and (tok[e].isalnum() or tok[e] in "-_"):
                    continue
                key = lst[0]
                if key in seen:
                    break
                seen.add(key)
                buf.append(tok[pos:s0])
                buf.append(f'<span class="term" role="button" tabindex="0" data-g="{",".join(map(str, lst))}">{tok[s0:e]}</span>')
                pos = e
                break
        buf.append(tok[pos:])
        res.append("".join(buf))
    return "".join(res)


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
    for k, i in enumerate(re.findall(r"^> \[ILLUSTRATION ([A-Z0-9-]+):", t, re.M), 1):
        ORDER[i] = k
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
    keys, answers = parse_checks(answers, n)
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
        found = []
        body = md2html(md, keys, n, found)
        lessons.append({"file": f"M{n:02d}/{name}", "title": ltitle, "checks": found,
                        "html": f"<h1>{html.escape(ltitle)}</h1>\n" + body})

    add("L00_start_here", f"Module {n} — Start here: outline and the problem", "\n\n".join(start))
    for k, g in enumerate(groups, 1):
        first = g[0].split("\n", 1)[0].lstrip("# ").strip()
        add(f"L{k:02d}", f"Module {n}, Lesson {k}: {first}", "\n\n".join(g))
    kit = os.path.join(KIT, f"M{n:02d}_lab_kit.md")
    if os.path.exists(kit):
        add("L97_lab_kit", f"Module {n} — Lab kit", open(kit, encoding="utf-8").read().split("\n", 1)[1])
    if re.sub(r"^#.*$", "", answers, flags=re.M).strip():
        add("L98_answers", f"Module {n} — Answers", "## Answers for this module" + answers)
    if sources:
        add("L99_sources", f"Module {n} — Sources", "\n\n".join(sources))
    quiz = parse_quiz(practice, answers_q, n) if practice else []
    used = {q for l in lessons for q in l["checks"]}
    for qid in sorted(set(keys) - used):
        print(f"  warning: M{n} answer {qid} has no matching question")
    return {"n": n, "title": title, "lessons": lessons, "quiz": quiz}


# ---------- Lab kit downloads, resources, and mock exams ----------
KIT = os.path.join(CE, "lab_kit")


def kit_files(n):
    """Spreadsheet (CSV) and image files for one module's lab kit, as {name: {type, data}} (images base64)."""
    import base64
    out = {}
    for p in sorted(glob.glob(os.path.join(KIT, "csv", f"M{n:02d}_*.csv"))):
        out[os.path.basename(p)] = {"type": "text/csv", "data": open(p, encoding="utf-8").read()}
    for p in sorted(glob.glob(os.path.join(KIT, "images", f"M{n:02d}_*.png"))):
        out[os.path.basename(p)] = {"type": "image/png", "b64": base64.b64encode(open(p, "rb").read()).decode()}
    return out


def resource(file, title, md):
    return {"file": file, "title": title, "html": f"<h1>{html.escape(title)}</h1>\n" + gloss_mark(pandoc(md))}


def parse_mock(path, exam, minutes):
    """Questions, keys, explanations, and domains from a book mock exam (exams/<EXAM>_Mock_Exam_A.md)."""
    t = open(path, encoding="utf-8").read()
    qs = t.split("## Questions", 1)[1].split("## Answer sheet", 1)[0]
    ans = t.split("## Answers and explanations", 1)[1].split("## Score by domain", 1)[0]
    dom = t.split("## Score by domain", 1)[1]
    domain_of, table_order = {}, []
    for line in re.findall(r"^\|.+\|\s*$", dom, re.M):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        name = cells[0].strip("* ")
        if not cells or re.match(r"(?i)(domain|total|-+)$", name) or set(name) <= set("-: "):
            continue
        lists = [c for c in cells[1:] if re.fullmatch(r"\d+(\s*,\s*\d+)+", c)]  # the cell that lists question numbers
        if not lists:
            continue
        for x in lists[0].split(","):
            domain_of[int(x)] = name
        table_order.append(name)
    items, pieces = [], []
    for b in re.split(r"\n(?=### Question \d+)", "\n" + qs)[1:]:
        num = int(re.match(r"### Question (\d+)", b.strip()).group(1))
        body = b.strip().split("\n", 1)[1]
        opts = dict(re.findall(r"^([ABCD])\. (.+?)\s*$", body, re.M))
        stem = re.split(r"\n(?=A\. )", body, 1)[0].strip()
        items.append({"n": num, "options": opts, "domain": domain_of.get(num, "")})
        pieces.append(stem)
    keys = {}
    for m in re.finditer(r"^\*\*(\d+)\. Key ([ABCD])\.\*\*\s*(.+?)(?=^\*\*\d+\. Key |\Z)", ans, re.S | re.M):
        keys[int(m.group(1))] = (m.group(2), m.group(3).strip())
    for it in items:
        pieces.append(keys.get(it["n"], ("", ""))[1])
    conv = md_batch(pieces)
    k = len(items)
    for i, it in enumerate(items):
        it["stem"] = conv[i]
        it["key"] = keys.get(it["n"], ("", ""))[0]
        it["explain"] = conv[k + i]
        it["options"] = {L: inline_md(o) for L, o in it["options"].items()}
        if not it["key"] or len(it["options"]) != 4:
            print(f"  warning: {exam} mock question {it['n']} is incomplete")
    domains = [d for d in table_order if any(it["domain"] == d for it in items)]
    return {"exam": exam, "title": f"{exam} Mock Exam A", "minutes": minutes, "domains": domains, "items": items}


def render_images():
    os.makedirs(IMG, exist_ok=True)
    for i in sorted(used_figs):
        src = fig_source(i)
        png = os.path.join(IMG, i + ".png")
        if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(src):
            continue
        if src.endswith(".png"):
            shutil.copy(src, png)
            subprocess.run(["sips", "-Z", "1600", png], capture_output=True)
            continue
        svg = src
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,1080",
                        f"--screenshot={png}", "file://" + svg], capture_output=True)
        subprocess.run(["sips", "-Z", "1600", png], capture_output=True)


if __name__ == "__main__":
    load_glossary()
    mods = [build_module(n) for n in range(0, 14)]
    course = [{"n": m["n"], "title": m["title"], "quiz": bool(m["quiz"]),
               "lessons": [{"file": l["file"], "title": l["title"], "checks": l["checks"]} for l in m["lessons"]]} for m in mods]
    res = []
    roster = os.path.join(KIT, "00_practice_emr_roster.md")
    if os.path.exists(roster):
        res.append(resource("R/roster", "Practice EMR roster", open(roster, encoding="utf-8").read().split("\n", 1)[1]))
    guide = os.path.join(CE, "97_exam_prep_guide_v2.md")
    if os.path.exists(guide):
        res.append(resource("R/exam_prep", "Exam prep guide", open(guide, encoding="utf-8").read().split("\n", 1)[1]))
    res.append(resource("R/glossary", "Glossary", open(os.path.join(CE, "98_glossary_v2.md"), encoding="utf-8").read().split("\n", 1)[1]))
    mocks = {}
    for exam, minutes in (("CEHRS", 100), ("CAHIMS", 120)):
        p = os.path.join(CE, "exams", f"{exam}_Mock_Exam_A.md")
        if os.path.exists(p):
            mocks[f"mock_{exam}"] = parse_mock(p, exam, minutes)
    extra = {f"kit_M{n:02d}": kit_files(n) for n in range(14)}
    extra.update(mocks)
    extra["resources"] = {"lessons": [{"file": r["file"], "title": r["title"]} for r in res],
                          "mocks": [{"key": k, "exam": v["exam"], "title": v["title"], "count": len(v["items"]), "minutes": v["minutes"]} for k, v in mocks.items()]}
    bundle = {
        "built": datetime.datetime.now().isoformat(timespec="seconds"),
        "course": course,
        "quizzes": {f"quiz_M{m['n']:02d}": m["quiz"] for m in mods if m["quiz"]},
        "glossary": GLOSS,
        "extra": extra,
        "lessons": [{"file": l["file"], "title": l["title"], "html": l["html"]} for m in mods for l in m["lessons"]] + res,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "ehrico_content_bundle.json")
    json.dump(bundle, open(out, "w", encoding="utf-8"))
    print(f"modules: {len(mods)}  lessons: {len(bundle['lessons'])}  quizzes: {len(bundle['quizzes'])} "
          f"({sum(len(v) for v in bundle['quizzes'].values())} questions)  figures: {len(used_figs)}")
    print(f"in-lesson questions: {sum(len(l['checks']) for m in course for l in m['lessons'])}  glossary terms: {len(GLOSS)}")
    mock_note = ", ".join(v["exam"] + " " + str(len(v["items"])) for v in mocks.values())
    print(f"resources: {len(res)}  mock exams: {mock_note}  "
          f"kit downloads: {sum(len(extra[f'kit_M{n:02d}']) for n in range(14))} files")
    print(f"bundle: {out} ({os.path.getsize(out) // 1024} KB)")
    if "--no-images" not in sys.argv:
        render_images()
        print("images rendered:", len(used_figs))
