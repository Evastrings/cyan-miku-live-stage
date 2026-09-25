import { Container, Graphics } from 'pixi.js';

/*
 * Procedural 2.5D puppets built from PixiJS Graphics.
 *
 * These are stylised PLACEHOLDERS so the project runs with zero assets.
 * Every puppet exposes the same tiny interface:
 *
 *   puppet.root                      -> Pixi Container (feet at 0,0, y is up = negative)
 *   puppet.update(dt, ctx)           -> animate one frame
 *   ctx = { bp, energy, mode, mouth, time }
 *
 * To use your own art, write a class with that interface (sprite sheet,
 * Spine, Live2D...) and return it from createCyan()/createMiku() in Stage.js.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const UL = 38; // upper arm length
const FL = 36; // forearm length

/**
 * Two-bone IK in the torso's frame. (x, y) is the hand target relative to the
 * shoulder. Rotation 0 = arm hanging straight down; positive = swings toward
 * screen-left. `flip` picks which way the elbow bends.
 */
function solveArm(x, y, flip) {
  const d = clamp(Math.hypot(x, y), 8, UL + FL - 0.5);
  const a = Math.acos(clamp((UL * UL + d * d - FL * FL) / (2 * UL * d), -1, 1));
  const b = Math.acos(clamp((UL * UL + FL * FL - d * d) / (2 * UL * FL), -1, 1));
  const base = Math.atan2(-x, y);
  return { up: base + flip * a, fore: -flip * (Math.PI - b) };
}

function hairChain(n, segLen, w0, w1, color) {
  const root = new Container();
  const joints = [];
  let parent = root;
  for (let i = 0; i < n; i++) {
    const c = new Container();
    c.y = i === 0 ? 0 : segLen;
    const wa = lerp(w0, w1, i / n);
    const wb = lerp(w0, w1, (i + 1) / n);
    const g = new Graphics();
    g.poly([-wa / 2, 0, wa / 2, 0, wb / 2, segLen, -wb / 2, segLen]).fill(color);
    g.circle(0, 0, wa / 2).fill(color);
    if (i === n - 1) g.circle(0, segLen, wb / 2).fill(color);
    c.addChild(g);
    parent.addChild(c);
    joints.push(c);
    parent = c;
  }
  return { root, joints };
}

function swayChain(chain, time, phase, amp, bias) {
  chain.joints.forEach((j, k) => {
    j.rotation = (k === 0 ? bias : 0) + amp * Math.sin(phase - k * 0.75) * (0.5 + k * 0.2);
  });
}

function makeLeg(x, { skin, bootColor, sole, bootTop = 50, band = null }) {
  const c = new Container();
  c.x = x;
  c.y = -105;
  const g = new Graphics();
  g.roundRect(-7, -2, 14, 80, 6).fill(skin);
  g.roundRect(-9, bootTop, 18, 105 - bootTop, 7).fill(bootColor);
  if (band) g.rect(-9, bootTop - 4, 18, 5).fill(band);
  g.roundRect(-11, 100, 25, 6, 3).fill(sole);
  c.addChild(g);
  return c;
}

function makeArm({ skin, sleeve = null, cuff = null }) {
  const up = new Container();
  const gu = new Graphics();
  gu.roundRect(-6, -4, 12, UL + 8, 6).fill(skin);
  up.addChild(gu);
  const fore = new Container();
  fore.y = UL;
  const gf = new Graphics();
  gf.roundRect(-5.2, -4, 10.4, FL + 8, 5).fill(skin);
  if (sleeve) {
    gf.roundRect(-7.5, -5, 15, FL * 0.72, 6).fill(sleeve);
    if (cuff) gf.rect(-8, FL * 0.72 - 6, 16, 5).fill(cuff);
  }
  gf.circle(0, FL + 4, 6.5).fill(skin);
  fore.addChild(gf);
  up.addChild(fore);
  return { up, fore };
}

function makeHead({ skin, hair, iris, headset = null }) {
  const c = new Container();
  const face = new Graphics();
  face.ellipse(0, -34, 31, 33).fill(skin);
  c.addChild(face);

  const h = new Graphics();
  h.ellipse(0, -55, 35, 19).fill(hair);
  h.poly([-36, -52, -29, -52, -29, -6, -38, -16]).fill(hair);
  h.poly([36, -52, 29, -52, 29, -6, 38, -16]).fill(hair);
  h.poly([-33, -56, -24, -40, -12, -58]).fill(hair);
  h.poly([-16, -58, -6, -38, 6, -58]).fill(hair);
  h.poly([4, -58, 14, -40, 26, -58]).fill(hair);
  h.poly([22, -58, 28, -42, 35, -56]).fill(hair);
  c.addChild(h);

  if (headset) {
    const hs = new Graphics();
    for (const sx of [-1, 1]) {
      hs.circle(sx * 34, -32, 9).fill(headset.color);
      hs.circle(sx * 34, -32, 5).fill(headset.ring);
    }
    c.addChild(hs);
  }

  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new Container();
    e.x = sx * 12.5;
    e.y = -27;
    const eg = new Graphics();
    eg.ellipse(0, 0, 5.8, 7.8).fill(0x1b2233);
    eg.ellipse(0, 0.6, 4.7, 6.6).fill(iris);
    eg.ellipse(0, 2.6, 3.4, 3.6).fill({ color: 0xffffff, alpha: 0.28 });
    eg.circle(-1.6, -2.4, 1.9).fill(0xffffff);
    eg.rect(-6.4, -8.4, 12.8, 2.2).fill(0x1b2233);
    e.addChild(eg);
    c.addChild(e);
    eyes.push(e);
  }

  const blush = new Graphics();
  blush.ellipse(-19, -16, 6, 3.2).fill({ color: 0xff8fa3, alpha: 0.38 });
  blush.ellipse(19, -16, 6, 3.2).fill({ color: 0xff8fa3, alpha: 0.38 });
  c.addChild(blush);

  const mouth = new Graphics();
  mouth.ellipse(0, 0, 4.2, 2.6).fill(0xb8434f);
  mouth.y = -12;
  c.addChild(mouth);

  return { c, eyes, mouth };
}

function drawClover(g, x, y, r, color, dark) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    g.circle(x + dx * r, y + dy * r, r * 1.02).fill(color);
  }
  g.circle(x, y, r * 0.55).fill(dark);
}

function makeGuitar(body, trim) {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(-96, -4, 70, 8, 3).fill(0x8a5a34);
  g.rect(-94, -2.5, 66, 5).fill(0x2b1c14);
  g.roundRect(-110, -7, 16, 14, 3).fill(trim);
  g.ellipse(-8, 0, 20, 17).fill(body);
  g.ellipse(14, 1, 28, 23).fill(body);
  g.circle(12, 0, 7).fill(0x14121e);
  g.rect(26, -7, 4, 14).fill(0xf0e6d0);
  drawClover(g, 4, 12, 3.2, 0x35d46a, 0x1e9e4a);
  g.moveTo(-104, 0).lineTo(28, 0).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
  c.addChild(g);
  return c;
}

// -------------------------------------------------------------------------
class Puppet {
  constructor() {
    this.root = new Container();
    this.tgt = {};
    this.cur = null;
    this.seed = Math.random() * 3;
  }

  _smooth(dt, rate = 12) {
    if (!this.cur) this.cur = { ...this.tgt };
    const k = Math.min(1, dt * rate);
    for (const key in this.tgt) this.cur[key] += (this.tgt[key] - this.cur[key]) * k;
  }

  _face(time, mouthOpen) {
    const bl = (time + this.seed) % 3.6;
    const k = bl > 3.45 ? Math.max(0, 1 - Math.abs((bl - 3.525) / 0.075)) : 0;
    this.eyes.forEach((e) => (e.scale.y = 1 - 0.9 * k));
    this.mouth.scale.y = 0.35 + mouthOpen * (0.6 + 0.9 * Math.abs(Math.sin(time * 13)));
  }

  _legs(dt, o) {
    // hips lower on the beat and rise between beats; legs stretch to keep feet planted
    const sq = o.squat;
    this.hips.y = -105 + sq;
    for (const leg of [this.legL, this.legR]) {
      leg.y = -105 + sq;
      leg.scale.y = (105 - sq) / 105;
    }
  }
}

// -------------------------------------------------------------------------
export class Cyan extends Puppet {
  constructor() {
    super();
    const HAIR = 0x35e0d4;
    const SKIN = 0xffe3d3;
    const WHITE = 0xf7f9ff;
    const SHADE = 0xd3daea;

    this.legL = makeLeg(-13, { skin: SKIN, bootColor: WHITE, sole: 0xb9c2d6, bootTop: 52 });
    this.legR = makeLeg(13, { skin: SKIN, bootColor: WHITE, sole: 0xb9c2d6, bootTop: 52 });
    this.root.addChild(this.legL, this.legR);

    this.hips = new Container();
    this.hips.y = -105;
    const shorts = new Graphics();
    shorts.roundRect(-24, -8, 48, 34, 8).fill(0x22415a);
    this.hips.addChild(shorts);
    this.root.addChild(this.hips);

    this.torso = new Container();
    this.hips.addChild(this.torso);

    // long hair behind the body
    this.hair = [-24, 0, 24].map((x, i) => {
      const ch = hairChain(4, 30, 34, 14, HAIR);
      ch.root.x = x;
      ch.root.y = -130;
      this.torso.addChild(ch.root);
      return ch;
    });

    const tg = new Graphics();
    tg.poly([-23, -84, 23, -84, 19, 0, -19, 0]).fill(WHITE);
    tg.roundRect(-13, -99, 26, 20, 6).fill(WHITE);
    tg.rect(-13, -84, 26, 2).fill(SHADE);
    drawClover(tg, 0, -60, 6.4, 0x35d46a, 0x1e9e4a);
    this.torso.addChild(tg);

    this.guitar = makeGuitar(0x14b8b0, 0xffffff);
    this.guitar.x = 4;
    this.guitar.y = -30;
    this.guitar.rotation = 0.3;
    this.torso.addChild(this.guitar);

    this.armL = makeArm({ skin: SKIN });
    this.armR = makeArm({ skin: SKIN });
    this.armL.up.x = -23;
    this.armL.up.y = -78;
    this.armR.up.x = 23;
    this.armR.up.y = -78;
    this.torso.addChild(this.armL.up, this.armR.up);

    const head = makeHead({ skin: SKIN, hair: HAIR, iris: 0x35e0d4 });
    head.c.y = -95;
    this.head = head.c;
    this.eyes = head.eyes;
    this.mouth = head.mouth;
    this.torso.addChild(this.head);
  }

  update(dt, o) {
    const { bp, energy, mode, mouth, time } = o;
    const e = 0.3 + energy * 0.7;
    const beatAbs = Math.abs(Math.sin(bp * Math.PI));
    const sway = Math.sin(bp * Math.PI * 0.5);
    const T = this.tgt;

    let lean = 0, tilt = 0, gRot = 0.3, strum = 6, slide = 5, kick = 0, wave = 0, hair = 0.07, jump = 2;
    switch (mode) {
      case 'guitar':
        lean = 0.05 * sway; tilt = 0.07 * sway; strum = 10 * e; slide = 8; jump = 4 * e; hair = 0.04 + 0.09 * e;
        break;
      case 'sing':
        lean = 0.04 * sway; tilt = 0.14 * Math.sin(bp * Math.PI * 0.5 + 1); strum = 6 * e; slide = 5; jump = 3 * e; hair = 0.1;
        break;
      case 'solo':
        lean = -0.12 + 0.04 * sway; tilt = -0.16; gRot = 0.58; strum = 13; slide = 18; jump = 6; kick = 1; hair = 0.22;
        break;
      case 'wave':
        wave = 1; strum = 3; lean = 0.03 * sway; tilt = 0.1 * sway; jump = 2; hair = 0.08;
        break;
      default:
        strum = 2; slide = 2; hair = 0.05; jump = 1;
    }
    Object.assign(T, { lean, tilt, gRot, strum, slide, kick, wave, hair, jump, mouth: mouth ? 1 : 0, e });
    this._smooth(dt);
    const C = this.cur;

    this._legs(dt, { squat: 6 * C.e * (1 - beatAbs) - C.jump * beatAbs });
    this.legL.rotation = 0.06 + 0.04 * sway;
    this.legR.rotation = -0.06 - 0.04 * sway - C.kick * 0.5 * Math.max(0, Math.sin(bp * Math.PI));

    this.torso.rotation = C.lean;
    this.head.rotation = C.tilt - C.lean * 0.5;
    this.guitar.rotation = C.gRot + 0.02 * Math.sin(bp * Math.PI * 2);

    // hand targets (torso space), transformed from guitar-local points
    const gp = (lx, ly) => {
      const c = Math.cos(this.guitar.rotation);
      const s = Math.sin(this.guitar.rotation);
      return { x: this.guitar.x + lx * c - ly * s, y: this.guitar.y + lx * s + ly * c };
    };
    const fret = gp(-62 + C.slide * Math.sin(bp * Math.PI * 0.5 + this.seed), 2);
    const strumPt = gp(14, 6 + C.strum * Math.sin(bp * Math.PI * 4));
    const wavePt = { x: 58 + 16 * Math.sin(bp * Math.PI * 2), y: -150 };
    const rx = lerp(strumPt.x, wavePt.x, C.wave);
    const ry = lerp(strumPt.y, wavePt.y, C.wave);

    const aL = solveArm(fret.x + 23, fret.y + 78, 1);
    const aR = solveArm(rx - 23, ry + 78, -1);
    this.armL.up.rotation = aL.up;
    this.armL.fore.rotation = aL.fore;
    this.armR.up.rotation = aR.up;
    this.armR.fore.rotation = aR.fore;

    this.hair.forEach((ch, i) => {
      swayChain(ch, time, bp * Math.PI - i * 0.5, C.hair * (i === 1 ? 0.8 : 1), (i - 1) * 0.05);
    });

    this._face(time, C.mouth);
  }
}

// -------------------------------------------------------------------------
export class Miku extends Puppet {
  constructor() {
    super();
    const TEAL = 0x39c5bb;
    const TEAL_D = 0x2a9d96;
    const BLACK = 0x23262f;
    const GRAY = 0xd8dde2;
    const SKIN = 0xfff0e6;

    this.legL = makeLeg(-13, { skin: BLACK, bootColor: BLACK, sole: TEAL_D, bootTop: 60, band: TEAL });
    this.legR = makeLeg(13, { skin: BLACK, bootColor: BLACK, sole: TEAL_D, bootTop: 60, band: TEAL });
    this.root.addChild(this.legL, this.legR);

    this.hips = new Container();
    this.hips.y = -105;
    const skirt = new Graphics();
    skirt.poly([-24, -6, 24, -6, 36, 32, -36, 32]).fill(BLACK);
    skirt.rect(-36, 30, 72, 3).fill(TEAL);
    this.hips.addChild(skirt);
    this.root.addChild(this.hips);

    this.torso = new Container();
    this.hips.addChild(this.torso);

    // twin tails behind the body
    this.tails = [-1, 1].map((sx) => {
      const ch = hairChain(5, 36, 30, 9, TEAL);
      ch.root.x = sx * 36;
      ch.root.y = -134;
      this.torso.addChild(ch.root);
      return ch;
    });

    const tg = new Graphics();
    tg.poly([-23, -84, 23, -84, 19, 0, -19, 0]).fill(GRAY);
    tg.roundRect(-11, -96, 22, 16, 5).fill(GRAY);
    tg.poly([-5, -80, 5, -80, 7, -50, 0, -42, -7, -50]).fill(TEAL);
    tg.rect(-19, -8, 38, 8).fill(TEAL_D);
    this.torso.addChild(tg);

    this.armL = makeArm({ skin: SKIN, sleeve: BLACK, cuff: TEAL });
    this.armR = makeArm({ skin: SKIN, sleeve: BLACK, cuff: TEAL });
    this.armL.up.x = -23;
    this.armL.up.y = -78;
    this.armR.up.x = 23;
    this.armR.up.y = -78;
    // little mic in the right hand, shown while singing
    this.mic = new Graphics();
    this.mic.roundRect(-3, FL + 2, 6, 14, 3).fill(0x2b2f3a);
    this.mic.circle(0, FL + 18, 5).fill(0x9aa3b2);
    this.armR.fore.addChild(this.mic);
    this.torso.addChild(this.armL.up, this.armR.up);

    const head = makeHead({ skin: SKIN, hair: TEAL, iris: 0x2bb7ad, headset: { color: BLACK, ring: TEAL } });
    head.c.y = -95;
    this.head = head.c;
    this.eyes = head.eyes;
    this.mouth = head.mouth;
    this.torso.addChild(this.head);
  }

  update(dt, o) {
    const { bp, energy, mode, mouth, time } = o;
    const e = 0.3 + energy * 0.7;
    const b = Math.abs(Math.sin(bp * Math.PI));
    const ph = Math.sin(bp * Math.PI);
    const ph2 = Math.sin(bp * Math.PI + Math.PI / 2);
    const sway = Math.sin(bp * Math.PI * 0.5);
    const T = this.tgt;

    let L, R, lean = 0, tilt = 0, hair = 0.05, jump = 2, step = 0.05, mic = 0;
    switch (mode) {
      case 'dance':
        L = [-62 - 14 * ph, -100 - 42 * ph];
        R = [62 + 14 * ph2, -100 - 42 * ph2];
        lean = 0.07 * sway; tilt = 0.12 * Math.sin(bp * Math.PI * 0.5 + 0.6); hair = 0.06 + 0.16 * e; jump = 6 * e; step = 0.14;
        break;
      case 'sing':
        R = [9, -116];
        L = [-66, -84 - 14 * sway];
        lean = 0.03 * sway; tilt = 0.09 * sway; hair = 0.1; jump = 3 * e; step = 0.06; mic = 1;
        break;
      case 'groove':
        L = [-(14 + 26 * b), -150];
        R = [14 + 26 * b, -150];
        lean = 0.05 * sway; tilt = 0.08 * sway; hair = 0.16; jump = 5 * e; step = 0.1;
        break;
      case 'wave':
        R = [62 + 16 * Math.sin(bp * Math.PI * 2), -150];
        L = [-34, -16];
        lean = 0.03 * sway; tilt = 0.1 * sway; hair = 0.1; jump = 2;
        break;
      default:
        L = [-34, -14 + 2 * sway];
        R = [34, -14 - 2 * sway];
    }
    Object.assign(T, {
      lx: L[0], ly: L[1], rx: R[0], ry: R[1],
      lean, tilt, hair, jump, step, mic, mouth: mouth ? 1 : 0, e,
    });
    this._smooth(dt);
    const C = this.cur;

    this._legs(dt, { squat: 6 * C.e * (1 - b) - C.jump * b });
    this.legL.rotation = C.step * ph;
    this.legR.rotation = -C.step * ph2;

    this.torso.rotation = C.lean;
    this.head.rotation = C.tilt - C.lean * 0.5;
    this.mic.visible = C.mic > 0.5;

    const aL = solveArm(C.lx + 23, C.ly + 78, 1);
    const aR = solveArm(C.rx - 23, C.ry + 78, -1);
    this.armL.up.rotation = aL.up;
    this.armL.fore.rotation = aL.fore;
    this.armR.up.rotation = aR.up;
    this.armR.fore.rotation = aR.fore;

    this.tails.forEach((ch, i) => {
      swayChain(ch, time, bp * Math.PI - i * 1.1, C.hair, (i === 0 ? 1 : -1) * 0.1);
    });

    this._face(time, C.mouth);
  }
}
