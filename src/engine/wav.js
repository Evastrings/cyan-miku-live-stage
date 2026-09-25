/** Encode an AudioBuffer as a 16-bit PCM WAV file (Blob in the browser, Uint8Array anywhere). */
export function audioBufferToWavBytes(buf) {
  const nCh = buf.numberOfChannels;
  const len = buf.length;
  const sr = buf.sampleRate;
  const dataBytes = len * nCh * 2;
  const out = new DataView(new ArrayBuffer(44 + dataBytes));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, nCh, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * nCh * 2, true);
  out.setUint16(32, nCh * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, dataBytes, true);
  const chans = [];
  for (let c = 0; c < nCh; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
