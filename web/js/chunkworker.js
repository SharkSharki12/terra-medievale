// Worker : génère les images des morceaux de carte (chunks) à différents niveaux de détail
import { Terrain, T } from './terrain.js';
import { makeTreeSprites, GROUND_PAL, MACRO_COL, TREE_MACRO } from './sprites.js';
import { hash2, makePerlin } from './noise.js';
const pn = makePerlin(4242), pn2 = makePerlin(777);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);

let terr = null, regionId = -1;
let trees = null;
const CH = 512; // taille d'une image de chunk en pixels
// priorité de recouvrement des bordures (le plus fort déborde sur le plus faible)
const PRIO = [0, 1, 1, 1, 2, 3, 6, 7, 5, 4, 8, 9, 5, 4, 6.5, 10];
const FOREST = new Uint8Array([0, 1, 1, 1, 1, 0, 0, 1, 1]);

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    terr = new Terrain(m.region);
    regionId = m.regionId;
    if (!trees) trees = makeTreeSprites();
    return;
  }
  if (m.type === 'render') {
    if (m.regionId !== regionId || !terr) { self.postMessage({ type: 'skip', key: m.key, regionId: m.regionId }); return; }
    const out = m.level <= 3 ? renderTiles(m) : renderMacro(m);
    out.type = 'chunk'; out.key = m.key; out.regionId = regionId; out.level = m.level; out.cx = m.cx; out.cy = m.cy;
    const tr = [out.bitmap];
    if (out.g) tr.push(out.g.buffer, out.t.buffer, out.h.buffer);
    self.postMessage(out, tr);
  }
};

function renderTiles(m) {
  const L = m.level, n = 32 << L, ppt = 16 >> L;
  const tx0 = m.cx * n, ty0 = m.cy * n;
  const W = n + 2;
  const gA = new Uint8Array(W * W), tA = new Uint8Array(W * W), hA = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    terr.sample(tx0 + i - 1 + 0.5, ty0 + j - 1 + 0.5, 1);
    const k = j * W + i;
    gA[k] = terr.g; tA[k] = terr.t; hA[k] = terr.h;
  }
  if (m.cleared) for (const c of m.cleared) {
    const i = c[0] - tx0 + 1, j = c[1] - ty0 + 1;
    if (i >= 0 && j >= 0 && i < W && j < W) {
      const k = j * W + i;
      tA[k] = 0;
      if (c[2] !== undefined) gA[k] = c[2];
      // une ville est toujours bâtie sur la terre ferme (remblai), sauf les ponts sur les rivières
      else if (gA[k] <= 4 && gA[k] !== 3) { gA[k] = 14; hA[k] = 2; }
    }
  }
  // ombrage du relief par case
  const sh = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const l = hA[j * W + Math.max(0, i - 1)], r = hA[j * W + Math.min(W - 1, i + 1)];
    const u = hA[Math.max(0, j - 1) * W + i], d = hA[Math.min(W - 1, j + 1) * W + i];
    let s = 1 + ((l - r) + (u - d)) * 0.012;
    sh[k] = s < 0.78 ? 0.78 : s > 1.2 ? 1.2 : s;
  }
  const c = new OffscreenCanvas(CH, CH);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(CH, CH);
  const d = img.data;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j + 1) * W + (i + 1);
    const g = gA[k];
    const gl = gA[k - 1], gr = gA[k + 1], gu = gA[k - W], gd = gA[k + W];
    const s00 = sh[k], sR = sh[k + 1], sD = sh[k + W], sRD = sh[k + W + 1], sL = sh[k - 1], sU = sh[k - W];
    for (let py = 0; py < ppt; py++) for (let px = 0; px < ppt; px++) {
      const wx = (tx0 + i) * ppt + px, wy = (ty0 + j) * ppt + py;
      let gg = g;
      if (ppt >= 4) {
        const fx = (px + 0.5) / ppt, fy = (py + 0.5) / ppt;
        const hn = fx < 0.5 ? gl : gr, hd = fx < 0.5 ? fx : 1 - fx;
        const vn = fy < 0.5 ? gu : gd, vd = fy < 0.5 ? fy : 1 - fy;
        const rr = hash2(wx, wy, 3) * 0.32;
        if (hn !== g && PRIO[hn] > PRIO[g] && hd < rr) gg = hn;
        else if (vn !== g && PRIO[vn] > PRIO[g] && vd < rr) gg = vn;
      }
      const pal = GROUND_PAL[gg];
      const hv = hash2(wx, wy, gg);
      // taches douces + tramage ordonné (style pixel-art)
      const pv = pn(wx * 0.055, wy * 0.055) * 0.55 + pn2(wx * 0.17, wy * 0.17) * 0.25 + BAYER[(wy & 3) * 4 + (wx & 3)] * 0.38;
      let col;
      if (gg <= 4) {
        const wave = hash2((wx + (wy >> 2) * 5) >> 3, wy >> 1, 11);
        col = wave > 0.95 && (wy & 1) === 0 ? pal[3] : pv > 0.22 ? pal[2] : pv < -0.22 ? pal[0] : pal[1];
        if (gg !== 4 && ppt >= 8) {
          const fx = (px + 0.5) / ppt, fy = (py + 0.5) / ppt;
          const near = (gl > 4 && gl < 15 && fx < 0.2) || (gr > 4 && gr < 15 && fx > 0.8) || (gu > 4 && gu < 15 && fy < 0.2) || (gd > 4 && gd < 15 && fy > 0.8);
          if (near && hv > 0.3) col = [190, 216, 228];
        }
      } else if (gg === 15) {
        col = pv > 0.1 ? pal[2] : pal[1];
      } else if (gg === 7 && hv > 0.955) {
        const f = hash2(wx, wy, 77);
        col = f < 0.4 ? [236, 214, 72] : f < 0.7 ? [226, 120, 170] : [244, 244, 244];
      } else if (gg === 13 && pv < -0.15) {
        col = pal[3];
      } else {
        col = pv > 0.2 ? pal[2] : pv < -0.2 ? pal[0] : pal[1];
        if (hv > 0.94) col = pal[3];
        else if (hv < 0.03) col = pal[2];
      }
      const forestFloor = FOREST[tA[k]] && gg === g ? 0.86 : 1;
      // ombrage interpolé
      const fx = (px + 0.5) / ppt - 0.5, fy = (py + 0.5) / ppt - 0.5;
      const sx = fx >= 0 ? s00 + (sR - s00) * fx : s00 + (s00 - sL) * fx;
      const sy = fy >= 0 ? (sD - s00) * fy : (s00 - sU) * fy;
      const s = gg <= 4 || gg === 15 ? 1 : (sx + sy) * forestFloor;
      const o = ((j * ppt + py) * CH + (i * ppt + px)) * 4;
      d[o] = col[0] * s; d[o + 1] = col[1] * s; d[o + 2] = col[2] * s; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // arbres
  if (ppt >= 8) {
    const half = ppt === 8;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const t = tA[j * W + i];
      if (!t) continue;
      const tx = tx0 + i - 1, ty = ty0 + j - 1;
      const ox = Math.round((hash2(tx, ty, 5) - 0.5) * 6), oy = Math.round((hash2(tx, ty, 6) - 0.5) * 4);
      const bx = (i - 1) * ppt + (ppt >> 1) + (half ? ox >> 1 : ox), by = (j - 1) * ppt + ppt - (half ? 1 : 2) + (half ? oy >> 1 : oy);
      if (t !== 6 && t !== 5) {
        ctx.beginPath();
        ctx.ellipse(bx + (half ? 1 : 2), by, half ? 3.5 : 7, half ? 1.5 : 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const t = tA[k];
      if (!t) continue;
      const tx = tx0 + i - 1, ty = ty0 + j - 1;
      const v = Math.floor(hash2(tx, ty, 9) * 3);
      const ox = Math.round((hash2(tx, ty, 5) - 0.5) * 6), oy = Math.round((hash2(tx, ty, 6) - 0.5) * 4);
      // intérieur de forêt : deux arbres par case pour une canopée dense
      let dbl = false;
      if (FOREST[t] && i > 0 && j > 0 && i < W - 1 && j < W - 1) {
        const nb = (FOREST[tA[k - 1]] ? 1 : 0) + (FOREST[tA[k + 1]] ? 1 : 0) + (FOREST[tA[k - W]] ? 1 : 0) + (FOREST[tA[k + W]] ? 1 : 0);
        dbl = nb >= 3;
      }
      if (half) {
        if (dbl) ctx.drawImage(trees[t][(v + 1) % 3].half, (i - 1) * 8 - 2, (j - 1) * 8 - 6);
        ctx.drawImage(trees[t][v].half, (i - 1) * 8 + (ox >> 1) + (dbl ? 2 : 0), (j - 1) * 8 + (oy >> 1) - 4);
      } else {
        if (dbl) ctx.drawImage(trees[t][(v + 1) % 3].full, (i - 1) * 16 - 4 + (ox >> 1), (j - 1) * 16 - 13);
        ctx.drawImage(trees[t][v].full, (i - 1) * 16 + ox + (dbl ? 3 : 0), (j - 1) * 16 + oy - 8);
      }
    }
  } else {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const t = tA[(j + 1) * W + i + 1];
      if (!t) continue;
      const c2 = TREE_MACRO[t];
      if (ppt === 4) {
        ctx.fillStyle = `rgb(${c2[0]},${c2[1]},${c2[2]})`;
        ctx.fillRect(i * 4, j * 4, 3, 3);
        ctx.fillStyle = `rgb(${c2[0] + 30},${c2[1] + 40},${c2[2] + 20})`;
        ctx.fillRect(i * 4, j * 4, 2, 1);
      } else {
        ctx.fillStyle = `rgb(${c2[0]},${c2[1]},${c2[2]})`;
        ctx.fillRect(i * 2, j * 2, 2, 2);
      }
    }
  }
  const bitmap = c.transferToImageBitmap();
  const res = { bitmap };
  if (L === 0) {
    const g = new Uint8Array(n * n), t = new Uint8Array(n * n), h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j + 1) * W + i + 1;
      g[j * n + i] = gA[k]; t[j * n + i] = tA[k]; h[j * n + i] = hA[k];
    }
    res.g = g; res.t = t; res.h = h;
  }
  return res;
}

function renderMacro(m) {
  const L = m.level;
  const ps = 1 << (L - 4); // cases par pixel
  const n = 32 << L;
  const tx0 = m.cx * n, ty0 = m.cy * n;
  const N = CH + 1;
  const gA = new Uint8Array(N * N), tA = new Uint8Array(N * N), hA = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    terr.sample(tx0 + (i + 0.5) * ps, ty0 + (j + 0.5) * ps, ps);
    const k = j * N + i;
    gA[k] = terr.g; tA[k] = terr.t; hA[k] = terr.h;
  }
  const c = new OffscreenCanvas(CH, CH);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(CH, CH);
  const d = img.data;
  const pm = ps * 10;
  for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
    const k = j * N + i;
    const g = gA[k];
    let col = MACRO_COL[g];
    const t = tA[k];
    let r = col[0], gg = col[1], b = col[2];
    if (t && t !== 6) { const tc = TREE_MACRO[t]; r = r * 0.35 + tc[0] * 0.65; gg = gg * 0.35 + tc[1] * 0.65; b = b * 0.35 + tc[2] * 0.65; }
    let s = 1;
    if (g > 4) {
      const slope = (hA[k] - hA[k + N + 1]) / (pm * 1.414);
      s = 1 + slope * 1.5;
      s = s < 0.68 ? 0.68 : s > 1.3 ? 1.3 : s;
    } else if (g <= 1) {
      // eau profonde plus sombre loin des côtes
      s = 0.92 + hash2(tx0 + i, ty0 + j, 4) * 0.04;
    }
    const o = (j * CH + i) * 4;
    d[o] = r * s; d[o + 1] = gg * s; d[o + 2] = b * s; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { bitmap: c.transferToImageBitmap() };
}
