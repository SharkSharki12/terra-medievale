// Logique du jeu : bâtiments, économie (facile), habitants, objectifs, événements, rendu de la ville
import { BUILDINGS, RANKS, RES, RES_NAMES, getSprite } from './buildings.js';
import { G, isWater, FERTILITY } from './terrain.js';
import { hash2 } from './noise.js';
import { tileToLatLon, latLonToTile } from './geo.js';
import { key, unkey, oldUnkey } from './keys.js';
import { People, fromPlace } from './people.js';
import { Nav } from './nav.js';
import { Life } from './life.js';
import { drawRoadNet, lineTiles } from './roads.js';
export { key, unkey };
export const UNITS = {
  soldat: { name: 'Soldats', one: 'Soldat', cost: { food: 12, gold: 4, wood: 4 }, time: 4, atk: 1, def: 1.2, carry: 10, needs: 'caserne' },
  archer: { name: 'Archers', one: 'Archer', cost: { wood: 10, gold: 8 }, time: 5, atk: 1.3, def: 2.0, carry: 6, needs: 'archerie' },
  chevalier: { name: 'Chevaliers', one: 'Chevalier', cost: { food: 20, gold: 18, iron: 6 }, time: 9, atk: 3.5, def: 2.5, carry: 25, needs: 'ecurie' },
};
export const UNIT_TYPES = Object.keys(UNITS);
const sameFrame = (a, b) => a && b && Math.abs(a.lat0 - b.lat0) < 1e-9 && Math.abs(a.lon0 - b.lon0) < 1e-9;
function frameOf(f) { return { lat0: f.lat0, lon0: f.lon0, cos0: Math.cos(f.lat0 * Math.PI / 180) }; }
const TREEISH = new Uint8Array([0, 1, 1, 1, 1, 1, 0, 1, 1]);
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
const SEASON_LEN = 75; // secondes de jeu

export const OBJECTIVES = [
  { text: 'Construis 2 maisons', prog: g => [g.count('maison'), 2], reward: { wood: 40 } },
  { text: 'Construis un bûcheron près d\'une forêt', prog: g => [g.count('bucheron'), 1], reward: { wood: 30, stone: 10 } },
  { text: 'Construis une ferme sur une prairie', prog: g => [g.count('ferme'), 1], reward: { food: 60 } },
  { text: 'Construis une carrière', prog: g => [g.count('carriere'), 1], reward: { stone: 30 } },
  { text: 'Trace 12 routes reliées au manoir', prog: g => [g.connectedRoads, 12], reward: { wood: 30, gold: 20 } },
  { text: 'Construis un puits', prog: g => [g.count('puits'), 1], reward: { gold: 25 } },
  { text: 'Atteins 25 habitants (rang Village)', prog: g => [g.s.pop, 25], reward: { gold: 50, wood: 50 } },
  { text: 'Construis un marché', prog: g => [g.count('marche'), 1], reward: { gold: 40 } },
  { text: 'Construis une église', prog: g => [g.count('eglise'), 1], reward: { stone: 60 } },
  { text: 'Construis un moulin près des fermes', prog: g => [g.count('moulin'), 1], reward: { food: 120 } },
  { text: 'Atteins 70 habitants (rang Bourg)', prog: g => [g.s.pop, 70], reward: { gold: 100, stone: 60 } },
  { text: 'Construis une mine de fer', prog: g => [g.count('mine'), 1], reward: { iron: 25 } },
  { text: 'Construis une forge', prog: g => [g.count('forge'), 1], reward: { wood: 100 } },
  { text: 'Construis 4 maisons de pierre', prog: g => [g.count('grandemaison'), 4], reward: { stone: 80 } },
  { text: 'Atteins 160 habitants (rang Ville)', prog: g => [g.s.pop, 160], reward: { gold: 150, stone: 100 } },
  { text: 'Construis 40 segments de remparts', prog: g => [g.count('rempart'), 40], reward: { stone: 150 } },
  { text: 'Construis un château', prog: g => [g.count('chateau'), 1], reward: { gold: 300 } },
  { text: 'Atteins 350 habitants (rang Cité)', prog: g => [g.s.pop, 350], reward: { gold: 300, iron: 50 } },
  { text: 'Construis une cathédrale', prog: g => [g.count('cathedrale'), 1], reward: { gold: 500 } },
  { text: 'Atteins 700 habitants (rang Capitale)', prog: g => [g.s.pop, 700], reward: { gold: 1000 } },
];

const EVENTS = [
  { w: 3, f: g => { const v = Math.round(40 + g.s.pop * 0.6); g.add({ gold: v }); return `Une caravane de marchands fait halte : +${v} or`; } },
  { w: 3, f: g => { const v = Math.round(60 + g.s.pop * 0.8); g.add({ food: v }); return `Récolte abondante ! +${v} nourriture`; } },
  { w: 2, f: g => { if (!g.pp) return null; const home = g.pp.freeHome(2); if (!home) return null; const from = g.pp.originName(); const [a] = g.pp.immigrantFamily(home, from, true); return `La famille ${a.f}, venue ${fromPlace(from)}, s'installe dans ta ville`; } },
  { w: 2, f: g => { const v = 50 + Math.round(g.s.pop * 0.3); g.add({ wood: v }); return `Une tempête a abattu des arbres : +${v} bois`; } },
  { w: 2, f: g => { const v = 30 + Math.round(g.s.pop * 0.25); g.add({ stone: v }); return `Un moine bâtisseur offre son aide : +${v} pierre`; } },
  { w: 2, f: g => { g.feast = 120; return 'Fête au village ! Danses et ripailles : le bonheur grimpe'; } },
  { w: 1, f: g => { if (g.s.rank < 2) return null; const v = 10 + Math.round(g.s.pop * 0.05); g.add({ iron: v }); return `Un forgeron itinérant laisse ${v} fer`; } },
  { w: 1, bad: true, f: g => { const v = Math.round(Math.min(Math.round(g.s.res.food * 0.15), 60) * (g.count('grenier') ? 0.5 : 1)); if (v < 5) return null; g.s.res.food -= v; return `Un hiver rude : -${v} nourriture${g.count('grenier') ? ' (le grenier a sauvé la moitié des réserves)' : ''}`; } },
  { w: 0.7, bad: true, f: g => { if (!g.pp || g.s.pop < 35 || g.s.epi || g.s.time < 900) return null; g.pp.startEpidemic(g.count('apothicaire') ? 0.35 + Math.random() * 0.3 : undefined); return null; } },
  { w: 1, f: g => { if (!g.pp) return null; const sick = g.s.people.filter(p => p.sick); if (!sick.length) return null; for (const p of sick) { p.sick = 0; g.pp.log(p, 'gue'); } return `Un moine guérisseur de passage soigne ${sick.length} malade${sick.length > 1 ? 's' : ''}`; } },
];

let SHARED = null;
function shared() {
  if (!SHARED) SHARED = { wall: makeWallSprites() };
  return SHARED;
}

export class Game {
  constructor(app, s, opts = {}) {
    this.app = app;
    this.s = s;
    this.remote = !!opts.remote;
    this.owner = opts.owner || '';
    this.color = opts.color || null;
    this.pid = opts.pid || null;
    this.dirty = true;
    this.occ = new Map();
    this.byId = new Map();
    this.cleared = new Set();
    this.rates = { wood: 0, stone: 0, food: 0, gold: 0, iron: 0 };
    this.cap = 0; this.happy = 60; this.jobs = 0; this.staffing = 1;
    this.growT = 0; this.acc = 0; this.feast = 0;
    this.connected = new Set();
    this.connectedRoads = 0;
    this.particles = [];
    const sh = shared();
    this.wallSprites = sh.wall;
    this.tool = null;
    this.selected = null;
    this.hoverTile = null;
    this.drag = null;
    this.roads = [];
    this.roadSrc = new Map();
    this.roadType = new Map();
    this.cgrid = new Map();
    this.counts = {};
    this.nav = new Nav(this);
    this.life = new Life(this, app);
    this.lastDraw = 0;
    Game.migrate(s);
    this.region = opts.region || null;
    this.setView(this.region);
    if (!this.remote) {
      this.pp = new People(this);
      if (!s.people.length && s.pop > 0 && this.manoir) { const n = s.pop; this.pp.populateFromCount(n); this.pp.syncMilitary(); }
    }
  }
  // reprend les habitants animés d'une ancienne version de cette ville (instantanés successifs)
  adoptLife(old) {
    if (!old || !old.life) return;
    this.life = old.life; this.life.g = this; this.life.structT = -1;
    this.particles = old.particles;
  }

  static newState(name, lat0, lon0, mx, my) {
    return {
      version: 3, name, lat0, lon0, frames: [{ lat0, lon0 }],
      res: { wood: 150, stone: 80, food: 120, gold: 60, iron: 0 },
      pop: 0, people: [], nextPid: 1, lordId: 0, dead: [], chron: [], rank: 0, time: 0, speed: 1, obj: 0, nextId: 2, nextEvent: 150,
      buildings: [{ id: 1, type: 'manoir', px: mx, py: my, f: 0, v: 0 }],
      rd: [], founded: Date.now(),
      army: { soldat: 0, archer: 0, chevalier: 0 }, queue: [], armies: [], incoming: [], reports: [], glory: 0,
    };
  }

  // anciennes sauvegardes (v1) -> v2 : cadres de coordonnées, routes [x, y, cadre]
  static migrate(s) {
    if (!s.frames) s.frames = [{ lat0: s.lat0, lon0: s.lon0 }];
    for (const b of s.buildings) {
      if (b.px === undefined) { b.px = b.x; b.py = b.y; }
      if (b.f === undefined) b.f = 0;
    }
    if (!s.rd) { s.rd = (s.roads || []).map(k => { const [x, y] = oldUnkey(k); return [x, y, 0]; }); }
    delete s.roads;
    for (const e of s.rd) if (!e[3]) e[3] = 2;
    s.people ||= []; s.nextPid ||= 1; s.dead ||= []; s.chron ||= []; s.lordId ||= 0;
    s.army ||= { soldat: 0, archer: 0, chevalier: 0 };
    for (const u of UNIT_TYPES) s.army[u] ||= 0;
    s.queue ||= []; s.armies ||= []; s.incoming ||= []; s.reports ||= [];
    s.glory ||= 0;
    s.version = 3;
  }

  // ---------- cadres de coordonnées (construction infinie) ----------
  frameIndex(region) { return region ? this.s.frames.findIndex(f => sameFrame(f, region)) : -1; }
  ensureFrame(region) {
    let i = this.frameIndex(region);
    if (i < 0) { this.s.frames.push({ lat0: region.lat0, lon0: region.lon0 }); i = this.s.frames.length - 1; }
    return i;
  }
  // convertit (x, y) du cadre f vers la vue (région affichée)
  toView(f, x, y) {
    const fi = this.viewFrame;
    if (f === fi || !this.region) return [x, y];
    const src = this.s.frames[f] || this.s.frames[0];
    const ll = tileToLatLon(frameOf(src), x, y);
    const t = latLonToTile(this.region, ll.lat, ll.lon);
    return [Math.round(t.tx), Math.round(t.ty)];
  }
  setView(region) {
    if (region) this.region = region;
    this.viewFrame = this.frameIndex(this.region);
    for (const b of this.s.buildings) { const [x, y] = this.toView(b.f, b.px, b.py); b.x = x; b.y = y; }
    this.roads = []; this.roadSrc.clear(); this.roadType.clear();
    for (const e of this.s.rd) { const [x, y] = this.toView(e[2], e[0], e[1]); const k = key(x, y); if (this.roadSrc.has(k)) continue; this.roads.push(k); this.roadSrc.set(k, e); this.roadType.set(k, e[3] || 2); }
    this.rebuild();
  }
  manoirLatLon() {
    const m = this.manoir;
    return tileToLatLon(frameOf(this.s.frames[m.f] || this.s.frames[0]), m.px + 1.5, m.py + 1.5);
  }
  inRegion(b) {
    const r = this.region;
    return r && Math.abs(b.x - (r.ctx || 0)) < 9400 && Math.abs(b.y - (r.cty || 0)) < 9400;
  }

  get manoir() { return this.s.buildings.find(b => b.type === 'manoir'); }
  get center() { const m = this.manoir; return [m.x + 1.5, m.y + 1.5]; }
  get radius() { return RANKS[this.s.rank].radius; }
  count(type) { return this.counts[type] || 0; }

  rebuild() {
    this.occ.clear(); this.byId.clear(); this.cleared.clear(); this.cgrid.clear();
    for (const b of this.s.buildings) this.addOcc(b);
    for (const k of this.roads) { const [x, y] = unkey(k); this.setOcc(x, y, -1); }
    // villes IA : cours et jardins dégagés dans les îlots (cadre 0)
    if (this.s.clr) for (const [x0, y0, w, h] of this.s.clr) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const [x, y] = this.toView(0, x0 + i, y0 + j);
      const k = key(x, y);
      if (this.cleared.has(k)) continue;
      this.cleared.add(k);
      const bk = key(x >> 5, y >> 5);
      let set = this.cgrid.get(bk); if (!set) this.cgrid.set(bk, set = new Set()); set.add(k);
    }
    this.nav.invalidate();
    this.recompute();
    if (!this.remote) for (const b of this.s.buildings) {
      if (this.inRegion(b)) { b.site = this.computeSite(b); b.sq = b.site; } else b.site = b.sq ?? 1;
    }
  }
  addOcc(b) {
    const B = BUILDINGS[b.type];
    this.byId.set(b.id, b);
    for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) this.setOcc(b.x + i, b.y + j, b.id);
  }
  // occupation + index spatial des cases défrichées (rendu des chunks)
  setOcc(x, y, id) {
    const k = key(x, y);
    this.occ.set(k, id);
    if (!this.cleared.has(k)) {
      this.cleared.add(k);
      const bk = key(x >> 5, y >> 5);
      let set = this.cgrid.get(bk);
      if (!set) this.cgrid.set(bk, set = new Set());
      set.add(k);
    }
  }
  delOcc(x, y) {
    const k = key(x, y);
    this.occ.delete(k);
    if (this.cleared.delete(k)) { const set = this.cgrid.get(key(x >> 5, y >> 5)); if (set) set.delete(k); }
  }

  // ---------- placement ----------
  tileBlocked(x, y, type) {
    const t = this.app.map.getTile(x, y);
    if (t.g >= 15) return 'Terres inexplorées';
    if (isWater(t.g)) {
      if (BUILDINGS[type].road && t.g === G.RIVER) return null;
      return 'Impossible de bâtir sur l\'eau';
    }
    return null;
  }

  // transformation d'une case déjà occupée : amélioration de route, porte dans un rempart…
  conversion(type, x, y) {
    const B = BUILDINGS[type];
    if (!B || B.w !== 1 || B.h !== 1) return null;
    const k = key(x, y);
    const id = this.occ.get(k);
    if (id === undefined) return null;
    const b = id === -1 ? null : this.byId.get(id);
    const gateOK = this.s.rank >= BUILDINGS.porte.rank;
    if (B.road) {
      if (id === -1) return (this.roadType.get(k) || 2) < B.road ? 'upgrade' : 'same';
      if (b && b.type === 'rempart') return gateOK ? 'gate' : 'blocked';
      if (b && b.type === 'porte') return 'same';
      return 'blocked';
    }
    if (type === 'rempart' || type === 'tour') {
      if (id === -1) return type === 'rempart' && gateOK ? 'gate' : 'blocked';
      if (b && (b.type === 'rempart' || b.type === 'porte' || b.type === 'tour')) return 'same';
      return 'blocked';
    }
    if (type === 'porte') {
      if (id === -1 || (b && b.type === 'rempart')) return 'gate';
      if (b && b.type === 'porte') return 'same';
      return 'blocked';
    }
    return 'blocked';
  }

  costOf(type, x, y) {
    const B = BUILDINGS[type];
    if (x !== undefined) {
      const conv = this.conversion(type, x, y);
      if (conv === 'gate') return BUILDINGS.porte.cost;
      if (B.road && this.app.map.getTile(x, y).g === G.RIVER) return B.road === 1 ? { wood: 4 } : B.road === 3 ? { stone: 10 } : { wood: 6 };
    }
    return B.cost;
  }
  canAfford(cost, mult = 1) { for (const r in cost) if ((this.s.res[r] || 0) < cost[r] * mult) return false; return true; }
  missing(cost) { const m = []; for (const r in cost) if ((this.s.res[r] || 0) < cost[r]) m.push(RES_NAMES[r]); return m; }

  canPlace(type, x, y) {
    const B = BUILDINGS[type];
    if (B.rank > this.s.rank) return { ok: false, why: `Débloqué au rang ${RANKS[B.rank].name}` };
    const conv = this.conversion(type, x, y);
    if (conv === 'same') return { ok: false, same: true, why: 'Déjà construit ici' };
    if (conv === 'blocked') return { ok: false, why: 'Emplacement occupé' };
    const cost = this.costOf(type, x, y);
    if (!this.canAfford(cost)) return { ok: false, why: `Pas assez de ${this.missing(cost).join(', ').toLowerCase()}` };
    if (conv) return { ok: true, conv };
    for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) {
      const tx = x + i, ty = y + j;
      const k = key(tx, ty);
      if (this.occ.has(k)) return { ok: false, why: 'Emplacement occupé' };
      if (this.app.othersAt && this.app.othersAt(k)) return { ok: false, why: 'Ces terres appartiennent à un autre seigneur' };
      const bl = this.tileBlocked(tx, ty, type);
      if (bl) return { ok: false, why: bl };
    }
    if (B.needWater && !this.touchesWater(x, y, B.w, B.h)) return { ok: false, why: 'Doit toucher l\'eau' };
    return { ok: true };
  }

  touchesWater(x, y, w, h) {
    for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
      if (i >= 0 && i < w && j >= 0 && j < h) continue;
      if ((i === -1 || i === w) && (j === -1 || j === h)) continue;
      const g = this.app.map.getTile(x + i, y + j).g;
      if (isWater(g) && !this.occ.has(key(x + i, y + j))) return true;
    }
    return false;
  }

  place(type, x, y, quiet = false) {
    const chk = this.canPlace(type, x, y);
    if (!chk.ok) return chk;
    const cost = this.costOf(type, x, y);
    for (const r in cost) this.s.res[r] -= cost[r];
    const B = BUILDINGS[type];
    const fi = this.ensureFrame(this.region);
    this.viewFrame = fi;
    const k = key(x, y);
    if (chk.conv === 'upgrade') {
      const e = this.roadSrc.get(k);
      if (e) e[3] = B.road;
      this.roadType.set(k, B.road);
    } else if (chk.conv === 'gate') {
      // la porte remplace le rempart ou la route
      if (this.occ.get(k) === -1) this.removeRoad(k, x, y);
      else { const old = this.byId.get(this.occ.get(k)); if (old) this.removeBuilding(old); }
      this.addBuilding('porte', x, y, fi);
    } else if (B.road) {
      const e = [x, y, fi, B.road];
      this.s.rd.push(e); this.roads.push(k); this.roadSrc.set(k, e); this.roadType.set(k, B.road); this.setOcc(x, y, -1);
      this.app.map.invalidate(x, y);
    } else {
      const b = this.addBuilding(type, x, y, fi);
      b.born = performance.now();
      this.spawnDust(x + B.w / 2, y + B.h / 2, B.w);
    }
    this.changed();
    if (!quiet) this.app.audio.play(B.road ? 'tick' : 'build');
    return { ok: true };
  }
  addBuilding(type, x, y, fi) {
    const B = BUILDINGS[type];
    const b = { id: this.s.nextId++, type, x, y, px: x, py: y, f: fi, v: Math.floor(hash2(x, y, 3) * 6) };
    this.s.buildings.push(b);
    this.addOcc(b);
    for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) this.app.map.invalidate(x + i, y + j);
    b.site = this.computeSite(b); b.sq = b.site;
    return b;
  }
  removeRoad(k, x, y) {
    const e = this.roadSrc.get(k);
    if (e) { const i = this.s.rd.indexOf(e); if (i >= 0) this.s.rd.splice(i, 1); }
    this.roadSrc.delete(k); this.roadType.delete(k);
    const i = this.roads.indexOf(k); if (i >= 0) this.roads.splice(i, 1);
    this.delOcc(x, y);
    this.app.map.invalidate(x, y);
  }
  removeBuilding(b) {
    const B = BUILDINGS[b.type];
    const i = this.s.buildings.indexOf(b); if (i >= 0) this.s.buildings.splice(i, 1);
    this.byId.delete(b.id);
    for (let j = 0; j < B.h; j++) for (let i2 = 0; i2 < B.w; i2++) { this.delOcc(b.x + i2, b.y + j); this.app.map.invalidate(b.x + i2, b.y + j); }
    if (this.selected === b) this.selected = null;
  }
  changed() {
    this.nav.invalidate();
    this.recompute();
    this.dirty = true;
    if (this.pp) this.pp.jobDirty = true;
  }

  demolishAt(x, y) {
    const k = key(x, y);
    const id = this.occ.get(k);
    if (id === undefined) return false;
    if (id === -1) this.removeRoad(k, x, y);
    else {
      const b = this.byId.get(id);
      if (b.type === 'manoir') { this.app.ui.toast('Le manoir ne peut pas être démoli', 'bad'); return false; }
      const B = BUILDINGS[b.type];
      for (const r in B.cost) this.s.res[r] += Math.floor(B.cost[r] / 2);
      this.removeBuilding(b);
      this.spawnDust(b.x + B.w / 2, b.y + B.h / 2, B.w);
    }
    this.changed();
    this.app.audio.play('demolish');
    return true;
  }

  buildingAt(x, y) {
    const id = this.occ.get(key(Math.floor(x), Math.floor(y)));
    if (id === undefined) return null;
    if (id === -1) return { road: true, x: Math.floor(x), y: Math.floor(y) };
    return this.byId.get(id);
  }

  // cases défrichées dans un rectangle (pour le rendu des chunks)
  clearedIn(x0, y0, n) {
    const out = [];
    for (let by = y0 >> 5; by <= (y0 + n - 1) >> 5; by++) for (let bx = x0 >> 5; bx <= (x0 + n - 1) >> 5; bx++) {
      const set = this.cgrid.get(key(bx, by));
      if (!set) continue;
      for (const k of set) {
        const [x, y] = unkey(k);
        if (x >= x0 && y >= y0 && x < x0 + n && y < y0 + n) out.push([x, y]);
      }
    }
    return out;
  }

  // ---------- connectivité routière (8 directions, les portes comptent comme des routes) ----------
  recompute() {
    const counts = {};
    for (const b of this.s.buildings) counts[b.type] = (counts[b.type] || 0) + 1;
    this.counts = counts;
    const m = this.manoir;
    const net = new Set(this.roads);
    this.gateKeys = [];
    for (const b of this.s.buildings) if (b.type === 'porte') { const k = key(b.x, b.y); net.add(k); this.gateKeys.push(k); }
    this.drawKeys = this.gateKeys.length ? this.roads.concat(this.gateKeys) : this.roads;
    const seen = new Set();
    const q = [];
    if (m) for (let i = -1; i <= 3; i++) for (let j = -1; j <= 3; j++) {
      const k = key(m.x + i, m.y + j);
      if (net.has(k) && !seen.has(k)) { seen.add(k); q.push(k); }
    }
    while (q.length) {
      const k = q.pop();
      const [x, y] = unkey(k);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const k2 = key(x + dx, y + dy);
        if (net.has(k2) && !seen.has(k2)) { seen.add(k2); q.push(k2); }
      }
    }
    this.connectedRoadSet = seen;
    this.connectedRoads = seen.size;
    this.connected.clear();
    for (const b of this.s.buildings) {
      const B = BUILDINGS[b.type];
      if (b.type === 'manoir') { this.connected.add(b.id); continue; }
      let c = false;
      for (let i = -1; i <= B.w && !c; i++) for (let j = -1; j <= B.h && !c; j++) {
        if (i >= 0 && i < B.w && j >= 0 && j < B.h) continue;
        if (seen.has(key(b.x + i, b.y + j))) c = true;
      }
      if (c) this.connected.add(b.id);
    }
    let cap = 0, jobs = 0;
    for (const b of this.s.buildings) { const B = BUILDINGS[b.type]; cap += B.pop || 0; jobs += B.jobs || 0; }
    this.cap = cap;
    if (!this.pp) this.jobs = jobs;
    this.mills = this.s.buildings.filter(b => b.type === 'moulin');
    this.sawmills = this.s.buildings.filter(b => b.type === 'scierie');
  }

  // ---------- qualité du site ----------
  computeSite(b) {
    const B = BUILDINGS[b.type];
    if (!B.site) return 1;
    const map = this.app.map;
    const cx = b.x + B.w / 2, cy = b.y + B.h / 2;
    const scan = (r, fn) => {
      let n = 0;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        n += fn(map.getTile(x, y), x, y);
      }
      return n;
    };
    switch (B.site) {
      case 'fertile': {
        let s = 0, n = 0;
        for (let j = -1; j <= B.h; j++) for (let i = -1; i <= B.w; i++) { s += FERTILITY[map.getTile(b.x + i, b.y + j).g]; n++; }
        return Math.max(0.25, Math.min(1.15, s / n));
      }
      case 'forest': {
        const c = scan(8, (t, x, y) => (TREEISH[t.t] && !this.cleared.has(key(x, y)) ? 1 : 0));
        return 0.35 + Math.min(1.25, c / 35);
      }
      case 'rock': {
        const c = scan(7, (t, x, y) => (t.g === G.ROCK ? 1 : t.t === 6 && !this.cleared.has(key(x, y)) ? 2 : 0));
        return 0.35 + Math.min(1.3, c / 14);
      }
      case 'mountain': {
        let hs = 0, hn = 0;
        const c = scan(9, (t) => { hs += t.h; hn++; return t.g === G.ROCK ? 1 : t.t === 6 ? 2 : 0; });
        return 0.35 + Math.min(1.1, c / 16) + Math.min(0.5, (hs / Math.max(1, hn)) / 2500);
      }
      case 'water': {
        const c = scan(6, (t) => (isWater(t.g) ? 1 : 0));
        return 0.4 + Math.min(1.0, c / 35);
      }
      case 'vigne': {
        let s = 0, n = 0;
        for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) { const g = map.getTile(b.x + i, b.y + j).g; s += g === G.DRY ? 1.2 : g === G.GRASS ? 1 : g === G.MEADOW ? 0.85 : g === G.SAND ? 0.7 : 0.35; n++; }
        let lat = 45;
        try { lat = Math.abs(tileToLatLon(this.region, cx, cy).lat); } catch { }
        const climate = lat < 25 ? 0.75 : lat <= 47 ? 1.1 : lat <= 52 ? 0.85 : 0.5;
        return Math.max(0.25, Math.min(1.3, (s / n) * climate));
      }
    }
    return 1;
  }

  efficiency(b) {
    const B = BUILDINGS[b.type];
    let e = (b.site ?? 1) * this.happyFactor * (1 + this.forgeBonus);
    if (B.jobs) e *= this.pp ? 0.3 + 0.7 * (b.staff ?? 0) : this.staffing;
    if (this.connected.has(b.id) && b.type !== 'manoir') e *= 1.2;
    const near = (list, r) => list.some(m => Math.hypot(m.x - b.x, m.y - b.y) < r);
    if (b.type === 'ferme' && near(this.mills, 12)) e *= 1.5;
    if (b.type === 'boulangerie' && near(this.mills, 15)) e *= 1.5;
    if (b.type === 'bucheron' && near(this.sawmills, 15)) e *= 1.3;
    if (b.type === 'tisserand' && this.count('bergerie')) e *= 1.5;
    return e;
  }
  get happyFactor() { return 0.8 + this.happy / 250; }
  get forgeBonus() { return Math.min(3, this.count('forge')) * 0.08; }

  add(res) { for (const r in res) this.s.res[r] = (this.s.res[r] || 0) + res[r]; }

  // ---------- simulation ----------
  update(dtReal) {
    const active = performance.now() - this.lastDraw < 800 && !this.app.bgMode && dtReal < 0.5;
    if (this.remote) { this.life.update(dtReal, 1, active); this.updateParticles(dtReal, 1); return; }
    const sp = this.s.speed;
    const dt = dtReal * sp;
    if (dt > 0) {
      this.acc += dt;
      while (this.acc >= 0.5) { this.step(0.5); this.acc -= 0.5; }
    }
    this.life.update(dtReal, sp, active);
    this.updateParticles(dtReal, sp);
  }

  step(dt) {
    const s = this.s;
    s.time += dt;
    // bonheur
    let sum = 0;
    for (const b of s.buildings) sum += BUILDINGS[b.type].happy || 0;
    if (this.feast > 0) { this.feast -= dt; sum += 25; }
    let H = 50 + 45 * (1 - Math.exp(-sum / 30)) - s.pop * 0.045 + (s.rank === 0 ? 10 : 0);
    if (s.res.food <= 0.5) H -= 15;
    const mourning = (s.recentDeaths || []).length;
    if (mourning && !this.count('cimetiere')) H -= Math.min(10, mourning * 0.7);
    if (s.epi && s.epi.until > s.time) H -= 8;
    this.happy = Math.max(5, Math.min(100, H));
    // habitants : naissances, décès, mariages, emplois, immigration
    if (this.pp) {
      this.pp.step(dt);
      this.milT = (this.milT || 0) + dt;
      if (this.milT > 6) { this.milT = 0; this.pp.syncMilitary(); }
    } else {
      this.staffing = this.jobs > 0 ? Math.min(1, s.pop / this.jobs) : 1;
    }
    // production
    const d = { wood: 0, stone: 0, food: 0, gold: 0, iron: 0 };
    for (const b of s.buildings) {
      const B = BUILDINGS[b.type];
      if (!B.prod) continue;
      const e = this.efficiency(b);
      for (const r in B.prod) d[r] += B.prod[r] * e;
    }
    d.food -= s.pop * 0.035 * (1 - 0.15 * Math.min(2, this.count('grenier')));
    d.gold += s.pop * 0.012 * (this.happy / 60);
    for (const r of RES) {
      s.res[r] = Math.max(0, s.res[r] + d[r] * dt);
      this.rates[r] = this.rates[r] * 0.8 + d[r] * 60 * 0.2;
    }
    // rang
    while (s.rank < RANKS.length - 1 && s.pop >= RANKS[s.rank + 1].pop) {
      s.rank++;
      this.app.onRankUp(s.rank);
    }
    // objectifs
    const o = OBJECTIVES[s.obj];
    if (o) {
      const [a, b] = o.prog(this);
      if (a >= b) {
        this.add(o.reward);
        s.obj++;
        this.app.ui.toast(`Objectif accompli : ${o.text} — récompense : ${fmtCost(o.reward)}`, 'good');
        this.app.audio.play('reward');
      }
    }
    // sites (recalcul périodique)
    if (Math.floor(s.time) % 15 === 0 && Math.floor(s.time - dt) % 15 !== 0) for (const b of s.buildings) if (this.inRegion(b)) { b.site = this.computeSite(b); b.sq = b.site; }
    // entraînement des troupes + entretien
    this.trainStep(dt);
    // événements
    if (s.time >= s.nextEvent) {
      s.nextEvent = s.time + 110 + Math.random() * 140;
      const tot = EVENTS.reduce((a, e) => a + e.w, 0);
      let r = Math.random() * tot;
      for (const ev of EVENTS) {
        r -= ev.w;
        if (r <= 0) { const msg = ev.f(this); if (msg) { this.app.ui.toast(msg, ev.bad ? 'bad' : ''); this.app.audio.play(ev.bad ? 'bad' : 'coin'); } break; }
      }
    }
  }

  dateText() {
    const t = this.s.time;
    const season = Math.floor(t / SEASON_LEN) % 4;
    const year = 1100 + Math.floor(t / (SEASON_LEN * 4));
    return `${SEASONS[season]} de l'an ${year}`;
  }

  // ---------- particules (fumée, poussière) ----------
  spawnDust(x, y, w) {
    for (let i = 0; i < 10 + w * 4; i++) this.particles.push({ x: x + (Math.random() - 0.5) * w, y: y + (Math.random() - 0.5) * w * 0.6, vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 0.8, life: 0.8 + Math.random() * 0.6, max: 1.4, dust: true, s: 0.3 + Math.random() * 0.3 });
  }
  updateParticles(dt, sp) {
    const P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.dust) { p.vx += 0.15 * dt; p.s += dt * 0.25; }
    }
    // fumée des cheminées (bâtiments visibles uniquement)
    if (sp > 0 && P.length < 500 && this.view) {
      const v = this.view;
      for (const b of this.s.buildings) {
        const B = BUILDINGS[b.type];
        if (!B.smoke) continue;
        if (b.x + B.w < v.x0 || b.x > v.x1 || b.y + B.h < v.y0 || b.y - 4 > v.y1) continue;
        for (const [sx, sy] of B.smoke) {
          if (Math.random() < dt * 1.4) P.push({ x: b.x + (sx + 1) / 16, y: b.y + (sy - B.top - 2) / 16, vx: 0.05, vy: -0.45, life: 2.6, max: 2.6, s: 0.12 });
        }
      }
    }
  }

  // ---------- rendu de la ville sur la carte ----------
  draw(ctx, map, time) {
    const z = map.z, W = map.W, H = map.H;
    const [ax, ay] = map.toTile(0, 0), [bx, by] = map.toTile(W, H);
    this.view = { x0: ax - 2, y0: ay - 2, x1: bx + 2, y1: by + 8 };
    const k = z / 16;
    const SX = (tx) => (tx - map.cx) * z + W / 2, SY = (ty) => (ty - map.cy) * z + H / 2;
    const [ccx, ccy] = this.center;

    if (z < 2.2) {
      // vue lointaine : petits rectangles + blason
      const RC = ['#a8864e', '#9c7e50', '#b4935e', '#a49e92'];
      for (const kk of this.roads) {
        const [x, y] = unkey(kk); if (x < ax - 1 || x > bx + 1 || y < ay - 1 || y > by + 1) continue;
        ctx.fillStyle = RC[this.roadType.get(kk) || 2];
        ctx.fillRect(SX(x), SY(y), Math.max(1, z), Math.max(1, z));
      }
      for (const b of this.s.buildings) {
        const B = BUILDINGS[b.type];
        if (b.x + B.w < ax - 1 || b.x > bx + 1 || b.y + B.h < ay - 1 || b.y > by + 1) continue;
        ctx.fillStyle = b.type === 'ferme' || b.type === 'vignoble' ? '#c8a83a' : b.type === 'manoir' || b.type === 'chateau' ? '#e8e0d0' : B.wall ? '#8a847a' : '#b0503a';
        ctx.fillRect(SX(b.x), SY(b.y), Math.max(1, B.w * z), Math.max(1, B.h * z));
      }
      this.drawLabel(ctx, map, SX(ccx), SY(ccy));
      this.drawGhost(ctx, map, SX, SY, k, time);
      return;
    }

    ctx.imageSmoothingEnabled = false;
    // routes (chemins, routes, rues pavées, ponts)
    drawRoadNet(ctx, map, this.drawKeys || this.roads, (kk) => this.roadType.get(kk) || (this.occ.get(kk) > 0 && this.byId.get(this.occ.get(kk))?.type === 'porte' ? 2 : 0), (x, y) => isWater(this.app.map.getTile(x, y).g), this.view);
    // aperçu de tracé (routes / remparts)
    if (this.drag && this.drag.path) {
      for (const [x, y, ok] of this.drag.path) {
        if (ok === null) continue;
        ctx.fillStyle = ok ? 'rgba(120,230,120,0.45)' : 'rgba(240,80,60,0.45)';
        ctx.fillRect(SX(x), SY(y), z, z);
      }
    }

    // liste triée en profondeur
    const items = [];
    for (const b of this.s.buildings) {
      const B = BUILDINGS[b.type];
      if (b.x + B.w < ax - 1 || b.x > bx + 1 || b.y + B.h < ay - 1 || b.y - B.top / 16 > by + 1) continue;
      items.push({ y: b.y + B.h, b });
    }
    if (items.length) this.lastDraw = performance.now();
    if (z >= 4) {
      this.life.collect(items, this.view);
      if (this.app.game === this && this.app.lord) this.app.lord.collect(items, this.view);
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      if (!it.b) {
        if (it.fn) it.fn(ctx, SX, SY, k, time);
        else this.life.drawItem(ctx, it, SX, SY, k, time);
        continue;
      }
      const b = it.b;
      const B = BUILDINGS[b.type];
      if (b.type === 'rempart') {
        const spr = this.wallSprites[this.wallMask(b.x, b.y)];
        ctx.drawImage(spr, Math.round(SX(b.x)), Math.round(SY(b.y) - 10 * k), Math.ceil(16 * k), Math.ceil(26 * k));
        continue;
      }
      const spr = getSprite(b.type, b.v, b.type === 'manoir' ? this.s.rank : 0);
      let x0 = SX(b.x), y0 = SY(b.y) - B.top * k;
      let sc = 1;
      if (b.born) {
        const t = (performance.now() - b.born) / 350;
        if (t >= 1) b.born = 0; else sc = 0.6 + 0.4 * easeOutBack(t);
      }
      const w = spr.width * k * sc, h = spr.height * k * sc;
      x0 += (spr.width * k - w) / 2; y0 += (spr.height * k - h);
      ctx.drawImage(spr, Math.round(x0), Math.round(y0), Math.round(w), Math.round(h));
      if (b.type === 'moulin') this.drawBlades(ctx, SX(b.x) + 16 * k, SY(b.y) - 2 * k, k, time);
      if (this.selected === b || this.hoverB === b) {
        ctx.strokeStyle = this.selected === b ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2 * map.dpr;
        ctx.strokeRect(SX(b.x) + 1, SY(b.y) + 1, B.w * z - 2, B.h * z - 2);
      }
    }
    // particules
    for (const p of this.particles) {
      const a = Math.min(1, p.life / p.max * 1.5);
      ctx.fillStyle = p.dust ? `rgba(180,160,120,${a * 0.7})` : `rgba(225,225,230,${a * 0.55})`;
      const s = p.s * z;
      ctx.fillRect(SX(p.x) - s / 2, SY(p.y) - s / 2, s, s);
    }
    if (z < 5) this.drawLabel(ctx, map, SX(ccx), SY(ccy) - 3 * z);
    this.drawGhost(ctx, map, SX, SY, k, time);
  }

  drawBlades(ctx, hx, hy, k, time) {
    const ang = (time / 1000) * 1.2 * Math.min(3, this.s.speed || 0.0001);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(this.s.speed ? ang : 0.4);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#4a3020'; ctx.fillRect(-0.5 * k, 0, 1.2 * k, 15 * k);
      ctx.fillStyle = '#e8e0cc'; ctx.fillRect(0.7 * k, 3 * k, 3.2 * k, 11 * k);
      ctx.fillStyle = '#b8b0a0'; ctx.fillRect(0.7 * k, 3 * k, 3.2 * k, 1 * k);
    }
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-1.5 * k, -1.5 * k, 3 * k, 3 * k);
    ctx.restore();
  }

  drawLabel(ctx, map, x, y) {
    const d = map.dpr;
    ctx.save();
    ctx.font = `bold ${15 * d}px "Palatino Linotype", Georgia, serif`;
    ctx.textAlign = 'center';
    const icon = this.app.crestImg;
    if (icon && icon.complete) ctx.drawImage(icon, x - 16 * d, y - 40 * d, 32 * d, 32 * d);
    ctx.lineWidth = 4 * d; ctx.strokeStyle = 'rgba(25,18,10,0.9)';
    ctx.strokeText(this.s.name, x, y + 4 * d);
    ctx.fillStyle = '#f3d77a';
    ctx.fillText(this.s.name, x, y + 4 * d);
    if (this.remote && this.owner) {
      ctx.font = `bold ${12 * d}px "Palatino Linotype", Georgia, serif`;
      ctx.strokeText(this.owner, x, y + 20 * d);
      ctx.fillStyle = this.color || '#fff';
      ctx.fillText(this.owner, x, y + 20 * d);
    }
    ctx.restore();
  }

  // Résumé compact de la ville pour les autres joueurs
  snapshot(pid, owner, color) {
    const s = this.s;
    return {
      v: 3, pid, owner, color, name: s.name, frames: s.frames, rank: s.rank, pop: s.pop, updated: Date.now(),
      lord: this.pp && this.pp.lord ? { n: this.pp.fullName(this.pp.lord), s: this.pp.lord.s, lk: this.pp.lord.lk } : undefined,
      def: Math.round(this.defensePower()), army: this.armyAtHome,
      b: s.buildings.map(b => [b.type, b.px, b.py, b.v || 0, b.f || 0]), r: s.rd,
    };
  }

  // Ville d'un autre joueur (ou d'un village IA), recalée dans la région affichée
  static fromSnapshot(app, snap, region) {
    snap = normalizeSnap(snap);
    const buildings = snap.b.map(([type, x, y, v, f], i) => ({ id: i + 1, type, px: x, py: y, v, f: f || 0 })).filter(b => BUILDINGS[b.type]);
    const s = { version: 3, name: snap.name, frames: snap.frames, lat0: snap.frames[0].lat0, lon0: snap.frames[0].lon0, rank: snap.rank || 0, pop: snap.pop || 0, buildings, rd: snap.r.map(e => e.slice()), res: {}, speed: 1, time: 0, obj: 0, people: [], clr: Array.isArray(snap.clr) ? snap.clr.slice(0, 400) : null };
    return new Game(app, s, { remote: true, owner: snap.owner, color: snap.color, pid: snap.pid, region });
  }

  drawGhost(ctx, map, SX, SY, k, time) {
    const h = this.hoverTile;
    if (!h || !this.tool || this.tool === 'demolish' || this.drag) return;
    const B = BUILDINGS[this.tool];
    if (B.road || (B.wall && !B.gate)) {
      const c = this.canPlace(this.tool, h.x, h.y);
      ctx.fillStyle = c.ok ? 'rgba(120,230,120,0.5)' : c.same ? 'rgba(255,255,255,0.25)' : 'rgba(240,80,60,0.5)';
      ctx.fillRect(SX(h.x), SY(h.y), map.z, map.z);
      this.ghostCheck = c;
      return;
    }
    const x = h.x - Math.floor((B.w - 1) / 2), y = h.y - Math.floor((B.h - 1) / 2);
    const chk = this.canPlace(this.tool, x, y);
    ctx.fillStyle = chk.ok ? 'rgba(120,230,120,0.35)' : 'rgba(240,80,60,0.4)';
    ctx.fillRect(SX(x), SY(y), B.w * map.z, B.h * map.z);
    if (map.z >= 2.2) {
      const spr = getSprite(this.tool, 0, 0);
      ctx.globalAlpha = 0.65 + 0.1 * Math.sin(time / 200);
      ctx.drawImage(spr, Math.round(SX(x)), Math.round(SY(y) - B.top * k), spr.width * k, spr.height * k);
      ctx.globalAlpha = 1;
    }
    this.ghostCheck = chk;
  }

  wallMask(x, y) {
    const r = (dx, dy) => { const id = this.occ.get(key(x + dx, y + dy)); if (id === undefined || id === -1) return false; const b = this.byId.get(id); return b && (b.type === 'rempart' || b.type === 'tour' || b.type === 'porte'); };
    return (r(0, -1) ? 1 : 0) | (r(1, 0) ? 2 : 0) | (r(0, 1) ? 4 : 0) | (r(-1, 0) ? 8 : 0);
  }

  // ---------- outils ----------
  linePath(x0, y0, x1, y1) {
    const out = [];
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    out.push([x, y]);
    // d'abord le plus long axe
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
      while (x !== x1) { x += dx; out.push([x, y]); }
      while (y !== y1) { y += dy; out.push([x, y]); }
    } else {
      while (y !== y1) { y += dy; out.push([x, y]); }
      while (x !== x1) { x += dx; out.push([x, y]); }
    }
    return out.slice(0, 400);
  }
  previewPath() {
    const d = this.drag;
    // routes : tracé droit dans les 8 directions (diagonales) ; remparts : en L
    const pts = BUILDINGS[this.tool].road ? lineTiles(d.x0, d.y0, d.x1, d.y1, 500) : this.linePath(d.x0, d.y0, d.x1, d.y1);
    // simulation des coûts
    const res = { ...this.s.res };
    d.path = pts.map(([x, y]) => {
      const c = this.canPlace(this.tool, x, y);
      if (c.same) return [x, y, null];
      if (!c.ok) return [x, y, false];
      const cost = this.costOf(this.tool, x, y);
      for (const r in cost) { if (res[r] < cost[r]) return [x, y, false]; }
      for (const r in cost) res[r] -= cost[r];
      return [x, y, true];
    });
  }
  toolDown(tx, ty) {
    const x = Math.floor(tx), y = Math.floor(ty);
    const B = BUILDINGS[this.tool];
    if (this.tool === 'demolish') { this.drag = { demolish: true }; this.demolishAt(x, y); return; }
    if (B && (B.road || (B.wall && !B.gate))) { this.drag = { x0: x, y0: y, x1: x, y1: y }; this.previewPath(); }
  }
  toolMove(tx, ty) {
    const x = Math.floor(tx), y = Math.floor(ty);
    if (!this.drag) return;
    if (this.drag.demolish) { this.demolishAt(x, y); return; }
    if (x !== this.drag.x1 || y !== this.drag.y1) { this.drag.x1 = x; this.drag.y1 = y; this.previewPath(); }
  }
  toolUp(tx, ty) {
    const d = this.drag;
    this.drag = null;
    if (!d) {
      // clic simple de placement
      const B = BUILDINGS[this.tool];
      if (!B) return;
      const x = Math.floor(tx) - Math.floor((B.w - 1) / 2), y = Math.floor(ty) - Math.floor((B.h - 1) / 2);
      const r = this.place(this.tool, x, y);
      if (!r.ok) { this.app.ui.toast(r.why, 'bad'); this.app.audio.play('error'); }
      else if (!this.canAfford(BUILDINGS[this.tool].cost)) { /* garde l'outil */ }
      return;
    }
    if (d.demolish) return;
    let n = 0, why = null;
    for (const [x, y, ok] of d.path || []) {
      if (!ok) continue;
      const r = this.place(this.tool, x, y, true);
      if (r.ok) n++; else why = r.why;
    }
    if (n) this.app.audio.play('build');
    else if ((d.path || []).some(p => p[2] === false)) {
      const first = d.path.find(p => p[2] === false);
      this.app.ui.toast(why || this.canPlace(this.tool, first[0], first[1]).why || 'Impossible de construire ici', 'bad'); this.app.audio.play('error');
    }
  }

  serialize() {
    const s = this.s;
    return JSON.stringify({ ...s, buildings: s.buildings.map(({ id, type, px, py, f, v, sq }) => ({ id, type, px, py, f, v, sq: sq === undefined ? undefined : Math.round(sq * 1000) / 1000 })) });
  }

  // ---------- armée ----------
  get armyAtHome() { let n = 0; for (const u of UNIT_TYPES) n += this.s.army[u] || 0; return n; }
  get armyCap() { return Math.floor(this.s.pop * 0.5) + 5; }
  armyTotal() {
    let n = this.armyAtHome;
    for (const a of this.s.armies) for (const u of UNIT_TYPES) n += a.units[u] || 0;
    for (const q of this.s.queue) n += q.n;
    return n;
  }
  canTrain(u) { return this.count(UNITS[u].needs) > 0; }
  train(u, n) {
    const U = UNITS[u];
    if (!this.canTrain(u)) return `Il faut d'abord construire : ${BUILDINGS[U.needs].name}`;
    n = Math.min(n, this.armyCap - this.armyTotal());
    if (n <= 0) return `Armée au maximum (${this.armyCap}) : fais grandir ta population`;
    if (this.pp) {
      const queued = this.s.queue.reduce((a, q) => a + q.n, 0);
      n = Math.min(n, this.pp.recruitable().length - queued);
      if (n <= 0) return 'Plus assez d\'habitants en âge de combattre (16 à 50 ans, en bonne santé)';
    }
    let afford = n;
    for (const r in U.cost) afford = Math.min(afford, Math.floor((this.s.res[r] || 0) / U.cost[r]));
    if (afford <= 0) return `Pas assez de ressources pour un ${U.one.toLowerCase()}`;
    for (const r in U.cost) this.s.res[r] -= U.cost[r] * afford;
    const last = this.s.queue[this.s.queue.length - 1];
    if (last && last.u === u) last.n += afford; else this.s.queue.push({ u, n: afford, t: 0 });
    this.dirty = true;
    return null;
  }
  trainStep(dt) {
    const q = this.s.queue[0];
    if (q) {
      const nb = Math.max(1, this.count(UNITS[q.u].needs));
      q.t += dt * (0.7 + 0.3 * nb);
      let done = 0;
      while (q.n > 0 && q.t >= UNITS[q.u].time) { q.t -= UNITS[q.u].time; q.n--; this.s.army[q.u] = (this.s.army[q.u] || 0) + 1; done++; }
      if (q.n <= 0) this.s.queue.shift();
      if (done && this.pp) this.pp.syncMilitary();
    }
    // entretien : un peu de nourriture
    const n = this.armyAtHome;
    if (n) this.s.res.food = Math.max(0, this.s.res.food - n * 0.006 * dt);
  }
  // puissance défensive de la ville (troupes présentes + fortifications)
  defensePower() {
    const s = this.s;
    let d = 0;
    for (const u of UNIT_TYPES) d += (s.army[u] || 0) * UNITS[u].def;
    const walls = this.count('rempart');
    let fort = 6 + s.rank * 6 + this.count('tour') * 10 + this.count('porte') * 6 + Math.min(400, walls * 1.5) + this.count('chateau') * 80;
    let mult = walls >= 20 ? 1.25 : 1;
    return (d + fort) * mult;
  }
}

// anciens instantanés (v1) -> v2
export function normalizeSnap(snap) {
  if (snap.frames) return snap;
  return { ...snap, v: 2, frames: [{ lat0: snap.lat0, lon0: snap.lon0 }], b: snap.b.map(([t, x, y, v]) => [t, x, y, v, 0]), r: (snap.r || []).map(k => { const [x, y] = oldUnkey(k); return [x, y, 0]; }) };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function fmtCost(c) {
  return Object.entries(c).map(([r, v]) => `${v} ${RES_NAMES[r].toLowerCase()}`).join(', ');
}
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

// Évaluation d'un site pour fonder la ville (étoiles 0..3)
export function evaluateSite(map, cx, cy) {
  let trees = 0, fert = 0, rock = 0, water = 0, n = 0, land = 0, hsum = 0;
  const R = 30;
  for (let y = -R; y <= R; y += 2) for (let x = -R; x <= R; x += 2) {
    if (x * x + y * y > R * R) continue;
    const t = map.getTile(cx + x, cy + y);
    n++;
    if (isWater(t.g)) { water++; continue; }
    if (t.g >= 15) continue;
    land++;
    hsum += t.h;
    if (TREEISH[t.t]) trees++;
    fert += FERTILITY[t.g];
    if (t.g === G.ROCK || t.t === 6) rock++;
  }
  const st = (v, a, b, c) => (v >= c ? 3 : v >= b ? 2 : v >= a ? 1 : 0);
  return {
    wood: st(trees / n, 0.04, 0.12, 0.25),
    food: st(fert / Math.max(1, land) * (land / n), 0.3, 0.55, 0.8),
    stone: st(rock / n, 0.01, 0.04, 0.1),
    water: st(water / n, 0.005, 0.04, 0.12),
    space: st(land / n, 0.4, 0.7, 0.92),
    alt: Math.round(hsum / Math.max(1, land)),
  };
}

// ----- sprites de remparts (16 combinaisons), 16x26 avec 10 px de hauteur -----
function makeWallSprites() {
  const out = [];
  const top = '#c4beb2', face = '#9a948a', dark = '#6d675f', line = '#2a1e16';
  for (let m = 0; m < 16; m++) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 26;
    const ctx = c.getContext('2d');
    const rects = [[4, 4, 12, 12]];
    if (m & 1) rects.push([4, 0, 12, 4]);
    if (m & 4) rects.push([4, 12, 12, 16]);
    if (m & 2) rects.push([12, 4, 16, 12]);
    if (m & 8) rects.push([0, 4, 4, 12]);
    // ombre
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const [x0, y0, x1, y1] of rects) ctx.fillRect(x0 + 2, y0 + 10 + 2, x1 - x0, y1 - y0);
    // faces avant
    for (const [x0, y0, x1, y1] of rects) {
      ctx.fillStyle = face; ctx.fillRect(x0, y1, x1 - x0, 10);
      ctx.fillStyle = dark;
      for (let yy = y1 + 2; yy < y1 + 10; yy += 3) ctx.fillRect(x0, yy, x1 - x0, 1);
      ctx.fillStyle = line; ctx.fillRect(x0, y1 + 9, x1 - x0, 1);
    }
    // dessus
    for (const [x0, y0, x1, y1] of rects) {
      ctx.fillStyle = top; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // créneaux
    ctx.fillStyle = '#d8d2c6';
    for (const [x0, y0, x1, y1] of rects) for (let xx = x0; xx < x1; xx += 3) ctx.fillRect(xx, y1 - 2, 2, 2);
    ctx.fillStyle = line;
    for (const [x0, y0, x1, y1] of rects) {
      if (!(x0 === 4 && y0 === 0) && !(x0 === 12 && y0 === 4) && !(x0 === 0 && y0 === 4)) ctx.fillRect(x0, y0, x1 - x0, 1);
    }
    out.push(c);
  }
  return out;
}
