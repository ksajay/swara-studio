// Spec for call-and-response singing (assets/sing.js): phrases, curve matching, phases, Hold Sa.
const test = require("node:test");
const assert = require("node:assert/strict");
const Sing = require("../assets/sing.js");

const SA = 48, FPS = 60;
// Sung frames for a list of [midi offset from Sa, seconds], starting at t0, with optional cents error.
function sung(parts, opts = {}) {
  const out = []; let t = opts.t0 || 0;
  for (const [deg, secs, cents = 0] of parts) {
    const n = Math.round(secs * FPS);
    for (let i = 0; i < n; i++) { out.push({ t, m: deg == null ? null : SA + deg + cents / 100 }); t += 1 / FPS; }
  }
  return out;
}

/* ---------- Phrases ---------- */
test("a new card is a single held note; it grows to Sa-to-note, then three-note shapes", () => {
  const unlocked = [0, 2, 4, 7];
  const p0 = Sing.buildPhrase(4, unlocked, 0, () => 0.3);
  assert.deepEqual(p0.notes.map((n) => n.deg), [4]);
  assert.ok(p0.notes[0].dur >= 2);
  const p1 = Sing.buildPhrase(4, unlocked, 1, () => 0.3);
  assert.deepEqual(p1.notes.map((n) => n.deg), [0, 4]);
  const p3 = Sing.buildPhrase(4, unlocked, 3, () => 0.3);
  assert.equal(p3.notes.length, 3);
  assert.ok(p3.notes.some((n) => n.deg === 4), "the target is in the phrase");
  for (const n of p3.notes) assert.ok(unlocked.includes(n.deg), "only notes you have unlocked");
  assert.ok(Math.abs(p3.total - p3.notes.reduce((a, n) => a + n.dur, 0)) < 1e-9);
});

test("Sa's own phrases still make sense", () => {
  assert.deepEqual(Sing.buildPhrase(0, [0, 7], 0, Math.random).notes.map((n) => n.deg), [0]);
  const p = Sing.buildPhrase(0, [0, 7], 2, Math.random).notes.map((n) => n.deg);
  assert.ok(p.includes(0) && p.length >= 2);
});

test("the rule for a hit is the same for every note and is stated", () => {
  assert.equal(Sing.HOLD_SECS, 0.8);
  assert.equal(Sing.TOL_CENTS, 35);
  assert.match(Sing.RULE_TEXT, /0\.8/);
});

/* ---------- Curve matching ---------- */
const phrase = { notes: [{ deg: 0, dur: 1.2 }, { deg: 4, dur: 1.2 }], total: 2.4 };

test("singing the phrase as heard passes, note by note", () => {
  const r = Sing.scoreAttempt(phrase, sung([[0, 1.2], [4, 1.2]]), SA);
  assert.equal(r.passed, true);
  assert.deepEqual(r.notes.map((n) => n.verdict), ["ok", "ok"]);
});

test("singing slower, later, or scooping into each note still passes", () => {
  assert.equal(Sing.scoreAttempt(phrase, sung([[0, 1.8], [4, 1.8]], { t0: 1.3 }), SA).passed, true);
  assert.equal(Sing.scoreAttempt(phrase, sung([[0, 0.2, -80], [0, 1.0], [4, 0.2, -90], [4, 1.0]]), SA).passed, true);
});

test("a note held 50 cents sharp is reported as sharp, with how far", () => {
  const r = Sing.scoreAttempt(phrase, sung([[0, 1.2], [4, 1.2, 50]]), SA);
  assert.equal(r.passed, false);
  assert.equal(r.notes[0].verdict, "ok");
  assert.equal(r.notes[1].verdict, "sharp");
  assert.ok(Math.abs(r.notes[1].cents - 50) < 5);
});

test("a flat note is reported as flat", () => {
  const r = Sing.scoreAttempt(phrase, sung([[0, 1.2, -45], [4, 1.2]]), SA);
  assert.equal(r.notes[0].verdict, "flat");
});

test("too short in the green does not count, even if on pitch", () => {
  const r = Sing.scoreAttempt(phrase, sung([[0, 1.2], [4, 0.4]]), SA);
  assert.equal(r.notes[1].verdict, "short");
  assert.equal(r.passed, false);
});

test("skipping a note, singing the wrong order, or silence all fail", () => {
  assert.equal(Sing.scoreAttempt(phrase, sung([[0, 2.4]]), SA).notes[1].verdict, "missing");
  assert.equal(Sing.scoreAttempt(phrase, sung([[4, 1.2], [0, 1.2]]), SA).passed, false);
  const silent = Sing.scoreAttempt(phrase, sung([[null, 3]]), SA);
  assert.deepEqual(silent.notes.map((n) => n.verdict), ["missing", "missing"]);
});

test("a single held note passes on time in the green, not on perfection", () => {
  const one = { notes: [{ deg: 7, dur: 2 }], total: 2 };
  assert.equal(Sing.scoreAttempt(one, sung([[7, 0.3, 60], [7, 0.9], [7, 0.3, 60]]), SA).passed, true);
});

/* ---------- Phases: listen, your turn, result ---------- */
function drill() { return Sing.createDrill(phrase, SA); }
function feed(d, frames) { for (const f of frames) d.frame(f.t, f.m); }

test("starts by listening, and ignores everything the mic hears while the phrase plays", () => {
  const d = drill();
  assert.equal(d.phase(), "listen");
  feed(d, sung([[0, 1.2], [4, 1.2]], { t0: 0 }));
  assert.equal(d.phase(), "listen");
  assert.equal(d.frames().length, 0);
});

test("after the phrase plays it waits for you, forever if need be", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[null, 60]], { t0: 2.5 }));
  assert.equal(d.phase(), "wait");
  assert.equal(d.result(), null);
});

test("the speaker's echo right after playback is ignored", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[4, 0.2]], { t0: 2.5 }));
  assert.equal(d.phase(), "wait");
});

test("your turn starts when you start singing, and ends when you stop", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[null, 2], [0, 1.2], [4, 1.2], [null, 1.0]], { t0: 2.5 }));
  assert.equal(d.phase(), "result");
  assert.equal(d.result().passed, true);
});

test("your turn also ends if you keep singing well past the phrase", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[0, 1.2], [4, 6]], { t0: 3 }));
  assert.equal(d.phase(), "result");
});

test("a short breath between notes does not end your turn", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[0, 1.2], [null, 0.4]], { t0: 3 }));
  assert.equal(d.phase(), "sing");
});

test("live progress lights up a note as soon as it has been held in the green", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[0, 1.0]], { t0: 3 }));
  assert.deepEqual(d.live().map((n) => n.done), [true, false]);
});

test("try again starts a fresh attempt and counts attempts", () => {
  const d = drill(); d.playbackDone(2.5);
  feed(d, sung([[0, 1.2], [4, 1.2, 60], [null, 1]], { t0: 3 }));
  assert.equal(d.result().passed, false);
  assert.equal(d.attempts(), 1);
  d.retry();
  assert.equal(d.phase(), "listen");
  assert.equal(d.result(), null);
  d.playbackDone(10);
  feed(d, sung([[0, 1.2], [4, 1.2], [null, 1]], { t0: 10.5 }));
  assert.equal(d.result().passed, true);
  assert.equal(d.attempts(), 2);
});

/* ---------- Hold Sa ---------- */
test("Hold Sa counts up while in the green and marks 1, 2 and 3 second milestones", () => {
  const h = Sing.createHoldMeter({ tol: 25, goal: 3 });
  let s; for (const f of sung([[0, 3.2, 10]])) s = h.frame(f.t, f.m, SA);
  assert.ok(s.run >= 3.1 && s.best >= 3.1);
  assert.equal(s.milestone, 3);
  assert.equal(s.done, true);
});

test("a tiny wobble out of the green does not reset the timer", () => {
  const h = Sing.createHoldMeter({ tol: 25, goal: 3 });
  let s; for (const f of sung([[0, 1.5], [0, 0.1, 40], [0, 1.0]])) s = h.frame(f.t, f.m, SA);
  assert.ok(s.run > 2.5, "run " + s.run);
});

test("drifting sharp resets the timer and says why and when", () => {
  const h = Sing.createHoldMeter({ tol: 25, goal: 3 });
  let s, reset = null;
  for (const f of sung([[0, 1.2], [0, 0.5, 45]])) { s = h.frame(f.t, f.m, SA); if (s.reset) reset = s.reset; }
  assert.equal(s.run, 0);
  assert.equal(reset.why, "sharp");
  assert.ok(Math.abs(reset.after - 1.2) < 0.1, "after " + reset.after);
  assert.ok(s.best >= 1.1);
});

test("stopping singing resets with 'stopped', and best is kept", () => {
  const h = Sing.createHoldMeter({ tol: 25, goal: 3 });
  let s, reset = null;
  for (const f of sung([[0, 2.1], [null, 0.5]])) { s = h.frame(f.t, f.m, SA); if (s.reset) reset = s.reset; }
  assert.equal(reset.why, "stopped");
  assert.equal(s.milestone, 2);
});

test("an uploaded recording is scored as one attempt, in any phase", () => {
  const d = drill();
  d.submit(sung([[0, 1.2], [4, 1.2]], { t0: 0 }));
  assert.equal(d.phase(), "result");
  assert.equal(d.result().passed, true);
  assert.equal(d.attempts(), 1);
});
