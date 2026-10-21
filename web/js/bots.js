// Villages IA : des centaines de seigneurs qui fondent leur village en même temps que toi, partout sur Terre,
// aux emplacements de vraies villes, et grandissent à partir de zéro comme les joueurs.
// Tout est déterministe (graine du monde + horloge du monde) : chaque joueur d'une partie voit les mêmes villages.
import { mulberry32, hash2 } from './noise.js';
import { haversine, latLonToTile } from './geo.js';
import { BUILDINGS, RANKS } from './buildings.js';
import { isWater, FERTILITY, G } from './terrain.js';
import { key } from './keys.js';
import { Game, UNITS } from './game.js';

export const MAX_BOTS = 2000;
const BOT_COLORS = ['#7b2d26', '#1f4e79', '#2e6b30', '#8c6d1f', '#5b2c6f', '#a04000', '#117a65', '#7d3c98', '#922b21', '#1a5276', '#b9770e', '#424949'];
const FIRST = ['Aldric', 'Baudouin', 'Godefroy', 'Thibaut', 'Hugues', 'Enguerrand', 'Gauthier', 'Renaud', 'Geoffroy', 'Amaury', 'Bertrand', 'Guillaume',
  'Raoul', 'Foulques', 'Aymeric', 'Eudes', 'Lothaire', 'Tancrède', 'Odon', 'Arnaud', 'Ysabeau', 'Aliénor', 'Mathilde', 'Blanche', 'Héloïse', 'Adélaïde',
  'Constance', 'Bérengère', 'Isaure', 'Clémence', 'Ermengarde', 'Gisèle'];
const TITLES = ['Seigneur', 'Baron', 'Vicomte', 'Comte', 'Duc', 'Roi'];
const TITLES_F = ['Dame', 'Baronne', 'Vicomtesse', 'Comtesse', 'Duchesse', 'Reine'];
export const TEMPER_NAMES = { paisible: 'Paisible', neutre: 'Prudent', belliqueux: 'Belliqueux' };

export function rankOf(pop) { let r = 0; while (r < RANKS.length - 1 && pop >= RANKS[r + 1].pop) r++; return r; }

// ---------------- monde des bots ----------------
export const EPOCH = 600;       // s : une « saison de campagne » entre seigneurs IA
const NB_RANGE = 90000;         // m : rayon des voisins (guerres, alliances, routes)

// population d'un bot sans tenir compte des guerres (croissance rapide)
// croissance : rapide, encore plus forte avec des alliés (commerce entre seigneurs IA)
export function growthOf(b, age) { return Math.min(b.maxPop, 10 + 6 * b.g * (b.allyMult || 1) * Math.pow(Math.max(0, age) / 60, 1.25)); }
export function basePop(b, t) {
  const age = t - b.foundAt;
  if (age < 0) return 0;
  return growthOf(b, age);
}

export class BotWorld {
  constructor(places) { this.places = places; this.bots = []; this.events = []; this.byId = new Map(); }

  // sélection déterministe des emplacements (vraies villes, espacées d'au moins 30 km)
  init(seed, count = MAX_BOTS) {
    this.seed = seed >>> 0;
    const rnd = mulberry32(this.seed ^ 0x5bd1e995);
    const cand = this.places.map((p) => ({ p, s: Math.log10((p[5] || 0) + 50) + rnd() * 1.8 }));
    cand.sort((a, b) => b.s - a.s);
    const grid = new Map();
    const cell = (lat, lon) => `${Math.floor(lat / 0.6)}:${Math.floor(lon / 0.6)}`;
    const bots = [];
    for (const c of cand) {
      if (bots.length >= count) break;
      const [name, , country, lat, lon, pop] = c.p;
      let ok = true;
      for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1 && ok; dj++) {
        const l = grid.get(`${Math.floor(lat / 0.6) + di}:${Math.floor(lon / 0.6) + dj}`);
        if (l) for (const b of l) if (haversine(lat, lon, b.lat, b.lon) < 30000) { ok = false; break; }
      }
      if (!ok) continue;
      const id = bots.length;
      const r = mulberry32(this.seed ^ Math.imul(id + 1, 2654435761));
      const temperR = r();
      const temper = temperR < 0.45 ? 'paisible' : temperR < 0.8 ? 'neutre' : 'belliqueux';
      const bigCity = Math.min(1, Math.max(0, (Math.log10((pop || 0) + 10) - 3) / 4));
      const female = r() < 0.3;
      const b = {
        id, name, country,
        lat: lat + (r() - 0.5) * 0.03, lon: lon + (r() - 0.5) * 0.03 / Math.max(0.2, Math.cos(lat * Math.PI / 180)),
        foundAt: r() < 0.5 ? r() * 90 : 90 + Math.pow(r(), 1.6) * 1800,
        g: 0.7 + r() * 0.8,
        maxPop: Math.round((400 + Math.pow(r(), 1.5) * 6000) * (0.75 + 0.6 * bigCity)),
        mil: temper === 'paisible' ? 0.08 + r() * 0.07 : temper === 'neutre' ? 0.12 + r() * 0.1 : 0.2 + r() * 0.12,
        temper, female,
        lord: FIRST[female ? 20 + Math.floor(r() * 12) : Math.floor(r() * 20)],
        color: BOT_COLORS[Math.floor(r() * BOT_COLORS.length)],
        seed: Math.floor(r() * 4294967295),
        nb: [], inc: [],
      };
      bots.push(b);
      const k = cell(b.lat, b.lon);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
    this.bots = bots;
    this.byId = new Map(bots.map(b => [b.id, b]));
    // voisins (guerres et alliances entre seigneurs IA)
    for (const b of bots) {
      const near = [];
      const ci = Math.floor(b.lat / 0.6), cj = Math.floor(b.lon / 0.6);
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        for (const o of grid.get(`${ci + di}:${cj + dj}`) || []) {
          if (o === b) continue;
          const d = haversine(b.lat, b.lon, o.lat, o.lon);
          if (d < NB_RANGE) near.push([d, o.id]);
        }
      }
      near.sort((a, c) => a[0] - c[0]);
      b.nb = near.slice(0, 8).map(x => x[1]);
      b.nbd = near.slice(0, 8).map(x => x[0]);
    }
    for (const b of bots) for (const id of b.nb) this.byId.get(id).inc.push(b.id);
    // alliances entre seigneurs IA : chaque allié voisin accélère la croissance (+20 %)
    for (const b of bots) {
      b.allies = b.nb.filter(id => this.allied(b, this.byId.get(id)));
      b.allyMult = 1 + 0.2 * b.allies.length;
    }
    this.cache = new Map(); this.wars = new Map(); this.hist = new Map();
    return this;
  }

  setEvents(list) { this.events = list || []; this.cache.clear(); this.evByBot = null; }
  addEvent(e) {
    if (this.events.some(x => x.id === e.id)) return false;
    this.events.push(e); this.cache.clear(); this.evByBot = null;
    return true;
  }
  eventsFor(id) {
    if (!this.evByBot) {
      this.evByBot = new Map();
      for (const e of this.events) { if (!this.evByBot.has(e.bot)) this.evByBot.set(e.bot, []); this.evByBot.get(e.bot).push(e); }
      for (const l of this.evByBot.values()) l.sort((a, b) => a.t - b.t);
    }
    return this.evByBot.get(id) || [];
  }

  title(b, rank) { return (b.female ? TITLES_F : TITLES)[Math.min(rank, 5)] + ' ' + b.lord; }

  // ---------- diplomatie automatique entre seigneurs IA (déterministe : identique pour tous les joueurs) ----------
  allied(a, b) {
    const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
    const r = mulberry32((this.seed ^ Math.imul(lo + 1, 0x9E3779B1) ^ Math.imul(hi + 1, 0x85EBCA77)) >>> 0)();
    const t = (x) => (x.temper === 'paisible' ? 0.14 : x.temper === 'belliqueux' ? -0.2 : 0);
    return r + t(a) + t(b) > 0.8;
  }
  relationBetween(a, b) {
    if (this.allied(a, b)) return 'alliance';
    return 'paix';
  }
  // guerre lancée par le bot b pendant la saison e (ou null)
  war(b, e) {
    const k = b.id * 100000 + e;
    let w = this.wars.get(k);
    if (w !== undefined) return w;
    w = null;
    const t0 = e * EPOCH;
    if (b.temper !== 'paisible' && b.nb.length && basePop(b, t0) >= 25) {
      const r = mulberry32((this.seed ^ Math.imul(b.id + 7, 0x27d4eb2d) ^ Math.imul(e + 3, 0x165667b1)) >>> 0);
      if (r() < (b.temper === 'belliqueux' ? 0.3 : 0.06)) {
        const i = Math.floor(r() * b.nb.length);
        const tg = this.byId.get(b.nb[i]);
        const t = t0 + 60 + r() * (EPOCH - 120);
        const pd0 = basePop(tg, t);
        if (pd0 >= 10 && !this.allied(b, tg) && b.nbd[i] < 70000) {
          const pa = basePop(b, t) * b.mil * (0.7 + 0.6 * r());
          const pd = pd0 * tg.mil * (0.7 + 0.6 * r()) + 6 + rankOf(pd0) * 5;
          w = { a: b.id, d: tg.id, t, win: pa > pd, crushing: pa > pd * 2.2, ratio: pa / Math.max(1, pd) };
        }
      }
    }
    if (this.wars.size > 400000) this.wars.clear();
    this.wars.set(k, w);
    return w;
  }
  // guerres impliquant b jusqu'à T (attaquant ou défenseur)
  history(b, T) {
    const E = Math.floor(T / EPOCH);
    let h = this.hist.get(b.id);
    if (!h) { h = { e: Math.max(0, Math.floor(b.foundAt / EPOCH)), list: [] }; this.hist.set(b.id, h); }
    const scan = (e, out, lim) => {
      const own = this.war(b, e);
      if (own && own.t <= lim) out.push(own);
      for (const id of b.inc) { const w = this.war(this.byId.get(id), e); if (w && w.d === b.id && w.t <= lim) out.push(w); }
    };
    while (h.e < E) { scan(h.e, h.list, Infinity); h.e++; }
    const cur = [];
    if (E >= Math.floor(b.foundAt / EPOCH)) scan(E, cur, T);
    return cur.length ? h.list.concat(cur) : h.list;
  }

  // état d'un bot à l'instant T (secondes d'horloge du monde)
  state(b, T) {
    const ck = Math.round(T * 4);
    const c = this.cache.get(b.id);
    if (c && c.k === ck) return c.st;
    const st = this.computeState(b, T);
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(b.id, { k: ck, st });
    return st;
  }
  computeState(b, T) {
    let setback = 0, loss = 0, vassal = null, overlord = null, lastWar = null;
    for (const e of this.eventsFor(b.id)) {
      if (e.t > T) break;
      if (e.type === 'raid') { setback += e.setback || 0; loss += (e.loss || 0) * Math.exp(-(T - e.t) / 1500); }
      else if (e.type === 'vassal') vassal = { pid: e.pid, name: e.name, color: e.color };
      else if (e.type === 'free') vassal = null;
    }
    if (T >= b.foundAt) for (const w of this.history(b, T)) {
      const fade = Math.exp(-(T - w.t) / 1500);
      const bp = basePop(b, w.t) * b.mil;
      if (w.a === b.id) { if (!w.win) { setback += 80; loss += bp * 0.6 * fade; } else loss += bp * 0.2 * fade; }
      else if (w.win) {
        setback += 140 + 160 * Math.min(1, w.ratio - 1);
        loss += bp * 0.8 * fade;
        if (w.crushing && T < w.t + 3 * EPOCH) { const a = this.byId.get(w.a); overlord = { id: a.id, name: a.name, color: a.color }; }
      } else loss += bp * 0.3 * fade;
      if (!lastWar || w.t > lastWar.t) lastWar = w;
    }
    const age = T - b.foundAt - setback;
    if (age < 0 || b.absent) return { founded: false };
    const pop = Math.round(growthOf(b, age));
    const rank = rankOf(pop);
    const base = Math.floor(Math.min(pop * b.mil, 30 + Math.sqrt(pop) * 6) * Math.min(1, age / 700) + (age > 240 ? 2 : 0));
    const army = Math.max(0, Math.round(base - loss));
    const ch = rank >= 2 ? Math.floor(army * 0.15) : 0, ar = rank >= 1 ? Math.floor(army * 0.3) : 0;
    const units = { soldat: army - ch - ar, archer: ar, chevalier: ch };
    let defU = 0; for (const u in units) defU += units[u] * UNITS[u].def;
    const fort = 6 + rank * 6 + (rank >= 1 ? rank * 10 : 0) + (rank >= 3 ? 90 : 0) + (rank >= 4 ? 80 : 0);
    const def = Math.round((defU + fort) * (rank >= 3 ? 1.25 : 1));
    const res = { wood: pop * 4, stone: pop * 3, food: pop * 5, gold: pop * 3, iron: rank >= 2 ? pop : 0 };
    return { founded: true, age, pop, rank, army, units, def, res, vassal, overlord: vassal ? null : overlord, lastWar };
  }

  // guerres récentes entre seigneurs IA autour d'un point (nouvelles pour le joueur)
  warsBetween(lat, lon, radiusM, t0, t1) {
    const out = [];
    if (t1 - t0 > EPOCH * 3) t0 = t1 - EPOCH * 3;
    for (const b of this.bots) {
      if (Math.abs(b.lat - lat) > radiusM / 100000 + 0.3) continue;
      if (haversine(lat, lon, b.lat, b.lon) > radiusM) continue;
      for (let e = Math.floor(t0 / EPOCH); e <= Math.floor(t1 / EPOCH); e++) {
        const w = this.war(b, e);
        if (w && w.t > t0 && w.t <= t1 && T_ok(this, w)) out.push(w);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // bots fondés autour d'un point (pour la carte)
  near(lat, lon, radiusM, T) {
    const out = [];
    for (const b of this.bots) {
      if (Math.abs(b.lat - lat) > radiusM / 100000 + 0.5) continue;
      const d = haversine(lat, lon, b.lat, b.lon);
      if (d > radiusM) continue;
      const st = this.state(b, T);
      if (st.founded) out.push({ b, st, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
}
function T_ok(world, w) { const a = world.byId.get(w.a), d = world.byId.get(w.d); return !a.absent && !d.absent; }

// ---------------- plan de ville d'un bot sur le vrai terrain ----------------
// Ville en damier autour du manoir : îlots de 6×6 cases bordés de rues, place du marché au sud du manoir,
// quartiers d'habitation, quartier civique au centre, casernes en périphérie, remparts et portes à partir
// du rang Ville, campagne (fermes, bûcherons, carrières…) reliée par des chemins, routes vers les villes voisines.
const S = 7; // pas de la grille : 1 rue + 6 cases d'îlot
const LOTS = [[0, 0], [2, 0], [4, 0], [0, 4], [2, 4], [4, 4], [0, 2], [4, 2]];
const CIVIC = new Set(['puits', 'marche', 'eglise', 'taverne', 'jardin', 'statue', 'forge', 'boulangerie', 'apothicaire', 'tisserand', 'grenier', 'cathedrale', 'chateau']);
const MIL = new Set(['caserne', 'archerie', 'ecurie']);
const HOUSES = new Set(['maison', 'grandemaison']);
const PLAZA = ['marche', 'puits', 'jardin', 'statue'];
const ORDER = ['maison', 'ferme', 'bucheron', 'puits', 'embarcadere', 'carriere', 'bergerie', 'cimetiere', 'caserne', 'pecheur', 'marche', 'moulin', 'eglise',
  'grenier', 'taverne', 'boulangerie', 'archerie', 'apothicaire', 'tisserand', 'grandemaison', 'mine', 'forge', 'scierie', 'vignoble', 'port', 'ecurie',
  'jardin', 'monastere', 'statue', 'chateau', 'cathedrale'];
const TREEISH = new Uint8Array([0, 1, 1, 1, 1, 1, 0, 1, 1]);

function needs(p, water) {
  return {
    maison: Math.ceil(Math.min(p, 100) / 5.5),
    grandemaison: p > 100 ? Math.ceil((p - 100) / 14) : 0,
    ferme: Math.min(36, Math.ceil(p / 22)),
    bucheron: Math.min(8, 1 + Math.floor(p / 80)),
    carriere: p >= 14 ? Math.min(5, 1 + Math.floor(p / 160)) : 0,
    puits: Math.min(20, 1 + Math.floor(p / 80)),
    embarcadere: water && p >= 12 ? 1 : 0,
    caserne: p >= 18 ? 1 + Math.floor(p / 280) : 0,
    pecheur: water && p >= 20 ? Math.min(6, 1 + Math.floor(p / 220)) : 0,
    marche: p >= 28 ? Math.min(8, 1 + Math.floor(p / 320)) : 0,
    cimetiere: p >= 30 ? Math.min(4, 1 + Math.floor(p / 450)) : 0,
    bergerie: p >= 35 ? Math.min(8, 1 + Math.floor(p / 300)) : 0,
    moulin: p >= 35 ? Math.min(12, 1 + Math.floor(p / 120)) : 0,
    eglise: p >= 45 ? Math.min(6, 1 + Math.floor(p / 420)) : 0,
    taverne: p >= 55 ? 1 + Math.floor(p / 350) : 0,
    boulangerie: p >= 60 ? 1 + Math.floor(p / 250) : 0,
    archerie: p >= 60 ? 1 : 0,
    grenier: p >= 70 ? 1 + Math.floor(p / 400) : 0,
    apothicaire: p >= 80 ? 1 + Math.floor(p / 400) : 0,
    tisserand: p >= 90 ? 1 : 0,
    mine: p >= 90 ? 1 : 0,
    forge: p >= 100 ? 1 : 0,
    vignoble: p >= 100 ? 1 + Math.floor(p / 400) : 0,
    scierie: p >= 120 ? 1 : 0,
    ecurie: p >= 130 ? 1 : 0,
    jardin: p >= 150 ? 1 + Math.floor(p / 250) : 0,
    port: water && p >= 200 ? 1 : 0,
    statue: p >= 250 ? 1 : 0,
    monastere: p >= 300 ? 1 : 0,
    chateau: p >= 380 ? 1 : 0,
    cathedrale: p >= 620 ? 1 : 0,
  };
}

export class BotPlanner {
  constructor(bot, region, map, blocked, world) {
    this.bot = bot; this.map = map; this.blocked = blocked || (() => false); this.world = world;
    this.rng = mulberry32(bot.seed);
    this.occ = new Set(); this.items = []; this.roads = []; this.roadAt = new Map(); this.counts = {};
    this.blocks = new Map(); this.closed = new Set();
    this.region = region;
    const t = latLonToTile(region, bot.lat, bot.lon);
    this.cx = Math.round(t.tx); this.cy = Math.round(t.ty);
    this.p = 6; this.townR = 6; this.walled = false;
    this.ok = this.placeManor();
    if (this.ok) {
      let w = 0;
      for (let dy = -30; dy <= 30; dy += 3) for (let dx = -30; dx <= 30; dx += 3) if (isWater(this.tile(this.mx + dx, this.my + dy).g)) w++;
      this.water = w > 3;
      this.setupHighways();
    }
  }
  tile(x, y) { return this.map.getTile(x, y); }
  land(x, y) { const g = this.tile(x, y).g; return g >= 5 && g < 15; }
  free(x, y) {
    const k = key(x, y);
    if (this.occ.has(k) || this.blocked(k)) return false;
    return this.land(x, y);
  }
  rectFree(x, y, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!this.free(x + i, y + j)) return false;
    return true;
  }
  roadable(x, y) {
    const k = key(x, y);
    if (this.occ.has(k) || this.blocked(k)) return false;
    const g = this.tile(x, y).g;
    return (g >= 5 && g < 15) || g === G.RIVER;
  }
  put(type, x, y, req) {
    const B = BUILDINGS[type];
    for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) this.occ.add(key(x + i, y + j));
    this.items.push({ type, x, y, v: Math.floor(hash2(x, y, 3) * 6), req });
    this.counts[type] = (this.counts[type] || 0) + 1;
  }
  road(x, y, req, kind) {
    const k = key(x, y);
    if (this.roadAt.has(k)) return true;
    if (!this.roadable(x, y)) return false;
    this.occ.add(k);
    const r = { x, y, req, kind, gate: 0 };
    this.roads.push(r); this.roadAt.set(k, r);
    return true;
  }

  // ---------- manoir et grille ----------
  placeManor() {
    let best = null, bs = -1;
    for (let r = 0; r < 70; r += 2) {
      for (let i = -r; i <= r; i += 2) for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        const x = this.cx + dx - 1, y = this.cy + dy - 1;
        if (!this.rectFree(x - 1, y - 1, 5, 5)) continue;
        let n = 0;
        for (let j = -7; j <= 13; j += 2) for (let ii = -7; ii <= 10; ii += 2) if (this.free(x + ii, y + j)) n++;
        const sc = n - r * 0.15;
        if (sc > bs) { bs = sc; best = [x, y]; }
      }
      if (best && bs > 80) break;
    }
    if (!best) return false;
    const [x, y] = best;
    this.mx = x; this.my = y;
    this.gx0 = x - 2; this.gy0 = y - 2;
    this.openBlock(0, 0, 'manoir', 0, true);
    this.put('manoir', x, y, 0);
    this.blocks.get('0,0').used.fill(1, 0, 36); // le manoir et sa cour
    this.openBlock(0, 1, 'place', 6, true);
    return true;
  }
  blockXY(i, j) { return [this.gx0 + i * S + 1, this.gy0 + j * S + 1]; }
  openBlock(i, j, type, req, force = false) {
    const k = i + ',' + j;
    if (this.blocks.has(k) || this.closed.has(k)) return null;
    const [x0, y0] = this.blockXY(i, j);
    const okm = new Uint8Array(36);
    let n = 0;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (this.free(x0 + x, y0 + y)) { okm[y * 6 + x] = 1; n++; }
    if (!force && n < 22) { this.closed.add(k); return null; }
    const blk = { i, j, type, x0, y0, ok: okm, used: new Uint8Array(36), d: Math.hypot(i, j - 0.5), req };
    this.blocks.set(k, blk);
    // rues autour de l'îlot
    const gx = this.gx0 + i * S, gy = this.gy0 + j * S;
    const kindH = (jj) => (jj === 1 ? 'main' : 'street'), kindV = (ii) => (ii === 0 || ii === 1 ? 'main' : 'street');
    for (let t = 0; t <= S; t++) {
      this.road(gx + t, gy, req, kindH(j));
      this.road(gx + t, gy + S, req, kindH(j + 1));
      this.road(gx, gy + t, req, kindV(i));
      this.road(gx + S, gy + t, req, kindV(i + 1));
    }
    this.townR = Math.max(this.townR, Math.hypot(i * S + 3.5, (j - 0.5) * S) + 5);
    return blk;
  }
  // îlots candidats par distance au centre (spirale)
  candidates(minD = 0) {
    if (!this.cand) {
      const c = [];
      for (let j = -16; j <= 17; j++) for (let i = -16; i <= 16; i++) c.push([i, j, Math.hypot(i, (j - 0.5) * 1.05) + hash2(i, j, this.bot.seed % 1000) * 0.6]);
      c.sort((a, b) => a[2] - b[2]);
      this.cand = c;
    }
    return this.cand.filter(([i, j, d]) => d >= minD && !this.blocks.has(i + ',' + j) && !this.closed.has(i + ',' + j));
  }
  fit(blk, w, h, lots) {
    const free = (ox, oy) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (oy + y) * 6 + ox + x; if (!blk.ok[i] || blk.used[i]) return false; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!this.free(blk.x0 + ox + x, blk.y0 + oy + y)) return false;
      return true;
    };
    if (lots) { for (const [ox, oy] of lots) if (free(ox, oy)) return [ox, oy]; return null; }
    let best = null, bs = -1;
    for (let oy = 0; oy + h <= 6; oy++) for (let ox = 0; ox + w <= 6; ox++) {
      if (!free(ox, oy)) continue;
      const sc = (oy + h === 6 ? 3 : 0) + (oy === 0 ? 2 : 0) + (ox === 0 || ox + w === 6 ? 1 : 0);
      if (sc > bs) { bs = sc; best = [ox, oy]; }
    }
    return best;
  }
  putIn(blk, type, ox, oy, req) {
    const B = BUILDINGS[type];
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) blk.used[(oy + y) * 6 + ox + x] = 1;
    this.put(type, blk.x0 + ox, blk.y0 + oy, req);
    return true;
  }
  placeUrban(type, req) {
    const B = BUILDINGS[type];
    const btype = HOUSES.has(type) ? 'res' : MIL.has(type) ? 'mil' : 'civic';
    const lots = HOUSES.has(type) ? LOTS : null;
    const blocks = [...this.blocks.values()].sort((a, b) => a.d - b.d);
    // place du marché, centre des îlots d'habitation (puits, fontaines)
    if (PLAZA.includes(type)) {
      const pl = this.blocks.get('0,1');
      if (pl) { const f = type === 'puits' ? this.fit(pl, 1, 1, [[2, 2], [3, 3], [2, 3], [3, 2]]) : this.fit(pl, B.w, B.h); if (f) return this.putIn(pl, type, f[0], f[1], req); }
      if (type === 'puits' || type === 'jardin') for (const blk of blocks) if (blk.type === 'res') { const f = this.fit(blk, B.w, B.h, [[2, 2]]); if (f) return this.putIn(blk, type, f[0], f[1], req); }
    }
    for (const blk of blocks) {
      if (blk.type !== btype) continue;
      const f = this.fit(blk, B.w, B.h, lots);
      if (f) return this.putIn(blk, type, f[0], f[1], req);
    }
    // nouvel îlot (les casernes vont en périphérie)
    let tries = 0;
    for (const [i, j] of this.candidates(btype === 'mil' ? 1.9 : 0)) {
      if (tries++ > 6) break;
      const blk = this.openBlock(i, j, btype, req);
      if (!blk) continue;
      const f = this.fit(blk, B.w, B.h, lots);
      if (f) return this.putIn(blk, type, f[0], f[1], req);
    }
    return false;
  }

  // ---------- campagne ----------
  siteScore(type, x, y, B) {
    const cx = x + B.w / 2, cy = y + B.h / 2;
    const scan = (r, f) => { let n = 0; for (let j = -r; j <= r; j += 2) for (let i = -r; i <= r; i += 2) n += f(this.tile(Math.floor(cx + i), Math.floor(cy + j))); return n; };
    switch (type) {
      case 'ferme': case 'bergerie': { let s = 0; for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) s += FERTILITY[this.tile(x + i, y + j).g]; return s / (B.w * B.h) * 2; }
      case 'vignoble': { let s = 0; for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) { const g = this.tile(x + i, y + j).g; s += g === G.DRY ? 1.2 : g === G.GRASS ? 1 : 0.4; } return s / (B.w * B.h); }
      case 'bucheron': case 'scierie': return scan(6, t => (TREEISH[t.t] ? 1 : 0)) / 15;
      case 'carriere': case 'mine': return scan(6, t => (t.g === G.ROCK ? 1 : t.t === 6 ? 2 : 0)) / 8;
      case 'pecheur': case 'port': case 'embarcadere': return scan(4, t => (isWater(t.g) ? 1 : 0)) / 10;
      case 'moulin': { let n = 0; for (const it of this.items) if (it.type === 'ferme' && Math.abs(it.x - x) < 14 && Math.abs(it.y - y) < 14) n++; return n; }
      case 'cimetiere': case 'monastere': return 0.5;
    }
    return 0;
  }
  touchesWater(x, y, w, h) {
    for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
      if (i >= 0 && i < w && j >= 0 && j < h) continue;
      if (isWater(this.tile(x + i, y + j).g)) return true;
    }
    return false;
  }
  placeRural(type, req) {
    const B = BUILDINGS[type];
    const water = !!B.needWater;
    const near = type === 'cimetiere' || type === 'moulin';
    const rmin = this.townR + (near ? 1 : 3), rmax = this.townR + (near ? 8 : 20 + this.p / 6) * (water ? 1.8 : 1);
    let best = null, bs = -1e9;
    for (let i = 0; i < 90; i++) {
      const a = this.rng() * Math.PI * 2, d = rmin + this.rng() * (rmax - rmin);
      const x = Math.round(this.mx + 1 + Math.cos(a) * d - B.w / 2), y = Math.round(this.my + 1 + Math.sin(a) * d - B.h / 2);
      if (!this.rectFree(x - 1, y - 1, B.w + 2, B.h + 2)) continue;
      if (water && !this.touchesWater(x, y, B.w, B.h)) continue;
      let sc = this.siteScore(type, x, y, B) - d * 0.008;
      // près des routes existantes : campagne ordonnée le long des chemins
      sc -= this.nearestRoadDist(x + B.w / 2, y + B.h, 30) * 0.015;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (!best) return false;
    this.put(type, best[0], best[1], req);
    this.connect(best[0] + Math.floor(B.w / 2), best[1] + B.h, req);
    return true;
  }
  nearestRoadDist(x, y, lim) {
    let bd = lim;
    for (let i = 0; i < this.roads.length; i += Math.max(1, Math.floor(this.roads.length / 250))) {
      const r = this.roads[i], d = Math.abs(r.x - x) + Math.abs(r.y - y);
      if (d < bd) bd = d;
    }
    return bd;
  }
  // relie un point au réseau existant par le chemin le plus court (recherche en largeur)
  connect(sx, sy, req) {
    if (!this.roadable(sx, sy) && !this.roadAt.has(key(sx, sy))) {
      let found = false;
      for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]]) if (this.roadable(sx + dx, sy + dy)) { sx += dx; sy += dy; found = true; break; }
      if (!found) return;
    }
    const par = new Map(), q = [sx, sy];
    const k0 = key(sx, sy);
    par.set(k0, -1);
    let qi = 0, end = null;
    while (qi < q.length && par.size < 9000) {
      const x = q[qi++], y = q[qi++];
      const k = key(x, y);
      if (this.roadAt.has(k) && k !== k0) { end = k; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (par.has(nk)) continue;
        if (!this.roadAt.has(nk) && !this.roadable(nx, ny)) continue;
        par.set(nk, k); q.push(nx, ny);
      }
    }
    if (!end) return;
    let k = par.get(end);
    while (k !== -1 && k !== undefined) {
      const x = Math.floor(k / 2097152) - 1048576, y = (k % 2097152) - 1048576;
      this.road(x, y, req, 'rural');
      k = par.get(k);
    }
  }

  // ---------- routes vers les villes voisines ----------
  setupHighways() {
    this.hw = [];
    const w = this.world;
    if (!w || !this.bot.nb) return;
    for (let i = 0; i < Math.min(3, this.bot.nb.length); i++) {
      const o = w.byId.get(this.bot.nb[i]);
      if (!o || this.bot.nbd[i] > 60000) continue;
      const t = latLonToTile(this.region, o.lat, o.lon);
      const dx = t.tx - this.mx, dy = t.ty - this.my, L = Math.hypot(dx, dy);
      if (L < 50) continue;
      this.hw.push({ tx: t.tx, ty: t.ty, x: this.mx + 1, y: this.my + 5, len: 0, max: L / 2 + 6, dead: false });
    }
  }
  growHighways(req) {
    const want = 30 + this.p * 1.6;
    for (const h of this.hw) {
      let guard = 0;
      while (!h.dead && h.len < Math.min(want, h.max) && guard++ < 400) {
        let best = null, bs = 1e9;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = h.x + dx, ny = h.y + dy, nk = key(nx, ny);
          const own = this.roadAt.has(nk);
          if (!own && !this.roadable(nx, ny)) continue;
          if (h.prev === nk) continue;
          const t = this.tile(nx, ny);
          const sc = Math.hypot(h.tx - nx, h.ty - ny) + (own ? -0.4 : 0) + (TREEISH[t.t] ? 0.6 : 0) + (t.g === G.RIVER ? 1.5 : 0) + (dx && dy ? 0.25 : 0);
          if (sc < bs) { bs = sc; best = [nx, ny, nk]; }
        }
        if (!best || bs > Math.hypot(h.tx - h.x, h.ty - h.y) + 1.2) { h.dead = true; break; }
        h.prev = key(h.x, h.y);
        h.x = best[0]; h.y = best[1]; h.len++;
        this.road(h.x, h.y, req, 'highway');
      }
    }
  }

  // ---------- remparts ----------
  buildWalls(req) {
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    for (const b of this.blocks.values()) { i0 = Math.min(i0, b.i); i1 = Math.max(i1, b.i); j0 = Math.min(j0, b.j); j1 = Math.max(j1, b.j); }
    const x0 = this.gx0 + i0 * S - 2, x1 = this.gx0 + (i1 + 1) * S + 2, y0 = this.gy0 + j0 * S - 2, y1 = this.gy0 + (j1 + 1) * S + 2;
    // les îlots coupés par l'enceinte ne seront pas bâtis (faubourgs au-delà)
    for (let j = j0 - 1; j <= j1 + 1; j++) for (let i = i0 - 1; i <= i1 + 1; i++) if (!this.blocks.has(i + ',' + j)) this.closed.add(i + ',' + j);
    const ring = [];
    for (let x = x0; x <= x1; x++) ring.push([x, y0], [x, y1]);
    for (let y = y0 + 1; y < y1; y++) ring.push([x0, y], [x1, y]);
    let n = 0;
    for (const [x, y] of ring) {
      const k = key(x, y);
      const corner = (x === x0 || x === x1) && (y === y0 || y === y1);
      const r = this.roadAt.get(k);
      if (r) { r.gate = req; this.items.push({ type: 'porte', x, y, v: 0, req }); continue; }
      if (!this.free(x, y)) continue;
      const tower = corner || (++n % 13 === 0);
      this.put(tower ? 'tour' : 'rempart', x, y, req);
    }
    this.walled = true;
  }

  // avance le plan jusqu'à la population p (incrémental, borné en temps)
  advance(toPop, budgetMs = 12) {
    if (!this.ok) return true;
    const t0 = performance.now();
    while (this.p < toPop) {
      this.p += 2;
      const nd = needs(this.p, this.water);
      for (const type of ORDER) {
        let guard = 0;
        while ((this.counts[type] || 0) < nd[type] && guard++ < 3) {
          const urban = HOUSES.has(type) || CIVIC.has(type) || MIL.has(type);
          const okp = urban ? this.placeUrban(type, this.p) : this.placeRural(type, this.p);
          if (!okp) { this.counts[type] = (this.counts[type] || 0) + 1; break; } // impossible ici : on abandonne ce bâtiment
        }
      }
      if (this.p >= 20 && this.p % 6 === 0) this.growHighways(this.p);
      if (!this.walled && this.p >= 160) this.buildWalls(this.p);
      if (performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }
  // instantané (format Game) des bâtiments existants à la population p
  snapshot(bot, st, region, title) {
    const b = [], r = [];
    const R = st.rank;
    for (const it of this.items) if (it.req <= st.pop) b.push([it.type, it.x, it.y, it.v, 0]);
    for (const rd of this.roads) {
      if (rd.req > st.pop || (rd.gate && rd.gate <= st.pop)) continue;
      const t = rd.kind === 'main' ? (R >= 2 ? 3 : 2) : rd.kind === 'street' ? (R >= 3 ? 3 : R >= 1 ? 2 : 1) : rd.kind === 'highway' ? (R >= 4 ? 3 : 2) : (R >= 3 ? 2 : 1);
      r.push([rd.x, rd.y, 0, t]);
    }
    // îlots bâtis : terrain dégagé (jardins, cours) entre les maisons
    const clr = [];
    for (const blk of this.blocks.values()) if (blk.req <= st.pop && blk.used.some(Boolean)) clr.push([blk.x0, blk.y0, 6, 6]);
    return {
      v: 3, pid: 'bot:' + bot.id, owner: title, color: st.vassal ? st.vassal.color : bot.color, name: bot.name,
      frames: [{ lat0: region.lat0, lon0: region.lon0 }], rank: st.rank, pop: st.pop, b, r, clr, n: b.length * 7 + r.length + R * 100000,
    };
  }
}

// gestionnaire côté client : plans + villes affichées autour de la région
export class BotView {
  constructor(app) { this.app = app; this.planners = new Map(); this.games = new Map(); this.regionKey = null; this.queue = []; }
  reset() {
    for (const g of this.games.values()) this.app.invalidateGame(g);
    this.planners.clear(); this.games.clear(); this.queue = [];
  }
  update(world, region, T, budgetMs = 14) {
    if (!world || !region) return;
    const rk = `${region.lat0},${region.lon0},${region.ctx},${region.cty}`;
    if (rk !== this.regionKey) { this.reset(); this.regionKey = rk; }
    const c = this.app.regionCenterLatLon();
    const near = world.near(c.lat, c.lon, 105000, T);
    const keep = new Set(near.map(n => n.b.id));
    const t0 = performance.now();
    for (const { b, st } of near) {
      if (this.app.siteTakenByPlayer(b)) { b.absent = true; continue; }
      let pl = this.planners.get(b.id);
      if (!pl) {
        if (performance.now() - t0 > budgetMs) continue;
        pl = new BotPlanner(b, region, this.app.map, (k) => this.app.blockedForBots(k, b.id), world);
        this.planners.set(b.id, pl);
        if (!pl.ok) continue;
      }
      if (!pl.ok) continue;
      const done = pl.advance(st.pop, Math.max(2, budgetMs - (performance.now() - t0)));
      const title = world.title(b, st.rank);
      const snap = pl.snapshot(b, st, region, title);
      const old = this.games.get(b.id);
      if (!old || old.snapN !== snap.n || old.s.rank !== st.rank || old.color !== snap.color) {
        const g = Game.fromSnapshot(this.app, snap, region);
        g.isBot = true; g.bot = b; g.snapN = snap.n; g.botState = st;
        if (old) { g.adoptLife(old); this.app.invalidateDiff(old, g); }
        else this.app.invalidateGame(g);
        this.games.set(b.id, g);
      } else { old.botState = st; old.s.pop = st.pop; }
      if (!done || performance.now() - t0 > budgetMs) break;
    }
    for (const [id, g] of this.games) if (!keep.has(id)) { this.app.invalidateGame(g); this.games.delete(id); this.planners.delete(id); }
  }
}
