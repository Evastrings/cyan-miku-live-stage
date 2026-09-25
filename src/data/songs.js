// All songs and lyrics here are original placeholders. Swap in your own freely.
//
// Every song shares one structure (STRUCTURE) so the choreography stays
// consistent; each song brings its own tempo, key, chords, drum style,
// palette, light show, motifs and lyrics.

export const STRUCTURE = [
  { id: 'intro',   label: 'Intro',        bars: 2, lead: 'duet', energy: 0.35, lyric: null },
  { id: 'verse1',  label: 'Verse 1',      bars: 4, lead: 'miku', energy: 0.55, lyric: 'verse1' },
  { id: 'chorus1', label: 'Chorus',       bars: 4, lead: 'duet', energy: 0.9,  lyric: 'chorus' },
  { id: 'verse2',  label: 'Verse 2',      bars: 4, lead: 'cyan', energy: 0.65, lyric: 'verse2' },
  { id: 'chorus2', label: 'Chorus',       bars: 4, lead: 'duet', energy: 0.95, lyric: 'chorus' },
  { id: 'solo',    label: 'Guitar solo',  bars: 4, lead: 'cyan', energy: 1,    lyric: null },
  { id: 'bridge',  label: 'Bridge',       bars: 2, lead: 'miku', energy: 0.5,  lyric: 'bridge' },
  { id: 'final',   label: 'Final chorus', bars: 4, lead: 'duet', energy: 1,    lyric: 'chorus' },
  { id: 'outro',   label: 'Outro',        bars: 2, lead: 'duet', energy: 0.3,  lyric: 'outro' },
];

export const LEAD_LABEL = { miku: 'Miku leads', cyan: 'Cyan leads', duet: 'Duet' };

// Luck system. Weights control how often each bonus can fire.
export const LUCKY_EVENTS = [
  { type: 'clover_rain', label: 'Clover rain', weight: 3 },
  { type: 'confetti', label: 'Confetti cannons', weight: 3 },
  { type: 'golden_spot', label: 'Golden spotlight', weight: 2 },
  { type: 'fireworks', label: 'Fireworks', weight: 2 },
  { type: 'rainbow', label: 'Rainbow beams', weight: 1.5 },
  { type: 'bonus_lyric', label: 'Bonus lyric', weight: 3 },
];

/*
 * Motifs: one bar of 16th notes, values are scale-degree offsets from the
 * current chord root (so the melody always follows the chords).
 * Each list is [A, B] where A plays on bars 1..n-1 and B is the cadence bar.
 */
export const SONGS = [
  {
    id: 'clover-skyline',
    title: 'Clover Skyline',
    feel: 'Bright J-rock opener',
    bpm: 132,
    root: 57, // A3
    scale: 'minor',
    prog: [0, 5, 2, 6], // Am F C G
    style: 'rock',
    lights: 'beams',
    palette: { sky1: 0x0a1630, sky2: 0x1d4f80, accent: 0x5ff5e2, accent2: 0xffd35c },
    motifs: {
      verse: ['2 . 4 - 5 - 4 . 2 . 0 - . . 2 .', '4 . 2 - 0 - . . 4 - 2 - 0 - - .'],
      chorus: ['7 - . 7 9 - 7 . 4 - . 4 5 - 4 .', '7 . 9 . 7 - 5 4 4 - 2 - 0 - - .'],
    },
    lyrics: {
      verse1: [
        'Streetlight hums my name tonight',
        'Coins in my pocket, dawn in my eyes',
        'Every wrong turn was a door',
        'Now the whole sky opens wide',
      ],
      chorus: [
        'Clover skyline, hold on tight',
        'Luck is just a song we sing',
        'Turn it up, let the rooftops shine',
        'One more chord and we take wing',
      ],
      verse2: [
        'Wrote my map on a paper crane',
        'Let the wind decide the lane',
        'Strangers clapping in the rain',
        'I never had to run again',
      ],
      bridge: ['If the dice roll low, we play on', 'Every heartbeat keeps the tempo'],
      outro: ['Clover skyline, fade to gold', 'Thanks for the light, don\'t let go'],
    },
    bonus: [
      'Four leaves, four wishes, one loud guitar',
      'Lucky seven in the front row tonight',
      'Toss a coin, it lands on a chorus',
      'Every ticket stub is a four-leaf clover',
    ],
  },
  {
    id: 'neon-lullaby',
    title: 'Neon Lullaby',
    feel: 'Late-night synthwave',
    bpm: 100,
    root: 50, // D3
    scale: 'minor',
    prog: [0, 3, 5, 4], // Dm Gm Bb Am
    style: 'synth',
    lights: 'lasers',
    palette: { sky1: 0x120a2a, sky2: 0x3a1466, accent: 0xff5ecb, accent2: 0x4fe9ff },
    motifs: {
      verse: ['4 - - . 2 - . . 0 - - . 2 - 4 .', '4 - . 2 0 - - - . . 2 - 0 - - .'],
      chorus: ['7 - - 9 7 - 4 . 5 - - 4 2 - 4 .', '9 - 7 - 4 - 5 - 4 - - . 0 - - .'],
    },
    lyrics: {
      verse1: [
        'City sleeps in violet static',
        'Signals blink like tired stars',
        'I hum the hush between the towers',
        'Drive slow through the afterglow',
      ],
      chorus: [
        'Neon lullaby, carry me',
        'Through the wires and the rain',
        'Every light\'s a little promise',
        'Sing it soft, then sing again',
      ],
      verse2: [
        'Rooftop radios whisper low',
        'Chrome and moon on the overpass',
        'Tomorrow\'s just a tab left open',
        'We\'ll close it when the sun comes past',
      ],
      bridge: ['Hold the note, let it glow', 'Nobody\'s lost when the bassline knows'],
      outro: ['Neon lullaby, goodnight', 'Leave the signal on for me'],
    },
    bonus: [
      'Pink and cyan, the sky can\'t decide',
      'Every red light turns green for us',
      'The moon just requested an encore',
      'Luck arrives on the offbeat',
    ],
  },
  {
    id: 'fourth-leaf-fever',
    title: 'Fourth Leaf Fever',
    feel: 'Fast pop-punk sprint',
    bpm: 150,
    root: 52, // E3
    scale: 'minor',
    prog: [0, 2, 6, 4], // Em G D Bm
    style: 'punk',
    lights: 'strobe',
    palette: { sky1: 0x06210f, sky2: 0x0f5a2f, accent: 0x8dff6a, accent2: 0xf3ffd1 },
    motifs: {
      verse: ['4 . 4 . 2 . 4 . 5 . 4 . 2 . 0 .', '4 . 2 . 0 . . . 2 . 4 . 7 - - .'],
      chorus: ['7 . 7 9 7 . 4 . 7 . 7 9 7 . 5 .', '9 . 7 . 4 . 2 . 4 - - . 0 - - .'],
    },
    lyrics: {
      verse1: [
        'Alarm\'s a drum, I\'m out the door',
        'Sneakers laced with static shocks',
        'Pockets full of nothing much',
        'Heart\'s a snare that never stops',
      ],
      chorus: [
        'Fourth leaf fever, count me in',
        'Flip the coin and let it fly',
        'Louder, louder, we\'ll be fine',
        'Light the fuse and touch the sky',
      ],
      verse2: [
        'Missed the bus, then caught a beat',
        'Found a crew on Fifth and Main',
        'All the trouble that I met',
        'Turned to hooks and sweet refrain',
      ],
      bridge: ['Three, two, one, no backup plan', 'Just a riff and open hands'],
      outro: ['Fever fades, the sparks remain', 'See you on the next refrain'],
    },
    bonus: [
      'Snake eyes? Nope, it\'s double sevens',
      'The setlist got shuffled by fate',
      'Two clovers, one amp, zero regrets',
      'That was lucky, do it again',
    ],
  },
  {
    id: 'midnight-encore',
    title: 'Midnight Encore',
    feel: 'Slow lantern ballad',
    bpm: 84,
    root: 53, // F3
    scale: 'major',
    prog: [0, 4, 5, 3], // F C Dm Bb
    style: 'ballad',
    lights: 'lanterns',
    palette: { sky1: 0x1a0f2b, sky2: 0x53306b, accent: 0xffb36b, accent2: 0xc9a6ff },
    motifs: {
      verse: ['2 - - . 4 - 2 . 0 - - . 2 - - .', '4 - 2 - 0 - - - . . . . 0 - - -'],
      chorus: ['4 - - 7 9 - 7 . 5 - - 4 5 - 7 .', '9 - 7 - 5 - 4 - 2 - - . 0 - - -'],
    },
    lyrics: {
      verse1: [
        'Lanterns sway like tiny tides',
        'Faces glowing, side by side',
        'I forgot the words I wrote',
        'But you\'re all singing anyway',
      ],
      chorus: [
        'Stay for one more midnight song',
        'Let the quiet carry us',
        'Even luck must take a bow',
        'Sing it slow, we\'ve got all night',
      ],
      verse2: [
        'Backstage light and paper cups',
        'Guitar case with a broken clasp',
        'Every ending\'s just a doorway',
        'Held by hands we\'re glad to grasp',
      ],
      bridge: ['Hands up high, the lanterns rise', 'Small good fortune, big goodbye'],
      outro: ['Midnight encore, one last chord', 'Thank you all, you\'re the reward'],
    },
    bonus: [
      'One more verse nobody rehearsed',
      'The lanterns spell out a wish',
      'Luck sat down in the last row',
      'A shooting star just joined the choir',
    ],
  },
];

/** Expand STRUCTURE into a per-bar timeline for a song. */
export function buildBars(song) {
  const p = song.prog;
  const bars = [];
  STRUCTURE.forEach((sec, si) => {
    let prog = p;
    if (sec.id === 'intro') prog = [p[0], p[1]];
    else if (sec.id === 'bridge') prog = [p[2], p[3]];
    else if (sec.id === 'outro') prog = [p[3], 0];
    const lines = sec.lyric ? song.lyrics[sec.lyric] : null;
    for (let b = 0; b < sec.bars; b++) {
      bars.push({
        sec,
        secIndex: si,
        barInSec: b,
        chordDeg: prog[b % prog.length],
        lyric: lines ? lines[b] : null,
        first: b === 0,
        last: b === sec.bars - 1,
      });
    }
  });
  return bars;
}

export const totalBars = STRUCTURE.reduce((n, s) => n + s.bars, 0);
export const songSeconds = (song) => Math.round((totalBars * 4 * 60) / song.bpm);
