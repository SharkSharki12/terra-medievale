// Navigation des habitants : coût des cases (routes rapides, forêts lentes, eau et bâtiments infranchissables),
// recherche de chemin A* (8 directions) avec budget de temps, portes des bâtiments.
import { key } from './keys.js';
import { BUILDINGS } from './buildings.js';

const TREEISH = new Uint8Array([0, 1, 1, 1, 1, 1, 0, 1, 1]);
export const ROAD_COST = [1.25, 0.8, 0.64, 0.52];

// tampons partagés (réutilisés d'un calcul à l'autre)
let cap = 0, gArr, fromArr, stampArr, closedArr, stamp = 0;
function ensure(n) {
  if (n <= cap) return;
  cap = Math.max(n, cap * 2, 65536);
  gArr = new Float32Array(cap); fromArr = new Int32Array(cap); stampArr = new Uint32Array(cap); closedArr = new Uint32Array(cap);
  stamp = 0;
}

export class Nav {
  constructor(game) { this.g = game; this.version = 0; this.memo = new Map(); this.doors = new Map(); this.cache = new Map(); }
  invalidate() { this.version++; this.memo.clear(); this.doors.clear(); this.cache.clear(); }

  cost(x, y) {
    const k = key(x, y);
    let c = this.memo.get(k);
    if (c !== undefined) return c;
    c = this.compute(x, y, k);
    if (this.memo.size > 250000) this.memo.clear();
    this.memo.set(k, c);
    return c;
  }
  compute(x, y, k) {
    const g = this.g;
    const id = g.occ.get(k);
    if (id === -1) return ROAD_COST[g.roadType.get(k) || 2];
    if (id !== undefined) {
      const b = g.byId.get(id);
      return b && BUILDINGS[b.type].gate ? 0.7 : Infinity;
    }
    const t = g.app.map.getTile(x, y);
    if (t.g <= 4 || t.g >= 15) return Infinity;
    let c = 1.25;
    switch (t.g) { case 10: c = 3; break; case 11: c = 2.4; break; case 13: c = 2.5; break; case 9: c = 1.7; break; case 5: c = 1.4; break; case 12: c = 1.5; break; }
    if (t.t && !g.cleared.has(k)) { if (t.t === 6) c += 4; else if (TREEISH[t.t]) c += 1.1; }
    return c;
  }
  passable(x, y) { return this.cost(x, y) < Infinity; }

  // case devant la porte d'un bâtiment
  door(b) {
    let d = this.doors.get(b.id);
    if (d) return d;
    const B = BUILDINGS[b.type];
    const cand = [];
    const cx = b.x + Math.floor(B.w / 2);
    for (let o = 0; o < B.w; o++) { const dx = o % 2 ? -Math.ceil(o / 2) : Math.ceil(o / 2); cand.push([cx + dx, b.y + B.h]); }
    for (let j = B.h - 1; j >= 0; j--) { cand.push([b.x - 1, b.y + j]); cand.push([b.x + B.w, b.y + j]); }
    for (let i = 0; i < B.w; i++) cand.push([b.x + i, b.y - 1]);
    cand.push([b.x - 1, b.y + B.h], [b.x + B.w, b.y + B.h]);
    let best = null, bc = Infinity;
    for (let i = 0; i < cand.length; i++) {
      const [x, y] = cand[i];
      const c = this.cost(x, y) + i * 0.02;
      if (c < bc) { bc = c; best = cand[i]; }
      if (i < B.w && c < 0.9) break; // une route devant la porte
    }
    d = best || [cx, b.y + B.h];
    this.doors.set(b.id, d);
    return d;
  }

  // A* sur une fenêtre autour des deux points ; renvoie [x0,y0,x1,y1,...] ou null
  findPath(sx, sy, tx, ty, maxExp = 16000) {
    if (sx === tx && sy === ty) return [sx, sy];
    const ck = `${sx},${sy}>${tx},${ty}`;
    const hit = this.cache.get(ck);
    if (hit !== undefined) return hit;
    const dist = Math.max(Math.abs(tx - sx), Math.abs(ty - sy));
    const pad = Math.round(20 + dist * 0.3);
    const x0 = Math.min(sx, tx) - pad, y0 = Math.min(sy, ty) - pad;
    const W = Math.abs(tx - sx) + 2 * pad + 1, H = Math.abs(ty - sy) + 2 * pad + 1;
    if (W * H > 1500000) return null;
    ensure(W * H);
    stamp++;
    if (stamp > 4e9) { stampArr.fill(0); closedArr.fill(0); stamp = 1; }
    const idx = (x, y) => (y - y0) * W + (x - x0);
    const heapI = [], heapF = [];
    const push = (i, f) => {
      let n = heapI.length; heapI.push(i); heapF.push(f);
      while (n > 0) { const p = (n - 1) >> 1; if (heapF[p] <= f) break; heapI[n] = heapI[p]; heapF[n] = heapF[p]; n = p; }
      heapI[n] = i; heapF[n] = f;
    };
    const pop = () => {
      const top = heapI[0];
      const li = heapI.pop(), lf = heapF.pop();
      const n = heapI.length;
      if (n) {
        let i = 0;
        while (true) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && heapF[c + 1] < heapF[c]) c++;
          if (heapF[c] >= lf) break;
          heapI[i] = heapI[c]; heapF[i] = heapF[c]; i = c;
        }
        heapI[i] = li; heapF[i] = lf;
      }
      return top;
    };
    const H0 = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return 0.5 * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
    const si = idx(sx, sy), ti = idx(tx, ty);
    gArr[si] = 0; stampArr[si] = stamp; fromArr[si] = -1;
    push(si, H0(sx, sy));
    let exp = 0, found = false;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heapI.length) {
      const ci = pop();
      if (closedArr[ci] === stamp) continue;
      closedArr[ci] = stamp;
      if (ci === ti) { found = true; break; }
      if (++exp > maxExp) break;
      const cx = x0 + (ci % W), cy = y0 + Math.floor(ci / W);
      const gc = gArr[ci];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < x0 || ny < y0 || nx >= x0 + W || ny >= y0 + H) continue;
        const ni = (ny - y0) * W + (nx - x0);
        if (closedArr[ni] === stamp) continue;
        let c = ni === ti ? 1 : this.cost(nx, ny);
        if (c === Infinity) continue;
        if (d >= 4) {
          if (this.cost(cx + DX[d], cy) === Infinity || this.cost(cx, cy + DY[d]) === Infinity) continue;
          c *= 1.414;
        }
        const ng = gc + c;
        if (stampArr[ni] !== stamp || ng < gArr[ni]) {
          stampArr[ni] = stamp; gArr[ni] = ng; fromArr[ni] = ci;
          push(ni, ng + H0(nx, ny));
        }
      }
    }
    let out = null;
    if (found) {
      const rev = [];
      let i = ti;
      while (i !== -1) { rev.push(x0 + (i % W), y0 + Math.floor(i / W)); i = fromArr[i]; }
      out = [];
      for (let j = rev.length - 2; j >= 0; j -= 2) out.push(rev[j], rev[j + 1]);
    }
    if (this.cache.size > 600) this.cache.clear();
    this.cache.set(ck, out);
    return out;
  }
}

// file d'attente des calculs de chemins, avec budget de temps par image
export class PathQueue {
  constructor() { this.q = []; }
  request(nav, sx, sy, tx, ty, cb) {
    const hit = nav.cache.get(`${sx},${sy}>${tx},${ty}`);
    if (hit !== undefined) { cb(hit); return; }
    if (this.q.length > 400) this.q.shift().cb(null);
    this.q.push({ nav, sx, sy, tx, ty, cb });
  }
  run(budgetMs = 3) {
    const t0 = performance.now();
    while (this.q.length && performance.now() - t0 < budgetMs) {
      const j = this.q.shift();
      let p = null;
      try { p = j.nav.findPath(j.sx, j.sy, j.tx, j.ty); } catch (e) { console.error(e); }
      j.cb(p);
    }
  }
  drop(nav) { this.q = this.q.filter(j => j.nav !== nav); }
}
export const pathQueue = new PathQueue();
