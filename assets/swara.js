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
  // Tanpura-like pluck: three detuned saws through a closing low-pass filter.
  function pluck(m, t, dur, vol) {
    var c = ac(); dur = dur || 2.8; vol = vol || 0.07;
    var f = c.createBiquadFilter(), gn = c.createGain();
    f.type = "lowpass"; f.Q.value = 0.8;
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(600, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [-7, 0, 6].forEach(function (cents) {
      var o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = cents;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    });
    f.connect(gn); gn.connect(master);
  }
  // Drone cycle: Pa, Sa, Sa, low Sa, the classic tanpura order.
  var DRONE = [-5, 0, 0, -12];
  function droneTick() {
    var c = ac();
    while (droneNext < c.currentTime + 0.3) {
      pluck(droneSa + DRONE[droneStep % 4], droneNext);
      droneStep++; droneNext += 0.7;
    }
  }
  function droneStart(saMidi) {
    droneSa = saMidi; var c = ac();
    if (droneTimer) return;
    droneNext = c.currentTime + 0.05; droneStep = 0; droneTick();
    droneTimer = setInterval(droneTick, 100);
  }
  function droneStop() { if (droneTimer) { clearInterval(droneTimer); droneTimer = null; } }
  function droneOn() { return !!droneTimer; }
  function droneSetSa(m) { droneSa = m; }

  // Harmonium-like tone for target notes.
  function tone(m, when, dur, vol) {
    var c = ac(); var t = when || c.currentTime + 0.02; dur = dur || 1.0; vol = vol || 0.16;
    var f = c.createBiquadFilter(), gn = c.createGain();
    f.type = "lowpass"; f.frequency.value = 2200;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    gn.gain.setValueAtTime(vol, t + dur - 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    var o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = mtof(m);
    var o2 = c.createOscillator(); o2.type = "square"; o2.frequency.value = mtof(m); o2.detune.value = 4;
    var g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(gn); gn.connect(master);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.15); o2.stop(t + dur + 0.15);
    return t + dur;
  }
  // Play a list of MIDI notes in sequence; returns the end time.
  function seq(notes, dur, gap) {
    var c = ac(); var t = c.currentTime + 0.05; dur = dur || 0.6; gap = gap || 0.08;
    notes.forEach(function (m) { tone(m, t, dur); t += dur + gap; });
    return t;
  }

  g.Swara = {
    SWARAS: SWARAS, LETTERS: LETTERS, mtof: mtof, ftom: ftom, letter: letter, letterPc: letterPc,
    describe: describe, pcDistance: pcDistance, swaraHTML: swaraHTML, octaveName: octaveName,
    detect: detect, analyseBuffer: analyseBuffer,
    ac: ac, tone: tone, seq: seq, pluck: pluck,
    droneStart: droneStart, droneStop: droneStop, droneOn: droneOn, droneSetSa: droneSetSa
  };
})(window);
