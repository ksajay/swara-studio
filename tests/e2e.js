// End-to-end test: the built app (dist/) in real Chrome, with a synthetic singer as the microphone.
// Run: npm run test:e2e   (set CHROME_PATH to use an existing Chrome/Chromium binary)
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const path = require("node:path");

const PORT = 8790, BASE = `http://localhost:${PORT}/`;
const SA = 48, mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Replaces the microphone with oscillators we can retune, and records every note the app plays.
const HARNESS = `
  window.__played = [];
  const _seq = Swara.seq;
  window.__timbres = [];
  window.__questions = [];
  Swara.seq = function (notes, dur, gap, timbre) {
    window.__played.push(notes.slice()); window.__timbres.push(timbre || "harmonium");
    if (gap === 0.25) window.__questions.push(notes.slice()); // ear questions: Sa, then the mystery note
    return _seq.apply(this, arguments);
  };
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    window.__constraints = constraints;
    const c = Swara.ac(), dest = c.createMediaStreamDestination(), g = c.createGain();
    g.gain.value = 0.3; g.connect(dest);
    window.__oscs = [0.5, 0.25, 0.15, 0.08].map((a, i) => {
      const o = c.createOscillator(), gg = c.createGain(); o.frequency.value = 164.81 * (i + 1); gg.gain.value = a;
      o.connect(gg); gg.connect(g); o.start(); return o;
    });
    window.__sing = (hz) => window.__oscs.forEach((o, i) => (o.frequency.value = hz * (i + 1)));
    window.__gate = g;
    window.__singPhrase = (parts) => new Promise((res) => {
      let t = 0;
      parts.forEach(([hz, secs]) => { setTimeout(() => { g.gain.value = 0.3; window.__sing(hz); }, t * 1000); t += secs; });
      setTimeout(() => { g.gain.value = 0; res(); }, t * 1000);
    });
    window.__stream = dest.stream;
    return dest.stream;
  };`;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["ok", name]); console.log("ok  ", name); }
  catch (e) {
    results.push(["FAIL", name]); console.log("FAIL", name, "\n     ", e.message.split("\n")[0]);
    if (process.env.GITHUB_ACTIONS) console.log("::error title=e2e failed::" + name + " :: " + e.message.split("\n")[0].replace(/[\r\n%]/g, " "));
  }
}
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("swara-studio-v1")));

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: path.join(__dirname, "..", "dist"), stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fresh = async () => { await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.evaluate(HARNESS); await page.selectOption("#saSelect", String(SA)); };

  try {
    await step("installable: manifest, icons and offline worker are served", async () => {
      await page.goto(BASE);
      const m = await (await page.request.get(BASE + "manifest.webmanifest")).json();
      assert.equal(m.display, "standalone");
      for (const ic of m.icons) assert.equal((await page.request.get(BASE + ic.src)).status(), 200, ic.src);
      await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!r), null, { timeout: 5000 });
    });

    await step("live listening names a sung E3 as Ga when Sa is C3", async () => {
      await fresh();
      await page.click('[data-tab-btn="sing"]'); await page.click("#micBtn");
      await page.waitForFunction(() => document.getElementById("rdSwara").textContent.startsWith("Ga"), null, { timeout: 4000 });
      assert.match(await page.textContent("#rdSub"), /E3/);
    });

    await step("the microphone is opened with all voice processing off", async () => {
      assert.deepEqual(await page.evaluate(() => window.__constraints), { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    });

    await step("a steady note with tiny dropouts stays on screen the whole time", async () => {
      await page.evaluate((hz) => window.__sing(hz), mtof(SA + 4));
      await page.waitForFunction(() => document.getElementById("rdSwara").textContent.startsWith("Ga"));
      const blanks = await page.evaluate(() => new Promise((done) => {
        const g = window.__gate.gain, c = Swara.ac(); let blanks = 0, frames = 0;
        for (let k = 0; k < 10; k++) { const t = c.currentTime + 0.2 + k * 0.4; g.setValueAtTime(0, t); g.setValueAtTime(0.3, t + 0.06); }
        (function watch() {
          frames++; if (!document.getElementById("rdSwara").textContent.startsWith("Ga")) blanks++;
          if (frames < 260) requestAnimationFrame(watch); else done(blanks);
        })();
      }));
      assert.equal(blanks, 0, blanks + " frames blanked during a steady note");
    });

    await step("the input level meter moves when you sing and rests in silence", async () => {
      const singing = await page.evaluate(() => parseFloat(document.getElementById("micLevel").style.width) || 0);
      assert.ok(singing > 5, "level " + singing + "% while singing");
      await page.evaluate(() => { window.__gate.gain.value = 0; });
      await page.waitForTimeout(600);
      const quiet = await page.evaluate(() => parseFloat(document.getElementById("micLevel").style.width) || 0);
      assert.ok(quiet < 2, "level " + quiet + "% in silence");
      assert.match(await page.textContent("#rdSub"), /Sing/);
      await page.evaluate(() => { window.__gate.gain.value = 0.3; });
    });

    await step("the readout never changes size as notes come and go", async () => {
      const box = () => page.evaluate(() => {
        const r = document.querySelector(".readout").getBoundingClientRect(), l = document.getElementById("lane").getBoundingClientRect();
        return { h: Math.round(r.height * 10) / 10, laneTop: Math.round(l.top * 10) / 10, text: document.getElementById("rdSwara").textContent };
      });
      const seen = [];
      const sample = async (label) => { await page.waitForTimeout(350); const b = await box(); b.label = label; seen.push(b); };
      await page.evaluate(() => { window.__gate.gain.value = 0; }); await sample("silence");
      await page.evaluate((hz) => { window.__gate.gain.value = 0.3; window.__sing(hz); }, mtof(SA + 4)); await sample("Ga");
      await page.evaluate((hz) => window.__sing(hz), mtof(SA + 12)); await sample("taar Sa");
      await page.evaluate((hz) => window.__sing(hz), mtof(SA - 5)); await sample("mandra Pa");
      await page.evaluate(() => { window.__gate.gain.value = 0; }); await sample("silence again");
      await page.evaluate(() => { window.__gate.gain.value = 0.3; }); await sample("back on");
      const hs = new Set(seen.map((b) => b.h)), tops = new Set(seen.map((b) => b.laneTop));
      assert.ok(seen.some((b) => b.text.startsWith("Ga")) && seen.some((b) => b.text.startsWith("–")), "did not see both states: " + JSON.stringify(seen.map((b) => b.text)));
      assert.equal(hs.size, 1, "readout heights: " + seen.map((b) => b.label + " " + b.h).join(", "));
      assert.equal(tops.size, 1, "lane moved: " + seen.map((b) => b.label + " " + b.laneTop).join(", "));
    });

    await step("putting the app in the background stops listening, releases the mic and quiets the drone", async () => {
      await page.click("#droneBtn");
      assert.equal(await page.evaluate(() => Swara.droneOn()), true);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.textContent("#micBtn"), "Start listening");
      assert.ok(await page.evaluate(() => window.__stream.getTracks().every((t) => t.readyState === "ended")), "mic track still live");
      assert.equal(await page.evaluate(() => Swara.droneOn()), false);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(300);
      assert.equal(await page.textContent("#micBtn"), "Start listening", "does not restart the mic by itself");
      assert.match(await page.textContent("#micMsg"), /Paused/);
      await page.click("#micBtn");
      await page.waitForFunction(() => document.getElementById("micBtn").textContent === "Stop listening");
    });

    await step("Hold Sa shows a running timer toward 3 seconds and says why it reset", async () => {
      await page.evaluate((hz) => { window.__gate.gain.value = 0.3; window.__sing(hz); }, mtof(SA + 0.1));
      const panelH = () => page.evaluate(() => Math.round(document.getElementById("holdPanel").getBoundingClientRect().height));
      await page.click("#modeTune");
      const hs = [await panelH()];
      for (let k = 0; k < 6; k++) { await page.waitForTimeout(600); hs.push(await panelH()); }
      assert.match(await page.textContent("#holdTime"), /of 3\.0 s/);
      assert.ok((await state(page)).saHold[await page.evaluate(() => SRS.localToday())] >= 3);
      assert.match(await page.textContent("#holdMilestones"), /3 s ✓/);
      await page.evaluate((hz) => window.__sing(hz), mtof(SA + 0.45));
      await page.waitForFunction(() => /sharp/.test(document.getElementById("holdNote").textContent), null, { timeout: 3000 });
      hs.push(await panelH());
      assert.equal(new Set(hs).size, 1, "Hold Sa panel heights: " + hs.join(", "));
    });

    const phraseNow = () => page.evaluate(() => JSON.parse(document.getElementById("rvPhrase").dataset.phrase));
    const phaseIs = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("rvPhase").textContent), re.source, { timeout: 15000 });
    const singIt = async (centsOff = 0) => {
      const p = await phraseNow();
      await page.evaluate((parts) => window.__singPhrase(parts), p.map((n) => [mtof(n.midi + centsOff / 100), n.dur + 0.3]));
    };

    await step("sing reviews wait for you: nothing moves on while you are silent", async () => {
      await fresh();
      await page.click('[data-tab-btn="sing"]'); await page.click("#micBtn");
      await page.evaluate(() => { window.__gate.gain.value = 0; });
      await page.click("#modeMatch");
      await phaseIs(/Your turn/);
      await page.waitForTimeout(6000);
      assert.match(await page.textContent("#rvPhase"), /Your turn/);
      assert.match(await page.textContent("#rvCount"), /Review 1 of 6/);
      const st = await state(page);
      assert.ok(Object.keys(st.cards).filter((k) => k.startsWith("sing:")).every((k) => st.cards[k].seen === 0), "a card was graded");
    });

    await step("the app does not score its own reference note", async () => {
      await page.click("#rvHear");
      await page.waitForFunction(() => /Listen/.test(document.getElementById("rvPhase").textContent));
      const p = await phraseNow();
      await page.evaluate((hz) => { window.__gate.gain.value = 0.3; window.__sing(hz); }, mtof(p[p.length - 1].midi));
      await phaseIs(/Your turn/);
      await page.evaluate(() => { window.__gate.gain.value = 0; });
      await page.waitForTimeout(3000);
      assert.match(await page.textContent("#rvPhase"), /Your turn/);
    });

    await step("a sharp first try is explained; you retry until right; only the first try schedules the card", async () => {
      const target = await page.evaluate(() => JSON.parse(document.getElementById("rvPhrase").dataset.target));
      await singIt(50);
      await phaseIs(/Result/);
      assert.match(await page.textContent("#rvResult"), /sharp/);
      assert.equal(await page.isVisible("#rvRetry"), true);
      assert.ok(!(await page.getAttribute("#rvNext", "class") || "").includes("primary"), "Next should not be the main button yet");
      let st = await state(page);
      assert.equal(st.cards["sing:" + target].box, 1); assert.deepEqual(st.recent.sing, [0]);
      await page.click("#rvRetry");
      await phaseIs(/Your turn/);
      await singIt(0);
      await phaseIs(/Result/);
      assert.match(await page.textContent("#rvResult"), /✓/);
      assert.ok((await page.getAttribute("#rvNext", "class")).includes("primary"));
      assert.match(await page.textContent("#rvCount"), /Review 1 of 6 · try 2/);
      st = await state(page);
      assert.equal(st.cards["sing:" + target].box, 1, "a retry does not reschedule");
      assert.deepEqual(st.recent.sing, [0], "a retry does not count toward unlocking");
    });

    await step("a right first try moves the card up, and the next review waits for you to tap Next", async () => {
      await page.waitForTimeout(2500);
      assert.match(await page.textContent("#rvCount"), /Review 1 of 6/, "moved on by itself");
      await page.click("#rvNext");
      await phaseIs(/Listen|Your turn/);
      assert.match(await page.textContent("#rvCount"), /Review 2 of 6 · try 1/);
      const target = await page.evaluate(() => JSON.parse(document.getElementById("rvPhrase").dataset.target));
      const before = (await state(page)).cards["sing:" + target];
      await phaseIs(/Your turn/);
      await singIt(0);
      await phaseIs(/Result/);
      const after = (await state(page)).cards["sing:" + target];
      if (before.due <= await page.evaluate(() => SRS.localToday())) assert.equal(after.box, before.box + 1);
      assert.match(await page.textContent("#rvResult"), /✓/);
    });

    await step("the Sa picker shows your whole scale, and it follows a new Sa", async () => {
      await fresh();
      await page.evaluate(() => { document.getElementById("saPanel").hidden = false; });
      assert.match(await page.textContent("#saSelect option:checked"), /^Sa = C3/);
      const strip = await page.textContent("#saScale");
      for (const bit of ["Sa", "C3", "Re", "D3", "Ga", "E3", "Ni", "B3"]) assert.ok(strip.includes(bit), "missing " + bit);
      await page.selectOption("#saSelect", "50");
      assert.ok((await page.textContent("#saScale")).includes("F♯3"), "Ga should be F-sharp 3 when Sa is D3");
      assert.ok((await page.textContent("#todayScale")).includes("F♯3"), "Today shows the same scale");
      await page.selectOption("#saSelect", String(SA));
    });

    await step("the drone's first string can be set to Ma or Ni, and the choice is kept", async () => {
      await fresh();
      await page.evaluate(() => { document.getElementById("saPanel").hidden = false; });
      await page.selectOption("#droneFirst", "Ma");
      await page.click('[data-tab-btn="sing"]'); await page.click("#droneBtn");
      const cfg = await page.evaluate(() => Swara.droneConfig());
      assert.equal(cfg.first, "Ma"); assert.equal(cfg.strings[0].name, "Ma");
      assert.equal((await state(page)).droneFirst, "Ma");
      await page.click("#droneBtn");
      await page.reload();
      assert.equal(await page.inputValue("#droneFirst"), "Ma", "choice survives a reload");
    });

    await step("an ear round mixes at least three instrument sounds", async () => {
      await fresh();
      await page.click('[data-tab-btn="ear"]'); await page.click("#earStart");
      for (let i = 0; i < 15; i++) {
        const notes = await page.evaluate(() => window.__questions[window.__questions.length - 1]);
        await page.click(`#answers button[data-a="${notes[1] - notes[0]}"]`);
        await page.click("#earNext");
        await page.waitForFunction((k) => window.__questions.length > k || /done/i.test(document.getElementById("earCount").textContent), i + 1);
      }
      const used = await page.evaluate(() => [...new Set(window.__timbres)]);
      assert.ok(used.length >= 3, "only " + used.join(", "));
    });

    await step("an ear session of right answers moves every due card up a box", async () => {
      await fresh();
      await page.click('[data-tab-btn="ear"]'); await page.click("#earStart");
      for (let i = 0; i < 15; i++) {
        const notes = await page.evaluate(() => window.__questions[window.__questions.length - 1]);
        const deg = notes[1] - notes[0];
        await page.click(`#answers button[data-a="${deg}"]`);
        await page.click("#earNext");
        await page.waitForFunction((k) => window.__questions.length > k || /done/i.test(document.getElementById("earCount").textContent), i + 1);
      }
      assert.match(await page.textContent("#earFb"), /15 of 15 right/);
      const st = await state(page);
      assert.equal(st.cards["ear:0"].box, 1); assert.equal(st.cards["ear:7"].box, 1);
      assert.equal(st.recent.ear.length, 15, "every ordinary question counts toward unlocking");
    });

    await step("meeting the unlock rule adds Ga to the ear deck", async () => {
      await page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem("swara-studio-v1")), t = SRS.localToday();
        st.cards["ear:0"] = { box: 2, due: t, seen: 9, right: 9 }; st.cards["ear:7"] = { box: 2, due: t, seen: 9, right: 9 };
        st.recent.ear = Array(19).fill(1); st.updated = Date.now();
        localStorage.setItem("swara-studio-v1", JSON.stringify(st));
      });
      await page.reload(); await page.evaluate(HARNESS);
      await page.click('[data-tab-btn="ear"]'); await page.click("#earStart");
      const notes = await page.evaluate(() => window.__questions[window.__questions.length - 1]);
      await page.click(`#answers button[data-a="${notes[1] - notes[0]}"]`);
      await page.waitForFunction(() => /Unlocked: Ga/.test(document.getElementById("toast").textContent), null, { timeout: 3000 });
      assert.equal((await state(page)).stage, 1);
    });

    await step("a backup from another device merges in without losing newer reviews", async () => {
      const before = await state(page);
      const other = JSON.parse(JSON.stringify(before));
      other.cards["ear:4"] = { box: 4, due: "2099-01-01", seen: 20, right: 19, last: "2099-01-01" };
      other.gates = { "s1-hum": true }; other.updated = 1;
      const text = await page.evaluate((o) => SRS.backupText(o, SRS.localToday()), other);
      await page.click('[data-tab-btn="progress"]'); await page.click("#showRestore");
      await page.fill("#restoreText", text); await page.click("#doRestore");
      const st = await state(page);
      assert.equal(st.cards["ear:4"].box, 4); assert.equal(st.stage, before.stage); assert.equal(st.gates["s1-hum"], true);
    });

    await step("the installed app opens offline", async () => {
      await page.goto(BASE); await page.waitForTimeout(500);
      await ctx.setOffline(true);
      await page.reload();
      assert.match(await page.textContent(".brand"), /Swara Studio/);
      await page.goto(BASE + "reference/note-map.html");
      assert.match(await page.textContent("h1"), /Note map/);
      await ctx.setOffline(false);
    });

    await step("every page fits a 360px phone without sideways scrolling", async () => {
      for (const u of ["", "lessons/0001-find-your-sa.html", "reference/note-map.html", "reference/memory-hacks.html"]) {
        await page.goto(BASE + u);
        for (const t of u ? [null] : ["today", "sing", "ear", "progress", "learn"]) {
          if (t) await page.click(`[data-tab-btn="${t}"]`);
          const w = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(w <= 360, `${u || "app"} ${t || ""} is ${w}px wide`);
        }
      }
    });

    await step("lesson quiz gives instant feedback", async () => {
      await page.goto(BASE + "lessons/0001-find-your-sa.html");
      await page.click(".quiz .q:first-child .opts button:first-child");
      assert.match(await page.textContent(".quiz .q:first-child .why"), /^Right/);
    });

    await step("no script errors on any page", async () => { assert.deepEqual(errors, []); });
  } finally {
    await browser.close(); server.kill();
  }
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
