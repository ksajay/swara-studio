/* Swara Studio core: note naming, pitch detection (YIN), and sound (drone + tones).
   Exposes window.Swara. No dependencies. */
(function (g) {
  "use strict";

  // The 12 positions above Sa. dev = Devanagari, mark = Bhatkhande mark, carn = Carnatic name.
  var SWARAS = [
    { name: "Sa",  full: "Sa",       dev: "सा", mark: "",      sol: "do", carn: "S",  fixed: true },
    { name: "Re",  full: "komal Re", dev: "रे", mark: "komal", sol: "ra", carn: "R1" },
    { name: "Re",  full: "Re",       dev: "रे", mark: "",      sol: "re", carn: "R2" },
    { name: "Ga",  full: "komal Ga", dev: "ग",  mark: "komal", sol: "me", carn: "G2" },
    { name: "Ga",  full: "Ga",       dev: "ग",  mark: "",      sol: "mi", carn: "G3" },
    { name: "Ma",  full: "Ma",       dev: "म",  mark: "",      sol: "fa", carn: "M1" },
    { name: "Ma",  full: "tivra Ma", dev: "म",  mark: "tivra", sol: "fi", carn: "M2" },
    { name: "Pa",  full: "Pa",       dev: "प",  mark: "",      sol: "sol", carn: "P", fixed: true },
    { name: "Dha", full: "komal Dha",dev: "ध",  mark: "komal", sol: "le", carn: "D1" },
    { name: "Dha", full: "Dha",      dev: "ध",  mark: "",      sol: "la", carn: "D2" },
    { name: "Ni",  full: "komal Ni", dev: "नि", mark: "komal", sol: "te", carn: "N2" },
    { name: "Ni",  full: "Ni",       dev: "नि", mark: "",      sol: "ti", carn: "N3" }
  ];
  var LETTERS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function ftom(f) { return 69 + 12 * Math.log2(f / 440); }
  function letter(m) { var n = Math.round(m); return LETTERS[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
  function letterPc(pc) { return LETTERS[((pc % 12) + 12) % 12]; }

  // Describe a frequency relative to Sa (a MIDI note number).
  function describe(freq, saMidi) {
    var m = ftom(freq), n = Math.round(m), rel = n - saMidi;
    var deg = ((rel % 12) + 12) % 12;
    var oct = Math.floor(rel / 12); // -1 mandra, 0 madhya, 1 taar
    return { midi: m, nearest: n, cents: (m - n) * 100, deg: deg, oct: oct, swara: SWARAS[deg], letter: letter(n), freq: freq };
  }

  // Cents from MIDI value m to the nearest octave copy of target (-600..+600). Singers often land
  // an octave away from a played note; that still counts as singing the right swara.
  function pcDistance(m, target) { var d = (m - target) * 100; return ((d % 1200) + 1800) % 1200 - 600; }

  // HTML for a swara name with its Bhatkhande mark and octave dot.
  function swaraHTML(deg, opts) {
    opts = opts || {};
    var s = SWARAS[((deg % 12) + 12) % 12];
    var oct = opts.oct || Math.floor(deg / 12);
    var cls = "sw" + (s.mark ? " " + s.mark : "") + (s.fixed ? " fixed" : "");
    var dot = oct < 0 ? "<sub>•</sub>" : oct > 0 ? "<sup>•</sup>" : "";
    var label = opts.dev ? s.dev : s.name;
    return '<span class="' + cls + '">' + label + "</span>" + dot;
  }
  function octaveName(oct) { return oct < 0 ? "mandra (low)" : oct > 0 ? "taar (high)" : "madhya (middle)"; }


  // Your shuddha scale from Sa to taar Sa, with the Western letter of each note.
  function scale(saMidi) {
    return [0, 2, 4, 5, 7, 9, 11, 12].map(function (d) {
      var sw = SWARAS[d % 12];
      return { deg: d, name: sw.name, dev: sw.dev, sol: sw.sol, midi: saMidi + d, letter: letter(saMidi + d) };
    });
  }

  /* ---------- Timbres ----------
     Ear questions rotate through several timbres: note naming is most accurate with piano and worst
     with pure tones (Miyazaki 1989), and training across timbres helps recognition generalise. */
  var TIMBRES = ["piano", "harmonium", "pluck"];
  // Piano-like partials: slightly stretched above whole multiples (string stiffness), each quieter
  // and shorter-lived than the one below.
  function pianoPartials(f) {
    var B = 0.0004, out = [];
    for (var n = 1; n <= 8; n++) out.push({ freq: n * f * Math.sqrt(1 + B * n * n), amp: 1 / Math.pow(n, 1.3), decay: 1.6 / Math.pow(n, 0.7) });
    return out;
  }
  // Plucked string (Karplus-Strong) with an all-pass stage so the pitch is exact, not rounded.
  function pluckSamples(f, sr, dur) {
    var len = Math.floor(sr * dur), y = new Float32Array(len), P = sr / f;
    var L = Math.max(2, Math.floor(P - 0.5)), frac = P - 0.5 - L, C = (1 - frac) / (1 + frac);
    var seed = 12345, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
    var prevV = 0, prevAp = 0, i, peak = 0;
    for (i = 0; i < len; i++) {
      if (i < L) { y[i] = rnd(); continue; }
      var v = 0.996 * 0.5 * (y[i - L] + y[i - L - 1 >= 0 ? i - L - 1 : 0]);
      var ap = C * v + prevV - C * prevAp; prevV = v; prevAp = ap; y[i] = ap;
    }
    for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
    if (peak > 0) for (i = 0; i < len; i++) y[i] /= peak;
    return y;
  }

  /* ---------- Tanpura drone ----------
     Standard tuning is low Pa, Sa, Sa, low Sa; the first string changes to low Ma or low Ni for some
     ragas. A tanpura is tuned by ear until the beating stops, so its intervals are pure ratios. */
  var FIRST_STRING = { Pa: 3 / 4, Ma: 2 / 3, Ni: 15 / 16 };
  function droneStrings(saMidi, first) {
    first = FIRST_STRING[first] ? first : "Pa";
    var sa = mtof(saMidi);
    return [
      { name: first, oct: -1, freq: sa * FIRST_STRING[first] },
      { name: "Sa", oct: 0, freq: sa }, { name: "Sa", oct: 0, freq: sa },
      { name: "Sa", oct: -1, freq: sa / 2 }
    ];
  }
  // One tanpura pluck. A low-loss plucked string (Karplus-Strong, all-pass tuned so the pitch is
  // exact) plus a resonant band that sweeps down through the overtones, imitating the jawari bridge's
  // bright burst whose brightness falls over time, and a soft swell as the body comes in.
  function tanpuraSamples(f, sr, dur) {
    var len = Math.floor(sr * dur), y = new Float32Array(len), out = new Float32Array(len);
    var P = sr / f, L = Math.max(2, Math.floor(P - 0.5)), frac = P - 0.5 - L, C = (1 - frac) / (1 + frac);
    var seed = 98765, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
    var prevV = 0, prevAp = 0, i, loss = Math.pow(0.5, 1 / (f * 2.2)); // amplitude halves every ~2.2 s
    for (i = 0; i < len; i++) {
      if (i < L) { y[i] = rnd(); continue; }
      var v = loss * (0.55 * y[i - L] + 0.45 * y[i - L - 1 >= 0 ? i - L - 1 : 0]);
      var ap = C * v + prevV - C * prevAp; prevV = v; prevAp = ap; y[i] = ap;
    }
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b2 = 0, a1 = 0, a2 = 0, a0 = 1, peak = 0, Q = 2.5;
    for (i = 0; i < len; i++) {
      var t = i / sr;
      if (i % 32 === 0) {
        var cf = Math.min(sr * 0.45, 4200 * Math.exp(-t / 0.8) + 3 * f), w0 = 2 * Math.PI * cf / sr, al = Math.sin(w0) / (2 * Q);
        a0 = 1 + al; b0 = al / a0; b2 = -al / a0; a1 = -2 * Math.cos(w0) / a0; a2 = (1 - al) / a0;
      }
      var xb = y[i], bp = b0 * xb + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xb; y2 = y1; y1 = bp;
      var swell = 1 - Math.exp(-t / 0.12);
      out[i] = swell * (0.55 * xb + 1.6 * bp * Math.exp(-t / 2.5));
      peak = Math.max(peak, Math.abs(out[i]));
    }
    if (peak > 0) for (i = 0; i < len; i++) out[i] *= 0.9 / peak;
    return out;
  }

  /* ---------- Pitch detection: YIN (de Cheveigné & Kawahara, 2002) ---------- */
  function detect(buf, sr) {
    var n = buf.length, i, t, rms = 0;
    for (i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) return null;
    var W = n >> 1;
    var tMin = Math.max(2, Math.floor(sr / 1050));
    var tMax = Math.min(n - W - 2, Math.floor(sr / 62));
    var d = new Float32Array(tMax + 2);
    for (t = 1; t <= tMax + 1; t++) {
      var s = 0;
      for (i = 0; i < W; i++) { var v = buf[i] - buf[i + t]; s += v * v; }
      d[t] = s;
    }
    var run = 0; d[0] = 1;
    for (t = 1; t <= tMax + 1; t++) { run += d[t]; d[t] = run > 0 ? d[t] * t / run : 1; }
    var tau = -1;
    for (t = tMin; t <= tMax; t++) {
      if (d[t] < 0.15) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) return null;
    var x0 = d[tau - 1], x1 = d[tau], x2 = d[tau + 1], den = x0 - 2 * x1 + x2;
    var shift = den !== 0 ? 0.5 * (x0 - x2) / den : 0;
    if (Math.abs(shift) > 1) shift = 0;
    return { freq: sr / (tau + shift), clarity: 1 - x1, rms: rms };
  }

  // Analyse a whole recording: returns [{t, freq}] every ~23 ms.
  function analyseBuffer(audioBuffer) {
    var sr = audioBuffer.sampleRate, ch = audioBuffer.numberOfChannels;
    var len = audioBuffer.length, mono = new Float32Array(len), c, i;
    for (c = 0; c < ch; c++) { var data = audioBuffer.getChannelData(c); for (i = 0; i < len; i++) mono[i] += data[i] / ch; }
    var frame = 2048, hop = 1024, out = [];
    for (i = 0; i + frame <= len; i += hop) {
      var r = detect(mono.subarray(i, i + frame), sr);
      out.push({ t: i / sr, freq: r ? r.freq : null });
    }
    return out;
  }

  /* ---------- Sound ---------- */
  var ctx = null, master = null, droneTimer = null, droneNext = 0, droneStep = 0, droneSa = 48;
  function ac() {
    if (!ctx) {
      var AC = g.AudioContext || g.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.7;
      var comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Drone playback: each string is rendered once into a buffer, then plucked in the tanpura cycle.
  var bufCache = {};
  function stringBuffer(f) {
    var c = ac(), k = f.toFixed(4) + ":" + c.sampleRate;
    if (!bufCache[k]) { var d = tanpuraSamples(f, c.sampleRate, 6), b = c.createBuffer(1, d.length, c.sampleRate); b.getChannelData(0).set(d); bufCache[k] = b; }
    return bufCache[k];
  }
  function pluck(f, t, vol) {
    var c = ac(), src = c.createBufferSource(), g = c.createGain();
    src.buffer = stringBuffer(f); g.gain.value = vol || 0.22;
    src.connect(g); g.connect(master); src.start(t);
  }
  var droneFirst = "Pa", GAPS = [0.75, 0.75, 0.75, 1.5]; // even plucks, then a rest after low Sa
  function droneTick() {
    var c = ac(), strs = droneStrings(droneSa, droneFirst);
    while (droneNext < c.currentTime + 0.3) {
      var k = droneStep % 4; pluck(strs[k].freq, droneNext);
      droneNext += GAPS[k]; droneStep++;
    }
  }
  function droneStart(saMidi, first) {
    droneSa = saMidi; if (first) droneFirst = first; var c = ac();
    if (droneTimer) return;
    droneNext = c.currentTime + 0.05; droneStep = 0; droneTick();
    droneTimer = setInterval(droneTick, 100);
  }
  function droneStop() { if (droneTimer) { clearInterval(droneTimer); droneTimer = null; } }
  function droneOn() { return !!droneTimer; }
  function droneSetSa(m) { droneSa = m; }
  function droneSetFirst(name) { if (FIRST_STRING[name]) droneFirst = name; }
  function droneConfig() { return { sa: droneSa, first: droneFirst, strings: droneStrings(droneSa, droneFirst) }; }

  // Harmonium-like reed tone: steady, so it is the reference for singing targets.
  function harmonium(m, t, dur, vol) {
    var c = ac(), f = c.createBiquadFilter(), gn = c.createGain();
    f.type = "lowpass"; f.frequency.value = 2200;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    gn.gain.setValueAtTime(vol, t + dur - 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    var o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = mtof(m);
    var o2 = c.createOscillator(); o2.type = "square"; o2.frequency.value = mtof(m); o2.detune.value = 4;
    var g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(gn); gn.connect(master);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.15); o2.stop(t + dur + 0.15);
  }
  function piano(m, t, dur, vol) {
    var c = ac(), out = c.createGain(); out.gain.value = vol * 1.6; out.connect(master);
    pianoPartials(mtof(m)).forEach(function (p) {
      if (p.freq > 12000) return;
      var o = c.createOscillator(), g = c.createGain(); o.frequency.value = p.freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p.amp * 0.5, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur + 0.6, p.decay * 2.2));
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.7);
    });
  }
  var pluckCache = {};
  function pluckTone(m, t, dur, vol) {
    var c = ac(), k = m + ":" + c.sampleRate;
    if (!pluckCache[k]) { var data = pluckSamples(mtof(m), c.sampleRate, 2.2), b = c.createBuffer(1, data.length, c.sampleRate); b.getChannelData(0).set(data); pluckCache[k] = b; }
    var src = c.createBufferSource(), g = c.createGain(); src.buffer = pluckCache[k]; g.gain.value = vol * 1.4;
    src.connect(g); g.connect(master); src.start(t); src.stop(t + Math.max(dur + 0.8, 1.5));
  }
  // Play one note in a timbre (default harmonium); returns its end time.
  function tone(m, when, dur, vol, timbre) {
    var c = ac(), t = when || c.currentTime + 0.02; dur = dur || 1.0; vol = vol || 0.16;
    if (timbre === "piano") piano(m, t, dur, vol);
    else if (timbre === "pluck") pluckTone(m, t, dur, vol);
    else harmonium(m, t, dur, vol);
    return t + dur;
  }
  // Play a list of MIDI notes in sequence; returns the end time.
  function seq(notes, dur, gap, timbre) {
    var c = ac(); var t = c.currentTime + 0.05; dur = dur || 0.6; gap = gap || 0.08;
    notes.forEach(function (m) { tone(m, t, dur, null, timbre); t += dur + gap; });
    return t;
  }

  g.Swara = {
    SWARAS: SWARAS, LETTERS: LETTERS, mtof: mtof, ftom: ftom, letter: letter, letterPc: letterPc,
    describe: describe, pcDistance: pcDistance, scale: scale, TIMBRES: TIMBRES, pianoPartials: pianoPartials, pluckSamples: pluckSamples, swaraHTML: swaraHTML, octaveName: octaveName,
    detect: detect, analyseBuffer: analyseBuffer,
    ac: ac, tone: tone, seq: seq,
    droneStart: droneStart, droneStop: droneStop, droneOn: droneOn, droneSetSa: droneSetSa, droneSetFirst: droneSetFirst, droneConfig: droneConfig,
    droneStrings: droneStrings, tanpuraSamples: tanpuraSamples
  };
})(window);
