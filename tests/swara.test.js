// Spec for note naming and pitch detection (assets/swara.js).
const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.window = globalThis;
require("../assets/swara.js");
const S = globalThis.Swara;

const SR = 48000, N = 2048;
function voice(f, opts = {}) {
  const amps = opts.amps || [0.5, 0.25, 0.15, 0.08];
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    b[i] = amps.reduce((s, a, h) => s + a * Math.sin(2 * Math.PI * f * (h + 1) * t), 0) * (opts.gain || 0.6);
  }
  return b;
}
function seededNoise(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 * 2 - 1; }; }
const centsOff = (got, want) => 1200 * Math.log2(got / want);

test("letter names and frequencies", () => {
  assert.equal(S.letter(60), "C4");
  assert.equal(S.letter(48), "C3");
  assert.equal(S.letter(57), "A3");
  assert.ok(Math.abs(S.mtof(69) - 440) < 1e-9);
  assert.ok(Math.abs(S.ftom(220) - 57) < 1e-9);
});

test("describe() names a note relative to Sa, with octave and cents", () => {
  const ga = S.describe(S.mtof(52.2), 48); // E3 + 20 cents, Sa = C3
  assert.equal(ga.swara.full, "Ga"); assert.equal(ga.deg, 4); assert.equal(ga.oct, 0);
  assert.equal(ga.letter, "E3"); assert.ok(Math.abs(ga.cents - 20) < 0.01);
  const lowPa = S.describe(S.mtof(43), 48);
  assert.equal(lowPa.swara.full, "Pa"); assert.equal(lowPa.oct, -1);
  const taarSa = S.describe(S.mtof(60), 48);
  assert.equal(taarSa.swara.full, "Sa"); assert.equal(taarSa.oct, 1);
  const dha = S.describe(S.mtof(58), 49); // Sa = C#3, so B-flat 3 is 9 steps up: Dha
  assert.equal(dha.swara.full, "Dha"); assert.equal(dha.letter, "B♭3");
});

test("the same swara keeps its name when Sa moves", () => {
  for (let sa = 40; sa <= 67; sa++) assert.equal(S.describe(S.mtof(sa + 7), sa).swara.full, "Pa");
});

test("swaraHTML marks komal with a line below and tivra with a line above", () => {
  assert.match(S.swaraHTML(3), /class="sw komal"/);
  assert.match(S.swaraHTML(6), /class="sw tivra"/);
  assert.match(S.swaraHTML(0), /fixed/);
  assert.match(S.swaraHTML(7), /fixed/);
});

test("pcDistance measures cents to the nearest copy of a target, in any octave", () => {
  assert.equal(Math.round(S.pcDistance(52.1, 52)), 10);
  assert.equal(Math.round(S.pcDistance(64.1, 52)), 10, "an octave up still counts as on target");
  assert.equal(Math.round(S.pcDistance(51.6, 52)), -40);
  assert.equal(Math.round(S.pcDistance(58, 52)), -600, "a tritone away is the farthest possible");
});

test("detects sung pitches from E2 to G5 within 5 cents", () => {
  let worst = 0;
  for (let m = 40; m <= 79; m += 1) {
    const f = S.mtof(m + 0.13), r = S.detect(voice(f), SR);
    assert.ok(r, "no pitch at midi " + m);
    worst = Math.max(worst, Math.abs(centsOff(r.freq, f)));
  }
  assert.ok(worst < 5, "worst error " + worst.toFixed(2) + " cents");
});

test("a voice whose overtone is louder than its fundamental is not read an octave high", () => {
  for (const f of [110, 146.83, 196, 261.63]) {
    const r = S.detect(voice(f, { amps: [0.2, 0.6, 0.3, 0.15] }), SR);
    assert.ok(r && Math.abs(centsOff(r.freq, f)) < 20, "at " + f + " got " + (r && r.freq.toFixed(1)));
  }
});

test("silence and very quiet input return no pitch", () => {
  assert.equal(S.detect(new Float32Array(N), SR), null);
  assert.equal(S.detect(voice(220, { gain: 0.005 }), SR), null);
});

test("random noise (a fan, traffic) is not named as a note", () => {
  let falseHits = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = seededNoise(seed), b = new Float32Array(N);
    for (let i = 0; i < N; i++) b[i] = rnd() * 0.3;
    if (S.detect(b, SR)) falseHits++;
  }
  assert.ok(falseHits <= 1, falseHits + " of 30 noise frames were read as notes");
});

test("analyseBuffer turns a recording into a pitch track", () => {
  const len = SR, data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = 0.4 * Math.sin(2 * Math.PI * 196 * i / SR) + 0.1 * Math.sin(4 * Math.PI * 196 * i / SR);
  const fake = { sampleRate: SR, numberOfChannels: 1, length: len, getChannelData: () => data };
  const track = S.analyseBuffer(fake);
  assert.ok(track.length > 40);
  const voiced = track.filter((x) => x.freq);
  assert.ok(voiced.length / track.length > 0.95);
  assert.ok(voiced.every((x) => Math.abs(centsOff(x.freq, 196)) < 5));
});
