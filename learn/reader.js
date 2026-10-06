// EHRICO read-aloud player: reads a lesson out loud with the browser's built-in voices.
// Speeds 1x to 1.5x, highlights the paragraph being read, and lets the learner click any paragraph to start there.
const Reader = (() => {
  const synth = window.speechSynthesis;
  const SPEEDS = [1, 1.1, 1.2, 1.3, 1.4, 1.5];
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("ehrico-reader-" + k); localStorage.setItem("ehrico-reader-" + k, v); } catch (e) { return null; } };
  let queue = [], idx = 0, playing = false, paused = false, rate = Number(pref("rate")) || 1, voiceName = pref("voice") || "", bar = null;

  // Hide novelty voices and put the most natural ones first.
  const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/i;
  const score = (v) => (/premium|neural|natural|online/i.test(v.name) ? 0 : /enhanced|siri/i.test(v.name) ? 1 : /^(Samantha|Ava|Allison|Susan|Zoe|Evan|Nathan|Tom|Google US English|Google UK English|Microsoft)/i.test(v.name) ? 2 : 3) + (/en-US/i.test(v.lang) ? 0 : 0.5);
  const englishVoices = () => {
    const all = (synth ? synth.getVoices() : []).filter((v) => /^en(-|_|$)/i.test(v.lang) && !NOVELTY.test(v.name));
    const us = all.filter((v) => /en[-_]US/i.test(v.lang)); // American English voices only, when the device has them
    return (us.length ? us : all).sort((a, b) => score(a) - score(b));
  };
  function bestVoice() {
    const vs = englishVoices();
    return vs.find((v) => v.name === voiceName) || vs[0] || null;
  }
  const textOf = (el) => el.innerText.replace(/\s+/g, " ").trim();

  function mark(i) {
    queue.forEach((el) => el.classList.remove("speaking"));
    const el = queue[i];
    if (el) { el.classList.add("speaking"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  function speak(i) {
    if (!synth) return;
    synth.cancel();
    idx = i;
    if (idx >= queue.length) return stop();
    const text = textOf(queue[idx]);
    if (!text) return speak(idx + 1);
    const u = new SpeechSynthesisUtterance(text);
    const v = bestVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rate;
    u.onend = () => { if (playing && !paused && queue[idx] && u.text === textOf(queue[idx])) speak(idx + 1); };
    mark(idx); playing = true; paused = false; update();
    synth.speak(u);
  }

  function stop() {
    if (synth) synth.cancel();
    playing = false; paused = false; queue.forEach((el) => el.classList.remove("speaking")); update();
  }

  function toggle() {
    if (!playing) return speak(idx || 0);
    if (paused) { paused = false; synth.resume(); }
    else { paused = true; synth.pause(); }
    update();
  }

  function update() {
    if (!bar) return;
    bar.querySelector("[data-act=play]").textContent = !playing ? "▶ Listen" : paused ? "▶ Resume" : "❚❚ Pause";
    bar.querySelector("[data-act=stop]").disabled = !playing;
  }

  function attach(article, mount) {
    stop(); idx = 0;
    if (!synth) { mount.innerHTML = `<p class="muted">Read-aloud isn't available in this browser.</p>`; return; }
    queue = [...article.querySelectorAll("h1, h2, h3, h4, p, li, figcaption, td, th, blockquote")]
      .filter((el) => !el.closest("li li") && !el.querySelector("p, li") && textOf(el));
    mount.innerHTML = `<div class="reader" role="group" aria-label="Read this lesson aloud">
      <button class="btn" data-act="play" type="button">▶ Listen</button>
      <button class="btn sec" data-act="stop" type="button" disabled>■ Stop</button>
      <label>Speed <select data-act="rate">${SPEEDS.map((s) => `<option value="${s}"${s === rate ? " selected" : ""}>${s}×</option>`).join("")}</select></label>
      <label>Voice <select data-act="voice"></select></label>
      <span class="muted reader-tip">Tip: click any paragraph to start reading from there.</span></div>`;
    bar = mount.querySelector(".reader");
    const fillVoices = () => {
      const sel = bar.querySelector("[data-act=voice]"), vs = englishVoices(), cur = bestVoice();
      sel.innerHTML = vs.map((v) => `<option value="${v.name}"${cur && v.name === cur.name ? " selected" : ""}>${v.name.replace(/\s*\(.*?\)\s*/g, "")} (${v.lang})</option>`).join("") || "<option>Default voice</option>";
    };
    fillVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = fillVoices;
    bar.querySelector("[data-act=play]").addEventListener("click", toggle);
    bar.querySelector("[data-act=stop]").addEventListener("click", () => { stop(); idx = 0; });
    bar.querySelector("[data-act=rate]").addEventListener("change", (e) => { rate = Number(e.target.value); pref("rate", rate); if (playing && !paused) speak(idx); });
    bar.querySelector("[data-act=voice]").addEventListener("change", (e) => { voiceName = e.target.value; pref("voice", voiceName); if (playing && !paused) speak(idx); });
    queue.forEach((el, i) => el.addEventListener("click", (e) => { if (e.target.closest("a")) return; speak(i); }));
    update();
  }

  window.addEventListener("hashchange", stop);
  return { attach, stop };
})();
