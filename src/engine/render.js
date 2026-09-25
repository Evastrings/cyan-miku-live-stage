import { AudioEngine } from './AudioEngine.js';
import { Conductor } from './Conductor.js';
import { buildBars, totalBars } from '../data/songs.js';

/**
 * Render a whole song to an AudioBuffer with an OfflineAudioContext.
 * No real-time constraints, so the result is exactly what the synth *should* sound like,
 * independent of how busy your PC is. Great for telling "bug in the music" from "slow PC".
 */
export async function renderSong(song, { OfflineCtor, sampleRate = 44100 } = {}) {
  const Ctor = OfflineCtor || window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const seconds = (totalBars * 240) / song.bpm + 3.5;
  const ctx = new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate);

  const audio = new AudioEngine();
  audio.init(ctx);
  audio.startSession(song.bpm);

  const c = new Conductor();
  c.audio = audio;
  c.song = song;
  c.bars = buildBars(song);
  c._buildMelody();

  const sd = 60 / song.bpm / 4;
  let t = 0.05;
  for (let step = 0; step < c.bars.length * 16; step++) {
    c._scheduleStep(step, t);
    t += sd;
  }
  return ctx.startRendering();
}
