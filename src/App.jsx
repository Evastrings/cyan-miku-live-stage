import { useEffect, useRef, useState, useCallback } from 'react';
import { conductor } from './engine/Conductor.js';
import { Stage } from './engine/Stage.js';
import { SONGS, LEAD_LABEL, songSeconds } from './data/songs.js';
import { renderSong } from './engine/render.js';
import { audioBufferToWavBytes } from './engine/wav.js';
import './styles.css';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Clover({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="clover">
      <g fill="currentColor">
        <circle cx="8" cy="8" r="5" />
        <circle cx="16" cy="8" r="5" />
        <circle cx="8" cy="16" r="5" />
        <circle cx="16" cy="16" r="5" />
      </g>
      <path d="M12 12 L18 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const stageEl = useRef(null);
  const deckEl = useRef(null);
  const stageRef = useRef(null);

  const [entered, setEntered] = useState(false);
  const [songId, setSongId] = useState(SONGS[0].id);
  const [playing, setPlaying] = useState(false);
  const [section, setSection] = useState(null);
  const [lyric, setLyric] = useState(null);
  const [bonus, setBonus] = useState(null);
  const [luck, setLuck] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [volume, setVolume] = useState(0.8);
  const [setlistMode, setSetlistMode] = useState(true);
  const [stalls, setStalls] = useState({ n: 0, worst: 0 });
  const [exporting, setExporting] = useState(false);
  const setlistRef = useRef(true);
  setlistRef.current = setlistMode;
  const enteredRef = useRef(false);
  enteredRef.current = entered;

  const song = SONGS.find((s) => s.id === songId);

  // Mount the PixiJS stage once.
  useEffect(() => {
    const stage = new Stage(stageEl.current, conductor);
    stageRef.current = stage;
    stage.init();
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
  }, []);

  // Keep the stage clear of the bottom deck.
  useEffect(() => {
    const el = deckEl.current;
    if (!el) return undefined;
    const apply = () => stageRef.current?.setInsets({ bottom: el.getBoundingClientRect().height });
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const id = setInterval(apply, 500); // stage may finish loading after first observe
    return () => {
      ro.disconnect();
      clearInterval(id);
    };
  }, []);

  // Conductor -> React state.
  useEffect(() => {
    let lyricKey = 0;
    let bonusTimer = 0;
    let nextTimer = 0;
    let toastId = 0;
    const offs = [
      conductor.on('song', (s) => {
        setSongId(s.id);
        const root = document.documentElement.style;
        root.setProperty('--accent', hex(s.palette.accent));
        root.setProperty('--accent2', hex(s.palette.accent2));
      }),
      conductor.on('play', () => {
        setPlaying(true);
        setStalls({ n: 0, worst: 0 });
      }),
      conductor.on('hiccup', (h) => setStalls({ n: h.stalls, worst: h.worstMs })),
      conductor.on('stop', () => {
        setPlaying(false);
        setSection(null);
        setLyric(null);
        setBonus(null);
      }),
      conductor.on('section', ({ sec }) => setSection(sec)),
      conductor.on('lyric', ({ text }) => setLyric(text ? { text, key: ++lyricKey } : null)),
      conductor.on('luck', ({ value }) => setLuck(value)),
      conductor.on('lucky', (ev) => {
        const id = ++toastId;
        setToasts((t) => [...t.slice(-2), { id, label: ev.label, jackpot: ev.type === 'jackpot' }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
        if (ev.type === 'bonus_lyric') {
          setBonus({ text: ev.text, key: id });
          clearTimeout(bonusTimer);
          bonusTimer = setTimeout(() => setBonus(null), conductor.barDuration() * 1000 * 1.6);
        }
      }),
      conductor.on('ended', () => {
        if (!setlistRef.current) return;
        const i = SONGS.findIndex((s) => s.id === conductor.song.id);
        const next = SONGS[(i + 1) % SONGS.length];
        nextTimer = setTimeout(() => conductor.play(next.id), 1600);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      clearTimeout(bonusTimer);
      clearTimeout(nextTimer);
    };
  }, []);

  // Initial palette variables.
  useEffect(() => {
    conductor.select(SONGS[0].id);
  }, []);

  const startShow = () => {
    setEntered(true);
    conductor.play(songId);
  };

  const pickSong = useCallback((id) => {
    if (enteredRef.current) conductor.play(id);
    else conductor.select(id);
  }, []);

  const toggle = () => {
    if (conductor.playing) conductor.stop();
    else conductor.play(songId);
  };

  // Render the selected song offline (no real-time limits) and download it as a WAV.
  // If the WAV is clean but live playback stutters, it's your PC's real-time load, not the music.
  const exportWav = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const buf = await renderSong(song);
      const blob = new Blob([audioBufferToWavBytes(buf)], { type: 'audio/wav' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${song.id}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      console.error('WAV export failed', err);
    } finally {
      setExporting(false);
    }
  };

  const onVolume = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    conductor.setVolume(v);
  };

  // Space toggles play/pause; arrows change song.
  useEffect(() => {
    const onKey = (e) => {
      if (!enteredRef.current) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        conductor.playing ? conductor.stop() : conductor.play();
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const i = SONGS.findIndex((s) => s.id === conductor.song.id);
        const d = e.code === 'ArrowRight' ? 1 : -1;
        pickSong(SONGS[(i + d + SONGS.length) % SONGS.length].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickSong]);

  return (
    <>
      <div className="stage" ref={stageEl} />

      <header className="hud-top">
        <div className="nowplaying" aria-live="polite">
          <span className="np-title">{song.title}</span>
          {section && (
            <>
              <span className="pill">{section.label}</span>
              <span className="lead">{LEAD_LABEL[section.lead]}</span>
            </>
          )}
        </div>
        {playing && stalls.n > 0 && (
          <span
            className="diag"
            title="The page's main thread was busy for a moment. Audio is buffered ahead so it usually survives, but frequent stalls mean this PC is struggling with the visuals."
          >
            {stalls.n} busy-PC stall{stalls.n > 1 ? 's' : ''}, worst {stalls.worst} ms
          </span>
        )}
      </header>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.jackpot ? ' jackpot' : ''}`}>
            <Clover size={16} />
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      <aside className="luck" aria-label="Luck meter">
        <Clover size={26} />
        <div className="luck-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(luck)}>
          <div className="luck-fill" style={{ height: `${luck}%` }} />
        </div>
        <span className="luck-num">{Math.round(luck)}</span>
      </aside>

      <footer className="deck" ref={deckEl}>
        <div className="lyrics" aria-live="off">
          {lyric && (
            <p key={lyric.key} className="lyric-line">
              {lyric.text}
            </p>
          )}
          {bonus && (
            <p key={`b${bonus.key}`} className="bonus-line">
              <Clover size={16} />
              {bonus.text}
            </p>
          )}
        </div>

        <div className="controls">
          <div className="transport">
            <button className="play" onClick={toggle} aria-label={playing ? 'Stop' : 'Play'}>
              {playing ? (
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5 L19 12 L8 19 Z" fill="currentColor" /></svg>
              )}
            </button>
            <label className="vol">
              <span className="sr">Volume</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={onVolume} />
            </label>
            <label className="check">
              <input type="checkbox" checked={setlistMode} onChange={(e) => setSetlistMode(e.target.checked)} />
              <span>Play the whole setlist</span>
            </label>
            <button className="linkbtn" onClick={exportWav} disabled={exporting}>
              {exporting ? 'Rendering WAV...' : 'Save this song as WAV'}
            </button>
          </div>

          <ol className="setlist">
            {SONGS.map((s, i) => (
              <li key={s.id}>
                <button
                  className="ticket"
                  aria-current={s.id === songId}
                  onClick={() => pickSong(s.id)}
                  style={{ '--t-accent': hex(s.palette.accent) }}
                >
                  <span className="stub">{i + 1}</span>
                  <span className="t-main">
                    <span className="t-title">{s.title}</span>
                    <span className="t-meta">{s.feel}, {s.bpm} BPM, {fmt(songSeconds(s))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </footer>

      {!entered && (
        <div className="gate">
          <div className="gate-card">
            <h1>
              Cyan <span className="x">×</span> Miku
            </h1>
            <p className="gate-sub">Live Stage</p>
            <p className="gate-copy">
              Four original songs, a guitar-slinging hero whose luck bends the show, and a stage that reacts to every beat.
            </p>
            <button className="start" onClick={startShow}>
              Start the show
            </button>
            <p className="gate-hint">Sound on. Tap the stage any time to feed Cyan's luck.</p>
          </div>
        </div>
      )}
    </>
  );
}
