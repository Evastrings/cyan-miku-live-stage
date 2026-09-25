import { mtof } from './music.js';

// Mix levels. If something is too loud or quiet on your speakers, tweak here.
export const MIX = {
  master: 0.62,
  kick: 0.95,
  snare: 0.5,
  hat: 0.16,
  crash: 0.22,
  riser: 0.12,
  bass: 0.34,
  pad: 0.07,
  arp: 0.13,
  bell: 0.16,
  guitar: 0.12,
  guitarLead: 0.2,
  voice: 0.9,
};

// Rough formant frequencies (Hz) for a sung vowel.
const VOWELS = {
  a: [800, 1150, 2900],
  e: [420, 2050, 2900],
  i: [300, 2300, 3000],
  o: [450, 800, 2830],
  u: [330, 700, 2700],
};

function softClip(k) {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = Math.tanh(k * x);
  }
  return c;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.session = null;
    this._freq = null;
  }

  /** Pass an OfflineAudioContext to render to a buffer instead of the speakers. */
  init(existingCtx) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    // 'playback' = bigger output buffer: more robust against glitches on busy PCs.
    const ctx = (this.ctx = existingCtx || new AC({ latencyHint: 'playback' }));

    this.master = ctx.createGain();
    this.master.gain.value = this.volume * MIX.master;

    // Gentle glue compressor -> brickwall-ish limiter -> soft clipper -> out.
    // (The old chain let peaks reach ~1.3, i.e. digital clipping = crackle.)
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;

    // Soft clipper: y = tanh(x). Shapers only see -1..1, so pre-gain 0.5 lets it cover x in -2..2.
    const clip = new Float32Array(2048);
    for (let i = 0; i < clip.length; i++) clip[i] = Math.tanh(((i / (clip.length - 1)) * 2 - 1) * 2);
    const preGain = ctx.createGain();
    preGain.gain.value = 0.5;
    this.soft = ctx.createWaveShaper();
    this.soft.curve = clip;
    const outGain = ctx.createGain();
    outGain.gain.value = 1.0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.master.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(preGain);
    preGain.connect(this.soft);
    this.soft.connect(outGain);
    outGain.connect(ctx.destination);
    this.limiter.connect(this.analyser);

    // Shared reverb (synthetic impulse response).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 3);
    const rOut = ctx.createGain();
    rOut.gain.value = 0.55;
    this.reverb.connect(rOut);
    rOut.connect(this.master);

    // One shared noise buffer for drums / risers.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Time the listener actually hears things (compensates output latency). */
  now() {
    const c = this.ctx;
    return c.currentTime - (c.outputLatency || 0);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v * MIX.master, this.ctx.currentTime, 0.05);
  }

  // ---- session bus: everything for one playthrough routes through here ----
  startSession(bpm) {
    this.endSession();
    const ctx = this.ctx;
    const s = {};
    s.input = ctx.createGain();
    s.input.connect(this.master);
    s.send = ctx.createGain();
    s.send.connect(this.reverb);

    // Dotted-eighth echo, tempo synced.
    s.echo = ctx.createDelay(2);
    s.echo.delayTime.value = (60 / bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    s.echo.connect(lp);
    lp.connect(fb);
    fb.connect(s.echo);
    lp.connect(s.input);

    // Guitar bus: two drive stages -> tone -> out (+ some reverb and echo).
    s.gtrHi = ctx.createWaveShaper();
    s.gtrHi.curve = softClip(9);
    s.gtrHi.oversample = '2x';
    s.gtrLo = ctx.createWaveShaper();
    s.gtrLo.curve = softClip(2.5);
    const hiGain = ctx.createGain();
    hiGain.gain.value = 0.22;
    const loGain = ctx.createGain();
    loGain.gain.value = 0.55;
    s.gtrTone = ctx.createBiquadFilter();
    s.gtrTone.type = 'lowpass';
    s.gtrTone.frequency.value = 3400;
    s.gtrTone.Q.value = 0.7;
    s.gtrHi.connect(hiGain);
    s.gtrLo.connect(loGain);
    hiGain.connect(s.gtrTone);
    loGain.connect(s.gtrTone);
    s.gtrTone.connect(s.input);
    const gw = ctx.createGain();
    gw.gain.value = 0.25;
    s.gtrTone.connect(gw);
    gw.connect(s.send);
    const ge = ctx.createGain();
    ge.gain.value = 0.14;
    s.gtrTone.connect(ge);
    ge.connect(s.echo);

    this.session = s;
    return s;
  }

  endSession() {
    const s = this.session;
    if (!s) return;
    const t = this.ctx.currentTime;
    s.input.gain.cancelScheduledValues(t);
    s.input.gain.setTargetAtTime(0, t, 0.03);
    s.send.gain.setTargetAtTime(0, t, 0.03);
    setTimeout(() => {
      try {
        s.input.disconnect();
        s.send.disconnect();
        s.echo.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }, 500);
    this.session = null;
  }

  // ---- analysis ----
  getSpectrum(n = 32) {
    const out = new Array(n).fill(0);
    if (!this.analyser) return out;
    const bins = this.analyser.frequencyBinCount;
    if (!this._freq) this._freq = new Uint8Array(bins);
    this.analyser.getByteFrequencyData(this._freq);
    const maxBin = Math.floor(bins * 0.7);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(i / n, 1.6) * maxBin);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * maxBin));
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, this._freq[k]);
      out[i] = m / 255;
    }
    return out;
  }

  // ---- internals ----
  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _route(node, { wet = 0, echo = 0 } = {}) {
    const s = this.session;
    const ctx = this.ctx;
    node.connect(s.input);
    if (wet > 0) {
      const g = ctx.createGain();
      g.gain.value = wet;
      node.connect(g);
      g.connect(s.send);
    }
    if (echo > 0) {
      const g = ctx.createGain();
      g.gain.value = echo;
      node.connect(g);
      g.connect(s.echo);
    }
  }

  _noise(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.start(t, Math.random() * 0.8, dur + 0.05);
    return src;
  }

  _env(param, t, attack, peak, end) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, end);
  }

  // ---- drums ----
  kick(t, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    this._env(g.gain, t, 0.002, MIX.kick * v, t + 0.38);
    o.connect(g);
    this._route(g);
    o.start(t);
    o.stop(t + 0.42);
  }

  snare(t, v = 1) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    this._env(g.gain, t, 0.002, MIX.snare * v, t + 0.2);
    n.connect(bp);
    bp.connect(g);
    this._route(g, { wet: 0.22 });

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const g2 = ctx.createGain();
    this._env(g2.gain, t, 0.002, MIX.snare * 0.6 * v, t + 0.12);
    o.connect(g2);
    this._route(g2);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, v = 1, open = false) {
    const ctx = this.ctx;
    const n = this._noise(t, open ? 0.25 : 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    this._env(g.gain, t, 0.001, MIX.hat * v, t + (open ? 0.25 : 0.045));
    n.connect(hp);
    hp.connect(g);
    this._route(g);
  }

  crash(t, v = 1) {
    const ctx = this.ctx;
    const n = this._noise(t, 1.6);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const g = ctx.createGain();
    this._env(g.gain, t, 0.002, MIX.crash * v, t + 1.6);
    n.connect(hp);
    hp.connect(g);
    this._route(g, { wet: 0.3 });
  }

  riser(t, dur, v = 1) {
    const ctx = this.ctx;
    const n = this._noise(t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(MIX.riser * v, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
    n.connect(bp);
    bp.connect(g);
    this._route(g, { wet: 0.3 });
  }

  // ---- harmony ----
  bass(t, midi, dur, v = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.15);
    const g = ctx.createGain();
    const peak = MIX.bass * v;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setValueAtTime(peak, t + Math.max(0.02, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o1.connect(lp);
    lp.connect(g);
    o2.connect(g);
    this._route(g);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  pad(t, midis, dur, v = 1) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.3;
    const g = ctx.createGain();
    const peak = MIX.pad * v;
    const a = Math.min(0.35, dur / 2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a + 0.01, dur - 0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    midis.forEach((m) => {
      [-6, 6].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.45);
      });
    });
    lp.connect(g);
    this._route(g, { wet: 0.25 });
  }

  pluck(t, midi, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4500, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.003, MIX.arp * v, t + 0.28);
    o.connect(lp);
    lp.connect(g);
    this._route(g, { wet: 0.2, echo: 0.25 });
    o.start(t);
    o.stop(t + 0.32);
  }

  bell(t, midi, v = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.003, MIX.bell * v, t + 1.2);
    [
      [1, 1],
      [2.001, 0.35],
      [3.003, 0.15],
    ].forEach(([mul, amp]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + 1.25);
    });
    this._route(g, { wet: 0.35, echo: 0.2 });
  }

  // ---- guitar (Cyan) ----
  guitarChord(t, midis, dur, v = 1, { mute = false, clean = false } = {}) {
    const ctx = this.ctx;
    const s = this.session;
    const target = clean ? s.gtrLo : s.gtrHi;
    midis.forEach((m, i) => {
      const st = t + i * 0.011; // tiny strum spread
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = i % 2 ? 4 : -4;
      const g = ctx.createGain();
      const peak = MIX.guitar * v;
      const end = mute ? 0.11 : dur;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(peak, st + 0.004);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.45), st + Math.max(0.05, end * 0.6));
      g.gain.exponentialRampToValueAtTime(0.0001, st + end + 0.05);
      osc.connect(g);
      g.connect(target);
      osc.start(st);
      osc.stop(st + end + 0.1);
    });
  }

  guitarLead(t, midi, dur, v = 1, { bend = false } = {}) {
    const ctx = this.ctx;
    const s = this.session;
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.detune.value = 5;
    if (bend) {
      const lo = f * Math.pow(2, -2 / 12);
      [o1, o2].forEach((o) => {
        o.frequency.setValueAtTime(lo, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
      });
    } else {
      o1.frequency.value = f;
      o2.frequency.value = f;
    }
    if (dur > 0.22) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(18, t + Math.min(0.35, dur * 0.7));
      lfo.connect(lg);
      lg.connect(o1.detune);
      lg.connect(o2.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.2);
    }
    const env = ctx.createGain();
    const peak = MIX.guitarLead * v;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.setValueAtTime(peak * 0.85, t + Math.max(0.02, dur * 0.8));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    env.connect(s.gtrLo);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.2);
    o2.stop(t + dur + 0.2);
  }

  // ---- vocal-ish lead (Miku) : sawtooth through vowel formants ----
  voice(t, midi, dur, v = 1, vowel = 'a') {
    const ctx = this.ctx;
    const f = mtof(midi);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.011, t + Math.min(0.3, dur * 0.6));
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.25);

    const env = ctx.createGain();
    const a = Math.min(0.03, dur * 0.4);
    const peak = MIX.voice * v;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + a);
    env.gain.setValueAtTime(peak, t + Math.max(a + 0.005, dur - 0.05));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);

    const [f1, f2, f3] = VOWELS[vowel] || VOWELS.a;
    [
      [f1, 6, 1.0],
      [f2, 8, 0.7],
      [f3, 10, 0.25],
    ].forEach(([freq, q, amp]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(bp);
      bp.connect(g);
      g.connect(env);
    });
    this._route(env, { wet: 0.35, echo: 0.18 });
    osc.start(t);
    osc.stop(t + dur + 0.25);
  }
}
