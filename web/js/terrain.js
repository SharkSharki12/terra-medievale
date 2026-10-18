// Génération du terrain local à l'échelle réelle (1 case = 10 m), guidée par les vraies données
import { makePerlin, hash2, smoothstep } from './noise.js';

const M_PER_DEG = Math.PI * 6371000 / 180;

export const G = {
  DEEP: 0, SHALLOW: 1, LAKE: 2, RIVER: 3, ICEW: 4,
  BEACH: 5, GRASS: 6, MEADOW: 7, DRY: 8, SAND: 9, ROCK: 10, SNOW: 11, TUNDRA: 12, MARSH: 13, DIRT: 14, VOID: 15,
};
export const T = { NONE: 0, OAK: 1, PINE: 2, JUNGLE: 3, ACACIA: 4, BUSH: 5, BOULDER: 6, PALM: 7, BIRCH: 8 };
export const isWater = (g) => g <= 4;
export const GROUND_NAMES = [
  'Océan profond', 'Eaux côtières', 'Lac', 'Rivière', 'Banquise',
  'Plage', 'Prairie', 'Prairie fleurie', 'Steppe sèche', 'Désert', 'Rochers', 'Neige', 'Toundra', 'Marais', 'Terre battue', 'Terres inexplorées',
];
export const TREE_NAMES = ['', 'Chêne', 'Sapin', 'Forêt tropicale', 'Acacia', 'Buisson', 'Rocher', 'Palmier', 'Bouleau'];
export const FERTILITY = [0, 0, 0, 0, 0, 0.35, 1.0, 1.1, 0.6, 0.25, 0.15, 0.1, 0.4, 0.55, 0.8, 0];
export const REGION_LIMIT = 98000; // m

export class Terrain {
  constructor(region) {
    this.r = region;
    const s = 1337;
    this.na = makePerlin(s + 1); this.nb = makePerlin(s + 2); this.nc = makePerlin(s + 3);
    this.nd = makePerlin(s + 4); this.ne = makePerlin(s + 5); this.nf = makePerlin(s + 6);
    this.ng = makePerlin(s + 7); this.nh = makePerlin(s + 8); this.nm = makePerlin(s + 9);
    this.nr = makePerlin(s + 10); this.nr2 = makePerlin(s + 11);
    this.g = 0; this.t = 0; this.h = 0; this.land = 0;
    this.cE = 0; this.cF = 0; this.cA = 0; this.cS = 0;
    const R = region.raster;
    this.rs = R.size; this.rinv = 1 / R.mpp; this.rhalf = R.half;
    this.cxm = R.cxm || 0; this.cym = R.cym || 0;
    this.landR = R.land; this.lakeR = R.lake;
    const C = region.coarse;
    this.cn = C.n; this.cinv = 1 / C.step; this.chalf = C.half;
    const V = region.rivers;
    this.rvCell = V.cell; this.rvN = V.nx; this.rvOx = V.ox ?? V.origin; this.rvOy = V.oy ?? V.origin; this.rvS = V.starts; this.rvI = V.items; this.rvG = V.segs;
  }

  rasterAt(arr, mx, my) {
    const s = this.rs;
    let u = (mx - this.cxm + this.rhalf) * this.rinv - 0.5, v = (my - this.cym + this.rhalf) * this.rinv - 0.5;
    if (u < 0) u = 0; else if (u > s - 1.001) u = s - 1.001;
    if (v < 0) v = 0; else if (v > s - 1.001) v = s - 1.001;
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const i = y0 * s + x0;
    const a = arr[i], b = arr[i + 1], c = arr[i + s], d = arr[i + s + 1];
    return ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * (1 / 255);
  }

  coarseAt(mx, my) {
    const n = this.cn;
    let u = (mx - this.cxm + this.chalf) * this.cinv, v = (my - this.cym + this.chalf) * this.cinv;
    if (u < 0) u = 0; else if (u > n - 1.001) u = n - 1.001;
    if (v < 0) v = 0; else if (v > n - 1.001) v = n - 1.001;
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const i = y0 * n + x0;
    const C = this.r.coarse;
    const bl = (A) => (A[i] + (A[i + 1] - A[i]) * fx) * (1 - fy) + (A[i + n] + (A[i + n + 1] - A[i + n]) * fx) * fy;
    this.cE = bl(C.E); this.cF = bl(C.forest); this.cA = bl(C.arid); this.cS = bl(C.snow);
  }

  // distance (m) au bord de la rivière la plus proche (négatif = dans l'eau)
  riverDist(mx, my) {
    const ci = Math.floor((mx - this.rvOx) / this.rvCell), cj = Math.floor((my - this.rvOy) / this.rvCell);
    if (ci < 0 || cj < 0 || ci >= this.rvN || cj >= this.rvN) return 1e9;
    const c = cj * this.rvN + ci;
    const S = this.rvG, I = this.rvI;
    let best = 1e9;
    for (let k = this.rvS[c], e = this.rvS[c + 1]; k < e; k++) {
      const o = I[k] * 5;
      const x1 = S[o], y1 = S[o + 1], x2 = S[o + 2], y2 = S[o + 3], hw = S[o + 4];
      const dx = x2 - x1, dy = y2 - y1;
      const L = dx * dx + dy * dy;
      let t = L > 0 ? ((mx - x1) * dx + (my - y1) * dy) / L : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const ex = x1 + dx * t - mx, ey = y1 + dy * t - my;
      const d = Math.sqrt(ex * ex + ey * ey) - hw;
      if (d < best) best = d;
    }
    return best;
  }

  // Échantillonne le terrain en (tx, ty) (en cases). ps = taille de l'échantillon en cases (détail).
  sample(tx, ty, ps) {
    const mx = tx * 10, my = ty * 10, pm = ps * 10;
    const na = this.na, nb = this.nb;
    const rx = mx - this.cxm, ry = my - this.cym;
    if (rx > REGION_LIMIT || rx < -REGION_LIMIT || ry > REGION_LIMIT || ry < -REGION_LIMIT) { this.g = 15; this.t = 0; this.h = 0; this.land = 0; return; }
    // déformation des côtes (détail fractal)
    let wx = na(mx * 0.0004, my * 0.0004) * 420, wy = nb(mx * 0.0004 + 31.7, my * 0.0004 - 12.3) * 420;
    if (pm < 300) { wx += na(mx * 0.003 + 5.1, my * 0.003) * 70; wy += nb(mx * 0.003, my * 0.003 + 8.3) * 70; }
    if (pm < 40) { wx += na(mx * 0.02, my * 0.02 + 3.3) * 14; wy += nb(mx * 0.02 + 1.9, my * 0.02) * 14; }
    const land = this.rasterAt(this.landR, mx + wx, my + wy);
    this.land = land;
    this.coarseAt(mx, my);
    const E = this.cE, forest = this.cF, arid0 = this.cA, snow = this.cS;
    const lat = this.r.lat0 - my / M_PER_DEG;
    const alat = lat < 0 ? -lat : lat;
    this.t = 0;
    if (land < 0.5) {
      this.h = -(0.5 - land) * 60;
      if (alat > 62 && snow > 0.6) this.g = 4;
      else this.g = land > 0.2 ? 1 : 0;
      return;
    }
    const lake = this.rasterAt(this.lakeR, mx + wx * 0.6, my + wy * 0.6);
    if (lake > 0.5) { this.g = (alat > 66 && snow > 0.6) ? 4 : 2; this.h = 0; return; }
    // rivières (méandres par déformation du domaine)
    let rwx = na(mx * 0.0014 + 77.7, my * 0.0014) * 80, rwy = nb(mx * 0.0014, my * 0.0014 + 55.5) * 80;
    if (pm < 60) { rwx += na(mx * 0.0065, my * 0.0065 - 9.1) * 20; rwy += nb(mx * 0.0065 - 4.4, my * 0.0065) * 20; }
    const rd = this.riverDist(mx + rwx, my + rwy);
    if (rd < (pm > 20 ? pm * 0.45 : 0)) { this.g = 3; this.h = 0; return; }

    // altitude locale : collines + crêtes montagneuses proportionnelles au relief réel
    const amp = 15 + E * 0.18;
    let rel = this.nc(mx * 0.00025, my * 0.00025) * 0.55 + this.nd(mx * 0.0011, my * 0.0011) * 0.3;
    if (pm < 80) rel += this.ne(mx * 0.006, my * 0.006) * 0.15;
    const mtn = smoothstep(450, 1800, E);
    let crest = 0;
    let h = E + rel * amp;
    if (mtn > 0) {
      const r1 = 1 - Math.abs(this.nr(mx * 0.00011, my * 0.00011));
      const r2 = 1 - Math.abs(this.nr2(mx * 0.00034, my * 0.00034));
      crest = r1 * r1 * 0.7 + r2 * r2 * 0.3;
      h += mtn * (crest - 0.42) * E * 0.95;
    }
    const coastF = land < 0.75 ? (land - 0.5) * 4 : 1;
    h = h * (0.12 + 0.88 * coastF) + 1;
    if (rd < 400) h = Math.min(h, E * 0.9 + 2 + rd * 0.05);
    if (h < 1) h = 1;
    this.h = h;

    const cl = Math.cos(lat * Math.PI / 180);
    const snowLine = 5200 * cl * Math.sqrt(cl);
    const treeLine = snowLine - 800;
    const ridge = 1 - Math.abs(this.nf(mx * 0.0016, my * 0.0016));
    const hn = this.ng(mx * 0.003, my * 0.003);
    const hr = hash2(Math.floor(tx), Math.floor(ty), 7);
    const lowRock = smoothstep(300, 1600, E) * 0.25;
    let g = 6, t = 0;
    if (snow > 0.62 && (alat > 58 || E > 2500)) {
      g = ridge > 0.95 ? 10 : 11;
    } else if (h > snowLine + hn * 150) {
      g = crest > 0.86 || ridge > 0.985 ? 10 : 11;
    } else if (h > treeLine + 250 + hn * 120 && (crest > 0.8 || ridge > 0.95)) {
      g = 10;
    } else if ((mtn > 0.3 && ridge > 0.988 - mtn * 0.03) || this.nr2(mx * 0.0006 + 13, my * 0.0006) > 0.72 - lowRock * 1.3) {
      g = 10;
    } else {
      let ar = arid0;
      if (rd < 2500) ar *= 0.25 + 0.75 * smoothstep(150, 2500, rd);
      const an = ar + this.ng(mx * 0.0012, my * 0.0012) * 0.12;
      if (an > 0.72) {
        g = 9;
        const dn = Math.sin((mx * 0.8 + my * 0.6) / 140 + this.nd(mx * 0.0007, my * 0.0007) * 4) * 0.5 + 0.5;
        this.h = h = h + dn * dn * 9 * smoothstep(0.72, 0.85, an);
      } else if (an > 0.4) g = 8;
      else if (alat > 61 + this.nh(mx * 0.00005, my * 0.00005) * 5 && forest < 0.55) g = 12;
      else g = 6;
      if (land < 0.6 && h < 22 && this.nh(mx * 0.002, my * 0.002) > -0.35 && E < 600) g = 5;
      if (g === 6) {
        const mn = this.nm(mx * 0.004, my * 0.004);
        if (mn > 0.4 || (h > treeLine && mn > 0.1)) g = 7;
        else if (h < 9 && forest > 0.3 && mn < -0.42) g = 13;
      }
      if (rd < 25 && rd >= 0 && g !== 5) g = (g === 9 || g === 8) ? 6 : g;
      // arbres
      if ((g === 6 || g === 7 || g === 8 || g === 12 || g === 13) && h < treeLine + 100) {
        const fp = this.nc(mx * 0.0007 + 3.3, my * 0.0007) * 0.7 + this.nd(mx * 0.0045, my * 0.0045 + 2.2) * 0.3;
        let thr = 0.36 - forest * 0.95;
        if (g === 8) thr += 0.32;
        if (g === 12) thr += 0.3;
        if (g === 7) thr += 0.15;
        if (h > treeLine - 150) thr += 0.35;
        let kind = 0;
        if (fp > thr) {
          const dens = 0.12 + 0.82 * smoothstep(thr, thr + 0.14, fp);
          if (hr < dens) kind = 1;
        } else if (hr < 0.006 + forest * 0.025) kind = 1;
        else if (hr > 0.985 - (g === 8 || g === 12 ? 0.03 : 0.006)) kind = 5;
        if (kind === 1) {
          const h2 = hash2(Math.floor(tx), Math.floor(ty), 31);
          if (alat > 56 || h > treeLine - 600) kind = (alat > 55 && h2 < 0.25) ? 8 : 2;
          else if (alat < 24 && arid0 < 0.4) kind = (land < 0.62 || h2 < 0.08) ? 7 : 3;
          else if (alat < 32 && g === 8) kind = 4;
          else kind = this.nb(mx * 0.0012 + 40, my * 0.0012) > 0.18 + (alat - 45) * -0.02 ? 2 : (h2 < 0.12 ? 8 : 1);
        }
        t = kind;
      } else if (g === 9 && rd < 700 && hr < 0.25) t = 7;
      else if (g === 5 && alat < 28 && hr < 0.04) t = 7;
      if (t === 0 && hr < 0.0025 + lowRock * 0.08 + mtn * 0.02 + (g === 9 ? 0.004 : 0) && hash2(Math.floor(tx), Math.floor(ty), 99) < 0.6) t = 6;
    }
    if (g === 11 && t === 0 && hr < 0.004) t = 6;
    this.g = g; this.t = t;
  }
}
