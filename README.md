# Cyan × Miku — Live Stage

A browser-based 2.5D concert. Pick a song and the stage lighting changes, Miku dances, Cyan
plays guitar, and a luck system randomly fires bonus effects and bonus lyrics.

**Stack:** Vite · React (UI shell) · PixiJS 8 (stage) · GSAP (camera and choreography) · Web Audio API (all music is synthesized live).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm test           # headless smoke test (sequencer, scene graph, sprite puppets)
```

Controls: **Space** play/stop · **← →** change song · **click or tap the stage** to feed Cyan's luck.

## Deploy to GitHub Pages

1. Push to a repo on GitHub (branch `main`).
2. Repo Settings → Pages → Source: **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push.

`vite.config.js` uses `base: './'`, so it works under `https://<user>.github.io/<repo>/` with no changes.

## How it fits together

```
src/engine/Conductor.js   sequencer + event bus + luck system
src/engine/AudioEngine.js Web Audio synth (drums, bass, pads, guitar, formant "voice")
src/engine/Stage.js       PixiJS scene: lights, crowd, particles, camera
src/engine/rigs.js        procedural Cyan / Miku puppets (IK arms, hair chains)
src/data/songs.js         songs, lyrics, palettes, luck event table
src/App.jsx               UI: setlist tickets, karaoke lyrics, luck meter
```

The Conductor schedules audio ahead of time and re-emits every musical moment (`kick`, `beat`,
`bar`, `section`, `lyric`, `note`, `lucky`...) at the moment you *hear* it, so visuals stay in sync.

## Using real character art

Put transparent PNGs at `public/characters/cyan.png` and `public/characters/miku.png`
(this zip already contains rough cutouts made from the reference images you sent).
If a file is present it replaces the placeholder puppet and is animated as a "paper puppet":
squash on the beat, hops, sways and leans per section. Size and anchoring live in `src/characters.js`.

- A full-body image with a clean transparent background looks best. Cyan's cutout is a bust
  (the screenshot was cropped at the thighs), so a full-body art of her would look much better.
- **Rights:** the art belongs to its owners. `.gitignore` keeps `public/characters/*.png` out of
  git on purpose, so a public GitHub repo and Pages site show the built-in placeholders instead
  of the copyrighted art. Only publish art you have the right to publish.
- Real Live2D or Spine models need the model files plus a PixiJS-8-compatible runtime. That is a
  separate step: the Stage only needs an object with `root` and `update(dt, ctx)`.

## Audio troubleshooting

- The app shows an orange **"busy-PC stalls"** badge if the page's main thread hangs (usually heavy
  rendering). A few small ones are harmless; many or big ones mean the PC is struggling.
- **Save this song as WAV** renders the selected song offline (no real-time limits). Clean WAV but
  stuttering live playback = real-time load on your machine. Glitch in the WAV = bug in the music.
- `npm run audio:check` renders every song in Node and reports peak level, clipping, silence and NaNs.
  `npm run audio:wav` also writes `out/<song>.wav`.
- Mix levels and the master limiter are in `src/engine/AudioEngine.js`. Rendering resolution is
  capped by `MAX_RENDER_PIXELS` in `Stage.js`.

## Customising

- **Add a song:** copy an entry in `src/data/songs.js` (tempo, key, chord degrees, drum style,
  palette, lights, two 16-step motifs, lyrics). Lyrics are one line per bar.
- **Tune the luck system:** `_rollLuck()` in `Conductor.js` (odds and meter growth) and
  `LUCKY_EVENTS` in `songs.js` (weights).
- **Mix levels:** the `MIX` table at the top of `AudioEngine.js`.
- **Use real character art:** the puppets in `rigs.js` are placeholders. Any object with
  `root` (a Pixi Container) and `update(dt, { bp, energy, mode, mouth, time })` can replace them:
  return it from `createCyan()` / `createMiku()` in `Stage.js`. Modes are
  `idle | guitar | sing | solo | wave` (Cyan) and `idle | dance | sing | groove | wave` (Miku).
  Spine, Live2D (pixi-live2d-display) or sprite-sheet animators can be driven from those modes.
- **Add real audio:** decode files with `AudioContext.decodeAudioData` and schedule them from
  `Conductor._scheduleStep`; the events and visuals work the same.

## Notes

- Music and lyrics are original. Character visuals are stylised placeholders. Use your own art
  for anything you publish, and check the rights holders' fan-work guidelines for the characters.
- Browsers block audio until a user gesture, which is why there is a "Start the show" button.
