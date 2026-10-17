/* Swara Studio scheduler: spaced repetition, stage unlocks, daily log, streaks and device merging.
   Pure functions over a plain state object, so the rules can be unit-tested (tests/srs.test.js).
   Works in the browser (window.SRS) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SRS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Ear and Sing decks grow together through these sets of scale degrees (semitones above Sa).
  var STAGES = [
    { name: "Home and fifth", degs: [0, 7], cur: 1 },
    { name: "Add Ga", degs: [0, 4, 7], cur: 1 },
    { name: "Add Re", degs: [0, 2, 4, 7], cur: 2 },
    { name: "Add Ma", degs: [0, 2, 4, 5, 7], cur: 2 },
    { name: "Add Dha", degs: [0, 2, 4, 5, 7, 9], cur: 2 },
    { name: "Add Ni: the full scale", degs: [0, 2, 4, 5, 7, 9, 11], cur: 2 },
    { name: "Komal Ga and komal Ni", degs: [0, 2, 3, 4, 5, 7, 9, 10, 11], cur: 3 },
    { name: "Komal Re and komal Dha", degs: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11], cur: 3 },
    { name: "Tivra Ma: all twelve", degs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], cur: 3 }
  ];
  // Side quest (no Sa): pitch classes from C, added a few at a time.
  var AP_STAGES = [[0, 7], [0, 4, 7], [0, 4, 7, 9], [0, 2, 4, 7, 9], [0, 2, 4, 5, 7, 9], [0, 2, 4, 5, 7, 9, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
  var INTERVALS = [0, 1, 2, 4, 7, 14]; // days until the next review, by box
  var DECKS = ["ear", "sing", "ap"];
  var RECENT_MAX = 20, UNLOCK_ACC = 0.85, UNLOCK_BOX = 2;

  /* ---------- Dates (YYYY-MM-DD, calendar arithmetic in UTC so DST never shifts a day) ---------- */
  function parse(s) { var p = s.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function fmt(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(s, n) { return fmt(parse(s) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function localToday(d) { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  /* ---------- State ---------- */
  function newState() {
    return { v: 1, updated: 0, saMidi: 48, saSet: false, stage: 0, apStage: 0, cards: {}, recent: { ear: [], sing: [], ap: [] }, days: {}, saHold: {}, gates: {}, singErr: [], droneFirst: "Pa" };
  }
  function normalise(raw) {
    var st = Object.assign(newState(), raw || {});
    st.recent = Object.assign({ ear: [], sing: [], ap: [] }, st.recent || {});
    st.cards = st.cards || {}; st.days = st.days || {}; st.saHold = st.saHold || {}; st.gates = st.gates || {}; st.singErr = st.singErr || [];
    return st;
  }
  function deckItems(st, deck) {
    return deck === "ap" ? AP_STAGES[Math.min(st.apStage, AP_STAGES.length - 1)] : STAGES[Math.min(st.stage, STAGES.length - 1)].degs;
  }
  function key(deck, item) { return deck + ":" + item; }
  function getCard(st, deck, item, today) {
    var k = key(deck, item);
    if (!st.cards[k]) st.cards[k] = { box: 0, due: today, seen: 0, right: 0 };
    return st.cards[k];
  }
  function ensureCards(st, today) {
    DECKS.forEach(function (d) { deckItems(st, d).forEach(function (i) { getCard(st, d, i, today); }); });
  }
  function dueItems(st, deck, today) {
    return deckItems(st, deck).filter(function (i) { return getCard(st, deck, i, today).due <= today; });
  }
  function accuracy(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }

  /* ---------- Grading ---------- */
  // opts.first: the card's first answer this session; only that one reschedules it.
  // opts.retry: the immediate re-ask after a miss; it never counts toward unlocking.
  function recordAnswer(st, deck, item, ok, opts) {
    var today = opts.today, c = getCard(st, deck, item, today);
    c.seen++; if (ok) c.right++; c.last = today;
    if (opts.first) {
      if (!ok) { c.box = 1; c.due = addDays(today, 1); }
      else if (c.due <= today) { c.box = Math.min(5, c.box + 1); c.due = addDays(today, INTERVALS[c.box]); }
    }
    if (!opts.retry) { var r = st.recent[deck]; r.push(ok ? 1 : 0); while (r.length > RECENT_MAX) r.shift(); }
    var d = st.days[today] || (st.days[today] = { ear: [0, 0], sing: [0, 0], ap: [0, 0] });
    d[deck][0]++; if (ok) d[deck][1]++;
    return { unlocked: checkPromotion(st, deck, today) };
  }

  function checkPromotion(st, deck, today) {
    if (deck === "sing") return [];
    var isAp = deck === "ap", level = isAp ? st.apStage : st.stage, max = isAp ? AP_STAGES.length - 1 : STAGES.length - 1;
    if (level >= max || st.recent[deck].length < RECENT_MAX || accuracy(st.recent[deck]) < UNLOCK_ACC) return [];
    var before = deckItems(st, deck);
    var ready = before.every(function (i) { return getCard(st, deck, i, today).box >= UNLOCK_BOX; });
    if (!ready) return [];
    if (isAp) st.apStage++; else st.stage++;
    st.recent[deck] = [];
    ensureCards(st, today);
    return deckItems(st, deck).filter(function (i) { return before.indexOf(i) < 0; });
  }

  /* ---------- Queues ---------- */
  // Due cards first (weakest first), topped up with the weakest other cards, then interleaved
  // so the same note never comes twice in a row.
  function buildQueue(st, deck, n, today, rand) {
    rand = rand || Math.random;
    var items = deckItems(st, deck);
    if (!items.length || n <= 0) return [];
    var byBox = function (a, b) { return getCard(st, deck, a, today).box - getCard(st, deck, b, today).box; };
    var picked = dueItems(st, deck, today).sort(byBox).slice(0, n);
    var rest = items.slice().sort(byBox), i = 0;
    while (picked.length < n) { picked.push(rest[i % rest.length]); i++; }
    var counts = {};
    picked.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    // After placing c, the remaining L notes can avoid repeats only if c has at most floor(L/2)
    // copies left and every other note at most ceil(L/2).
    var feasible = function (c, L) {
      return Object.keys(counts).every(function (k) {
        var n = counts[k] - (+k === c ? 1 : 0);
        return +k === c ? n <= Math.floor(L / 2) : n <= Math.ceil(L / 2);
      });
    };
    var out = [], last = null, left = picked.length;
    while (left > 0) {
      var keys = Object.keys(counts).filter(function (k) { return counts[k] > 0; }).map(Number);
      var cand = keys.filter(function (k) { return k !== last; });
      if (!cand.length) cand = keys; // a single-note deck: a repeat cannot be avoided
      var safe = cand.filter(function (k) { return feasible(k, left - 1); });
      if (safe.length) cand = safe;
      var pick = cand[Math.floor(rand() * cand.length) % cand.length];
      out.push(pick); counts[pick]--; left--; last = pick;
    }
    return out;
  }

  // Spread n questions evenly over the timbres, in a fresh random order each round.
  function planTimbres(n, list, rand) {
    rand = rand || Math.random;
    var off = Math.floor(rand() * list.length), out = [];
    for (var i = 0; i < n; i++) out.push(list[(i + off) % list.length]);
    for (var j = out.length - 1; j > 0; j--) { var k = Math.floor(rand() * (j + 1)); var t = out[j]; out[j] = out[k]; out[k] = t; }
    return out;
  }

  /* ---------- Progress ---------- */
  function practised(st, d) { var x = st.days[d]; return !!x && (x.ear[0] + x.sing[0] + x.ap[0]) > 0; }
  function streak(st, today) {
    var n = 0, d = practised(st, today) ? today : addDays(today, -1);
    while (practised(st, d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function holdDays(st) { return Object.keys(st.saHold).filter(function (k) { return st.saHold[k] >= 3; }).length; }
  function mastered(st) { return Object.keys(st.cards).filter(function (k) { return st.cards[k].box >= 3; }).length; }

  /* ---------- Two devices ---------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function newerCard(a, b) {
    if (!a) return b; if (!b) return a;
    var la = a.last || "", lb = b.last || "";
    if (la !== lb) return la > lb ? a : b;
    return (a.seen || 0) >= (b.seen || 0) ? a : b;
  }
  function mergeStates(a, b) {
    a = normalise(a); b = normalise(b);
    var newer = (a.updated || 0) >= (b.updated || 0) ? a : b, older = newer === a ? b : a;
    var m = clone(newer);
    Object.keys(older.cards).forEach(function (k) { m.cards[k] = clone(newerCard(newer.cards[k], older.cards[k])); });
    m.stage = Math.max(a.stage, b.stage); m.apStage = Math.max(a.apStage, b.apStage);
    Object.keys(older.days).forEach(function (d) {
      var x = m.days[d] || { ear: [0, 0], sing: [0, 0], ap: [0, 0] }, y = older.days[d];
      DECKS.forEach(function (k) { var p = x[k] || [0, 0], q = y[k] || [0, 0]; x[k] = q[0] > p[0] ? q.slice() : p.slice(); });
      m.days[d] = x;
    });
    Object.keys(older.saHold).forEach(function (d) { m.saHold[d] = Math.max(m.saHold[d] || 0, older.saHold[d]); });
    Object.keys(older.gates).forEach(function (g) { m.gates[g] = !!(m.gates[g] || older.gates[g]); });
    m.saSet = a.saSet || b.saSet;
    m.updated = Math.max(a.updated || 0, b.updated || 0);
    return m;
  }

  /* ---------- Backups ---------- */
  var BACKUP_HEAD = "Swara Studio progress backup";
  function backupText(st, today) {
    return BACKUP_HEAD + " (" + today + "). Claude: review this, update my learning records and make my next lesson.\n" + JSON.stringify(st);
  }
  function parseBackup(text) {
    var i = String(text).indexOf("{");
    if (i < 0) throw new Error("No backup found in that text.");
    var data = JSON.parse(String(text).slice(i));
    if (!data || typeof data !== "object" || typeof data.cards !== "object") throw new Error("That is not a Swara Studio backup.");
    return normalise(data);
  }

  return {
    STAGES: STAGES, AP_STAGES: AP_STAGES, INTERVALS: INTERVALS,
    addDays: addDays, daysBetween: daysBetween, localToday: localToday,
    newState: newState, normalise: normalise, deckItems: deckItems, key: key, getCard: getCard, ensureCards: ensureCards,
    dueItems: dueItems, accuracy: accuracy, recordAnswer: recordAnswer, checkPromotion: checkPromotion,
    buildQueue: buildQueue, planTimbres: planTimbres, streak: streak, holdDays: holdDays, mastered: mastered,
    mergeStates: mergeStates, backupText: backupText, parseBackup: parseBackup
  };
});
