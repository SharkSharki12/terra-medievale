// Sprites pixel-art générés par code (arbres, rochers) — utilisable dans un worker
import { hash2, mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return [c, ctx];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round);

// Dessine un "blob" ombré pixel par pixel : fn(x,y) -> valeur d'inclusion (>0 dedans)
function blob(ctx, x0, y0, w, h, inside, pal, seed) {
  const R = mulberry32(seed);
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const ins = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside(x + 0.5, y + 0.5) > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ins(x, y)) continue;
    // bord = contour sombre
    const edge = !ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1);
    const v = inside(x + 0.5, y + 0.5);
    // éclairage : haut-gauche clair
    const nx = (x / w - 0.5), ny = (y / h - 0.5);
    let l = 0.55 - nx * 0.6 - ny * 0.9 + (R() - 0.5) * 0.35 + v * 0.15;
    let c;
    if (edge && (!ins(x + 1, y) || !ins(x, y + 1))) c = pal[0];
    else if (edge) c = pal[1];
    else if (l > 0.95) c = pal[3];
    else if (l > 0.45) c = pal[2];
    else c = pal[1];
    const i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

function ellipseFn(cx, cy, rx, ry) {
  return (x, y) => 1 - ((x - cx) ** 2 / (rx * rx) + (y - cy) ** 2 / (ry * ry));
}
function unionFn(fs) { return (x, y) => Math.max(...fs.map(f => f(x, y))); }

// Arbres : 16x24, la base du tronc est en (8, 22)
export function makeTreeSprites() {
  const S = {};
  const greens = [
    [[24, 58, 22], [44, 96, 36], [66, 130, 48], [104, 168, 70]],
    [[28, 62, 24], [52, 104, 40], [76, 140, 54], [118, 176, 80]],
    [[22, 54, 26], [40, 90, 40], [60, 122, 52], [96, 158, 72]],
  ];
  const pines = [
    [[14, 40, 30], [26, 70, 46], [40, 96, 60], [70, 128, 80]],
    [[16, 44, 34], [30, 76, 52], [46, 104, 66], [78, 136, 88]],
  ];
  const trunk = (ctx, x, y0, y1, w = 2) => {
    ctx.fillStyle = '#4a3020'; ctx.fillRect(x, y0, w, y1 - y0);
    ctx.fillStyle = '#6b4a2c'; ctx.fillRect(x, y0, 1, y1 - y0);
  };
  const make = (kind, v) => {
    const [c, ctx] = canvas(16, 24);
    const seed = kind * 100 + v;
    if (kind === 1) { // chêne
      const g = greens[v % 3];
      trunk(ctx, 7, 14, 23);
      const r = mulberry32(seed);
      const f = unionFn([ellipseFn(8, 9, 6.5, 6), ellipseFn(5 + r() * 2, 7, 4, 4), ellipseFn(10 + r(), 8, 4.5, 4.5), ellipseFn(8, 12, 5.5, 3.5)]);
      blob(ctx, 0, 0, 16, 18, f, g, seed);
    } else if (kind === 2) { // sapin
      const g = pines[v % 2];
      trunk(ctx, 7, 18, 23);
      const f = (x, y) => {
        if (y < 1 || y > 20) return -1;
        const layer = ((y - 1) % 6) / 6;
        const base = (y - 1) / 19;
        const hw = 1 + base * 6.5 * (0.65 + layer * 0.45);
        return 1 - Math.abs(x - 8) / hw;
      };
      blob(ctx, 0, 0, 16, 21, f, g, seed);
    } else if (kind === 8) { // bouleau
      ctx.fillStyle = '#e8e4d8'; ctx.fillRect(7, 12, 2, 11);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(7, 15, 1, 1); ctx.fillRect(8, 18, 1, 1); ctx.fillRect(7, 21, 1, 1);
      const f = unionFn([ellipseFn(8, 8, 5, 6.5), ellipseFn(6.5, 11, 4, 3), ellipseFn(10, 10, 3.5, 3)]);
      blob(ctx, 0, 0, 16, 16, f, [[36, 70, 24], [70, 118, 40], [98, 150, 54], [140, 184, 80]], seed);
    } else if (kind === 3) { // jungle
      trunk(ctx, 7, 15, 23);
      const r = mulberry32(seed);
      const f = unionFn([ellipseFn(8, 9, 7.5, 6.5), ellipseFn(4, 10, 4, 4), ellipseFn(12, 10, 4, 4), ellipseFn(6 + r() * 4, 5, 4, 3.5)]);
      blob(ctx, 0, 0, 16, 18, f, [[12, 44, 16], [26, 80, 28], [40, 112, 38], [74, 150, 56]], seed);
    } else if (kind === 4) { // acacia
      ctx.fillStyle = '#5a3a24'; ctx.fillRect(7, 9, 2, 14); ctx.fillRect(5, 9, 1, 3); ctx.fillRect(10, 8, 1, 3);
      const f = unionFn([ellipseFn(8, 7, 7.5, 2.8), ellipseFn(5, 6, 3.5, 2.2), ellipseFn(11, 6.5, 3.5, 2.3)]);
      blob(ctx, 0, 0, 16, 11, f, [[48, 66, 22], [84, 104, 36], [112, 134, 48], [150, 164, 70]], seed);
    } else if (kind === 5) { // buisson
      const f = unionFn([ellipseFn(8, 19, 4.5, 3.5), ellipseFn(6, 18, 3, 3), ellipseFn(10, 18.5, 3, 2.8)]);
      blob(ctx, 0, 0, 16, 24, f, [[30, 62, 26], [58, 104, 42], [84, 136, 56], [120, 168, 76]], seed);
    } else if (kind === 6) { // rocher
      const r = mulberry32(seed);
      const f = unionFn([ellipseFn(8, 18.5, 5.5 + r(), 4), ellipseFn(6 + r() * 2, 17, 3.5, 3.5)]);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(9, 21, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      blob(ctx, 0, 0, 16, 23, f, [[92, 90, 86], [146, 142, 134], [172, 168, 160], [208, 204, 196]], seed);
    } else if (kind === 7) { // palmier
      ctx.fillStyle = '#7a5a34';
      for (let y = 8; y < 23; y++) ctx.fillRect(7 + Math.round(Math.sin(y * 0.25 + v) * 1.2), y, 2, 1);
      ctx.fillStyle = '#5a4026';
      for (let y = 9; y < 23; y += 3) ctx.fillRect(7 + Math.round(Math.sin(y * 0.25 + v) * 1.2), y, 2, 1);
      const cx = 8 + Math.round(Math.sin(8 * 0.25 + v) * 1.2), cy = 7;
      const fr = [[44, 92, 30], [70, 132, 44], [104, 168, 62]];
      for (let a = 0; a < 7; a++) {
        const ang = (a / 7) * Math.PI * 2 + v * 0.4;
        for (let s = 1; s < 7; s++) {
          const x = Math.round(cx + Math.cos(ang) * s), y = Math.round(cy + Math.sin(ang) * s * 0.6 + (s * s) * 0.08);
          ctx.fillStyle = rgb(fr[s < 3 ? 2 : s < 5 ? 1 : 0]);
          ctx.fillRect(x, y, 1, 1);
          if (s > 2) ctx.fillRect(x, y + 1, 1, 1);
        }
      }
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(cx, cy, 2, 2);
    }
    return c;
  };
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    S[k] = [];
    for (let v = 0; v < 3; v++) {
      const full = make(k, v);
      const [h, hc] = canvas(8, 12);
      hc.imageSmoothingEnabled = true;
      hc.drawImage(full, 0, 0, 8, 12);
      S[k].push({ full, half: h });
    }
  }
  return S;
}

// Palette du sol : [sombre, base, clair, accent]
export const GROUND_PAL = [
  [[20, 52, 102], [24, 60, 114], [28, 68, 126], [56, 102, 162]],   // océan profond
  [[34, 98, 146], [40, 110, 156], [48, 122, 166], [96, 160, 196]], // eaux côtières
  [[34, 92, 140], [40, 104, 152], [50, 118, 166], [92, 150, 192]], // lac
  [[40, 102, 152], [48, 116, 164], [58, 130, 178], [110, 168, 204]], // rivière
  [[196, 214, 230], [212, 228, 240], [232, 242, 250], [180, 200, 220]], // banquise
  [[206, 188, 132], [218, 202, 148], [230, 216, 164], [190, 170, 118]], // plage
  [[70, 128, 50], [82, 142, 56], [96, 158, 66], [60, 110, 42]],     // prairie
  [[78, 136, 54], [90, 150, 60], [104, 164, 70], [64, 116, 46]],    // prairie fleurie
  [[160, 146, 78], [174, 160, 88], [188, 174, 100], [140, 126, 66]], // steppe
  [[210, 176, 110], [220, 188, 122], [230, 200, 136], [196, 160, 98]], // désert
  [[110, 106, 100], [126, 122, 114], [144, 140, 132], [86, 84, 80]], // roche
  [[222, 230, 240], [234, 240, 248], [248, 250, 255], [196, 208, 226]], // neige
  [[114, 122, 82], [128, 136, 90], [142, 146, 100], [98, 104, 70]],  // toundra
  [[66, 104, 66], [76, 114, 70], [88, 126, 78], [62, 100, 112]],    // marais
  [[128, 96, 62], [142, 108, 70], [156, 120, 80], [112, 84, 54]],   // terre battue
  [[30, 33, 40], [34, 37, 45], [38, 41, 50], [28, 30, 36]],         // inexploré
];
// Couleur moyenne pour la vue lointaine
export const MACRO_COL = GROUND_PAL.map(p => p[1]);
export const TREE_MACRO = [null, [44, 92, 36], [30, 72, 46], [26, 78, 30], [92, 110, 40], [70, 112, 50], [120, 116, 108], [70, 130, 46], [92, 136, 52]];

export { hash2, mix };
