// Small music-theory helpers used by the sequencer.

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Scale degree (can be negative or > 6) -> MIDI note. */
export function degToMidi(root, scaleName, deg) {
  const sc = SCALES[scaleName];
  const oct = Math.floor(deg / 7);
  const i = ((deg % 7) + 7) % 7;
  return root + sc[i] + 12 * oct;
}

/** Keep a note inside [min, max] by octave-shifting. */
export function fold(m, min, max) {
  while (m > max) m -= 12;
  while (m < min) m += 12;
  return m;
}

/**
 * Motif strings describe one bar in 16th notes.
 *   number = scale-degree offset from the current chord root
 *   "."    = rest
 *   "-"    = hold the previous note
 */
export function parseMotif(str) {
  const notes = [];
  let last = null;
  str
    .trim()
    .split(/\s+/)
    .forEach((tk, i) => {
      if (tk === '.') {
        last = null;
      } else if (tk === '-') {
        if (last) last.len += 1;
      } else {
        last = { step: i, off: Number(tk), len: 1 };
        notes.push(last);
      }
    });
  return notes;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Four different guitar-solo bars: long note, 16th run, syncopation, climax. */
export function genSoloBar(i, rng) {
  const chordTones = [0, 2, 4, 7, 9];
  const pick = () => chordTones[(rng() * chordTones.length) | 0];
  if (i === 0) {
    return [
      { step: 0, off: pick(), len: 6 },
      { step: 6, off: pick(), len: 2 },
      { step: 8, off: pick(), len: 4 },
      { step: 12, off: pick(), len: 2 },
      { step: 14, off: pick(), len: 2 },
    ];
  }
  if (i === 1) {
    const out = [];
    let idx = ((rng() * 4) | 0) + 3;
    let dir = -1;
    for (let s = 0; s < 16; s++) {
      out.push({ step: s, off: idx, len: 1 });
      if (rng() < 0.25) dir *= -1;
      idx = Math.max(0, Math.min(9, idx + dir * (rng() < 0.7 ? 1 : 2)));
    }
    return out;
  }
  if (i === 2) {
    return [
      { step: 0, off: pick(), len: 3 },
      { step: 3, off: pick(), len: 3 },
      { step: 6, off: pick(), len: 2 },
      { step: 8, off: pick(), len: 3 },
      { step: 11, off: pick(), len: 3 },
      { step: 14, off: pick(), len: 2 },
    ];
  }
  return [
    { step: 0, off: 9, len: 10, bend: true },
    { step: 10, off: 7, len: 2 },
    { step: 12, off: 4, len: 4 },
  ];
}
