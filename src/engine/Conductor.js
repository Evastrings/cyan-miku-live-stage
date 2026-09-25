import { AudioEngine } from './AudioEngine.js';
import { SONGS, LUCKY_EVENTS, buildBars } from '../data/songs.js';
import { degToMidi, fold, parseMotif, mulberry32, hashStr, genSoloBar } from './music.js';

/*
 * The Conductor is the brain of the show. It:
 *   1. sequences the song with a look-ahead scheduler (audio-accurate timing)
 *   2. re-emits every musical moment as an event *at the moment you hear it*
 *      (kick, beat, bar, section, lyric, note...) so the visuals stay in sync
 *   3. runs the luck system (Lucky Cyan's whole thing)
 *
 * Events: song, play, stop, ended, beat, bar, section, lyric, kick, snare,
 *         crash, note, luck, lucky, hiccup
 */

// How far ahead audio is scheduled. Bigger = survives longer main-thread stalls
// (heavy rendering, background tabs) without stutter. Visuals are unaffected
// because they fire from a queue at the moment each sound is actually heard.
const LOOKAHEAD = 0.6;
const STALL_MS = 120; // a scheduler tick this late counts as a "main thread stall"

const DRUMS = {
  rock:   { kick: [0, 6, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], open: [14] },
  synth:  { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], ghost: [1, 3, 5, 7, 9, 11, 13, 15] },
  punk:   { kick: [0, 3, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [] },
  ballad: { kick: [0, 10], snare: [8], hat: [0, 4, 8, 12], open: [] },
};

// Guitar comping hit steps per style. "open" = ringing chords, "mute" = chugs.
const GTR = {
  rock:   { open: [0, 6, 8, 14], mute: [0, 2, 4, 6, 8, 10, 12, 14] },
  punk:   { open: [0, 2, 4, 6, 8, 10, 12, 14], mute: [0, 2, 4, 6, 8, 10, 12, 14] },
  synth:  { open: [0, 8], mute: [0, 2, 4, 6, 8, 10, 12, 14] },
  ballad: { open: [0, 8], mute: [] },
};

const VOWEL_SEQ = ['a', 'o', 'e', 'a', 'i', 'o'];
const CRITICAL = new Set(['bar', 'section', 'lyric', 'end']);
const isBig = (sec) => !!sec && (sec.id.startsWith('chorus') || sec.id === 'final' || sec.id === 'solo');

export class Conductor {
  constructor() {
    this.audio = new AudioEngine();
    this.songs = SONGS;
    this.song = SONGS[0];
    this.listeners = {};
    this.playing = false;
    this.queue = [];
    this.bars = [];
    this.barNotes = [];
    this.luck = 0;
    this.currentSection = null;
    this.voiceUntil = 0;
    this.gtrUntil = 0;
    this._tok = 0;
    this._bonusIdx = 0;
    this.stats = { stalls: 0, worstMs: 0 };
    this._lastTick = 0;
    this._pump = this._pump.bind(this);
  }

  // ---- tiny event bus ----
  on(type, fn) {
    (this.listeners[type] ||= new Set()).add(fn);
    return () => this.listeners[type].delete(fn);
  }
  emit(type, data) {
    this.listeners[type]?.forEach((fn) => fn(data));
  }

  // ---- public API ----
  select(id) {
    const s = SONGS.find((x) => x.id === id);
    if (!s) return;
    this.song = s;
    this.emit('song', s);
  }

  async play(id) {
    if (id) this.select(id);
    const tok = ++this._tok;
    const a = this.audio;
    a.init();
    if (a.ctx.state !== 'running') await a.ctx.resume();
    if (tok !== this._tok) return;

    this.stop(true);
    const song = this.song;
    this.bars = buildBars(song);
    this._buildMelody();
    a.startSession(song.bpm);

    const t0 = a.ctx.currentTime + 0.2;
    this.startTime = t0;
    this.nextTime = t0;
    this.step = 0;
    this.totalSteps = this.bars.length * 16;
    this.endQueued = false;
    this.queue = [];
    this.currentSection = null;
    this.voiceUntil = 0;
    this.gtrUntil = 0;
    this.luck = 0;
    this._bonusIdx = 0;
    this.stats = { stalls: 0, worstMs: 0 };
    this._lastTick = performance.now();
    this.playing = true;

    this._startTimer();
    this._raf = requestAnimationFrame(this._pump);
    this.emit('luck', { value: 0 });
    this.emit('play', { song });
  }

  stop(silent = false) {
    if (!this.playing && !silent) return;
    this._tok++;
    this.playing = false;
    this._stopTimer();
    cancelAnimationFrame(this._raf);
    this.queue = [];
    this.audio.endSession?.();
    this.currentSection = null;
    if (!silent) this.emit('stop');
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  setVolume(v) {
    this.audio.setVolume(v);
  }

  /** Beats since the song started (float). Drives all choreography. */
  beatPosition() {
    if (!this.playing) return 0;
    return Math.max(0, this.audio.now() - this.startTime) * (this.song.bpm / 60);
  }

  barDuration() {
    return 240 / this.song.bpm;
  }

  get voiceActive() {
    return this.playing && this.audio.now() < this.voiceUntil;
  }
  get gtrActive() {
    return this.playing && this.audio.now() < this.gtrUntil;
  }

  /** Clicking / tapping the stage feeds Cyan's luck. */
  tapLuck() {
    this.luck = Math.min(100, this.luck + 5);
    this.emit('luck', { value: this.luck });
    if (this.luck >= 100) {
      this._jackpot();
    } else if (Math.random() < 0.22) {
      this._trigger(this._pickEvent());
    }
  }

  // ---- scheduling ----
  // The 25ms scheduler clock runs in a Web Worker: browsers throttle main-thread
  // timers in background tabs (to ~1s), which would starve the audio scheduler.
  _startTimer() {
    this._stopTimer();
    try {
      const src = 'setInterval(()=>postMessage(0),25)';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = () => this._tick();
      this.timer = w;
    } catch (e) {
      this.timer = setInterval(() => this._tick(), 25);
    }
  }

  _stopTimer() {
    if (!this.timer) return;
    if (typeof this.timer.terminate === 'function') this.timer.terminate();
    else clearInterval(this.timer);
    this.timer = null;
  }

  _q(t, type, data) {
    this.queue.push({ t, type, data });
  }

  _tick() {
    const a = this.audio;
    const sd = 60 / this.song.bpm / 4;
    // Diagnostics: if this 25ms timer fires much later than asked, the page's main
    // thread was busy (usually rendering). Audio is buffered ahead so it usually
    // survives, but frequent big stalls mean the PC is struggling.
    const nowMs = performance.now();
    const gap = nowMs - this._lastTick;
    this._lastTick = nowMs;
    if (gap > STALL_MS && gap < 5000) {
      this.stats.stalls++;
      this.stats.worstMs = Math.max(this.stats.worstMs, Math.round(gap));
      this.emit('hiccup', { ...this.stats, gap: Math.round(gap) });
    }
    while (this.step < this.totalSteps && this.nextTime < a.ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this.step, this.nextTime);
      this.nextTime += sd;
      this.step++;
    }
    if (this.step >= this.totalSteps && !this.endQueued) {
      this.endQueued = true;
      this._q(this.nextTime + 1.6, 'end');
      this._stopTimer();
    }
  }

  _pump() {
    if (!this.playing) return;
    const now = this.audio.now();
    while (this.queue.length && this.queue[0].t <= now) {
      const ev = this.queue.shift();
      // If the tab was in the background, skip stale cosmetic events.
      if (now - ev.t > 0.6 && !CRITICAL.has(ev.type)) continue;
      this._handle(ev);
      if (!this.playing) return;
    }
    this._raf = requestAnimationFrame(this._pump);
  }

  _handle(ev) {
    const now = this.audio.now();
    switch (ev.type) {
      case 'section':
        this.currentSection = ev.data.sec;
        break;
      case 'note':
        if (ev.data.who === 'voice') this.voiceUntil = now + ev.data.dur;
        else this.gtrUntil = now + ev.data.dur;
        break;
      case 'end':
        this.stop(true);
        this.emit('stop');
        this.emit('ended', { song: this.song });
        return;
      default:
        break;
    }
    this.emit(ev.type, ev.data);
    if (ev.type === 'bar') this._rollLuck(ev.data.info);
  }

  _buildMelody() {
    const song = this.song;
    const rng = mulberry32(hashStr(song.id));
    const motif = {
      verse: song.motifs.verse.map(parseMotif),
      chorus: song.motifs.chorus.map(parseMotif),
    };
    this.barNotes = this.bars.map((info, bi) => {
      const id = info.sec.id;
      const lead = info.sec.lead;
      const cad = info.last ? 1 : 0;
      let notes = [];
      if (id === 'verse1' || id === 'verse2' || id === 'bridge') notes = motif.verse[cad];
      else if (id.startsWith('chorus') || id === 'final') notes = motif.chorus[cad];
      else if (id === 'outro') notes = info.last ? [{ step: 0, off: 0, len: 16 }] : motif.chorus[1];
      else if (id === 'solo') notes = genSoloBar(info.barInSec, rng);
      if (!notes.length) return [];
      const inst = id === 'solo' || lead === 'cyan' ? 'gtr' : 'voice';
      const base = song.root + 12;
      return notes.map((n, k) => {
        const midi = degToMidi(base, song.scale, info.chordDeg + n.off);
        return {
          step: n.step,
          len: n.len,
          bend: n.bend,
          inst,
          midi: inst === 'voice' ? fold(midi, 60, 83) : fold(midi, 62, 88),
          vowel: VOWEL_SEQ[(bi + k) % VOWEL_SEQ.length],
        };
      });
    });
  }

  _scheduleStep(step, t) {
    const a = this.audio;
    const song = this.song;
    const bar = (step / 16) | 0;
    const s = step % 16;
    const info = this.bars[bar];
    const sec = info.sec;
    const id = sec.id;
    const sd = 60 / song.bpm / 4;
    const barDur = sd * 16;
    const chorus = id.startsWith('chorus') || id === 'final';
    const nextBig = info.last && isBig(this.bars[bar + 1]?.sec);
    const lite = sec.energy < 0.6;
    const style = song.style;

    // chord voicings
    const triad = [0, 2, 4].map((o) => degToMidi(song.root, song.scale, info.chordDeg + o));
    const power = [triad[0], triad[2], triad[0] + 12];
    const bassNote = degToMidi(song.root - 12, song.scale, info.chordDeg);

    // ---- visual events ----
    if (s === 0) {
      this._q(t, 'bar', { bar, info });
      if (info.first) this._q(t, 'section', { sec, index: info.secIndex });
      if (info.lyric) this._q(t, 'lyric', { text: info.lyric, id, bar });
      else if (info.first) this._q(t, 'lyric', { text: null, id, bar });
    }
    if (s % 4 === 0) this._q(t, 'beat', { beat: s / 4, bar, energy: sec.energy });

    // ---- drums ----
    const d = DRUMS[style];
    if (lite) {
      if (s === 0 || s === 8) {
        a.kick(t, 0.8);
        this._q(t, 'kick');
      }
      if (s % 4 === 0) a.hat(t, 0.5);
    } else {
      if (d.kick.includes(s)) {
        a.kick(t, 1);
        this._q(t, 'kick');
      }
      if (d.snare.includes(s)) {
        a.snare(t, style === 'ballad' ? 0.55 : 1);
        this._q(t, 'snare');
      }
      if (d.hat.includes(s)) a.hat(t, s % 4 === 0 ? 0.9 : 0.6);
      if (d.open?.includes(s)) a.hat(t, 0.7, true);
      if (chorus && d.ghost?.includes(s)) a.hat(t, 0.3);
    }
    if (nextBig && s >= 12 && !lite) a.snare(t, 0.4 + (s - 12) * 0.15);
    if (s === 0 && info.first && (chorus || id === 'solo')) {
      a.crash(t, 1);
      this._q(t, 'crash');
    }
    if (nextBig && s === 8) a.riser(t, sd * 8, 1);

    // ---- bass ----
    if (!(id === 'intro' && info.barInSec === 0)) {
      if (style === 'ballad') {
        if (s === 0) a.bass(t, bassNote, sd * 7.5, 0.9);
        if (s === 8) a.bass(t, bassNote + 7, sd * 7, 0.7);
      } else {
        const steps = lite ? [0, 8] : [0, 2, 4, 6, 8, 10, 12, 14];
        if (steps.includes(s)) {
          const hop = style === 'rock' && (s === 6 || s === 14) ? 12 : 0;
          a.bass(t, bassNote + hop, sd * 1.8, s % 8 === 0 ? 1 : 0.75);
        }
      }
    }

    // ---- pad ----
    if (s === 0) {
      const padVel = { synth: 0.9, ballad: 1, rock: 0.55, punk: 0.3 }[style] * (0.6 + 0.4 * sec.energy);
      a.pad(t, triad, barDur * 1.02, padVel);
    }

    // ---- arps ----
    const arpNotes = triad.map((m) => m + 12);
    const arpPattern = [0, 1, 2, 1];
    if (style === 'synth') {
      const every = chorus ? 1 : 2;
      if (s % every === 0 && !(id === 'bridge')) {
        const idx = arpPattern[(s / every) % 4];
        a.pluck(t, arpNotes[idx] + (s % 8 >= 4 ? 12 : 0), 0.6 + 0.4 * sec.energy);
      }
    } else if (style === 'ballad') {
      if (s % 2 === 0) a.bell(t, arpNotes[arpPattern[(s / 2) % 4]] + 12, 0.7);
    } else if (id === 'intro') {
      if (s % 2 === 0) a.pluck(t, arpNotes[arpPattern[(s / 2) % 4]], 0.7);
    }

    // ---- guitar comping ----
    const lead = sec.lead;
    const g = GTR[style];
    const cleanTone = style === 'ballad' || id === 'intro' || id === 'outro' || id === 'bridge';
    let played = false;
    if (id === 'intro' || id === 'outro') {
      if (s === 0 && info.barInSec === 0) {
        a.guitarChord(t, triad.concat([triad[0] + 12]), barDur * 1.6, 0.8, { clean: true });
        played = true;
      }
    } else if (id === 'solo') {
      if (g.mute.includes(s)) {
        a.guitarChord(t, power, sd * 2, 0.55, { mute: true });
        played = true;
      }
    } else if (lead === 'duet') {
      if (g.open.includes(s)) {
        const notes = style === 'punk' ? power : triad.concat([triad[0] + 12]);
        a.guitarChord(t, notes, sd * 5, 0.9, { clean: cleanTone });
        played = true;
      }
    } else if (lead === 'miku' && id !== 'bridge') {
      // rhythm guitar under Miku's verse: light chugs
      if (!lite && g.mute.includes(s) && s % 4 === 0) {
        a.guitarChord(t, power, sd * 2, 0.5, { mute: true });
        played = true;
      }
    }
    if (played) this._q(t, 'strum');

    // ---- lead melody ----
    const notes = this.barNotes[bar];
    for (const n of notes) {
      if (n.step !== s) continue;
      const dur = n.len * sd * 0.96;
      if (n.inst === 'voice') a.voice(t, n.midi, dur, sec.energy > 0.8 ? 1 : 0.85, n.vowel);
      else a.guitarLead(t, n.midi, dur, id === 'solo' ? 1 : 0.8, { bend: n.bend });
      this._q(t, 'note', { who: n.inst, dur });
    }
  }

  // ---- luck ----
  _rollLuck(info) {
    if (info.sec.id === 'intro') return;
    const cyanBoost = info.sec.lead === 'cyan' ? 4 : 0;
    this.luck = Math.min(100, this.luck + 3 + Math.random() * 4 + cyanBoost);
    this.emit('luck', { value: this.luck });
    if (this.luck >= 100) {
      this._jackpot();
      return;
    }
    const p = 0.14 + this.luck / 260; // 14% at 0 luck, ~52% near the top
    if (Math.random() < p) this._trigger(this._pickEvent());
  }

  _pickEvent() {
    const total = LUCKY_EVENTS.reduce((n, e) => n + e.weight, 0);
    let r = Math.random() * total;
    for (const e of LUCKY_EVENTS) {
      r -= e.weight;
      if (r <= 0) return e;
    }
    return LUCKY_EVENTS[0];
  }

  _trigger(ev) {
    const payload = { type: ev.type, label: ev.label };
    if (ev.type === 'bonus_lyric') {
      const pool = this.song.bonus;
      payload.text = pool[this._bonusIdx++ % pool.length];
    }
    this.emit('lucky', payload);
  }

  _jackpot() {
    this.luck = 12;
    this.emit('lucky', { type: 'jackpot', label: 'JACKPOT 777' });
    this.emit('luck', { value: this.luck });
  }
}

export const conductor = new Conductor();
