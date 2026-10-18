// Mode Seigneur : incarne le seigneur de ta ville et parcours la Terre à vitesse réelle,
// à pied, à cheval ou en barque (1 case = 10 m, 1 m/s = 0,1 case/s, temps réel).
import { personSprite, horseSprite, boatSprite, drawAt, TOOLS } from './actors.js';
import { lookOf, fromPlace } from './people.js';
import { isWater } from './terrain.js';
import { key } from './keys.js';
import { tileToLatLon, latLonToTile, haversine } from './geo.js';
import { BUILDINGS } from './buildings.js';

const MS = 0.1; // 1 m/s en cases par seconde
// vitesses réelles (m/s) : [normal, rapide avec Maj]
export const SPEEDS = { foot: [6, 15], horse: [16, 40], boat: [10, 28] }; // m/s : rapide pour parcourir le monde
const ACCEL = { foot: 40, horse: 18, boat: 8 }; // m/s²
const MOUNT_NAMES = { foot: 'À pied', horse: 'À cheval', boat: 'En barque' };
const DOCKS = { embarcadere: 1, pecheur: 1, port: 1 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Lord {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.mount = 'foot';
    this.x = 0; this.y = 0; this.dir = 1; this.view = 0; this.ph = 0; this.v = 0;
    this.hx = 0; this.hy = 1; // direction du mouvement
    this.horse = null; this.boat = null; this.horseCall = null;
    this.hudT = 0; this.dist = 0;
    this.hud = document.querySelector('#lord-hud');
  }
  get g() { return this.app.game; }
  get person() { const g = this.g; return g && g.pp ? g.pp.lord : null; }

  toggle(force) {
    const on = force ?? !this.active;
    if (on) this.enter(); else this.exit();
  }

  enter() {
    const app = this.app, g = this.g;
    if (!g || !g.pp) return;
    if (!this.person) { app.ui.toast('Ta ville n\'a plus de seigneur…', 'bad'); return; }
    if (app.mode !== 'map' || !app.region) { app.ui.toast('Passe sur la carte de ta ville pour incarner ton seigneur', 'bad'); return; }
    const st = g.s.lordMode;
    let pos = null;
    if (st && st.lat != null) {
      const t = latLonToTile(app.region, st.lat, st.lon);
      if (this.inRegion(t.tx, t.ty)) pos = [t.tx, t.ty];
      this.mount = st.mount || 'foot';
      this.horse = st.horse ? this.fromLL(st.horse) : null;
      this.boat = st.boat ? this.fromLL(st.boat) : null;
    }
    const m = g.manoir;
    if (!pos) {
      const d = g.nav.door(m);
      pos = [d[0] + 0.5, d[1] + 0.5];
      this.mount = 'foot';
    }
    if (this.mount === 'boat' && !this.boatOK(pos[0], pos[1])) this.mount = 'foot';
    if (this.mount !== 'boat' && !this.footOK(pos[0], pos[1])) { const d = g.nav.door(m); pos = [d[0] + 0.5, d[1] + 0.5]; this.mount = 'foot'; }
    [this.x, this.y] = pos;
    if (!this.horse && this.mount !== 'horse') this.horse = this.stablePos();
    this.v = 0;
    this.active = true;
    g.life.forget(g.s.lordId);
    document.body.classList.add('lord-on');
    g.tool = null; g.selected = null;
    app.ui.showInfo(null);
    app.map.flyTo(this.x, this.y, Math.max(app.map.z, 22 * app.map.dpr));
    const p = this.person;
    app.ui.toast(`Tu incarnes ${g.pp.lordTitle(p)} ${g.pp.fullName(p)}. ZQSD/flèches pour marcher, Maj pour courir, E pour monter à cheval ou en barque.`, 'big');
    app.audio.play('click');
    this.renderHud(true);
  }

  exit() {
    if (!this.active) return;
    this.save();
    this.active = false;
    this.v = 0;
    document.body.classList.remove('lord-on');
    if (this.hud) this.hud.classList.add('hidden');
  }

  // ---------- coordonnées (changement de région) ----------
  toLL(x, y) { const ll = tileToLatLon(this.app.region, x, y); return { lat: ll.lat, lon: ll.lon }; }
  fromLL(ll) { const t = latLonToTile(this.app.region, ll.lat, ll.lon); return { x: t.tx, y: t.ty }; }
  inRegion(x, y) { const r = this.app.region; return r && Math.abs(x - (r.ctx || 0)) < 9300 && Math.abs(y - (r.cty || 0)) < 9300; }
  beforeRegion() {
    if (!this.active || !this.app.region) return null;
    return { me: this.toLL(this.x, this.y), horse: this.horse && this.toLL(this.horse.x, this.horse.y), boat: this.boat && this.toLL(this.boat.x, this.boat.y) };
  }
  afterRegion(saved) {
    if (!saved) return;
    const p = this.fromLL(saved.me);
    this.x = p.x; this.y = p.y;
    this.horse = saved.horse ? this.fromLL(saved.horse) : null;
    this.boat = saved.boat ? this.fromLL(saved.boat) : null;
    this.app.map.cx = this.x; this.app.map.cy = this.y;
  }
  save() {
    const g = this.g;
    if (!g || !this.app.region) return;
    g.s.lordMode = { ...this.toLL(this.x, this.y), mount: this.mount, horse: this.horse ? this.toLL(this.horse.x, this.horse.y) : null, boat: this.boat ? this.toLL(this.boat.x, this.boat.y) : null };
  }
  latLon() { return this.toLL(this.x, this.y); }

  // le cheval du seigneur attend à l'écurie (ou devant le manoir)
  stablePos() {
    const g = this.g;
    const st = g.s.buildings.find(b => b.type === 'ecurie') || g.manoir;
    const d = g.nav.door(st);
    return { x: d[0] + (st.type === 'ecurie' ? 0.5 : 1.3), y: d[1] + 0.6 };
  }

  // ---------- collisions ----------
  blockedByOthers(tx, ty) {
    const k = key(tx, ty);
    for (const og of this.app.otherGames()) {
      const id = og.occ.get(k);
      if (id === undefined || id === -1) continue;
      const b = og.byId.get(id);
      if (!b || !BUILDINGS[b.type].gate) return true;
    }
    return false;
  }
  footOK(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    const g = this.g;
    if (g.nav.cost(tx, ty) === Infinity) return false;
    return !this.blockedByOthers(tx, ty);
  }
  boatOK(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    const t = this.app.map.getTile(tx, ty);
    if (!isWater(t.g) || t.g === 4) return false;
    const id = this.g.occ.get(key(tx, ty));
    if (id !== undefined && id !== -1) return false; // les ponts (routes) laissent passer les barques
    return !this.blockedByOthers(tx, ty);
  }
  ok(x, y) { return this.mount === 'boat' ? this.boatOK(x, y) : this.footOK(x, y); }
  // une route (de ta ville ou de n'importe quel autre village, allié ou non)
  onRoad(tx, ty) {
    const k = key(tx, ty);
    if (this.g.occ.get(k) === -1) return true;
    for (const og of this.app.otherGames()) if (og.occ.get(k) === -1) return true;
    return false;
  }
  terrain(x, y) {
    if (this.mount === 'boat') return 1;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (this.onRoad(tx, ty)) return 1.3; // bonus sur toutes les routes
    const c = this.g.nav.cost(tx, ty);
    if (c === Infinity || c < 0.9) return 1.1; // portes, ponts
    return c > 2.6 ? 0.8 : c > 1.6 ? 0.9 : 1; // à peine ralenti hors des routes
  }


  // ---------- déplacement ----------
  update(dt, keys) {
    if (!this.active) return;
    const app = this.app, g = this.g;
    if (!g || !g.pp || app.mode !== 'map' || !app.region) return;
    if (!this.person) { this.exit(); return; }
    dt = Math.min(dt, 0.1);
    let ix = 0, iy = 0;
    if (!app.ui.modalOpen) {
      if (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')) ix -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) ix += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ')) iy -= 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) iy += 1;
    }
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const [slow, fast] = SPEEDS[this.mount];
    const target = ix || iy ? (run ? fast : slow) : 0;
    if (ix || iy) { const L = Math.hypot(ix, iy); this.hx = ix / L; this.hy = iy / L; }
    const a = ACCEL[this.mount] * (target < this.v ? 1.6 : 1);
    this.v = target > this.v ? Math.min(target, this.v + a * dt) : Math.max(target, this.v - a * dt);
    if (this.v > 0.01) {
      const f = this.terrain(this.x, this.y);
      const step = this.v * MS * f * dt;
      const nx = this.x + this.hx * step, ny = this.y + this.hy * step;
      let moved = true;
      if (this.ok(nx, ny)) { this.x = nx; this.y = ny; }
      else if (this.hx && this.ok(nx, this.y)) { this.x = nx; }
      else if (this.hy && this.ok(this.x, ny)) { this.y = ny; }
      else { moved = false; this.v = Math.min(this.v, this.mount === 'foot' ? 0 : this.v * 0.3); }
      if (moved) {
        this.ph += step * (this.mount === 'horse' ? 4 : this.mount === 'boat' ? 1.5 : 9);
        this.dist += step * 10;
      }
      if (Math.abs(this.hx) > Math.abs(this.hy) * 0.6) { this.view = 2; this.dir = this.hx < 0 ? -1 : 1; } else this.view = this.hy < 0 ? 1 : 0;
      if (this.mount !== 'foot' && this.hx) this.dir = this.hx < 0 ? -1 : 1;
    }
    // le cheval appelé accourt
    if (this.horseCall && this.horse) {
      const h = this.horse, dx = this.x + 0.8 - h.x, dy = this.y - h.y, d = Math.hypot(dx, dy);
      if (d < 1) this.horseCall = null;
      else {
        const st = Math.min(d, 3 * dt); // ~30 m/s
        const nx = h.x + dx / d * st, ny = h.y + dy / d * st;
        if (this.footOK(nx, ny)) { h.x = nx; h.y = ny; h.dir = dx < 0 ? -1 : 1; h.ph = (h.ph || 0) + st * 4; }
        else { this.horseCall = null; app.ui.toast('Ton cheval ne trouve pas de passage jusqu\'à toi', 'bad'); }
      }
    }
    // caméra : suit le seigneur quand il bouge ou s'il sort de l'écran
    const map = app.map;
    const [sx, sy] = map.toScreen(this.x, this.y);
    const off = sx < map.W * 0.15 || sx > map.W * 0.85 || sy < map.H * 0.15 || sy > map.H * 0.85;
    if (this.v > 0.05 || off) {
      const kf = Math.min(1, dt * (off ? 8 : 4));
      map.cx += (this.x - map.cx) * kf; map.cy += (this.y - 0.4 - map.cy) * kf;
      map.clampCam();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.25; this.renderHud(); }
  }

  // ---------- actions (touche E / H) ----------
  action() {
    const app = this.app, g = this.g;
    if (!this.active || !g) return;
    if (this.mount === 'horse') {
      this.horse = { x: this.x + 0.7 * this.dir, y: this.y + 0.15, dir: this.dir };
      if (!this.footOK(this.x, this.y)) { app.ui.toast('Impossible de descendre ici', 'bad'); return; }
      this.mount = 'foot'; this.v = 0;
      app.audio.play('click');
      return;
    }
    if (this.mount === 'boat') {
      // débarquer sur la rive la plus proche
      let best = null, bd = 2.2;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const tx = Math.floor(this.x) + i, ty = Math.floor(this.y) + j;
        if (!this.footOK(tx + 0.5, ty + 0.5)) continue;
        const d = Math.hypot(tx + 0.5 - this.x, ty + 0.5 - this.y);
        if (d < bd) { bd = d; best = [tx + 0.5, ty + 0.5]; }
      }
      if (!best) { app.ui.toast('Approche-toi de la rive pour débarquer', 'bad'); return; }
      this.boat = { x: this.x, y: this.y, dir: this.dir };
      this.x = best[0]; this.y = best[1]; this.mount = 'foot'; this.v = 0;
      app.audio.play('click');
      return;
    }
    // à pied : cheval ou barque à portée ?
    if (this.horse && Math.hypot(this.horse.x - this.x, this.horse.y - this.y) < 2.2) {
      this.x = this.horse.x; this.y = this.horse.y; this.dir = this.horse.dir || this.dir;
      if (!this.footOK(this.x, this.y)) { this.x -= 0.5 * this.dir; }
      this.horse = null; this.mount = 'horse'; this.v = 0; this.horseCall = null;
      app.audio.play('coin');
      return;
    }
    if (this.boat && Math.hypot(this.boat.x - this.x, this.boat.y - this.y) < 2.5 && this.boatOK(this.boat.x, this.boat.y)) {
      this.x = this.boat.x; this.y = this.boat.y; this.boat = null; this.mount = 'boat'; this.v = 0;
      app.audio.play('click');
      return;
    }
    const dock = this.nearDock();
    if (dock) {
      if (this.boat) this.boat = null; // la barque est ramenée au ponton
      this.x = dock[0]; this.y = dock[1]; this.mount = 'boat'; this.v = 0;
      app.ui.toast('Tu prends une barque. Maj pour hisser la voile.');
      app.audio.play('click');
      return;
    }
    const st = g.s.buildings.find(b => (b.type === 'ecurie' || b.type === 'manoir') && this.nearB(b, 3));
    if (st && !this.horse) { this.horse = this.stablePos(); return this.action(); }
    if (this.horse) {
      const d = Math.hypot(this.horse.x - this.x, this.horse.y - this.y) * 10;
      app.ui.toast(`Ton cheval t'attend à ${fmtDist(d)} (${compass(this.horse.x - this.x, this.horse.y - this.y)}). Touche H pour le siffler.`);
    } else app.ui.toast('Ni cheval ni barque à portée. Va à l\'écurie, au manoir ou à un embarcadère.');
  }
  whistle() {
    const app = this.app;
    if (!this.active || this.mount !== 'foot') return;
    if (!this.horse) { this.horse = this.stablePos(); }
    const d = Math.hypot(this.horse.x - this.x, this.horse.y - this.y);
    if (d > 45) { app.ui.toast(`Ton cheval est trop loin pour t'entendre (${fmtDist(d * 10)})`, 'bad'); return; }
    this.horseCall = true;
    app.ui.toast('Tu siffles… ton cheval accourt !');
    app.audio.play('coin');
  }
  nearB(b, r) {
    const B = BUILDINGS[b.type];
    const dx = Math.max(b.x - this.x, 0, this.x - (b.x + B.w)), dy = Math.max(b.y - this.y, 0, this.y - (b.y + B.h));
    return Math.hypot(dx, dy) <= r;
  }
  nearDock() {
    const g = this.g;
    for (const b of g.s.buildings) {
      if (!DOCKS[b.type] || !this.nearB(b, 3)) continue;
      const B = BUILDINGS[b.type];
      let best = null, bd = 1e9;
      for (let j = -2; j < B.h + 2; j++) for (let i = -2; i < B.w + 2; i++) {
        const x = b.x + i + 0.5, y = b.y + j + 0.5;
        if (!this.boatOK(x, y)) continue;
        const d = Math.hypot(x - this.x, y - this.y);
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) return best;
    }
    // en bord d'eau, n'importe quel ponton d'une autre ville fait aussi l'affaire
    for (const og of this.app.otherGames()) for (const b of og.s.buildings) {
      if (!DOCKS[b.type] || !this.nearB(b, 3)) continue;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const x = Math.floor(this.x) + i + 0.5, y = Math.floor(this.y) + j + 0.5; if (this.boatOK(x, y)) return [x, y]; }
    }
    return null;
  }

  // ---------- rendu ----------
  look() {
    const g = this.g, p = this.person;
    if (!p) return null;
    const L = lookOf(p.lk, p.s, g.pp.age(p));
    L.role = 'lord'; L.color = this.app.settings.color; L.tool = TOOLS.sword;
    return L;
  }
  collect(items, view) {
    if (!this.active) return;
    const inV = (x, y) => x > view.x0 - 3 && x < view.x1 + 3 && y > view.y0 - 3 && y < view.y1 + 4;
    if (this.horse && inV(this.horse.x, this.horse.y)) {
      const h = this.horse;
      items.push({ y: h.y, fn: (ctx, SX, SY, k) => drawAt(ctx, horseSprite('noir', this.horseCall ? 1 + (Math.floor(h.ph || 0) % 4) : 0), SX(h.x), SY(h.y), k * 0.8, (h.dir || 1) < 0, 0.5, 1) });
    }
    if (this.boat && inV(this.boat.x, this.boat.y)) {
      const b = this.boat;
      items.push({ y: b.y - 0.6, fn: (ctx, SX, SY, k, time) => drawAt(ctx, boatSprite('barque', 0, this.app.settings.color), SX(b.x), SY(b.y) + 3 * k + Math.sin(time / 400) * 0.4 * k, k, (b.dir || 1) < 0, 0.5, 1) });
    }
    items.push({ y: this.mount === 'boat' ? this.y - 0.6 : this.y, fn: (ctx, SX, SY, k, time) => this.draw(ctx, SX, SY, k, time) });
    // noms des habitants croisés (les plus proches)
    const life = this.g.life;
    const near = [];
    for (const w of life.walkers) {
      if (!w.pid || Math.abs(w.x - this.x) > 4 || Math.abs(w.y - this.y) > 4) continue;
      const d = Math.hypot(w.x - this.x, w.y - this.y);
      if (d < 3.5) near.push([d, w]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const placed = [];
    for (const [, w] of near.slice(0, 6)) {
      if (placed.some(([x, y]) => Math.abs(x - w.x) < 1.1 && Math.abs(y - w.y) < 0.5)) continue;
      placed.push([w.x, w.y]);
      items.push({ y: w.y + 0.001, fn: (ctx, SX, SY, k) => this.label(ctx, SX(w.x), SY(w.y) - 9 * k, this.g.pp.get(w.pid), k) });
    }
  }
  label(ctx, x, y, p, k) {
    if (!p) return;
    const d = this.app.map.dpr;
    ctx.save();
    ctx.font = `${Math.max(10, 11 * d)}px "Palatino Linotype", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(20,14,8,0.85)';
    const t = p.n;
    ctx.strokeText(t, x, y); ctx.fillStyle = '#f0e6cc'; ctx.fillText(t, x, y);
    ctx.restore();
  }
  draw(ctx, SX, SY, k, time) {
    const L = this.look();
    if (!L) return;
    const x = SX(this.x), y = SY(this.y);
    const d = this.app.map.dpr;
    // halo doré au sol
    ctx.save();
    ctx.fillStyle = 'rgba(255,215,90,0.28)';
    ctx.beginPath(); ctx.ellipse(x, y + k, 6 * k, 2.4 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const moving = this.v > 0.05;
    if (this.mount === 'horse') {
      const fr = moving ? 1 + (Math.floor(this.ph) % 4) : 0;
      drawAt(ctx, horseSprite('noir', fr, L), x, y, k * 0.8, this.dir < 0, 0.5, 1);
    } else if (this.mount === 'boat') {
      const kind = this.v > SPEEDS.boat[0] + 0.3 ? 'voile' : 'barque';
      drawAt(ctx, boatSprite(kind, moving ? Math.floor(this.ph) % 2 : 0, this.app.settings.color, L), x, y + 3 * k + Math.sin(time / 400) * 0.4 * k, k, this.dir < 0, 0.5, 1);
    } else {
      const fr = moving ? 1 + (Math.floor(this.ph) % 2) : 0;
      drawAt(ctx, personSprite(L, this.view, fr), x, y + k, k, this.view === 2 && this.dir < 0, 0.45, 1);
    }
    // couronne + nom (lisible même de loin)
    const top = y - (this.mount === 'foot' ? 11 : 16) * k - 4 * d;
    ctx.save();
    ctx.fillStyle = '#f3d77a'; ctx.strokeStyle = '#3a2410'; ctx.lineWidth = d;
    const s = 5 * d;
    ctx.beginPath(); ctx.moveTo(x - s, top); ctx.lineTo(x - s, top - s); ctx.lineTo(x - s / 2, top - s / 2); ctx.lineTo(x, top - s * 1.2); ctx.lineTo(x + s / 2, top - s / 2); ctx.lineTo(x + s, top - s); ctx.lineTo(x + s, top); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (k < 1.2) {
      ctx.font = `bold ${12 * d}px "Palatino Linotype", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(20,14,8,0.9)';
      const p = this.person, t = p ? p.n : '';
      ctx.strokeText(t, x, top - s * 1.6); ctx.fillStyle = '#f3d77a'; ctx.fillText(t, x, top - s * 1.6);
    }
    ctx.restore();
  }

  // ---------- panneau d'informations ----------
  where() {
    const app = this.app, g = this.g;
    const ll = this.latLon();
    const m = g.manoirLatLon();
    const dm = haversine(ll.lat, ll.lon, m.lat, m.lon);
    if (dm < 900) return { txt: `sur tes terres ${fromPlace(g.s.name)}`, dm, ll };
    let best = null, bd = 3500;
    for (const og of app.otherGames()) {
      const mm = og.manoir; if (!mm) continue;
      const d = Math.hypot(mm.x + 1.5 - this.x, mm.y + 1.5 - this.y) * 10;
      if (d < bd) { bd = d; best = og; }
    }
    if (best) return { txt: bd < 700 ? `à ${best.s.name}` : `près de ${best.s.name}`, dm, ll };
    const t = app.map.getTile(this.x, this.y);
    return { txt: isWater(t.g) ? 'sur l\'eau' : t.t ? 'en pleine forêt' : 'en pleine campagne', dm, ll };
  }
  renderHud(force = false) {
    const el = this.hud;
    if (!el) return;
    if (!this.active) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const g = this.g, p = this.person;
    if (!p) return;
    const w = this.where();
    const kmh = Math.round(this.v * 3.6 * this.terrain(this.x, this.y));
    const hints = [];
    if (this.mount === 'foot') {
      if (this.horse && Math.hypot(this.horse.x - this.x, this.horse.y - this.y) < 2.2) hints.push('<kbd>E</kbd> monter à cheval');
      else if (this.boat && Math.hypot(this.boat.x - this.x, this.boat.y - this.y) < 2.5) hints.push('<kbd>E</kbd> monter dans ta barque');
      else if (this.nearDock()) hints.push('<kbd>E</kbd> prendre une barque');
      else hints.push('<kbd>H</kbd> siffler ton cheval');
      hints.push('<kbd>Maj</kbd> courir');
    } else if (this.mount === 'horse') { hints.push('<kbd>E</kbd> descendre de cheval', '<kbd>Maj</kbd> galoper'); }
    else hints.push('<kbd>E</kbd> débarquer', '<kbd>Maj</kbd> hisser la voile');
    hints.push('<kbd>L</kbd> quitter');
    const h = `<div class="lh-name">👑 ${esc(g.pp.lordTitle(p))} ${esc(g.pp.fullName(p))}</div>
      <div class="lh-row"><b>${MOUNT_NAMES[this.mount]}</b> · ${kmh} km/h · ${esc(w.txt)}${w.dm >= 900 ? ` · ${fmtDist(w.dm)} du manoir` : ''}</div>
      <div class="lh-row small">${Math.abs(w.ll.lat).toFixed(4)}° ${w.ll.lat >= 0 ? 'N' : 'S'}, ${Math.abs(w.ll.lon).toFixed(4)}° ${w.ll.lon >= 0 ? 'E' : 'O'} · parcouru : ${fmtDist(this.dist)}</div>
      <div class="lh-keys">${hints.join(' · ')}</div>`;
    if (force || el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
  }

  // pour les autres joueurs
  presence() {
    if (!this.active || !this.app.region) return null;
    const ll = this.latLon();
    const p = this.person;
    return { lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6), m: this.mount, d: this.dir, mv: this.v > 0.05 ? 1 : 0, s: p ? p.s : 0, lk: p ? p.lk : 0 };
  }
}

export function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`; }
function compass(dx, dy) {
  const a = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
  return ['à l\'est', 'au nord-est', 'au nord', 'au nord-ouest', 'à l\'ouest', 'au sud-ouest', 'au sud', 'au sud-est'][Math.round(a / 45) % 8];
}
