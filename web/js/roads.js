// Rendu des routes : chemins de terre, routes, rues pavées, en diagonale, avec ponts sur les rivières.
import { unkey, key } from './keys.js';

export const ROAD_TYPES = { chemin: 1, route: 2, pave: 3 };
export const ROAD_NAMES = ['', 'Chemin', 'Route', 'Rue pavée'];
const STYLE = {
  1: { edge: '#6a5232', fill: '#9c7e50', w: 0.46 },
  2: { edge: '#6e5430', fill: '#b4935e', w: 0.7 },
  3: { edge: '#4a4640', fill: '#a49e92', w: 0.86 },
};

let patterns = null;
function makePatterns(ctx) {
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); draw(x); return ctx.createPattern(c, 'repeat'); };
  const R = (x, a, b, w, h, col) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  patterns = {
    1: mk(x => { R(x, 0, 0, 16, 16, '#9c7e50'); for (let i = 0; i < 26; i++) R(x, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, rnd() < 0.5 ? '#8a6c42' : '#b0925e'); }),
    2: mk(x => { R(x, 0, 0, 16, 16, '#b4935e'); for (let i = 0; i < 34; i++) R(x, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, rnd() < 0.4 ? '#9c7c4a' : rnd() < 0.5 ? '#c8a874' : '#a8a092'); }),
    3: mk(x => {
      R(x, 0, 0, 16, 16, '#6e6a62');
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const ox = (j % 2) * 2;
        const c = ['#a49e92', '#b4aea2', '#98928a', '#aca698'][(i + j * 3) % 4];
        R(x, i * 4 + ox, j * 4, 3, 3, c); R(x, i * 4 + ox, j * 4, 3, 1, '#c4beb2');
      }
    }),
    bridge: mk(x => { R(x, 0, 0, 16, 16, '#8a6038'); for (let i = 0; i < 16; i += 4) R(x, i, 0, 1, 16, '#5a3a22'); for (let i = 0; i < 10; i++) R(x, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, '#9a7048'); }),
    stonebridge: mk(x => { R(x, 0, 0, 16, 16, '#8a847a'); for (let j = 0; j < 16; j += 4) { R(x, 0, j, 16, 1, '#6a665e'); for (let i = (j / 4) % 2 ? 2 : 0; i < 16; i += 5) R(x, i, j, 1, 4, '#6a665e'); } }),
  };
}

// keys : clés des cases de route ; typeOf(k) -> 1..3 (0 = pas une route) ; waterAt(x, y) -> bool
export function drawRoadNet(ctx, map, keys, typeOf, waterAt, view) {
  if (!keys.length) return;
  if (!patterns) makePatterns(ctx);
  const z = map.z, W = map.W, H = map.H;
  const SX = (tx) => (tx - map.cx) * z + W / 2, SY = (ty) => (ty - map.cy) * z + H / 2;
  const edges = { 1: [], 2: [], 3: [] }, bridges = [], dots = { 1: [], 2: [], 3: [] };
  for (const k of keys) {
    const [x, y] = unkey(k);
    if (x < view.x0 - 2 || x > view.x1 + 2 || y < view.y0 - 2 || y > view.y1 + 2) continue;
    const t = typeOf(k);
    if (!t) continue;
    const E = typeOf(key(x + 1, y)), S = typeOf(key(x, y + 1)), Wt = typeOf(key(x - 1, y)), N = typeOf(key(x, y - 1));
    const SE = typeOf(key(x + 1, y + 1)), SW = typeOf(key(x - 1, y + 1)), NE = typeOf(key(x + 1, y - 1)), NW = typeOf(key(x - 1, y - 1));
    let n = 0;
    const w0 = waterAt(x, y);
    const add = (x2, y2, t2) => {
      const tt = Math.min(t, t2);
      const e = [x + 0.5, y + 0.5, x2 + 0.5, y2 + 0.5, tt];
      if (w0 || waterAt(x2, y2)) bridges.push(e); else edges[tt].push(e);
    };
    if (E) { add(x + 1, y, E); n++; }
    if (S) { add(x, y + 1, S); n++; }
    if (SE && !E && !S) { add(x + 1, y + 1, SE); n++; }
    if (SW && !Wt && !S) { add(x - 1, y + 1, SW); n++; }
    if (!n && !Wt && !N && !(NE && !N && !E) && !(NW && !N && !Wt)) dots[t].push([x + 0.5, y + 0.5]);
    else if (w0 && !n) bridges.push([x + 0.5, y + 0.5, x + 0.5, y + 0.5, t]);
  }
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pz = z / 16;
  const setPat = (p) => { if (p.setTransform) p.setTransform(new DOMMatrix([pz, 0, 0, pz, SX(0) % (16 * pz), SY(0) % (16 * pz)])); return p; };
  for (const t of [1, 2, 3]) {
    const st = STYLE[t];
    const path = new Path2D();
    for (const [a, b, c, d] of edges[t]) { path.moveTo(SX(a), SY(b)); path.lineTo(SX(c), SY(d)); }
    for (const [a, b] of dots[t]) { path.moveTo(SX(a), SY(b)); path.lineTo(SX(a) + 0.01, SY(b)); }
    ctx.strokeStyle = st.edge; ctx.lineWidth = Math.max(1.5, st.w * z + Math.max(1.5, z * 0.12));
    ctx.stroke(path);
    ctx.strokeStyle = z > 3 ? setPat(patterns[t]) : st.fill; ctx.lineWidth = Math.max(1, st.w * z);
    ctx.stroke(path);
  }
  if (bridges.length) {
    for (const [a, b, c, d, t] of bridges) {
      const stone = t === 3;
      const w = Math.max(1.5, (t === 1 ? 0.55 : 0.8) * z);
      ctx.strokeStyle = stone ? '#4e4a44' : '#3a2414'; ctx.lineWidth = w + Math.max(2, z * 0.22);
      ctx.beginPath(); ctx.moveTo(SX(a), SY(b)); ctx.lineTo(SX(c) + 0.01, SY(d)); ctx.stroke();
      ctx.strokeStyle = z > 3 ? setPat(patterns[stone ? 'stonebridge' : 'bridge']) : stone ? '#8a847a' : '#8a6038'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(SX(a), SY(b)); ctx.lineTo(SX(c) + 0.01, SY(d)); ctx.stroke();
      if (z > 6) { // garde-corps
        const dx = c - a, dy = d - b, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
        ctx.strokeStyle = stone ? '#cfc9bd' : '#5a3a22'; ctx.lineWidth = Math.max(1, z * 0.08);
        ctx.beginPath(); ctx.moveTo(SX(a) + nx, SY(b) + ny); ctx.lineTo(SX(c) + nx, SY(d) + ny); ctx.moveTo(SX(a) - nx, SY(b) - ny); ctx.lineTo(SX(c) - nx, SY(d) - ny); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// tracé d'une ligne droite (8 directions) entre deux cases
export function lineTiles(x0, y0, x1, y1, max = 600) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (out.length < max) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}
