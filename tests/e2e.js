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
  Swara.seq = function (notes, dur, gap, timbre) { window.__played.push(notes.slice()); window.__timbres.push(timbre || "harmonium"); return _seq.apply(this, arguments); };
  navigator.mediaDevices.getUserMedia = async function () {
    const c = Swara.ac(), dest = c.createMediaStreamDestination(), g = c.createGain();
    g.gain.value = 0.3; g.connect(dest);
    window.__oscs = [0.5, 0.25, 0.15, 0.08].map((a, i) => {
      const o = c.createOscillator(), gg = c.createGain(); o.frequency.value = 164.81 * (i + 1); gg.gain.value = a;
      o.connect(gg); gg.connect(g); o.start(); return o;
    });
    window.__sing = (hz) => window.__oscs.forEach((o, i) => (o.frequency.value = hz * (i + 1)));
    return dest.stream;
  };`;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["ok", name]); console.log("ok  ", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, "\n     ", e.message.split("\n")[0]); }
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

    await step("holding Sa for 3 seconds is recorded for the stage gate", async () => {
      await page.evaluate((hz) => window.__sing(hz), mtof(SA + 0.1));
      await page.click("#modeTune"); await page.waitForTimeout(3600);
      assert.ok((await state(page)).saHold[await page.evaluate(() => SRS.localToday())] >= 3);
    });

    await step("sing reviews score every target the singer hits and reschedule the cards", async () => {
      await page.click("#modeMatch");
      for (let i = 0; i < 6; i++) {
        await page.waitForFunction((n) => window.__played.length >= n, i + 1, { timeout: 5000 });
        const target = await page.evaluate(() => window.__played[window.__played.length - 1][1]);
        await page.evaluate((hz) => window.__sing(hz), mtof(target));
        await page.waitForFunction((n) => document.getElementById("tgEyebrow").textContent !== "Sing this · " + n + " of 6", i + 1, { timeout: 8000 });
      }
      assert.match(await page.textContent("#tgName"), /6 of 6 hit/);
      const st = await state(page);
      assert.equal(st.cards["sing:0"].box, 1); assert.equal(st.cards["sing:7"].box, 1);
    });

    await step("singing the wrong note is a miss, not a hit", async () => {
      await page.click("#modeMatch");
      await page.waitForFunction(() => document.getElementById("tgEyebrow").textContent.startsWith("Sing this · 1"));
      await page.evaluate((hz) => window.__sing(hz), mtof(SA + 3)); // komal Ga: never a stage-1 target
      await page.waitForFunction(() => /Missed/.test(document.getElementById("tgMsg").textContent), null, { timeout: 12000 });
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
        const notes = await page.evaluate(() => window.__played[window.__played.length - 1]);
        await page.click(`#answers button[data-a="${notes[1] - notes[0]}"]`);
        await page.click("#earNext");
      }
      const used = await page.evaluate(() => [...new Set(window.__timbres)]);
      assert.ok(used.length >= 3, "only " + used.join(", "));
    });

    await step("an ear session of right answers moves every due card up a box", async () => {
      await fresh();
      await page.click('[data-tab-btn="ear"]'); await page.click("#earStart");
      for (let i = 0; i < 15; i++) {
        const notes = await page.evaluate(() => window.__played[window.__played.length - 1]);
        const deg = notes[1] - notes[0];
        await page.click(`#answers button[data-a="${deg}"]`);
        await page.click("#earNext");
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
      const notes = await page.evaluate(() => window.__played[window.__played.length - 1]);
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
