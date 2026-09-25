// Renders every song offline and analyses the audio: clipping, silence, DC offset, loudness.
// Usage: node scripts/audio-check.mjs [--wav]   (--wav also writes out/<song>.wav)
import { JSDOM } from 'jsdom';
import { OfflineAudioContext } from 'node-web-audio-api';
import fs from 'node:fs';

globalThis.window = new JSDOM('').window;
const { renderSong } = await import('../src/engine/render.js');
const { audioBufferToWavBytes } = await import('../src/engine/wav.js');
const { SONGS } = await import('../src/data/songs.js');

const writeWav = process.argv.includes('--wav');
if (writeWav) fs.mkdirSync('out', { recursive: true });

for (const song of SONGS) {
  const t0 = Date.now();
  const buf = await renderSong(song, { OfflineCtor: OfflineAudioContext });
  const sr = buf.sampleRate;
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let peak = 0, over = 0, sum = 0, nan = 0, dc = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (!Number.isFinite(a)) { nan++; continue; }
    if (a > peak) peak = a;
    if (a >= 0.999) over++;
    sum += L[i] * L[i];
    dc += L[i];
  }
  // per-100ms loudness to spot dropouts and jumps
  const win = Math.floor(sr * 0.1);
  const rms = [];
  for (let i = 0; i + win < L.length; i += win) {
    let s = 0;
    for (let k = 0; k < win; k++) s += L[i + k] * L[i + k];
    rms.push(Math.sqrt(s / win));
  }
  const body = rms.slice(5, rms.length - 30);
  const dropouts = body.filter((v) => v < 0.005).length;
  const jumps = body.slice(1).filter((v, i) => v > body[i] * 4 && v > 0.1).length;
  const db = (x) => (20 * Math.log10(x || 1e-9)).toFixed(1);
  console.log(
    `${song.id.padEnd(18)} ${(L.length / sr).toFixed(0)}s  peak ${peak.toFixed(2)} (${db(peak)} dBFS)  clipped samples ${over}  ` +
    `avg RMS ${db(Math.sqrt(sum / L.length))} dBFS  DC ${(dc / L.length).toFixed(4)}  NaN ${nan}  quiet windows ${dropouts}  sudden jumps ${jumps}  [${Date.now() - t0}ms]`
  );
  if (writeWav) fs.writeFileSync(`out/${song.id}.wav`, audioBufferToWavBytes(buf));
}
