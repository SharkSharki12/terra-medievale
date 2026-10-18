// Vie de la ville : chaque habitant se déplace pour de vrai (maison → travail → marché → maison) en suivant
// les routes, charrettes tirées par des chevaux, animaux dans les prés, bateaux de pêche et navires.
import { BUILDINGS } from './buildings.js';
import { pathQueue, ROAD_COST } from './nav.js';
import { personSprite, horseSprite, cartSprite, boatSprite, animalSprite, drawAt, TOOLS } from './actors.js';
import { anonPerson, lookOf, YEAR } from './people.js';
import { isWater } from './terrain.js';
import { key } from './keys.js';
import { mulberry32 } from './noise.js';

const TOOL_OF = {
  bucheron: TOOLS.axe, scierie: TOOLS.axe, ferme: TOOLS.fork, carriere: TOOLS.pick, mine: TOOLS.pick, forge: TOOLS.hammer, marche: TOOLS.basket,
  pecheur: TOOLS.rod, port: TOOLS.rod, embarcadere: TOOLS.rod, bergerie: TOOLS.crook, vignoble: TOOLS.basket, moulin: TOOLS.basket, boulangerie: TOOLS.basket,
  monastere: TOOLS.book, eglise: TOOLS.book, apothicaire: TOOLS.basket, tisserand: TOOLS.basket, grenier: TOOLS.basket, taverne: TOOLS.bucket,
};
const OUTDOOR = { ferme: 1, bucheron: 1, carriere: 1, vignoble: 1, bergerie: 1, mine: 0 };
const LEISURE = ['marche', 'eglise', 'taverne', 'puits', 'jardin', 'cimetiere', 'monastere', 'statue'];
const STORE = ['grenier', 'marche', 'manoir'];
const PRODUCERS = { ferme: 'ble', bucheron: 'bois', scierie: 'bois', carriere: 'pierre', mine: 'fer', bergerie: 'laine', vignoble: 'vin', pecheur: 'poisson', moulin: 'ble' };
const DOCKS = { pecheur: 'peche', embarcadere: 'barque', port: 'navire' };
// vitesses réelles de marche (1 case = 10 m) : enfants 1,5 m/s, adultes 1,4 m/s, anciens 1 m/s
const SPEED = { 0: 0.15, 1: 0.14, 2: 0.1 };

export class Life {
  constructor(game, app) {
    this.g = game; this.app = app;
    this.walkers = []; this.animals = []; this.boats = []; this.carts = [];
    this.sched = new Map();
    this.clock = 0; this.tick = 0; this.rr = 0;
    this.anon = game.remote;
    this.seed = (hashStr(game.s.name || 'x') ^ 0x9e3779b9) >>> 0;
    this.rng = mulberry32(this.seed);
    this.structT = -1;
  }

  forget(pid) {
    this.sched.delete(pid);
    this.walkers = this.walkers.filter(w => w.pid !== pid);
  }

  // ---------- mise à jour ----------
  update(dt, sp, active) {
    const f = Math.min(3, sp);
    if (f <= 0) return;
    const d = dt * f;
    this.clock += d;
    if (!active) return;
    this.tick += d;
    if (this.tick > 0.5) {
      this.tick = 0;
      this.structure();
      if (this.anon) this.planAnon(); else this.planPeople();
      this.planCarts();
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (this.stepWalker(w, d)) this.walkers.splice(i, 1);
    }
    for (const c of this.carts) this.stepCart(c, d);
    for (const a of this.animals) this.stepAnimal(a, d);
    for (const b of this.boats) this.stepBoat(b, d);
  }

  // bâtiments → animaux et bateaux (recalculé quand la ville change)
  structure() {
    const g = this.g;
    const v = g.nav.version;
    if (v === this.structT) return;
    this.structT = v;
    if (this.fields) this.fields.clear();
    const oldA = new Map(this.animals.map(a => [a.bid + ':' + a.n, a]));
    const oldB = new Map(this.boats.map(b => [b.bid + ':' + b.n, b]));
    this.animals = []; this.boats = [];
    for (const b of g.s.buildings) {
      const B = BUILDINGS[b.type];
      const herd = b.type === 'bergerie' ? [['mouton', 6]] : b.type === 'ferme' ? [['vache', 2], ['poule', 2]] : b.type === 'ecurie' ? [['cheval', 2]] : b.type === 'manoir' ? [['poule', 2], ['cochon', 1]] : null;
      if (herd) {
        let n = 0;
        for (const [kind, cnt] of herd) for (let i = 0; i < cnt; i++, n++) {
          const a = oldA.get(b.id + ':' + n) || { bid: b.id, n, kind, x: b.x + B.w / 2 + (this.rng() - 0.5) * 3, y: b.y + B.h + 1 + this.rng() * 2, tx: 0, ty: 0, wait: this.rng() * 5, dir: 1, ph: 0 };
          a.cx = b.x + B.w / 2; a.cy = b.y + B.h / 2; a.R = b.type === 'bergerie' ? 6 : b.type === 'ecurie' ? 4 : 5;
          this.animals.push(a);
        }
      }
      const dk = DOCKS[b.type];
      if (dk) {
        const moor = this.findMooring(b);
        if (!moor) continue;
        const kinds = b.type === 'port' ? ['navire', 'peche'] : [dk];
        kinds.forEach((kind, n) => {
          const bo = oldB.get(b.id + ':' + n) || { bid: b.id, n, kind, x: moor[0] + 0.5, y: moor[1] + 0.5, state: 'moored', wait: 5 + this.rng() * 30, path: null, pi: 0, dir: 1, ph: 0 };
          bo.moor = moor; bo.R = kind === 'navire' ? 140 : 35;
          this.boats.push(bo);
        });
      }
    }
  }
  findMooring(b) {
    const B = BUILDINGS[b.type], map = this.app.map;
    for (let r = 1; r <= 3; r++) for (let j = -r; j < B.h + r; j++) for (let i = -r; i < B.w + r; i++) {
      if (i >= 0 && i < B.w && j >= 0 && j < B.h) continue;
      const g = map.getTile(b.x + i, b.y + j).g;
      if (g <= 3) return [b.x + i, b.y + j];
    }
    return null;
  }

  // ---------- habitants (ville du joueur) ----------
  maxWalkers() { return Math.min(150, 8 + Math.floor(this.g.s.pop * 0.32)); }
  planPeople() {
    const g = this.g, pp = g.pp;
    if (!pp) return;
    const list = g.s.people;
    if (!list.length) return;
    const busy = new Set(this.walkers.map(w => w.pid));
    const max = this.maxWalkers();
    const n = Math.min(list.length, 50);
    for (let k = 0; k < n; k++) {
      if (this.walkers.length + this.pending() >= max) break;
      this.rr = (this.rr + 1) % list.length;
      const p = list[this.rr];
      if (!p || busy.has(p.i) || p.aw || (this.app.lord && this.app.lord.active && p.i === g.s.lordId && this.app.game === g)) continue;
      let sc = this.sched.get(p.i);
      if (!sc) { sc = { at: this.rng() < 0.45 && p.w ? p.w : p.h, until: this.clock + this.rng() * 50 }; this.sched.set(p.i, sc); continue; }
      if (sc.until > this.clock || sc.pending) continue;
      const from = g.byId.get(sc.at) || g.byId.get(p.h) || g.manoir;
      if (!from) continue;
      const plan = this.choose(p, from);
      if (!plan) { sc.until = this.clock + 20 + this.rng() * 40; continue; }
      this.launch(p.i, from, plan, sc);
    }
  }
  pending() { let n = 0; for (const s of this.sched.values()) if (s.pending) n++; return n; }

  // choix d'une destination selon la vie de la personne
  choose(p, from) {
    const g = this.g, pp = g.pp, r = this.rng;
    const a = pp.age(p);
    if (p.sick) return from.id === p.h ? null : { to: g.byId.get(p.h), stay: 60, why: 'rentre se soigner' };
    const home = g.byId.get(p.h);
    const work = g.byId.get(p.w);
    const pickB = (types) => { const c = g.s.buildings.filter(b => types.includes(b.type)); if (!c.length) return null; c.sort((x, y) => Math.hypot(x.x - from.x, x.y - from.y) - Math.hypot(y.x - from.x, y.y - from.y)); return c[Math.floor(Math.pow(r(), 2) * Math.min(4, c.length))]; };
    if (p.m) {
      if (from.id === p.h) { const t = pickB(p.m === 'chevalier' ? ['ecurie', 'caserne'] : p.m === 'archer' ? ['archerie', 'tour', 'porte'] : ['caserne', 'tour', 'porte']); return t ? { to: t, stay: 40 + r() * 40, why: 's\'entraîne' } : null; }
      return home ? { to: home, stay: 30 + r() * 40, why: 'rentre chez lui' } : null;
    }
    if (a < 14) {
      if (from.id === p.h) { const t = pickB(['puits', 'jardin', 'marche', 'eglise']); return t && r() < 0.6 ? { to: t, stay: 8 + r() * 15, why: 'va jouer' } : null; }
      return home ? { to: home, stay: 25 + r() * 40, why: 'rentre à la maison' } : null;
    }
    if (from.id === p.h) {
      if (work && r() < 0.65) return { to: work, stay: 50 + r() * 50, why: 'va travailler', work: true };
      const t = pickB(p.t === 1 ? ['eglise', 'monastere'] : p.t === 2 ? ['taverne', 'marche'] : LEISURE);
      if (t && t.id !== from.id) return { to: t, stay: 10 + r() * 20, why: t.type === 'eglise' ? 'va prier' : t.type === 'taverne' ? 'va boire un verre' : t.type === 'marche' ? 'va au marché' : t.type === 'puits' ? 'va chercher de l\'eau' : 'se promène' };
      return null;
    }
    if (work && from.id === work.id && r() < 0.25) { const t = pickB(['marche', 'taverne', 'puits']); if (t) return { to: t, stay: 8 + r() * 15, why: 'fait une pause' }; }
    return home ? { to: home, stay: 30 + r() * 50, why: 'rentre chez ' + (p.s ? 'elle' : 'lui') } : null;
  }

  launch(pid, from, plan, sc) {
    const nav = this.g.nav;
    const a = nav.door(from), b = nav.door(plan.to);
    sc.pending = true;
    const ver = nav.version;
    pathQueue.request(nav, a[0], a[1], b[0], b[1], (path) => {
      sc.pending = false;
      if (nav.version !== ver && !path) { sc.until = this.clock + 2; return; }
      if (!path || path.length < 4) { sc.at = plan.to.id; sc.until = this.clock + plan.stay; return; }
      this.walkers.push({ pid, path, pi: 0, x: path[0] + 0.5, y: path[1] + 0.5, dest: plan.to.id, stay: plan.stay, why: plan.why, work: plan.work, dir: 1, view: 0, ph: 0, lane: (this.rng() - 0.5) * 0.3 });
    });
  }

  // ---------- habitants anonymes (villages IA, autres joueurs) ----------
  planAnon() {
    const g = this.g;
    const bs = g.s.buildings.filter(b => !BUILDINGS[b.type].wall && !BUILDINGS[b.type].road);
    if (bs.length < 2) return;
    const max = Math.min(60, 3 + Math.floor((g.s.pop || 0) * 0.16));
    if (!this.anonState) this.anonState = [];
    while (this.anonState.length < max) this.anonState.push({ idx: this.anonState.length, at: bs[Math.floor(this.rng() * bs.length)].id, until: this.clock + this.rng() * 30 });
    const busy = new Set(this.walkers.map(w => w.aidx));
    const houses = bs.filter(b => BUILDINGS[b.type].pop);
    for (const st of this.anonState) {
      if (busy.has(st.idx) || st.pending || st.until > this.clock) continue;
      if (this.walkers.length >= max) break;
      const from = g.byId.get(st.at) || bs[0];
      const isHome = BUILDINGS[from.type].pop;
      const to = isHome || !houses.length ? bs[Math.floor(this.rng() * bs.length)] : houses[Math.floor(this.rng() * houses.length)];
      if (!to || to.id === from.id) { st.until = this.clock + 10; continue; }
      const nav = g.nav, a = nav.door(from), b = nav.door(to);
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 160) { st.until = this.clock + 15; continue; }
      st.pending = true;
      pathQueue.request(nav, a[0], a[1], b[0], b[1], (path) => {
        st.pending = false;
        st.at = to.id; st.until = this.clock + 15 + this.rng() * 40;
        if (!path || path.length < 4) return;
        this.walkers.push({ aidx: st.idx, path, pi: 0, x: path[0] + 0.5, y: path[1] + 0.5, dest: to.id, stay: 0, why: '', dir: 1, view: 0, ph: 0, lane: (this.rng() - 0.5) * 0.3 });
      });
    }
  }

  // ---------- déplacement le long d'un chemin ----------
  stepWalker(w, d) {
    if (w.wander) return this.stepWander(w, d);
    const P = w.path;
    let speed = w.speed || this.walkerSpeed(w);
    let rem = d * speed;
    while (rem > 0) {
      if (w.pi + 2 >= P.length) return this.arrive(w);
      const nx = P[w.pi + 2] + 0.5, ny = P[w.pi + 3] + 0.5;
      const dx = nx - w.x, dy = ny - w.y, dist = Math.hypot(dx, dy);
      if (dist <= rem) { w.x = nx; w.y = ny; w.pi += 2; rem -= dist; continue; }
      w.x += dx / dist * rem; w.y += dy / dist * rem;
      if (Math.abs(dx) > Math.abs(dy) * 0.6) { w.dir = dx < 0 ? -1 : 1; w.view = 2; } else w.view = dy < 0 ? 1 : 0;
      w.ox = -dy / dist * w.lane; w.oy = dx / dist * w.lane;
      rem = 0;
    }
    w.ph += d * speed * 14;
    return false;
  }
  walkerSpeed(w) {
    const g = this.g;
    let base = 0.14;
    if (w.pid) { const p = g.pp && g.pp.get(w.pid); if (p) { const a = g.pp.age(p); base = a < 14 ? SPEED[0] : a >= 60 ? SPEED[2] : SPEED[1]; if (p.sick) base *= 0.6; } }
    const c = g.nav.cost(Math.floor(w.x), Math.floor(w.y));
    const f = c === Infinity ? 1 : c <= ROAD_COST[3] + 0.01 ? 1.25 : c <= ROAD_COST[2] + 0.01 ? 1.15 : c <= ROAD_COST[1] + 0.01 ? 1.05 : c > 2 ? 0.65 : 0.85;
    return base * f;
  }
  arrive(w) {
    if (w.pid) {
      const sc = this.sched.get(w.pid) || {};
      sc.at = w.dest; sc.until = this.clock + (w.stay || 20); sc.pending = false;
      this.sched.set(w.pid, sc);
      // travail en plein air : on reste visible sur le lieu de travail
      const b = this.g.byId.get(w.dest);
      if (w.work && b && OUTDOOR[b.type]) {
        const B = BUILDINGS[b.type];
        const area = b.type === 'ferme' || b.type === 'vignoble' ? [b.x + 0.5, b.y + 0.5, b.x + B.w - 0.5, b.y + B.h - 0.5] : [b.x - 3, b.y - 2, b.x + B.w + 3, b.y + B.h + 3];
        this.walkers.push({ pid: w.pid, wander: true, area, x: w.x, y: w.y, tx: w.x, ty: w.y, until: sc.until - 3, dest: w.dest, dir: w.dir, view: 2, ph: 0, wait: 1, working: true, why: 'travaille' });
      }
    }
    return true;
  }
  stepWander(w, d) {
    if (this.clock > w.until) {
      const sc = this.sched.get(w.pid); if (sc) sc.until = this.clock;
      return true;
    }
    if (w.wait > 0) { w.wait -= d; w.ph += d * 3; return false; }
    const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.05) {
      w.wait = 2 + this.rng() * 5;
      const [x0, y0, x1, y1] = w.area;
      for (let k = 0; k < 6; k++) {
        const tx = x0 + this.rng() * (x1 - x0), ty = y0 + this.rng() * (y1 - y0);
        if (this.g.nav.cost(Math.floor(tx), Math.floor(ty)) < Infinity || this.g.occ.get(key(Math.floor(tx), Math.floor(ty))) === w.dest) { w.tx = tx; w.ty = ty; break; }
      }
      return false;
    }
    const st = Math.min(dist, d * 0.08);
    w.x += dx / dist * st; w.y += dy / dist * st; w.ph += d * 1.2;
    w.dir = dx < 0 ? -1 : 1; w.view = 2;
    return false;
  }

  // ---------- charrettes ----------
  planCarts() {
    const g = this.g;
    const prods = g.s.buildings.filter(b => PRODUCERS[b.type]);
    const stores = g.s.buildings.filter(b => STORE.includes(b.type));
    const want = stores.length ? Math.min(6, Math.floor(prods.length / 2)) : 0;
    while (this.carts.length > want) this.carts.pop();
    while (this.carts.length < want) this.carts.push({ state: 'idle', wait: this.rng() * 10, x: 0, y: 0, path: null, pi: 0, dir: 1, ph: 0, visible: false });
    for (const c of this.carts) {
      if (c.state !== 'idle' || c.pending || c.wait > 0) continue;
      const from = prods[Math.floor(this.rng() * prods.length)];
      const to = stores.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
      if (!from || !to) continue;
      const nav = g.nav, a = nav.door(from), b = nav.door(to);
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 220) { c.wait = 20; continue; }
      c.pending = true;
      pathQueue.request(nav, a[0], a[1], b[0], b[1], (path) => {
        c.pending = false;
        if (!path || path.length < 6) { c.wait = 30; return; }
        c.path = path; c.pi = 0; c.x = path[0] + 0.5; c.y = path[1] + 0.5; c.state = 'go'; c.load = PRODUCERS[from.type]; c.visible = true; c.back = false;
      });
    }
  }
  stepCart(c, d) {
    if (c.state === 'idle') { c.wait -= d; c.visible = false; return; }
    if (c.state === 'unload') { c.wait -= d; if (c.wait <= 0) { c.state = 'go'; c.back = true; c.path = reversePath(c.path); c.pi = 0; c.load = null; } return; }
    const P = c.path;
    const cost = this.g.nav.cost(Math.floor(c.x), Math.floor(c.y));
    let rem = d * (cost < 0.9 ? 0.16 : 0.1); // charrette : 1 à 1,6 m/s
    while (rem > 0) {
      if (c.pi + 2 >= P.length) {
        if (c.back) { c.state = 'idle'; c.wait = 10 + this.rng() * 30; c.visible = false; }
        else { c.state = 'unload'; c.wait = 4 + this.rng() * 5; }
        return;
      }
      const nx = P[c.pi + 2] + 0.5, ny = P[c.pi + 3] + 0.5, dx = nx - c.x, dy = ny - c.y, dist = Math.hypot(dx, dy);
      if (dist <= rem) { c.x = nx; c.y = ny; c.pi += 2; rem -= dist; continue; }
      c.x += dx / dist * rem; c.y += dy / dist * rem;
      if (Math.abs(dx) > 0.01) c.dir = dx < 0 ? -1 : 1;
      rem = 0;
    }
    c.ph += d * 4;
  }

  // ---------- animaux ----------
  stepAnimal(a, d) {
    if (a.wait > 0) { a.wait -= d; return; }
    const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy);
    if (dist < 0.05 || !a.tx) {
      a.wait = 3 + this.rng() * 8;
      for (let k = 0; k < 5; k++) {
        const tx = a.cx + (this.rng() - 0.5) * 2 * a.R, ty = a.cy + (this.rng() - 0.5) * 2 * a.R;
        const ok = (x, y) => { const c = this.g.nav.cost(Math.floor(x), Math.floor(y)); return c < 2.5 && c > 0.9; };
        if (ok(tx, ty) && ok((tx + a.x) / 2, (ty + a.y) / 2)) { a.tx = tx; a.ty = ty; break; }
      }
      return;
    }
    const st = Math.min(dist, d * (a.kind === 'cheval' ? 0.12 : a.kind === 'poule' ? 0.08 : 0.05));
    a.x += dx / dist * st; a.y += dy / dist * st; a.ph += d * 4;
    a.dir = dx < 0 ? -1 : 1;
  }

  // ---------- bateaux ----------
  waterField(moor, R) {
    const k = moor[0] + ',' + moor[1] + ',' + R;
    this.fields ||= new Map();
    if (this.fields.has(k)) return this.fields.get(k);
    const map = this.app.map;
    const par = new Map(), list = [];
    const k0 = key(moor[0], moor[1]);
    par.set(k0, -1); const q = [moor[0], moor[1]];
    let qi = 0;
    const LIM = R > 60 ? 9000 : 2500;
    while (qi < q.length && list.length < LIM) {
      const x = q[qi++], y = q[qi++];
      list.push(x, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (Math.abs(nx - moor[0]) > R || Math.abs(ny - moor[1]) > R) continue;
        const nk = key(nx, ny);
        if (par.has(nk)) continue;
        if (map.getTile(nx, ny).g > 3) continue;
        if (this.g.occ.has(nk)) continue;
        par.set(nk, key(x, y)); q.push(nx, ny);
      }
    }
    const field = { par, list };
    if (this.fields.size > 12) this.fields.clear();
    this.fields.set(k, field);
    return field;
  }
  stepBoat(b, d) {
    if (b.state === 'moored' || b.state === 'fish' || b.state === 'away') {
      b.wait -= d; b.ph += d * 2;
      if (b.wait > 0) return;
      if (b.state === 'moored') {
        const f = this.waterField(b.moor, b.R);
        if (f.list.length < 20) { b.wait = 60; return; }
        // destination : loin pour un navire, à portée pour une barque
        let best = null, bd = -1;
        for (let k = 0; k < 12; k++) {
          const i = Math.floor(this.rng() * (f.list.length / 2)) * 2;
          const x = f.list[i], y = f.list[i + 1], dd = Math.hypot(x - b.moor[0], y - b.moor[1]);
          if (b.kind === 'navire' ? dd > bd : dd > 6 && dd < b.R * 0.8) { best = [x, y]; bd = dd; if (b.kind !== 'navire') break; }
        }
        if (!best) { b.wait = 30; return; }
        const path = [];
        let kk = key(best[0], best[1]);
        while (kk !== -1 && kk !== undefined) { const x = Math.floor(kk / 2097152) - 1048576, y = (kk % 2097152) - 1048576; path.push(x, y); kk = f.par.get(kk); }
        b.path = reversePath(path); b.pi = 0; b.state = 'out';
      } else if (b.state === 'fish' || b.state === 'away') {
        b.path = reversePath(b.path); b.pi = 0; b.state = 'back'; b.hidden = false;
      }
      return;
    }
    const P = b.path;
    let rem = d * (b.kind === 'navire' ? 0.45 : 0.18); // navire 4,5 m/s, barque 1,8 m/s
    while (rem > 0) {
      if (b.pi + 2 >= P.length) {
        if (b.state === 'out') {
          if (b.kind === 'navire' && Math.hypot(b.x - b.moor[0], b.y - b.moor[1]) > 60) { b.state = 'away'; b.hidden = true; b.wait = 60 + this.rng() * 90; }
          else { b.state = 'fish'; b.wait = 15 + this.rng() * 30; }
        } else { b.state = 'moored'; b.wait = 20 + this.rng() * 60; }
        return;
      }
      const nx = P[b.pi + 2] + 0.5, ny = P[b.pi + 3] + 0.5, dx = nx - b.x, dy = ny - b.y, dist = Math.hypot(dx, dy);
      if (dist <= rem) { b.x = nx; b.y = ny; b.pi += 2; rem -= dist; continue; }
      b.x += dx / dist * rem; b.y += dy / dist * rem;
      if (Math.abs(dx) > 0.01) b.dir = dx < 0 ? -1 : 1;
      rem = 0;
    }
    b.ph += d * 3;
  }

  // ---------- rendu ----------
  lookFor(w) {
    const g = this.g;
    if (w.pid) {
      const p = g.pp && g.pp.get(w.pid);
      if (!p) return null;
      const a = g.pp.age(p);
      const L = lookOf(p.lk, p.s, a);
      const work = g.byId.get(p.w);
      L.tool = a >= 60 && !p.w ? TOOLS.cane : work ? TOOL_OF[work.type] || 0 : 0;
      if (p.m) { L.role = p.m; L.tool = p.m === 'archer' ? TOOLS.bow : p.m === 'chevalier' ? TOOLS.sword : TOOLS.spear; L.color = this.app.settings && this.app.settings.color; }
      else if (p.i === g.s.lordId) { L.role = 'lord'; L.color = this.app.settings && this.app.settings.color; L.tool = TOOLS.sword; }
      else if (g.pp.isNoble(p)) { L.role = 'noble'; L.color = '#6a2a4a'; }
      else if (work && (work.type === 'monastere' || work.type === 'eglise')) L.role = 'moine';
      if (p.sick) L.sick = 1;
      return L;
    }
    if (w.aidx !== undefined) {
      if (!w.anon) w.anon = anonPerson(this.seed, w.aidx, this.g.s.name, this.app.worldClock ? this.app.worldClock() : 0);
      const A = w.anon;
      const L = lookOf(A.lk, A.s, A.age);
      L.tool = A.age >= 60 ? TOOLS.cane : (A.lk >> 8) % 3 === 0 ? TOOLS.basket : 0;
      return L;
    }
    return null;
  }
  // éléments à dessiner (triés en profondeur avec les bâtiments)
  collect(items, view) {
    const inV = (x, y) => x > view.x0 - 2 && x < view.x1 + 2 && y > view.y0 - 2 && y < view.y1 + 3;
    for (const w of this.walkers) if (inV(w.x, w.y)) items.push({ y: w.y, w });
    for (const c of this.carts) if (c.visible && inV(c.x, c.y)) items.push({ y: c.y, c });
    for (const a of this.animals) if (inV(a.x, a.y)) items.push({ y: a.y, an: a });
    for (const b of this.boats) if (!b.hidden && inV(b.x, b.y)) items.push({ y: b.y - 0.6, bo: b });
  }
  drawItem(ctx, it, SX, SY, k, time) {
    if (it.w) {
      const w = it.w;
      const L = this.lookFor(w);
      if (!L) return;
      const moving = !w.wander || w.wait <= 0;
      const frame = w.working && w.wait > 0 ? (Math.floor(w.ph) % 2 ? 3 : 0) : moving ? 1 + (Math.floor(w.ph) % 2) : 0;
      const spr = personSprite(L, w.view, frame);
      drawAt(ctx, spr, SX(w.x + (w.ox || 0)), SY(w.y + (w.oy || 0)) + 1 * k, k, w.view === 2 && w.dir < 0, 0.45, 1);
      if (this.g.selPerson && w.pid === this.g.selPerson) {
        ctx.strokeStyle = 'rgba(255,230,120,0.95)'; ctx.lineWidth = Math.max(1, k * 0.6);
        ctx.beginPath(); ctx.ellipse(SX(w.x), SY(w.y) + k, 4 * k, 1.6 * k, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (it.c) {
      const c = it.c;
      drawAt(ctx, cartSprite(c.load || 'vide', c.state === 'go' ? Math.floor(c.ph) % 4 : 0), SX(c.x), SY(c.y) + 2 * k, k, c.dir < 0, 0.55, 1);
    } else if (it.an) {
      const a = it.an;
      const spr = a.kind === 'cheval' ? horseSprite(a.n % 2 ? 'blanc' : 'alezan', a.wait > 0 ? 0 : 1 + (Math.floor(a.ph) % 4)) : animalSprite(a.kind, a.wait > 0 ? 0 : Math.floor(a.ph) % 2);
      drawAt(ctx, spr, SX(a.x), SY(a.y), k * (a.kind === 'cheval' ? 0.8 : 1), a.dir < 0, 0.5, 1);
    } else if (it.bo) {
      const b = it.bo;
      const bob = Math.sin(time / 400 + b.n) * 0.4 * k;
      drawAt(ctx, boatSprite(b.kind, Math.floor(b.ph) % 2, this.color()), SX(b.x), SY(b.y) + 3 * k + bob, k, b.dir < 0, 0.5, 1);
    }
  }
  color() { return this.g.remote ? this.g.color || '#b02828' : (this.app.settings && this.app.settings.color) || '#b02828'; }

  // habitant sous le curseur
  hit(tx, ty) {
    let best = null, bd = 0.9;
    for (const w of this.walkers) {
      const dx = tx - w.x, dy = ty - (w.y - 0.45);
      const d = Math.hypot(dx * 1.4, dy);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
}

function reversePath(P) { const out = []; for (let i = P.length - 2; i >= 0; i -= 2) out.push(P[i], P[i + 1]); return out; }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export { YEAR, isWater };
