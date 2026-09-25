import { Assets, Container, Sprite } from 'pixi.js';

/**
 * "Paper puppet": animates a single still image with the same interface as the
 * procedural rigs (root + update). It squashes on the beat, hops between beats
 * and leans/sways depending on the mode the Stage picks for the current section.
 */
export class SpritePuppet {
  constructor(texture, cfg) {
    this.root = new Container();
    this.body = new Container(); // origin = feet, so rotation/squash pivot at the floor
    this.root.addChild(this.body);
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5, cfg.feet ?? 1);
    const k = cfg.height / texture.height;
    this.sprite.scale.set(cfg.flip ? -k : k, k);
    this.sprite.y = cfg.offsetY ?? 0;
    this.body.addChild(this.sprite);
    this.tgt = { rotAmp: 0, rotBias: 0, hop: 0, sq: 0, fast: 0 };
    this.cur = { ...this.tgt };
  }

  update(dt, { bp, energy, mode }) {
    const e = 0.3 + energy * 0.7;
    const T = this.tgt;
    switch (mode) {
      case 'guitar': Object.assign(T, { rotAmp: 0.03 * e, rotBias: 0, hop: 7 * e, sq: 0.03 * e, fast: 0 }); break;
      case 'sing':   Object.assign(T, { rotAmp: 0.025, rotBias: 0, hop: 5 * e, sq: 0.02 * e, fast: 0 }); break;
      case 'solo':   Object.assign(T, { rotAmp: 0.03, rotBias: -0.1, hop: 12, sq: 0.05, fast: 0 }); break;
      case 'dance':  Object.assign(T, { rotAmp: 0.07 * e, rotBias: 0, hop: 16 * e, sq: 0.06 * e, fast: 1 }); break;
      case 'groove': Object.assign(T, { rotAmp: 0.045, rotBias: 0, hop: 13 * e, sq: 0.05 * e, fast: 0 }); break;
      case 'wave':   Object.assign(T, { rotAmp: 0.05, rotBias: 0, hop: 5, sq: 0.02, fast: 1 }); break;
      default:       Object.assign(T, { rotAmp: 0.008, rotBias: 0, hop: 2, sq: 0.008, fast: 0 });
    }
    const k = Math.min(1, dt * 10);
    for (const key in T) this.cur[key] += (T[key] - this.cur[key]) * k;
    const C = this.cur;

    const b = Math.abs(Math.sin(bp * Math.PI)); // 0 on the beat, 1 between beats
    const osc = (1 - C.fast) * Math.sin(bp * Math.PI * 0.5) + C.fast * Math.sin(bp * Math.PI);
    this.body.rotation = C.rotBias + C.rotAmp * osc;
    this.body.y = -C.hop * b;
    this.body.scale.set(1 + C.sq * 0.6 * (1 - b), 1 - C.sq * (1 - b));
  }
}

/** Returns a Texture, or null if the file is missing (so the placeholder stays). */
export async function loadArtTexture(url) {
  try {
    // A dev server answers unknown paths with index.html, so check it is really an image.
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) return null;
    return await Assets.load(url);
  } catch (e) {
    return null;
  }
}
