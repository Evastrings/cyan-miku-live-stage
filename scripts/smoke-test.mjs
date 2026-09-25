// Headless smoke test: no browser, no sound card.
//  1. Runs the sequencer through every song with a mock audio engine.
//  2. Builds the Pixi scene graph (no renderer) and animates it for a few thousand frames.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="c"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.HTMLElement = dom.window.HTMLElement;

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) { failed++; console.error('FAIL:', msg); } else console.log('ok  :', msg);
};

const { Conductor } = await import('../src/engine/Conductor.js');
const { SONGS, STRUCTURE, totalBars } = await import('../src/data/songs.js');

// ---------- 1. sequencer ----------
function mockAudio() {
  const calls = {};
  const proxy = new Proxy({}, {
    get: (_, name) => {
      if (name === 'ctx') return ctxMock;
      if (name === 'now') return () => ctxMock.currentTime;
      if (name === 'init' || name === 'startSession' || name === 'endSession' || name === 'setVolume') return () => {};
      if (name === 'getSpectrum') return () => new Array(32).fill(0.3);
      return (...args) => { (calls[name] ||= []).push(args); };
    },
  });
  const ctxMock = { currentTime: 0, state: 'running', resume: async () => {} };
  return { proxy, ctxMock, calls };
}

for (const song of SONGS) {
  const c = new Conductor();
  const { proxy, ctxMock, calls } = mockAudio();
  c.audio = proxy;
  const events = {};
  const sections = [];
  const lyrics = [];
  ['beat', 'bar', 'kick', 'snare', 'crash', 'note', 'strum', 'lucky', 'luck', 'ended'].forEach((t) => c.on(t, () => (events[t] = (events[t] || 0) + 1)));
  c.on('section', ({ sec }) => sections.push(sec.id));
  c.on('lyric', ({ text }) => text && lyrics.push(text));
  await c.play(song.id);
  const dur = (totalBars * 240) / song.bpm + 4;
  for (let t = 0; t < dur; t += 0.02) {
    ctxMock.currentTime = t;
    if (c.timer) c._tick();
    c._pump();
    if (!c.playing) break;
  }
  ok(sections.join(',') === STRUCTURE.map((s) => s.id).join(','), `${song.id}: sections play in order`);
  ok(events.bar === totalBars, `${song.id}: ${events.bar} bars fired (expected ${totalBars})`);
  ok(lyrics.length === 24, `${song.id}: ${lyrics.length} lyric lines shown (expected 24)`);
  ok(events.ended === 1, `${song.id}: ended event fired once`);
  ok(events.kick >= 50 && events.snare >= 15, `${song.id}: drums (${events.kick} kicks, ${events.snare} snares)`);
  ok(calls.voice?.length > 40 && calls.guitarLead?.length > 40, `${song.id}: voice ${calls.voice?.length} notes, guitar lead ${calls.guitarLead?.length} notes`);
  const midis = [...(calls.voice || []), ...(calls.guitarLead || [])].map((a) => a[1]);
  ok(midis.every((m) => m >= 55 && m <= 90 && Number.isFinite(m)), `${song.id}: melody stays in range (${Math.min(...midis)}..${Math.max(...midis)})`);
  const bad = Object.entries(calls).flatMap(([k, v]) => v.filter((a) => a.some((x) => typeof x === 'number' && !Number.isFinite(x))).map(() => k));
  ok(bad.length === 0, `${song.id}: no NaN arguments to synth (${bad.slice(0, 3).join(',')})`);
  console.log(`      luck events: ${events.lucky || 0}, final luck ${Math.round(c.luck)}`);
}

// ---------- 2. scene graph ----------
const pixi = await import('pixi.js');
const { Stage } = await import('../src/engine/Stage.js');
const c = new Conductor();
const { proxy, ctxMock } = mockAudio();
c.audio = proxy;
const host = document.getElementById('c');
const stage = new Stage(host, c);
stage.app = {
  screen: { width: 1280, height: 720 },
  stage: new pixi.Container(),
  ticker: { add() {}, remove() {} },
  renderer: { generateTexture: () => pixi.Texture.EMPTY },
  canvas: document.createElement('canvas'),
};
stage._build();
ok(!!stage.world && stage.beams.length === 7, 'Stage scene builds');

await c.play('clover-skyline');
const step = 1 / 60;
let t = 0;
const secSeen = new Set();
const dur = (totalBars * 240) / 132;
while (t < dur) {
  ctxMock.currentTime = t;
  c._tick();
  c._pump();
  stage._tick({ deltaMS: step * 1000 });
  if (c.currentSection) secSeen.add(c.currentSection.id);
  if (Math.random() < 0.01) c.tapLuck();
  t += step;
}
ok(secSeen.size === STRUCTURE.length, `Stage ticked through all ${secSeen.size} sections`);
for (const type of ['clover_rain', 'confetti', 'golden_spot', 'fireworks', 'rainbow', 'bonus_lyric', 'jackpot']) {
  stage._lucky({ type });
}
for (let i = 0; i < 300; i++) stage._tick({ deltaMS: 16 });
ok(true, 'All lucky effects run without throwing');
for (const s of SONGS) stage.applySong(s);
ok(true, 'Every song palette redraws the backdrop');

const rigs = await import('../src/engine/rigs.js');
const finite = (o) => o.rotation === o.rotation;
for (const P of [rigs.Cyan, rigs.Miku]) {
  const p = new P();
  for (const mode of ['idle', 'guitar', 'sing', 'solo', 'dance', 'groove', 'wave']) {
    for (let i = 0; i < 120; i++) p.update(1 / 60, { bp: i / 20, energy: 0.8, mode, mouth: i % 2 === 0, time: i / 60 });
    ok(finite(p.armL.up) && finite(p.armR.fore) && finite(p.torso), `${P.name} mode "${mode}" produces finite joint angles`);
  }
}

// ---------- 3. sprite mode + WAV encoder ----------
const { SpritePuppet } = await import('../src/engine/spriteRig.js');
const sp = new SpritePuppet(pixi.Texture.WHITE, { height: 300, feet: 1, offsetY: 0, flip: false });
for (const mode of ['idle', 'guitar', 'sing', 'solo', 'dance', 'groove', 'wave']) {
  for (let i = 0; i < 90; i++) sp.update(1 / 60, { bp: i / 15, energy: 0.9, mode });
  ok(Number.isFinite(sp.body.rotation) && Number.isFinite(sp.body.y) && sp.body.scale.y > 0.8, `SpritePuppet mode "${mode}" is finite and sane`);
}
const { audioBufferToWavBytes } = await import('../src/engine/wav.js');
const fake = { numberOfChannels: 2, length: 4, sampleRate: 44100, getChannelData: (c) => Float32Array.from([0, 0.5, -0.5, 2]) };
const wav = audioBufferToWavBytes(fake);
ok(wav.length === 44 + 4 * 2 * 2 && String.fromCharCode(...wav.slice(0, 4)) === 'RIFF', 'WAV encoder writes a valid header and clamps samples');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
