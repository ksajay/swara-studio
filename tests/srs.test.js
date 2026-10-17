// Spec for the spaced-repetition and progress logic (assets/srs.js).
// Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const SRS = require("../assets/srs.js");

const T = "2026-10-17";
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

function stateWith(cards, extra = {}) {
  const st = SRS.newState();
  SRS.ensureCards(st, T);
  Object.assign(st.cards, cards);
  return Object.assign(st, extra);
}

test("dates: addDays crosses months, years and leap days", () => {
  assert.equal(SRS.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(SRS.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(SRS.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(SRS.addDays("2026-10-17", -17), "2026-09-30");
  assert.equal(SRS.daysBetween("2026-10-17", "2026-10-31"), 14);
});

test("new learner starts with Sa and Pa cards in every deck, due today", () => {
  const st = SRS.newState();
  SRS.ensureCards(st, T);
  assert.equal(st.stage, 0);
  assert.deepEqual(Object.keys(st.cards).sort(), ["ap:0", "ap:7", "ear:0", "ear:7", "sing:0", "sing:7"]);
  for (const c of Object.values(st.cards)) { assert.equal(c.box, 0); assert.equal(c.due, T); }
});

test("a card answered right on each due date climbs boxes 1-5 with gaps 1, 2, 4, 7, 14 days, then stays at 5", () => {
  const st = stateWith({});
  let day = T;
  const expectGaps = [1, 2, 4, 7, 14, 14];
  for (const gap of expectGaps) {
    SRS.recordAnswer(st, "ear", 0, true, { first: true, today: day });
    const c = st.cards["ear:0"];
    assert.equal(SRS.daysBetween(day, c.due), gap);
    day = c.due;
  }
  assert.equal(st.cards["ear:0"].box, 5);
});

test("answering a card right BEFORE it is due does not move it up (keeps the spacing honest)", () => {
  const st = stateWith({ "ear:7": { box: 2, due: SRS.addDays(T, 2), seen: 3, right: 3 } });
  SRS.recordAnswer(st, "ear", 7, true, { first: true, today: T });
  assert.equal(st.cards["ear:7"].box, 2);
  assert.equal(st.cards["ear:7"].due, SRS.addDays(T, 2));
  assert.equal(st.cards["ear:7"].seen, 4);
});

test("a wrong answer sends a card back to box 1, due tomorrow, even if it was not due", () => {
  const st = stateWith({ "ear:7": { box: 4, due: SRS.addDays(T, 5), seen: 9, right: 9 } });
  SRS.recordAnswer(st, "ear", 7, false, { first: true, today: T });
  assert.equal(st.cards["ear:7"].box, 1);
  assert.equal(st.cards["ear:7"].due, SRS.addDays(T, 1));
});

test("only the first answer to a card in a session changes its schedule", () => {
  const st = stateWith({});
  SRS.recordAnswer(st, "ear", 0, false, { first: true, today: T });
  SRS.recordAnswer(st, "ear", 0, true, { first: false, today: T });
  assert.equal(st.cards["ear:0"].box, 1);
  assert.equal(st.cards["ear:0"].due, SRS.addDays(T, 1));
});

test("accuracy history skips the re-ask that follows a miss, so retries cannot inflate it", () => {
  const st = stateWith({});
  SRS.recordAnswer(st, "ear", 0, false, { first: true, today: T });
  SRS.recordAnswer(st, "ear", 0, true, { first: false, retry: true, today: T });
  assert.deepEqual(st.recent.ear, [0]);
});

test("accuracy history counts every ordinary question, including a note asked again later", () => {
  const st = stateWith({});
  SRS.recordAnswer(st, "ear", 0, true, { first: true, today: T });
  SRS.recordAnswer(st, "ear", 7, true, { first: true, today: T });
  SRS.recordAnswer(st, "ear", 0, true, { first: false, today: T });
  assert.deepEqual(st.recent.ear, [1, 1, 1]);
});

test("accuracy history keeps the last 20 first answers", () => {
  const st = stateWith({});
  for (let i = 0; i < 25; i++) SRS.recordAnswer(st, "sing", 0, i % 2 === 0, { first: true, today: T });
  assert.equal(st.recent.sing.length, 20);
});

test("the daily log counts every answer, retries included", () => {
  const st = stateWith({});
  SRS.recordAnswer(st, "ear", 0, false, { first: true, today: T });
  SRS.recordAnswer(st, "ear", 0, true, { first: false, today: T });
  assert.deepEqual(st.days[T].ear, [2, 1]);
});

test("accuracy() of an empty history is 0", () => {
  assert.equal(SRS.accuracy([]), 0);
  assert.equal(SRS.accuracy([1, 0, 1, 1]), 0.75);
});

function readyToPromote(overrides = {}) {
  return stateWith(
    { "ear:0": { box: 2, due: SRS.addDays(T, 2), seen: 10, right: 10 }, "ear:7": { box: 3, due: SRS.addDays(T, 4), seen: 10, right: 10 } },
    Object.assign({ recent: { ear: Array(20).fill(1), sing: [], ap: [] } }, overrides)
  );
}

test("the next note unlocks when every card is at box 2+ and the last 20 are 85%+", () => {
  const st = readyToPromote();
  const added = SRS.checkPromotion(st, "ear", T);
  assert.deepEqual(added, [4]);
  assert.equal(st.stage, 1);
  assert.deepEqual(st.recent.ear, []);
  assert.equal(st.cards["ear:4"].box, 0);
  assert.equal(st.cards["sing:4"].due, T);
});

test("no unlock while any card in the set is below box 2", () => {
  const st = readyToPromote();
  st.cards["ear:7"].box = 1;
  assert.deepEqual(SRS.checkPromotion(st, "ear", T), []);
  assert.equal(st.stage, 0);
});

test("no unlock with fewer than 20 answers, or under 85%", () => {
  const few = readyToPromote({ recent: { ear: Array(19).fill(1), sing: [], ap: [] } });
  assert.deepEqual(SRS.checkPromotion(few, "ear", T), []);
  const weak = readyToPromote({ recent: { ear: [...Array(16).fill(1), 0, 0, 0, 0], sing: [], ap: [] } });
  assert.deepEqual(SRS.checkPromotion(weak, "ear", T), []);
});

test("the sing deck never changes the stage, and the last stage is final", () => {
  const st = readyToPromote();
  assert.deepEqual(SRS.checkPromotion(st, "sing", T), []);
  st.stage = SRS.STAGES.length - 1;
  assert.deepEqual(SRS.checkPromotion(st, "ear", T), []);
  assert.equal(st.stage, SRS.STAGES.length - 1);
});

test("recordAnswer reports a newly unlocked note", () => {
  const st = readyToPromote({ recent: { ear: Array(19).fill(1), sing: [], ap: [] } });
  const res = SRS.recordAnswer(st, "ear", 0, true, { first: true, today: T });
  assert.deepEqual(res.unlocked, [4]);
});

test("the side-quest deck unlocks fixed notes on its own ladder", () => {
  const st = stateWith(
    { "ap:0": { box: 2, due: T, seen: 5, right: 5 }, "ap:7": { box: 2, due: T, seen: 5, right: 5 } },
    { recent: { ear: [], sing: [], ap: Array(20).fill(1) } }
  );
  assert.deepEqual(SRS.checkPromotion(st, "ap", T), [4]);
  assert.equal(st.apStage, 1);
  assert.equal(st.stage, 0);
});

test("a review queue puts due cards first", () => {
  const st = stateWith({ "ear:0": { box: 1, due: T, seen: 1, right: 1 }, "ear:7": { box: 3, due: SRS.addDays(T, 5), seen: 4, right: 4 } });
  assert.deepEqual(SRS.buildQueue(st, "ear", 1, T, Math.random), [0]);
});

test("a review queue has the requested length and never repeats a note back to back", () => {
  const st = stateWith({});
  st.stage = 3;
  SRS.ensureCards(st, T);
  for (let run = 0; run < 50; run++) {
    const q = SRS.buildQueue(st, "ear", 15, T, Math.random);
    assert.equal(q.length, 15);
    for (let i = 1; i < q.length; i++) assert.notEqual(q[i], q[i - 1], `repeat at ${i}: ${q}`);
  }
});

test("a review queue includes every due card when there is room", () => {
  const st = stateWith({});
  st.stage = 5;
  SRS.ensureCards(st, T);
  const q = SRS.buildQueue(st, "ear", 15, T, seq([0.1, 0.9, 0.5, 0.3]));
  for (const d of SRS.STAGES[5].degs) assert.ok(q.includes(d), `missing ${d}`);
});

test("streak counts consecutive practice days, and today not yet practised does not break it", () => {
  const st = stateWith({});
  const log = (d) => { st.days[d] = { ear: [3, 2], sing: [0, 0], ap: [0, 0] }; };
  assert.equal(SRS.streak(st, T), 0);
  log(SRS.addDays(T, -1)); log(SRS.addDays(T, -2));
  assert.equal(SRS.streak(st, T), 2);
  log(T);
  assert.equal(SRS.streak(st, T), 3);
  log(SRS.addDays(T, -4));
  assert.equal(SRS.streak(st, T), 3);
});

test("hold-Sa gate counts days with a hold of 3 seconds or more", () => {
  const st = stateWith({}, { saHold: { "2026-10-15": 3.2, "2026-10-16": 2.9, "2026-10-17": 5 } });
  assert.equal(SRS.holdDays(st), 2);
});

test("merging two devices keeps each card's latest review and the best of every log", () => {
  const phone = stateWith({ "ear:0": { box: 3, due: "2026-10-21", seen: 8, right: 7, last: "2026-10-17" } },
    { updated: 200, stage: 2, saMidi: 50, days: { [T]: { ear: [10, 8], sing: [0, 0], ap: [0, 0] } }, saHold: { [T]: 4 }, gates: { "s1-hum": true } });
  const claude = stateWith({ "ear:0": { box: 1, due: "2026-10-16", seen: 5, right: 3, last: "2026-10-15" }, "ear:7": { box: 2, due: "2026-10-18", seen: 4, right: 4, last: "2026-10-16" } },
    { updated: 100, stage: 1, saMidi: 48, days: { [T]: { ear: [4, 4], sing: [6, 5], ap: [0, 0] } }, saHold: { [T]: 2 }, gates: {} });
  const m = SRS.mergeStates(phone, claude);
  assert.equal(m.cards["ear:0"].box, 3);
  assert.equal(m.cards["ear:7"].box, 2);
  assert.equal(m.stage, 2);
  assert.equal(m.saMidi, 50);
  assert.deepEqual(m.days[T].ear, [10, 8]);
  assert.deepEqual(m.days[T].sing, [6, 5]);
  assert.equal(m.saHold[T], 4);
  assert.equal(m.gates["s1-hum"], true);
  assert.equal(SRS.mergeStates(claude, phone).cards["ear:0"].box, 3, "merge is order-independent for cards");
});

test("a backup can be read back from the copied text, and junk is rejected", () => {
  const st = stateWith({});
  const text = SRS.backupText(st, T);
  assert.match(text, /^Swara Studio progress backup/);
  assert.deepEqual(SRS.parseBackup(text).cards, st.cards);
  assert.throws(() => SRS.parseBackup("hello"));
  assert.throws(() => SRS.parseBackup('{"not":"ours"}'));
});

test("an ear round spreads its questions evenly across the timbres", () => {
  const t = SRS.planTimbres(15, ["piano", "harmonium", "pluck"], Math.random);
  assert.equal(t.length, 15);
  const counts = {};
  t.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
  assert.deepEqual(Object.keys(counts).sort(), ["harmonium", "piano", "pluck"]);
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
});

test("timbre order changes from round to round", () => {
  const a = SRS.planTimbres(12, ["piano", "harmonium", "pluck"], Math.random).join();
  let changed = false;
  for (let i = 0; i < 20 && !changed; i++) changed = SRS.planTimbres(12, ["piano", "harmonium", "pluck"], Math.random).join() !== a;
  assert.ok(changed);
});
