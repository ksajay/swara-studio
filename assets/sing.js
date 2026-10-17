/* Swara Studio call-and-response singing.
   Pure logic, tested in tests/sing.test.js:
   - buildPhrase: what to sing, growing from one held note to three-note shapes
   - scoreAttempt: match a sung pitch curve to the target notes, note by note
   - createDrill: the listen -> wait -> sing -> result phases, with retries
   - createHoldMeter: the Hold Sa timer with milestones and reset reasons
   Works in the browser (window.Sing) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HOLD_SECS = 0.8, TOL_CENTS = 35;
  var RULE_TEXT = "Sing the whole phrase on \"aa\". A note counts once you hold it in the green (within 35 cents) for 0.8 s. Take your time: it waits for you.";
  var NOTE_DUR = 1.2, HELD_DUR = 2.0, SKIP = 1.2, END_SILENCE = 0.8, ECHO_GUARD = 0.3, OVERRUN = 2.0;

  // Cents from m to the nearest octave copy of target, -600..+600.
  function pc(m, target) { var d = (m - target) * 100; return ((d % 1200) + 1800) % 1200 - 600; }

  /* ---------- Phrases ---------- */
  // level 0: one held note; 1-2: Sa to the note; 3+: three-note shapes through a neighbour.
  function buildPhrase(target, unlocked, level, rand) {
    rand = rand || Math.random;
    var degs;
    if (level <= 0) degs = [target];
    else if (level <= 2) degs = target === 0 ? [7, 0] : [0, target];
    else if (target === 0) degs = [0, 7, 0];
    else {
      var between = unlocked.filter(function (d) { return d > 0 && d < target; });
      if (!between.length) degs = [0, target, 0];
      else {
        var mid = target / 2, nb = between.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid); })[0];
        degs = rand() < 0.5 ? [0, nb, target] : [target, nb, 0];
      }
    }
    var dur = degs.length === 1 ? HELD_DUR : NOTE_DUR;
    var notes = degs.map(function (d) { return { deg: d, dur: dur }; });
    return { notes: notes, total: notes.length * dur };
  }
  function levelForBox(box) { return box <= 0 ? 0 : box <= 2 ? 1 : 3; }

  /* ---------- Curve matching ---------- */
  // Order-preserving alignment of sung frames to the phrase's notes (a small dynamic-time-warping
  // pass), so timing can stretch freely but the notes must come in order. Frames far from every
  // note (scoops, breaths) cost a flat penalty instead of distorting the match.
  function scoreAttempt(phrase, frames, saMidi) {
    var K = phrase.notes.length;
    var voiced = frames.filter(function (f) { return f.m != null; }).sort(function (a, b) { return a.t - b.t; });
    var empty = function () { return { deg: 0, verdict: "missing", inTune: 0, heard: 0, cents: null }; };
    if (!voiced.length) {
      return { passed: false, notes: phrase.notes.map(function (n) { var e = empty(); e.deg = n.deg; return e; }) };
    }
    var N = voiced.length, w = [], i, k;
    for (i = 0; i < N; i++) {
      var dt = i + 1 < N ? voiced[i + 1].t - voiced[i].t : (i > 0 ? voiced[i].t - voiced[i - 1].t : 1 / 60);
      w.push(Math.min(0.1, Math.max(0, dt)));
    }
    var cents = voiced.map(function (f) { return phrase.notes.map(function (n) { return pc(f.m, saMidi + n.deg); }); });
    var cost = function (f, kk) { return Math.min(Math.abs(cents[f][kk]) / 100, SKIP); };
    var INF = 1e18, dp = [], from = [];
    for (i = 0; i < N; i++) { dp.push(new Float64Array(K).fill(INF)); from.push(new Int8Array(K)); }
    dp[0][0] = cost(0, 0);
    for (i = 1; i < N; i++) {
      for (k = 0; k < K; k++) {
        var stay = dp[i - 1][k], step = k > 0 ? dp[i - 1][k - 1] : INF;
        if (stay <= step) { dp[i][k] = stay + cost(i, k); from[i][k] = 0; }
        else { dp[i][k] = step + cost(i, k); from[i][k] = 1; }
      }
    }
    var assign = new Array(N), endK = K - 1;
    while (endK > 0 && dp[N - 1][endK] >= INF) endK--;
    for (i = N - 1, k = endK; i >= 0; i--) { assign[i] = k; if (i > 0 && from[i][k] === 1) k--; }
    var notes = phrase.notes.map(function (n, kk) {
      var inTune = 0, heard = 0, sum = 0, cnt = 0;
      for (var f = 0; f < N; f++) {
        if (assign[f] !== kk) continue;
        var c = cents[f][kk];
        if (Math.abs(c) <= 150) { heard += w[f]; sum += c; cnt++; }
        if (Math.abs(c) <= TOL_CENTS) inTune += w[f];
      }
      var mean = cnt ? sum / cnt : null, verdict;
      if (inTune >= HOLD_SECS - 1e-9) verdict = "ok";
      else if (heard < 0.3) verdict = "missing";
      else if (Math.abs(mean) <= TOL_CENTS) verdict = "short";
      else verdict = mean < 0 ? "flat" : "sharp";
      return { deg: n.deg, verdict: verdict, inTune: inTune, heard: heard, cents: mean == null ? null : Math.round(mean) };
    });
    return { passed: notes.every(function (n) { return n.verdict === "ok"; }), notes: notes };
  }

  /* ---------- Phases ---------- */
  function createDrill(phrase, saMidi) {
    var phase = "listen", frames = [], res = null, attempts = 0, guardUntil = 0, onset = 0, lastVoiced = 0, voicedSecs = 0, lastT = null;
    function finish() { res = scoreAttempt(phrase, frames, saMidi); attempts++; phase = "result"; }
    return {
      phase: function () { return phase; },
      frames: function () { return frames.slice(); },
      result: function () { return res; },
      attempts: function () { return attempts; },
      phrase: function () { return phrase; },
      elapsed: function () { return phase === "sing" && lastT != null ? lastT - onset : 0; },
      playbackDone: function (t) { if (phase === "listen") { phase = "wait"; guardUntil = t + ECHO_GUARD; } },
      frame: function (t, m) {
        if (phase === "wait") {
          if (t < guardUntil || m == null) return;
          phase = "sing"; onset = t; lastVoiced = t; voicedSecs = 0; lastT = t; frames.push({ t: t, m: m }); return;
        }
        if (phase !== "sing") return;
        var dt = lastT == null ? 0 : Math.min(0.1, t - lastT); lastT = t;
        frames.push({ t: t, m: m });
        if (m != null) { lastVoiced = t; voicedSecs += dt; }
        if ((m == null && t - lastVoiced >= END_SILENCE && voicedSecs >= 0.3) || t - onset >= phrase.total + OVERRUN) finish();
      },
      live: function () {
        if (phase !== "sing" && phase !== "result") return phrase.notes.map(function (n) { return { deg: n.deg, done: false }; });
        var r = res || scoreAttempt(phrase, frames, saMidi);
        return r.notes.map(function (n) { return { deg: n.deg, done: n.verdict === "ok", verdict: n.verdict }; });
      },
      stop: function () { if (phase === "sing") finish(); },
      submit: function (recorded) { frames = recorded.slice(); finish(); },
      retry: function () { phase = "listen"; frames = []; res = null; lastT = null; }
    };
  }

  /* ---------- Hold Sa ---------- */
  function createHoldMeter(opts) {
    opts = opts || {};
    var tol = opts.tol || 25, goal = opts.goal || 3, GRACE = 0.15;
    var run = 0, best = 0, lastT = null, outSince = null, runAtLeave = 0;
    return {
      frame: function (t, m, saMidi) {
        var dt = lastT == null ? 0 : Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
        var c = m == null ? null : pc(m, saMidi), inside = c != null && Math.abs(c) <= tol, reset = null;
        if (inside) {
          outSince = null; run += dt; if (run > best) best = run;
        } else if (run > 0) {
          if (outSince == null) { outSince = t; runAtLeave = run; }
          if (t - outSince > GRACE) {
            reset = { why: m == null ? "stopped" : c > 0 ? "sharp" : "flat", after: Math.round(runAtLeave * 10) / 10 };
            run = 0; outSince = null;
          } else run += dt;
        }
        return { run: run, best: best, goal: goal, milestone: Math.floor(Math.min(best, goal) + 1e-9), done: best >= goal, inside: inside, cents: c, reset: reset };
      },
      reset: function () { run = 0; best = 0; lastT = null; outSince = null; }
    };
  }

  return {
    HOLD_SECS: HOLD_SECS, TOL_CENTS: TOL_CENTS, RULE_TEXT: RULE_TEXT,
    buildPhrase: buildPhrase, levelForBox: levelForBox, scoreAttempt: scoreAttempt,
    createDrill: createDrill, createHoldMeter: createHoldMeter
  };
});
