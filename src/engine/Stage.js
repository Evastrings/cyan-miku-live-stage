import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import gsap from 'gsap';
import { Cyan, Miku } from './rigs.js';
import { SpritePuppet, loadArtTexture } from './spriteRig.js';
import { ART } from '../characters.js';

// Cap the render size on huge / hi-dpi screens. Fewer pixels = smoother frames,
// and a smooth main thread is what keeps the audio scheduler happy.
const MAX_RENDER_PIXELS = 2.6e6;

/*
 * The Stage owns the PixiJS scene. It never touches audio directly: it reads
 * the Conductor (beat position, spectrum, voice/guitar activity) and listens
 * to its events (section, kick, crash, lucky...).
 *
 * World space is 1280x720. The camera (world container) fits/zooms that into
 * whatever canvas size we get.
 */

export const W = 1280;
export const H = 720;
const FLOOR_Y = 548;
const FEET_Y = 604;

// Camera + actor formations per kind of section. GSAP tweens between them.
const FORMS = {
  idle: { mikuX: 470, cyanX: 810, mikuS: 1.0, cyanS: 1.0, zoom: 1.0, cx: 640, cy: 360 },
  duet: { mikuX: 440, cyanX: 840, mikuS: 1.02, cyanS: 1.02, zoom: 1.04, cx: 640, cy: 370 },
  miku: { mikuX: 590, cyanX: 930, mikuS: 1.16, cyanS: 0.94, zoom: 1.12, cx: 610, cy: 390 },
  cyan: { mikuX: 340, cyanX: 730, mikuS: 0.94, cyanS: 1.16, zoom: 1.12, cx: 690, cy: 390 },
  solo: { mikuX: 330, cyanX: 720, mikuS: 0.9, cyanS: 1.28, zoom: 1.32, cx: 690, cy: 420 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const lerp = (a, b, t) => a + (b - a) * t;

function mix(c1, c2, t) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t) | 0;
  const g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t) | 0;
  const b = lerp(c1 & 255, c2 & 255, t) | 0;
  return (r << 16) | (g << 8) | b;
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

// Swap these two factories to plug in sprite / Spine / Live2D characters.
export const createCyan = () => new Cyan();
export const createMiku = () => new Miku();

export class Stage {
  constructor(container, conductor) {
    this.container = container;
    this.c = conductor;
    this.destroyed = false;
    this.time = 0;
    this.energy = 0.22;
    this.energyTarget = 0.22;
    this.punch = 0;
    this.flashAmt = 0;
    this.insetBottom = 0;
    this.fit = 1;
    this.center = { x: 0, y: 0 };
    this._w = 0;
    this._h = 0;
    this.particles = [];
    this.emitters = [];
    this.form = { ...FORMS.idle };
    this.modes = { cyan: 'idle', miku: 'idle' };
    this.gold = null;
    this.rainbow = null;
    this.unsubs = [];
    this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._tick = this._tick.bind(this);
  }

  async init() {
    const app = new Application();
    const box = this.container.getBoundingClientRect();
    const fitRes = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, box.width * box.height));
    await app.init({
      resizeTo: this.container,
      background: 0x07060f,
      antialias: true,
      autoDensity: true,
      resolution: Math.max(0.75, Math.min(window.devicePixelRatio || 1, fitRes, 2)),
    });
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    this.container.appendChild(app.canvas);
    try {
      await Promise.race([
        document.fonts.load('700 36px Unbounded'),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch (e) {
      /* fall back to system font */
    }
    if (this.destroyed) return;
    this._build();
    app.ticker.add(this._tick);
    this._loadArt(); // swaps in sprite art if public/characters/*.png exist
    this._onPointer = (e) => {
      const r = app.canvas.getBoundingClientRect();
      const p = this.world.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top });
      this.sparkleAt(p.x, p.y);
      this.c.tapLuck();
    };
    app.canvas.addEventListener('pointerdown', this._onPointer);
  }

  setInsets({ bottom = 0 } = {}) {
    this.insetBottom = bottom;
    if (this.app) this._layout();
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((u) => u());
    gsap.killTweensOf(this.form);
    if (this.app) {
      this.app.ticker.remove(this._tick);
      this.app.canvas.removeEventListener('pointerdown', this._onPointer);
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  // ------------------------------------------------------------------ build
  _build() {
    const app = this.app;
    this.world = new Container();
    app.stage.addChild(this.world);

    this.L = {};
    [
      'bgStatic', 'screenStatic', 'screenLive', 'truss', 'beams', 'lasers', 'crowdBack',
      'floorStatic', 'pools', 'actors', 'crowdFront', 'fx',
    ].forEach((n) => {
      const c = new Container();
      this.L[n] = c;
      this.world.addChild(c);
    });
    this.L.beams.blendMode = 'add';
    this.L.lasers.blendMode = 'add';
    this.L.pools.blendMode = 'add';
    this.L.actors.sortableChildren = true;

    this.trussG = new Graphics();
    this.L.truss.addChild(this.trussG);
    this.laserG = new Graphics();
    this.spotG = new Graphics();
    this.L.lasers.addChild(this.laserG, this.spotG);
    this.eq = new Graphics();
    this.L.screenLive.addChild(this.eq);

    const font = 'Unbounded, "Trebuchet MS", system-ui, sans-serif';
    this.titleText = new Text({ text: '', style: { fontFamily: font, fontSize: 36, fill: 0xffffff, fontWeight: '700', letterSpacing: 1 } });
    this.titleText.anchor.set(0.5);
    this.titleText.position.set(640, 98);
    this.subText = new Text({ text: '', style: { fontFamily: font, fontSize: 15, fill: 0xffffff, fontWeight: '500', letterSpacing: 2 } });
    this.subText.anchor.set(0.5);
    this.subText.position.set(640, 140);
    this.subText.alpha = 0.75;
    this.liveText = new Text({ text: 'STANDBY', style: { fontFamily: font, fontSize: 12, fill: 0xffffff, fontWeight: '700', letterSpacing: 2 } });
    this.liveText.anchor.set(0, 0.5);
    this.liveText.position.set(296, 80);
    this.liveDot = new Graphics();
    this.L.screenLive.addChild(this.titleText, this.subText, this.liveText, this.liveDot);

    this.miku = createMiku();
    this.cyan = createCyan();
    this.L.actors.addChild(this.miku.root, this.cyan.root);

    this.flash = new Graphics();
    app.stage.addChild(this.flash);

    this._makeTextures();
    this._layout();
    this._wire();
    this.applySong(this.c.song);
    this._setSection(null);
  }

  /** Replace a placeholder puppet with sprite art, if the image exists. */
  async _loadArt() {
    const base = import.meta.env?.BASE_URL ?? './';
    for (const key of ['cyan', 'miku']) {
      const cfg = ART[key];
      const tex = await loadArtTexture(base + cfg.src);
      if (!tex || this.destroyed || !this.app) continue;
      const puppet = new SpritePuppet(tex, cfg);
      const old = this[key];
      this.L.actors.removeChild(old.root);
      old.root.destroy({ children: true });
      this[key] = puppet;
      this.L.actors.addChild(puppet.root);
    }
  }

  _wire() {
    const on = (t, fn) => this.unsubs.push(this.c.on(t, fn));
    on('song', (s) => this.applySong(s));
    on('play', () => {
      this.liveText.text = 'LIVE';
    });
    on('stop', () => {
      this.liveText.text = 'STANDBY';
      this._setSection(null);
    });
    on('section', ({ sec }) => this._setSection(sec));
    on('kick', () => {
      this.punch = 1;
      if (this.song?.lights === 'strobe' && !this.reduceMotion) this.flashAmt = Math.max(this.flashAmt, 0.08);
    });
    on('crash', () => {
      if (!this.reduceMotion) this.flashAmt = Math.max(this.flashAmt, 0.28);
    });
    on('lucky', (ev) => this._lucky(ev));
  }

  _makeTextures() {
    const r = this.app.renderer;
    let g = new Graphics();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.circle(dx * 7, dy * 7, 7.6).fill(0x38d96b);
    g.circle(0, 0, 4).fill(0x1f9e4a);
    g.roundRect(-1, 8, 2.5, 12, 1).fill(0x1f9e4a);
    this.texClover = r.generateTexture(g);
    g.destroy();

    g = new Graphics();
    g.rect(-5, -3, 10, 6).fill(0xffffff);
    this.texConfetti = r.generateTexture(g);
    g.destroy();

    g = new Graphics();
    g.circle(0, 0, 8).fill({ color: 0xffffff, alpha: 0.18 });
    g.circle(0, 0, 5).fill({ color: 0xffffff, alpha: 0.45 });
    g.circle(0, 0, 2.5).fill(0xffffff);
    this.texSpark = r.generateTexture(g);
    g.destroy();

    g = new Graphics();
    g.star(0, 0, 5, 9, 4).fill(0xffffff);
    this.texStar = r.generateTexture(g);
    g.destroy();
  }

  _layout() {
    const app = this.app;
    const w = app.screen.width;
    const h = app.screen.height;
    const availH = Math.max(200, h - this.insetBottom);
    const viewW = w / availH < 1.1 ? 860 : W; // portrait phones crop the sides
    this.fit = Math.min(w / viewW, availH / H);
    this.center = { x: w / 2, y: availH / 2 };
    this.flash.clear();
    this.flash.rect(0, 0, w, h).fill(0xffffff);
    this.flash.alpha = 0;
    this._w = w;
    this._h = h;
  }

  // -------------------------------------------------------------- per-song
  applySong(song) {
    this.song = song;
    this.pal = song.palette;
    this.titleText.text = song.title;
    this._drawBackdrop();
  }

  _clear(layer) {
    layer.removeChildren().forEach((c) => c.destroy());
  }

  _drawBackdrop() {
    const p = this.pal;

    // sky gradient, wall strips, truss, halo
    this._clear(this.L.bgStatic);
    let g = new Graphics();
    const y0 = -700;
    const y1 = FLOOR_Y + 20;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      g.rect(-1400, y0 + ((y1 - y0) * i) / n, 4080, (y1 - y0) / n + 1).fill(mix(p.sky1, p.sky2, Math.pow(t, 1.3)));
    }
    for (let x = -1200; x < 2400; x += 80) g.rect(x, -700, 2, 1300).fill({ color: p.accent, alpha: 0.05 });
    g.circle(640, 170, 380).fill({ color: p.accent, alpha: 0.07 });
    g.circle(640, 170, 250).fill({ color: p.accent, alpha: 0.08 });
    g.rect(-1400, -300, 4080, 326).fill(0x0b0a16);
    g.rect(-1400, 26, 4080, 3).fill({ color: p.accent, alpha: 0.4 });
    this.L.bgStatic.addChild(g);

    // big screen frame
    this._clear(this.L.screenStatic);
    g = new Graphics();
    g.roundRect(250, 52, 780, 232, 14).fill(0x05040c);
    g.roundRect(250, 52, 780, 232, 14).stroke({ width: 3, color: p.accent, alpha: 0.65 });
    this.L.screenStatic.addChild(g);

    // floor
    this._clear(this.L.floorStatic);
    g = new Graphics();
    const fn = 30;
    const top = mix(p.sky2, 0x000000, 0.35);
    const bot = mix(p.sky1, 0x000000, 0.7);
    for (let i = 0; i < fn; i++) {
      g.rect(-1400, FLOOR_Y + (i * 560) / fn, 4080, 560 / fn + 1).fill(mix(top, bot, i / (fn - 1)));
    }
    g.rect(-1400, FLOOR_Y, 4080, 3).fill({ color: p.accent, alpha: 0.55 });
    for (let i = -12; i <= 12; i++) {
      g.moveTo(640 + i * 70, FLOOR_Y).lineTo(640 + i * 220, 1100);
    }
    g.stroke({ width: 2, color: p.accent, alpha: 0.09 });
    this.L.floorStatic.addChild(g);

    // spot pools under each character
    this._clear(this.L.pools);
    this.pools = [0, 1].map(() => {
      const pg = new Graphics();
      pg.ellipse(0, 0, 120, 24).fill({ color: p.accent, alpha: 0.22 });
      pg.ellipse(0, 0, 70, 13).fill({ color: p.accent2, alpha: 0.22 });
      this.L.pools.addChild(pg);
      return pg;
    });

    // beams
    this._clear(this.L.beams);
    this.beams = [120, 290, 460, 640, 820, 990, 1160].map((x, i) => {
      const c = new Container();
      c.x = x;
      c.y = 28;
      const bg = new Graphics();
      c.addChild(bg);
      this.L.beams.addChild(c);
      const b = { c, g: bg, i, color: -1, base: ((x - 640) / 640) * 0.32, phase: i * 0.9 };
      this._paintBeam(b, i % 2 ? p.accent2 : p.accent);
      return b;
    });

    // crowd
    this._clear(this.L.crowdBack);
    g = new Graphics();
    for (let i = 0; i < 46; i++) {
      const x = -40 + i * 30 + rand(-8, 8);
      const y = 652 + rand(-10, 8);
      const r = rand(9, 12);
      g.circle(x, y - 2, r + 1.5).fill({ color: p.accent, alpha: 0.07 });
      g.circle(x, y, r).fill(0x0b0913);
      g.ellipse(x, y + r + 16, r + 8, 22).fill(0x0b0913);
    }
    this.L.crowdBack.addChild(g);
    this.crowdBackG = g;

    this._clear(this.L.crowdFront);
    this.people = [];
    this.sticks = [];
    const lantern = this.song.lights === 'lanterns';
    for (let i = 0; i < 20; i++) {
      const cont = new Container();
      cont.x = -30 + i * 70 + rand(-14, 14);
      cont.y = 706;
      const pg = new Graphics();
      pg.circle(0, 0, 22).fill(0x05040a);
      pg.ellipse(0, 44, 44, 52).fill(0x05040a);
      cont.addChild(pg);
      if (i % 2 === 0 || lantern) {
        const stick = new Container();
        stick.x = i % 2 ? -14 : 14;
        stick.y = -4;
        const sg = new Graphics();
        const col = i % 4 < 2 ? p.accent : p.accent2;
        sg.roundRect(-3, -56, 6, 56, 3).fill(col);
        sg.circle(0, -56, lantern ? 20 : 13).fill({ color: col, alpha: 0.3 });
        sg.blendMode = 'add';
        stick.addChild(sg);
        cont.addChild(stick);
        this.sticks.push({ stick, i });
      }
      this.L.crowdFront.addChild(cont);
      this.people.push({ cont, i });
    }
    this.rainbow = null;
  }

  _paintBeam(b, color) {
    if (b.color === color) return;
    b.color = color;
    b.g.clear();
    b.g.poly([-7, 0, 7, 0, 95, 700, -95, 700]).fill({ color, alpha: 0.16 });
    b.g.poly([-3, 0, 3, 0, 45, 700, -45, 700]).fill({ color, alpha: 0.12 });
  }

  // ------------------------------------------------------------ choreography
  _setSection(sec) {
    let modes = { cyan: 'idle', miku: 'idle' };
    let key = 'idle';
    if (sec) {
      const id = sec.id;
      if (id === 'intro') { modes = { cyan: 'guitar', miku: 'idle' }; key = 'duet'; }
      else if (id === 'solo') { modes = { cyan: 'solo', miku: 'groove' }; key = 'solo'; }
      else if (id === 'outro') { modes = { cyan: 'wave', miku: 'wave' }; key = 'duet'; }
      else if (sec.lead === 'miku') { modes = { cyan: 'guitar', miku: 'sing' }; key = 'miku'; }
      else if (sec.lead === 'cyan') { modes = { cyan: 'sing', miku: 'dance' }; key = 'cyan'; }
      else { modes = { cyan: 'guitar', miku: 'dance' }; key = 'duet'; }
      this.energyTarget = sec.energy;
      this.subText.text = sec.label.toUpperCase();
    } else {
      this.energyTarget = 0.22;
      this.subText.text = '';
    }
    this.modes = modes;
    gsap.to(this.form, { ...FORMS[key], duration: 1.1, ease: 'power2.inOut', overwrite: true });
  }

  // ------------------------------------------------------------------ frame
  _tick(ticker) {
    if (this.destroyed || !this.app) return;
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    this.time += dt;
    const c = this.c;
    const playing = c.playing;
    if (this.app.screen.width !== this._w || this.app.screen.height !== this._h) this._layout();

    const bp = playing ? c.beatPosition() : (this.time * 100) / 60;
    const frac = bp - Math.floor(bp);
    const pulse = Math.pow(1 - frac, 3);
    this.energy += ((playing ? this.energyTarget : 0.22) - this.energy) * Math.min(1, dt * 2.5);
    const e = this.energy;
    this.punch *= Math.exp(-dt * 9);
    const rm = this.reduceMotion ? 0 : 1;
    const f = this.form;
    const pal = this.pal;
    const lights = this.song.lights;

    // camera
    const z = this.fit * f.zoom * (1 + this.punch * 0.012 * e * rm);
    this.world.scale.set(z);
    this.world.pivot.set(f.cx, f.cy);
    this.world.position.set(this.center.x, this.center.y);

    // beams
    const rainbowOn = !!this.rainbow;
    if (rainbowOn) {
      this.rainbow.t += dt;
      if (this.rainbow.t > this.rainbow.dur) {
        this.rainbow = null;
        this.beams.forEach((b) => (b.color = -1));
      }
    }
    this.beams.forEach((b) => {
      if (this.rainbow) this._paintBeam(b, hsl(Math.floor(((this.time * 120 + b.i * 50) % 360) / 12) * 12, 0.9, 0.6));
      else this._paintBeam(b, b.i % 2 ? pal.accent2 : pal.accent);
      b.c.rotation = b.base + Math.sin(this.time * (0.5 + e * 0.7) + b.phase) * (0.1 + 0.25 * e) * (rm ? 1 : 0.3);
      let a = 0.28 + 0.72 * (0.45 + 0.55 * e) * (0.55 + 0.45 * pulse);
      if (lights === 'lanterns') a *= 0.55;
      b.c.alpha = Math.min(1, a);
      b.c.visible = lights === 'strobe' && playing ? (Math.floor(bp * 2) + b.i) % 2 === 0 : true;
    });

    // lasers + golden spot
    this.laserG.clear();
    if (lights === 'lasers' && playing) {
      for (let i = 0; i < 12; i++) {
        const x = 90 + i * 100;
        const ex = x + Math.sin(this.time * 0.8 + i) * 520;
        this.laserG.moveTo(x, 28).lineTo(ex, 640);
        if (i % 2 === 1 || i === 11) {
          this.laserG.stroke({ width: 2, color: i % 4 < 2 ? pal.accent : pal.accent2, alpha: 0.6 * e });
        }
      }
    }
    this.spotG.clear();
    if (this.gold) {
      this.gold.t += dt;
      const k = this.gold.t / this.gold.dur;
      if (k >= 1) this.gold = null;
      else {
        const a = Math.sin(Math.PI * k) * 0.42;
        const x = this.cyan.root.x;
        this.spotG.poly([x - 14, 28, x + 14, 28, x + 160, FEET_Y + 30, x - 160, FEET_Y + 30]).fill({ color: 0xffd35c, alpha: a });
        if (Math.random() < dt * 24) {
          this._spawn(this.texSpark, x + rand(-60, 60), FEET_Y - rand(20, 260), {
            vy: -rand(30, 90), life: 1.4, scale: rand(0.8, 1.6), tint: 0xffe28a, add: true,
          });
        }
      }
    }

    // truss lamps
    this.trussG.clear();
    for (let i = 0; i < 21; i++) {
      const col = i % 2 ? pal.accent2 : pal.accent;
      const a = 0.35 + 0.65 * pulse * e;
      this.trussG.circle(i * 64, 14, 12).fill({ color: col, alpha: a * 0.2 });
      this.trussG.circle(i * 64, 14, 6).fill({ color: col, alpha: 0.4 + 0.6 * a });
    }

    // big screen: equalizer + live dot
    const spec = playing ? c.audio.getSpectrum(32) : null;
    this.eq.clear();
    for (let i = 0; i < 32; i++) {
      const v = spec ? spec[i] : 0.06 + 0.05 * Math.sin(this.time * 2 + i * 0.5);
      const h = 6 + v * 104;
      this.eq.roundRect(274 + i * 23, 268 - h, 20, h, 3).fill({ color: i % 2 ? pal.accent2 : pal.accent, alpha: 0.85 });
    }
    this.liveDot.clear();
    const dotOn = playing ? 1 : 0.35 + 0.15 * Math.sin(this.time * 3);
    this.liveDot.circle(284, 80, 5).fill({ color: playing ? 0xff3b4d : 0x8a8fa3, alpha: dotOn });

    // crowd
    const bob = Math.abs(Math.sin(bp * Math.PI));
    this.crowdBackG.y = -bob * 6 * e * rm;
    this.people.forEach(({ cont, i }) => {
      cont.y = 706 - Math.abs(Math.sin(bp * Math.PI + i * 0.4)) * 10 * e * rm;
    });
    this.sticks.forEach(({ stick, i }) => {
      stick.rotation = Math.sin(bp * Math.PI * 0.5 + i) * 0.5 * (0.4 + e) + (i % 2 ? -0.2 : 0.2);
    });
    if (lights === 'lanterns' && playing && Math.random() < dt * 3) {
      this._spawn(this.texSpark, rand(0, W), 700, { vy: -rand(30, 60), life: 5, scale: 1.6, scale2: 0.6, tint: pal.accent, add: true, sway: 20 });
    }

    // actors
    const sec = c.currentSection;
    const lead = sec ? sec.lead : 'duet';
    const voice = c.voiceActive;
    const gtr = c.gtrActive;
    const mikuMouth = voice;
    const cyanMouth = (voice && lead === 'duet') || (gtr && lead === 'cyan' && sec.id !== 'solo');

    this.miku.root.position.set(f.mikuX, FEET_Y);
    this.miku.root.scale.set(f.mikuS);
    this.miku.root.zIndex = f.mikuS * 100;
    this.cyan.root.position.set(f.cyanX, FEET_Y);
    this.cyan.root.scale.set(f.cyanS);
    this.cyan.root.zIndex = f.cyanS * 100;
    this.miku.update(dt, { bp, energy: e, mode: this.modes.miku, mouth: mikuMouth, time: this.time });
    this.cyan.update(dt, { bp, energy: e, mode: this.modes.cyan, mouth: cyanMouth, time: this.time });
    this.pools[0].position.set(f.mikuX, FEET_Y + 4);
    this.pools[0].scale.set(f.mikuS);
    this.pools[1].position.set(f.cyanX, FEET_Y + 4);
    this.pools[1].scale.set(f.cyanS);

    this._updateParticles(dt);

    // screen flash
    this.flashAmt *= Math.exp(-dt * 6);
    this.flash.alpha = this.flashAmt;
  }

  // -------------------------------------------------------------- particles
  _spawn(tex, x, y, o = {}) {
    if (this.particles.length > 520) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.x = x;
    s.y = y;
    s.tint = o.tint ?? 0xffffff;
    if (o.add) s.blendMode = 'add';
    s.scale.set(o.scale ?? 1);
    s.rotation = o.rot ?? 0;
    this.L.fx.addChild(s);
    this.particles.push({
      s, vx: o.vx ?? 0, vy: o.vy ?? 0, g: o.g ?? 0, drag: o.drag ?? 0, spin: o.spin ?? 0,
      life: o.life ?? 2, age: 0, sc0: o.scale ?? 1, sc1: o.scale2 ?? o.scale ?? 1,
      sway: o.sway ?? 0, ph: Math.random() * 6.28, flutter: !!o.flutter,
    });
  }

  _updateParticles(dt) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      em.t += dt;
      em.acc += dt * em.rate;
      while (em.acc >= 1) {
        em.acc -= 1;
        em.fn();
      }
      if (em.t >= em.dur) this.emitters.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.L.fx.removeChild(p.s);
        p.s.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      p.vy += p.g * dt;
      if (p.drag) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d;
        p.vy *= d;
      }
      p.s.x += (p.vx + Math.sin(p.age * 3 + p.ph) * p.sway) * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const sc = p.sc0 + (p.sc1 - p.sc0) * k;
      p.s.scale.x = sc;
      p.s.scale.y = p.flutter ? sc * Math.cos(p.age * 10 + p.ph) : sc;
      p.s.alpha = Math.min(1, p.age / 0.12) * Math.min(1, (p.life - p.age) / 0.6);
    }
  }

  // ---------------------------------------------------------------- effects
  _lucky({ type }) {
    switch (type) {
      case 'clover_rain': this.cloverRain(4); break;
      case 'confetti': this.confetti(); break;
      case 'golden_spot': this.gold = { t: 0, dur: 4.5 }; break;
      case 'fireworks': this.fireworks(); break;
      case 'rainbow': this.rainbow = { t: 0, dur: 4 }; break;
      case 'jackpot': this.jackpot(); break;
      case 'bonus_lyric': this.sparkleAt(this.cyan.root.x, FEET_Y - 250, true); break;
      default: break;
    }
  }

  cloverRain(dur = 4) {
    this.emitters.push({
      t: 0, dur, acc: 0, rate: 26,
      fn: () => this._spawn(this.texClover, rand(-60, W + 60), -30, {
        vy: rand(90, 170), sway: 40, spin: rand(-2, 2), scale: rand(0.7, 1.2), life: 6.5,
      }),
    });
  }

  confetti() {
    const colors = [0xffd35c, 0x5ff5e2, 0xff5ecb, 0xffffff, 0x8dff6a];
    for (const side of [-1, 1]) {
      const x = side < 0 ? 40 : W - 40;
      for (let i = 0; i < 70; i++) {
        const ang = rand(0.15, 0.7); // radians away from straight up, toward the stage centre
        const sp = rand(500, 900);
        this._spawn(this.texConfetti, x, 620, {
          vx: -side * Math.sin(ang) * sp, vy: -Math.cos(ang) * sp,
          g: 700, drag: 0.6, spin: rand(-8, 8), tint: pick(colors), life: rand(2.2, 3.4), flutter: true, scale: rand(0.8, 1.3),
        });
      }
    }
  }

  fireworks() {
    for (let n = 0; n < 3; n++) {
      gsap.delayedCall(n * 0.5, () => {
        if (this.destroyed) return;
        const cx = rand(300, 980);
        const cy = rand(110, 250);
        const col = pick([0xffd35c, this.pal.accent, this.pal.accent2, 0xff5ecb]);
        for (let i = 0; i < 46; i++) {
          const a = (i / 46) * Math.PI * 2 + rand(-0.1, 0.1);
          const sp = rand(120, 260);
          this._spawn(this.texSpark, cx, cy, {
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 160, drag: 1.5,
            life: 1.3, scale: 1.4, scale2: 0.2, tint: col, add: true,
          });
        }
        if (!this.reduceMotion) this.flashAmt = Math.max(this.flashAmt, 0.12);
      });
    }
  }

  sparkleAt(x, y, gold = false) {
    if (!this.app) return;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 200);
      this._spawn(gold ? this.texStar : this.texSpark, x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 200, drag: 1.2, life: 1, scale: rand(0.8, 1.6),
        scale2: 0.2, tint: gold ? 0xffd35c : this.pal.accent2, add: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      this._spawn(this.texClover, x, y, { vx: rand(-60, 60), vy: -rand(80, 160), g: 260, spin: rand(-3, 3), life: 1.4, scale: 0.8 });
    }
  }

  jackpot() {
    if (!this.reduceMotion) this.flashAmt = 0.8;
    this.confetti();
    this.fireworks();
    this.cloverRain(5);
    this.rainbow = { t: 0, dur: 5 };
    this.gold = { t: 0, dur: 5 };
    const t = new Text({
      text: '777',
      style: { fontFamily: 'Unbounded, sans-serif', fontSize: 150, fontWeight: '700', fill: 0xffd35c, stroke: { color: 0x7a4a00, width: 8 } },
    });
    t.anchor.set(0.5);
    t.position.set(640, 300);
    t.scale.set(0);
    this.L.fx.addChild(t);
    gsap.timeline({ onComplete: () => { if (!t.destroyed) t.destroy(); } })
      .to(t.scale, { x: 1.2, y: 1.2, duration: 0.6, ease: 'back.out(2.2)' })
      .to(t, { alpha: 0, duration: 0.8, delay: 1.6 });
  }
}
