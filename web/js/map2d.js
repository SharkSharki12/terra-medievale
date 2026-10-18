// Vue 2D : carte à l'échelle réelle (1 case = 10 m), tuiles générées par des workers
import { Terrain } from './terrain.js';

const CHUNK_PX = 512;
const MAX_LEVEL = 10;
const MAX_CACHE = 170;

export class MapView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cx = 0; this.cy = 0; this.z = 1;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cache = new Map();
    this.region = null; this.regionId = 0;
    this.handlers = {};
    this.clearedProvider = null;
    this.fly = null;
    this.frame = 0;
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
      w.busy = null;
      w.onmessage = (e) => this.onWorker(w, e.data);
      w.onerror = (e) => { console.error('worker', e.message); w.busy = null; };
      this.workers.push(w);
    }
    this.tileCache = new Map();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }
  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }

  setRegion(region, id) {
    for (const e of this.cache.values()) if (e.bitmap) e.bitmap.close();
    this.cache.clear();
    this.tileCache.clear();
    this.region = region; this.regionId = id;
    this.extra = [];
    this.terrain = new Terrain(region);
    for (const w of this.workers) { w.busy = null; w.postMessage({ type: 'init', region, regionId: id }); }
  }

  // ----- tuiles pour la logique du jeu -----
  getTile(tx, ty) {
    tx = Math.floor(tx); ty = Math.floor(ty);
    const cx = Math.floor(tx / 32), cy = Math.floor(ty / 32);
    const e = this.cache.get(`0:${cx}:${cy}`);
    if (e && e.g) {
      const i = (ty - cy * 32) * 32 + (tx - cx * 32);
      return { g: e.g[i], t: e.t[i], h: e.h[i] };
    }
    const k = (tx + 1048576) * 2097152 + (ty + 1048576);
    let r = this.tileCache.get(k);
    if (!r) {
      this.terrain.sample(tx + 0.5, ty + 0.5, 1);
      r = { g: this.terrain.g, t: this.terrain.t, h: this.terrain.h };
      if (this.tileCache.size > 60000) this.tileCache.clear();
      this.tileCache.set(k, r);
    }
    return r;
  }

  // invalide les chunks détaillés couvrant une case (après défrichage)
  invalidate(tx, ty) {
    for (let L = 0; L <= 3; L++) {
      const n = 32 << L;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const key = `${L}:${Math.floor((tx + ox) / n)}:${Math.floor((ty + oy) / n)}`;
        const e = this.cache.get(key);
        if (e) e.stale = true;
      }
    }
  }

  onWorker(w, m) {
    w.busy = null;
    if (m.type !== 'chunk' || m.regionId !== this.regionId) { if (m.bitmap) m.bitmap.close(); return; }
    const old = this.cache.get(m.key);
    if (old && old.bitmap && old.bitmap !== m.bitmap) old.bitmap.close();
    const e = { bitmap: m.bitmap, ready: true, loading: false, stale: false, used: this.frame, g: m.g, t: m.t, h: m.h, level: m.level };
    this.cache.set(m.key, e);
    this.dirty = true;
    if (this.onChunk) this.onChunk(m.key, e);
  }

  // chunks voulus hors affichage (ex. morceau détaillé du globe)
  setExtra(list) { this.extra = list.map(([L, cx, cy]) => ({ L, cx, cy, key: `${L}:${cx}:${cy}`, p: 50 })); }
  extraNeeds() {
    const out = [];
    for (const j of this.extra || []) {
      const e = this.cache.get(j.key);
      if (e) e.used = this.frame;
      if (!e) out.push(j);
    }
    return out;
  }
  pump() {
    if (!this.region) return;
    this.frame++;
    this.dispatch(this.extraNeeds());
  }

  // ----- caméra -----
  toScreen(tx, ty) { return [(tx - this.cx) * this.z + this.W / 2, (ty - this.cy) * this.z + this.H / 2]; }
  toTile(sx, sy) { return [(sx - this.W / 2) / this.z + this.cx, (sy - this.H / 2) / this.z + this.cy]; }
  get zMax() { return 48 * this.dpr; }
  get zSwitch() { return Math.max(this.H / 15000, this.W / 19000); }

  flyTo(tx, ty, z) { this.fly = { tx, ty, z: z || this.z, t: 0, x0: this.cx, y0: this.cy, z0: this.z }; }

  bindInput() {
    const el = this.canvas;
    let down = null;
    const tileAt = (e) => this.toTile(e.clientX * this.dpr, e.clientY * this.dpr);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      el.setPointerCapture(e.pointerId);
      this.fly = null;
      const tool = this.handlers.hasTool && this.handlers.hasTool();
      down = { x: e.clientX, y: e.clientY, b: e.button, moved: false, pan: !(tool && e.button === 0), tool: tool && e.button === 0 };
      if (down.tool && this.handlers.toolDown) this.handlers.toolDown(...tileAt(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const [tx, ty] = tileAt(e);
      this.mouse = { sx: e.clientX * this.dpr, sy: e.clientY * this.dpr, tx, ty };
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
        if (down.pan && down.moved) {
          this.cx -= (dx * this.dpr) / this.z; this.cy -= (dy * this.dpr) / this.z;
          down.x = e.clientX; down.y = e.clientY;
          this.clampCam();
        }
        if (down.tool && this.handlers.toolMove) this.handlers.toolMove(tx, ty);
      }
      if (this.handlers.hover) this.handlers.hover(tx, ty);
    });
    const up = (e) => {
      if (!down) return;
      const [tx, ty] = tileAt(e);
      if (down.tool && this.handlers.toolUp) this.handlers.toolUp(tx, ty);
      else if (!down.moved && this.handlers.click) this.handlers.click(tx, ty, down.b);
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('pointerleave', () => { this.mouse = null; if (this.handlers.hover) this.handlers.hover(null, null); });
    el.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.fly = null;
      const d = Math.max(-120, Math.min(120, e.deltaY));
      this.zoomAt(e.clientX * this.dpr, e.clientY * this.dpr, Math.exp(-d * 0.0025));
    }, { passive: false });
  }

  zoomAt(sx, sy, f) {
    const [tx, ty] = this.toTile(sx, sy);
    const nz = Math.min(this.zMax, this.z * f);
    this.z = nz;
    const [tx2, ty2] = this.toTile(sx, sy);
    this.cx += tx - tx2; this.cy += ty - ty2;
    this.clampCam();
    if (this.z < this.zSwitch && this.handlers.zoomOut) this.handlers.zoomOut();
  }

  clampCam() {
    const lim = 9600;
    const ox = this.region ? this.region.ctx || 0 : 0, oy = this.region ? this.region.cty || 0 : 0;
    this.cx = Math.max(ox - lim, Math.min(ox + lim, this.cx));
    this.cy = Math.max(oy - lim, Math.min(oy + lim, this.cy));
  }

  update(dt, keys) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.cx = f.x0 + (f.tx - f.x0) * e; this.cy = f.y0 + (f.ty - f.y0) * e;
      this.z = Math.exp(Math.log(f.z0) + (Math.log(f.z) - Math.log(f.z0)) * e);
      if (f.t >= 1) this.fly = null;
    }
    if (keys) {
      const sp = (900 * dt * this.dpr) / this.z;
      if (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')) this.cx -= sp;
      if (keys.has('ArrowRight') || keys.has('KeyD')) this.cx += sp;
      if (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ')) this.cy -= sp;
      if (keys.has('ArrowDown') || keys.has('KeyS')) this.cy += sp;
      this.clampCam();
    }
  }

  // ----- rendu -----
  levelFor(z) { return Math.max(0, Math.min(MAX_LEVEL, Math.floor(Math.log2(16 / z)))); }

  draw(time, drawWorld) {
    this.frame++;
    const ctx = this.ctx, W = this.W, H = this.H, z = this.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1e2128';
    ctx.fillRect(0, 0, W, H);
    if (!this.region) return;
    const L = this.levelFor(z);
    const n = 32 << L;
    const [ax, ay] = this.toTile(0, 0), [bx, by] = this.toTile(W, H);
    const c0x = Math.floor(ax / n), c1x = Math.floor(bx / n), c0y = Math.floor(ay / n), c1y = Math.floor(by / n);
    const need = [];
    const nativePPT = 16 / (1 << L);
    const smooth = z < nativePPT * 0.999;
    const mcx = (this.cx / n), mcy = (this.cy / n);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = `${L}:${cx}:${cy}`;
      const e = this.cache.get(key);
      const x0 = Math.round((cx * n - this.cx) * z + W / 2), y0 = Math.round((cy * n - this.cy) * z + H / 2);
      const x1 = Math.round(((cx + 1) * n - this.cx) * z + W / 2), y1 = Math.round(((cy + 1) * n - this.cy) * z + H / 2);
      const d = Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy);
      if (e && e.ready) {
        e.used = this.frame;
        ctx.imageSmoothingEnabled = smooth;
        ctx.drawImage(e.bitmap, x0, y0, x1 - x0, y1 - y0);
        if (e.stale && !e.loading) need.push({ L, cx, cy, key, p: d - 5 });
      } else {
        this.drawFallback(L, cx, cy, x0, y0, x1 - x0, y1 - y0);
        if (!e || !e.loading) need.push({ L, cx, cy, key, p: d });
        // ancêtre grossier en priorité pour remplir vite l'écran
        const L2 = Math.min(MAX_LEVEL, L + 2);
        if (L2 > L) {
          const pcx = Math.floor(cx / 4), pcy = Math.floor(cy / 4), pk = `${L2}:${pcx}:${pcy}`;
          const pe = this.cache.get(pk);
          if (pe) pe.used = this.frame;
          if (!pe) need.push({ L: L2, cx: pcx, cy: pcy, key: pk, p: -10 + d * 0.01 });
        }
      }
    }
    // couverture minimale : les chunks du niveau le plus grossier qui couvrent toute la région
    const NL = 32 << MAX_LEVEL, rcx = this.region.ctx || 0, rcy = this.region.cty || 0;
    for (let cy = Math.floor((rcy - 9800) / NL); cy <= Math.floor((rcy + 9800) / NL); cy++) for (let cx = Math.floor((rcx - 9800) / NL); cx <= Math.floor((rcx + 9800) / NL); cx++) {
      const k = `${MAX_LEVEL}:${cx}:${cy}`;
      const e = this.cache.get(k);
      if (e) e.used = this.frame; else need.push({ L: MAX_LEVEL, cx, cy, key: k, p: -20 });
    }
    // précharge un peu autour (niveau courant)
    if (need.length === 0) {
      for (let cy = c0y - 1; cy <= c1y + 1; cy++) for (let cx = c0x - 1; cx <= c1x + 1; cx++) {
        const key = `${L}:${cx}:${cy}`;
        if (!this.cache.has(key)) need.push({ L, cx, cy, key, p: 100 + Math.hypot(cx - mcx, cy - mcy) });
      }
    }
    for (const j of this.extraNeeds()) need.push({ ...j, p: 60 + j.p });
    this.dispatch(need);
    if (this.frame % 30 === 0) this.evict();
    ctx.imageSmoothingEnabled = false;
    if (drawWorld) drawWorld(ctx, this, time);
  }

  drawFallback(L, cx, cy, x, y, w, h) {
    for (let L2 = L + 1; L2 <= MAX_LEVEL; L2++) {
      const d = L2 - L;
      const pcx = Math.floor(cx / (1 << d)), pcy = Math.floor(cy / (1 << d));
      const e = this.cache.get(`${L2}:${pcx}:${pcy}`);
      if (e && e.ready) {
        e.used = this.frame;
        const sub = CHUNK_PX / (1 << d);
        const sx = (cx - pcx * (1 << d)) * sub, sy = (cy - pcy * (1 << d)) * sub;
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.drawImage(e.bitmap, sx, sy, sub, sub, x, y, w, h);
        return;
      }
    }
  }

  dispatch(need) {
    const idle = this.workers.filter(w => !w.busy);
    if (!idle.length || !need.length) return;
    need.sort((a, b) => a.p - b.p);
    const seen = new Set();
    for (const job of need) {
      if (!idle.length) break;
      if (seen.has(job.key)) continue;
      seen.add(job.key);
      let e = this.cache.get(job.key);
      if (e && e.loading) continue;
      if (!e) { e = { ready: false, loading: true, used: this.frame }; this.cache.set(job.key, e); }
      e.loading = true; e.stale = false;
      const w = idle.shift();
      w.busy = job.key;
      const msg = { type: 'render', key: job.key, regionId: this.regionId, level: job.L, cx: job.cx, cy: job.cy };
      if (job.L <= 3 && this.clearedProvider) {
        const nn = 32 << job.L;
        msg.cleared = this.clearedProvider(job.cx * nn - 1, job.cy * nn - 1, nn + 2);
      }
      w.postMessage(msg);
    }
  }

  evict() {
    if (this.cache.size <= MAX_CACHE) return;
    const arr = [...this.cache.entries()].filter(([, e]) => e.ready && e.used < this.frame - 2);
    arr.sort((a, b) => a[1].used - b[1].used);
    let k = this.cache.size - MAX_CACHE;
    for (const [key, e] of arr) {
      if (k-- <= 0) break;
      if (e.bitmap) e.bitmap.close();
      this.cache.delete(key);
    }
  }
}
