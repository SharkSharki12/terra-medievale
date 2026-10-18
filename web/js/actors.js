// Sprites pixel-art des personnages, chevaux, charrettes, bateaux et animaux (générés par code, mis en cache)

const SKINS = ['#f1c9a5', '#e3b08a', '#c68a62', '#8d5a3c'];
const HAIRS = ['#2a1c12', '#4a2e1a', '#7a4a24', '#b07a3a', '#d8b060', '#8a3a1a', '#1a1a1a', '#5a4a3a'];
const CLOTHS = ['#7a3a2a', '#3a5a8a', '#4a6a32', '#8a6a3a', '#5a3a6a', '#9a8a5a', '#6a2a2a', '#3a6a6a'];
const DRESSES = ['#8a4a5a', '#5a6a9a', '#6a7a42', '#a07a4a', '#7a4a7a', '#b0a070', '#9a3a3a', '#4a7a7a'];
export const TOOLS = { none: 0, axe: 1, fork: 2, pick: 3, basket: 4, spear: 5, bow: 6, cane: 7, hammer: 8, crook: 9, rod: 10, book: 11, sword: 12, bucket: 13 };

const cache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; } // petites toiles en mémoire (pas de contexte GPU)
function px(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f))), g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f))), b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}
// Atlas : les sprites générés sont rangés dans quelques grandes pages (une seule texture GPU par page au lieu
// de milliers de petites toiles, ce qui évitait des blocages du rendu avec beaucoup d'habitants à l'écran).
// Chaque sprite garde aussi sa petite toile d'origine (src) pour composer d'autres sprites sans relire le GPU.
const PAGE = 1024, MAX_PAGES = 6;
let pages = [];
let pending = [];
function atlasPlace(spr) {
  const c = spr.src, w = c.width, h = c.height;
  let p = pages[pages.length - 1];
  if (p && p.x + w > PAGE) { p.x = 0; p.y += p.row + 1; p.row = 0; }
  if (!p || p.y + h > PAGE) {
    if (pages.length >= MAX_PAGES) { pages = []; cache.clear(); pending = []; return; }
    const cv = document.createElement('canvas'); cv.width = PAGE; cv.height = PAGE;
    p = { cv, ctx: cv.getContext('2d'), x: 0, y: 0, row: 0 };
    pages.push(p);
  }
  p.ctx.drawImage(c, p.x, p.y);
  spr.img = p.cv; spr.sx = p.x; spr.sy = p.y;
  p.x += w + 1; p.row = Math.max(p.row, h);
}
// les nouveaux sprites sont dessinés depuis leur petite toile pendant l'image courante, puis rangés dans
// l'atlas au début de l'image suivante (jamais d'écriture et de lecture mêlées dans une même image)
export function flushAtlas() {
  if (!pending.length) return;
  const list = pending; pending = [];
  for (const spr of list) atlasPlace(spr);
}
function memo(k, f) {
  let c = cache.get(k);
  if (!c) { const cv = f(); c = { img: cv, sx: 0, sy: 0, width: cv.width, height: cv.height, src: cv }; cache.set(k, c); pending.push(c); }
  return c;
}
// dessine une partie d'un sprite (depuis sa toile d'origine) dans une autre toile en cours de création
function blit(ctx, spr, sx, sy, sw, sh, dx, dy) { ctx.drawImage(spr.src, sx, sy, sw, sh, dx, dy, sw, sh); }
// copie d'un sprite dans une toile autonome (portraits de l'interface)
export function spriteCanvas(spr) { return spr.src; }

// look : { s (0 homme, 1 femme), ac (0 enfant, 1 adulte, 2 ancien), hair, cloth, skin, tool, role ('noble','lord','soldat','archer','chevalier','moine'), color }
// view : 0 face (vers le bas), 1 dos (vers le haut), 2 profil (vers la droite) ; frame : 0 arrêt, 1-2 marche, 3 travail
export function personSprite(look, view, frame) {
  const k = `p${look.s}${look.ac}${look.hair}${look.cloth}${look.skin}${look.tool || 0}${look.role || ''}${look.color || ''}${look.sick ? 1 : 0}|${view}${frame}`;
  return memo(k, () => drawPerson(look, view, frame));
}

function drawPerson(L, view, frame) {
  const [c, ctx] = canvas(11, 15);
  const child = L.ac === 0, old = L.ac === 2;
  const ox = 2, oy = child ? 5 : 1; // origine du corps (enfant plus petit)
  const skin = L.sick ? '#b8c890' : SKINS[L.skin & 3];
  let hair = old ? '#b8b4ac' : HAIRS[L.hair & 7];
  let cloth = L.s ? DRESSES[L.cloth & 7] : CLOTHS[L.cloth & 7];
  const hose = '#3a2a1a', shoe = '#2a1a10', out = '#1e140c';
  const role = L.role || '';
  if (role === 'noble' || role === 'lord') cloth = L.color || '#7a1a2a';
  if (role === 'moine') cloth = '#6a4a2a';
  if (role === 'soldat') cloth = '#a08a5a';
  if (role === 'archer') cloth = '#3a5a2a';
  if (role === 'chevalier') cloth = '#9aa0ac';
  const legsPhase = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const H = child ? 9 : 13;
  const head = child ? 3 : 4, body = child ? 3 : 5, legs = child ? 3 : 4;
  const bw = child ? 3 : 5; // largeur du corps
  const bx = ox + (5 - bw) / 2 | 0;
  const hy = oy, by = oy + head, ly = by + body;
  // ombre
  px(ctx, ox, oy + H - 1, 5, 1, 'rgba(0,0,0,0.25)');
  // jambes
  if (L.s && !child && role !== 'chevalier' && role !== 'soldat' && role !== 'archer') {
    // robe longue
    px(ctx, bx, ly, bw, legs - 1, shade(cloth, 0.85));
    px(ctx, bx - (view === 2 ? 0 : 0), ly + legs - 1, bw, 1, shoe);
    if (legsPhase && view !== 1) px(ctx, bx + (legsPhase > 0 ? bw - 1 : 0), ly + legs - 1, 1, 1, shade(cloth, 0.7));
  } else if (view === 2) {
    const a = legsPhase;
    px(ctx, bx + 1 + (a > 0 ? 1 : 0), ly, 1, legs - 1, hose); px(ctx, bx + 1 + (a > 0 ? 1 : 0), ly + legs - 1, 2, 1, shoe);
    px(ctx, bx + 2 - (a > 0 ? 1 : a < 0 ? -1 : 0), ly, 1, legs - 1, shade(hose, 1.3)); px(ctx, bx + 2 - (a > 0 ? 1 : a < 0 ? -1 : 0), ly + legs - 1, 2, 1, shoe);
  } else {
    const l = legsPhase > 0 ? 1 : 0, r = legsPhase < 0 ? 1 : 0;
    px(ctx, bx + (child ? 0 : 1), ly, 1, legs - 1 - l, hose); px(ctx, bx + (child ? 0 : 1), ly + legs - 1 - l, 1, 1, shoe);
    px(ctx, bx + bw - (child ? 1 : 2), ly, 1, legs - 1 - r, hose); px(ctx, bx + bw - (child ? 1 : 2), ly + legs - 1 - r, 1, 1, shoe);
  }
  // cape (seigneur, chevalier)
  if ((role === 'lord' || role === 'chevalier') && view !== 0) px(ctx, bx - (view === 2 ? 1 : 0), by, view === 2 ? 2 : bw, body + 1, L.color || '#7a1a2a');
  // corps
  px(ctx, bx, by, bw, body, cloth);
  px(ctx, bx, by, bw, 1, shade(cloth, 1.15));
  px(ctx, bx, by + body - 1, bw, 1, shade(cloth, 0.75));
  if (!child) px(ctx, bx, by + body - 2, bw, 1, role === 'lord' || role === 'noble' ? '#d4a020' : '#4a3020'); // ceinture
  if (role === 'chevalier' || role === 'soldat') px(ctx, bx + 1, by + 1, bw - 2, 2, L.color || '#b02828'); // blason / tabard
  // bras
  const swing = frame === 3 ? -1 : legsPhase;
  if (view === 2) {
    px(ctx, bx + 2 + (swing > 0 ? 1 : 0), by + 1, 1, body - 1, shade(cloth, 0.8));
    px(ctx, bx + 2 + (swing > 0 ? 1 : 0), by + body - 1, 1, 1, skin);
  } else {
    px(ctx, bx - 1, by + (swing > 0 ? 0 : 1), 1, body - 1, shade(cloth, 0.8)); px(ctx, bx - 1, by + body - (swing > 0 ? 1 : 0), 1, 1, skin);
    px(ctx, bx + bw, by + (swing < 0 ? 0 : 1), 1, body - 1, shade(cloth, 0.8)); px(ctx, bx + bw, by + body - (swing < 0 ? 1 : 0), 1, 1, skin);
  }
  // tête
  const hx = ox + (child ? 1 : 1), hw = child ? 3 : 3;
  px(ctx, hx, hy + 1, hw, head - 1, skin);
  if (view === 1) px(ctx, hx, hy, hw, head - 1, hair);
  else {
    px(ctx, hx, hy, hw, 1, hair);
    if (view === 2) { px(ctx, hx, hy + 1, 1, head - 2, hair); px(ctx, hx + 2, hy + 2, 1, 1, out); }
    else { px(ctx, hx, hy + 2, 1, 1, out); px(ctx, hx + 2, hy + 2, 1, 1, out); }
  }
  if (L.s && !child && role !== 'chevalier' && role !== 'soldat') {
    if (old || (L.hair & 1)) { px(ctx, hx - 1 + (view === 2 ? 0 : 0), hy, hw + 1, 1, '#ece6d6'); px(ctx, hx - (view === 2 ? 0 : 1), hy + 1, 1, 2, '#ece6d6'); } // coiffe
    else if (view !== 0) px(ctx, view === 2 ? hx - 1 : hx, hy + 1, view === 2 ? 1 : hw, 3, hair); // cheveux longs
  }
  // couvre-chefs selon le rôle
  if (role === 'lord') { px(ctx, hx, hy - 1, hw, 1, '#e8c040'); px(ctx, hx, hy - 2, 1, 1, '#e8c040'); px(ctx, hx + 2, hy - 2, 1, 1, '#e8c040'); }
  if (role === 'soldat') { px(ctx, hx - 1, hy - 1, hw + 2, 1, '#8a909a'); px(ctx, hx, hy - 2, hw, 1, '#a8b0ba'); }
  if (role === 'chevalier') { px(ctx, hx, hy - 1, hw, head, '#a8b0ba'); px(ctx, hx, hy + 1, hw, 1, '#3a3a42'); px(ctx, hx + 1, hy - 2, 1, 1, L.color || '#b02828'); }
  if (role === 'archer') { px(ctx, hx - (view === 2 ? 1 : 0), hy - 1, hw + 1, 2, '#2e4a22'); }
  if (role === 'moine') { px(ctx, hx - 1, hy, hw + 2, 1, '#5a3a1e'); if (view !== 0) px(ctx, hx, hy, hw, head - 1, '#5a3a1e'); }
  if (old && !L.s && view === 0) px(ctx, hx, hy + 3, hw, 1, '#d8d4cc'); // barbe
  // outil tenu
  const tool = L.tool || 0;
  const tx = view === 2 ? bx + 3 + (swing > 0 ? 1 : 0) : bx + bw, ty = by + body - 1;
  const up = frame === 3;
  switch (tool) {
    case TOOLS.axe: px(ctx, tx, ty - (up ? 6 : 4), 1, up ? 6 : 5, '#7a5432'); px(ctx, tx, ty - (up ? 7 : 5), 2, 2, '#b8bcc4'); break;
    case TOOLS.fork: case TOOLS.crook: px(ctx, tx, ty - 7, 1, 9, '#8a6a42'); px(ctx, tx - 1, ty - 8, 3, 1, tool === TOOLS.fork ? '#9a9aa2' : '#8a6a42'); if (tool === TOOLS.fork) { px(ctx, tx - 1, ty - 9, 1, 1, '#9a9aa2'); px(ctx, tx + 1, ty - 9, 1, 1, '#9a9aa2'); } else px(ctx, tx + 1, ty - 9, 1, 2, '#8a6a42'); break;
    case TOOLS.pick: px(ctx, tx, ty - (up ? 6 : 4), 1, 5, '#7a5432'); px(ctx, tx - 1, ty - (up ? 7 : 5), 3, 1, '#8a8e96'); break;
    case TOOLS.hammer: px(ctx, tx, ty - 3, 1, 4, '#7a5432'); px(ctx, tx - 1, ty - (up ? 5 : 4), 3, 2, '#6a6e76'); break;
    case TOOLS.basket: px(ctx, tx - (view === 2 ? 0 : 1), ty, 3, 2, '#b08a4a'); px(ctx, tx, ty - 1, 1, 1, '#c8a050'); break;
    case TOOLS.bucket: px(ctx, tx, ty, 2, 2, '#6a5a4a'); px(ctx, tx, ty, 2, 1, '#5a8ab0'); break;
    case TOOLS.spear: px(ctx, tx, ty - 9, 1, 11, '#7a5432'); px(ctx, tx, ty - 11, 1, 2, '#c8ccd4'); break;
    case TOOLS.bow: px(ctx, tx, ty - 5, 1, 7, '#6a4428'); px(ctx, tx + 1, ty - 4, 1, 1, '#6a4428'); px(ctx, tx + 1, ty, 1, 1, '#6a4428'); break;
    case TOOLS.sword: px(ctx, tx, ty - 5, 1, 5, '#d0d4dc'); px(ctx, tx - 1, ty, 3, 1, '#a07a2a'); break;
    case TOOLS.cane: px(ctx, tx, ty - 2, 1, legs + 3, '#6a4a2a'); break;
    case TOOLS.rod: px(ctx, tx, ty - 8, 1, 9, '#8a6a42'); px(ctx, tx + 1, ty - 8, 1, 4, 'rgba(230,230,230,0.6)'); break;
    case TOOLS.book: px(ctx, tx - 1, ty - 1, 2, 2, '#7a2a1a'); break;
  }
  return c;
}

// cheval vu de profil (vers la droite) ; frame 0 arrêt, 1-4 galop ; rider = look du cavalier
const HORSE = { bai: ['#6a3e22', '#4a2a16', '#2a1a10'], blanc: ['#d8d4cc', '#b0aca4', '#7a766e'], noir: ['#2e2a28', '#1e1a18', '#0e0a08'], alezan: ['#9a5a2a', '#7a4220', '#4a2614'] };
export function horseSprite(coat = 'bai', frame = 0, rider = null) {
  const k = `h${coat}${frame}${rider ? JSON.stringify(rider) : ''}`;
  return memo(k, () => {
    const [c, ctx] = canvas(20, 22);
    const [b0, b1, b2] = HORSE[coat] || HORSE.bai;
    const oy = 8;
    px(ctx, 3, oy + 13, 14, 1, 'rgba(0,0,0,0.25)');
    // pattes
    const L = [[5, 0], [7, 0], [12, 0], [14, 0]];
    const ph = frame === 0 ? [0, 0, 0, 0] : frame === 1 ? [-1, 1, 1, -1] : frame === 2 ? [1, 0, -1, 1] : frame === 3 ? [1, -1, -1, 1] : [0, 1, 1, 0];
    L.forEach(([x], i) => { px(ctx, x + ph[i], oy + 8, 1, 4, i % 2 ? b1 : b2); px(ctx, x + ph[i], oy + 12, 1, 1, '#1a1410'); });
    // corps
    px(ctx, 4, oy + 3, 11, 5, b0);
    px(ctx, 4, oy + 3, 11, 1, shade(b0, 1.15));
    px(ctx, 4, oy + 7, 11, 1, b1);
    // encolure et tête
    px(ctx, 13, oy + 1, 3, 4, b0);
    px(ctx, 15, oy - 1, 3, 3, b0); px(ctx, 17, oy, 1, 2, b1); px(ctx, 16, oy, 1, 1, '#0e0a08');
    px(ctx, 15, oy - 2, 1, 1, b1);
    // crinière et queue
    px(ctx, 13, oy, 2, 3, b2);
    px(ctx, 2, oy + 3, 2, 1, b2); px(ctx, 1, oy + 4, 2, 3 + (frame ? 0 : 1), b2);
    if (rider) {
      // selle et cavalier
      px(ctx, 7, oy + 2, 4, 2, '#5a2a14');
      const p = personSprite({ ...rider, ac: 1 }, 2, 0);
      blit(ctx, p, 0, 0, 11, 9, 5, oy - 9); // haut du corps
      px(ctx, 9, oy + 3, 1, 3, '#3a2a1a'); // jambe
    }
    return c;
  });
}

// charrette tirée par un cheval (vers la droite)
export function cartSprite(load = 'ble', frame = 0) {
  return memo(`c${load}${frame}`, () => {
    const [c, ctx] = canvas(30, 22);
    const h = horseSprite('bai', frame ? 1 + (frame % 4) : 0);
    blit(ctx, h, 0, 0, h.width, h.height, 10, 0);
    const oy = 10;
    px(ctx, 1, oy + 11, 14, 1, 'rgba(0,0,0,0.25)');
    px(ctx, 12, oy + 4, 4, 1, '#5a3a22'); // brancard
    px(ctx, 1, oy + 1, 12, 6, '#7a5432'); px(ctx, 1, oy + 1, 12, 1, '#9a7048'); px(ctx, 1, oy + 6, 12, 1, '#4a3020');
    const LOAD = { ble: ['#d8b850', '#b89830'], bois: ['#8a6038', '#5a3a22'], pierre: ['#a8a49a', '#7a766e'], fer: ['#6a6e78', '#4a4e56'], laine: ['#ece8dc', '#c8c4b8'], vin: ['#7a3a2a', '#5a2a1a'], poisson: ['#9ab0c0', '#6a8090'] }[load] || ['#d8b850', '#b89830'];
    for (let i = 0; i < 5; i++) { px(ctx, 2 + i * 2, oy - 1 + (i % 2), 2, 2, LOAD[i % 2]); }
    const wf = frame % 2;
    for (const wx of [3, 9]) { px(ctx, wx, oy + 6, 3, 3, '#3a2a1a'); px(ctx, wx + 1, oy + 7, 1, 1, wf ? '#6a5a4a' : '#8a7a6a'); }
    return c;
  });
}

// bateaux (vers la droite) : barque, pêche, navire (cog), barque du seigneur (voile)
export function boatSprite(kind = 'barque', frame = 0, color = '#b02828', rider = null) {
  return memo(`b${kind}${frame}${color}${rider ? JSON.stringify(rider) : ''}`, () => {
    if (kind === 'navire') {
      const [c, ctx] = canvas(30, 30);
      const oy = 14;
      px(ctx, 2, oy + 12, 26, 2, 'rgba(255,255,255,0.35)');
      // coque
      px(ctx, 3, oy + 6, 24, 5, '#6a4426'); px(ctx, 2, oy + 5, 26, 2, '#8a5a32'); px(ctx, 5, oy + 11, 20, 1, '#4a2e18');
      px(ctx, 24, oy + 2, 4, 4, '#8a5a32'); px(ctx, 2, oy + 3, 4, 3, '#8a5a32'); // châteaux
      for (let x = 6; x < 24; x += 3) px(ctx, x, oy + 8, 1, 1, '#3a2414');
      // mât et voile
      px(ctx, 14, oy - 13, 1, 18, '#4a3020');
      const bulge = frame % 2;
      px(ctx, 8, oy - 11, 13 + bulge, 12, '#ece4d0'); px(ctx, 8, oy - 11, 13 + bulge, 1, '#d0c8b4');
      px(ctx, 12, oy - 9, 5, 6, color); px(ctx, 13, oy - 8, 3, 4, '#e8c040');
      px(ctx, 14, oy - 15, 4, 2, color);
      return c;
    }
    const [c, ctx] = canvas(20, 16);
    const oy = 8;
    px(ctx, 1, oy + 6, 18, 1, 'rgba(255,255,255,0.35)');
    px(ctx, 2, oy + 2, 15, 4, '#7a5030'); px(ctx, 1, oy + 1, 17, 2, '#9a6a3a'); px(ctx, 3, oy + 5, 13, 1, '#4a2e18');
    px(ctx, 16, oy, 2, 2, '#9a6a3a'); px(ctx, 1, oy, 2, 2, '#9a6a3a');
    if (kind === 'peche') { for (let i = 0; i < 4; i++) px(ctx, 3 + i * 2, oy + 1, 1, 1, '#c8b890'); }
    if (kind === 'voile') {
      px(ctx, 9, oy - 8, 1, 10, '#4a3020');
      px(ctx, 5, oy - 7, 8 + (frame % 2), 7, '#ece4d0'); px(ctx, 7, oy - 6, 3, 4, color);
    }
    const p = personSprite(rider || { s: 0, ac: 1, hair: 1, cloth: 3, skin: 1 }, 2, 0);
    blit(ctx, p, 0, 0, 11, 9, kind === 'voile' ? 9 : 5, oy - 8);
    if (kind !== 'voile') { const a = frame % 2 ? 1 : -1; px(ctx, 7, oy + 1, 1, 1, '#6a4a2a'); px(ctx, 5 + a, oy + 2, 3, 1, '#8a6a42'); px(ctx, 4 + a * 2, oy + 3, 2, 1, '#8a6a42'); }
    return c;
  });
}

// animaux (profil vers la droite)
export function animalSprite(kind, frame = 0) {
  return memo(`a${kind}${frame}`, () => {
    const [c, ctx] = canvas(12, 9);
    const step = frame % 2;
    if (kind === 'mouton') {
      px(ctx, 2, 8, 7, 1, 'rgba(0,0,0,0.2)');
      px(ctx, 3, 6, 1, 2 - step, '#2a2420'); px(ctx, 7, 6, 1, 1 + step, '#2a2420');
      px(ctx, 2, 3, 7, 4, '#ece8dc'); px(ctx, 3, 2, 5, 1, '#f8f4ea'); px(ctx, 2, 6, 7, 1, '#c8c4b8');
      px(ctx, 8, 3, 2, 2, '#3a3430'); px(ctx, 9, 4, 1, 1, '#2a2420');
    } else if (kind === 'vache') {
      px(ctx, 1, 8, 10, 1, 'rgba(0,0,0,0.2)');
      px(ctx, 2, 6, 1, 2 - step, '#4a3a2a'); px(ctx, 8, 6, 1, 1 + step, '#4a3a2a'); px(ctx, 4, 6, 1, 2, '#4a3a2a'); px(ctx, 7, 6, 1, 2, '#4a3a2a');
      px(ctx, 1, 2, 9, 5, '#ece6da'); px(ctx, 3, 3, 3, 2, '#2a2220'); px(ctx, 7, 2, 2, 2, '#2a2220');
      px(ctx, 9, 1, 3, 4, '#ece6da'); px(ctx, 11, 3, 1, 1, '#d89a9a'); px(ctx, 9, 0, 1, 1, '#c8c0b0');
    } else if (kind === 'poule') {
      px(ctx, 4, 6, 3, 1, 'rgba(0,0,0,0.2)');
      px(ctx, 4, 3, 3, 3, '#f0ece0'); px(ctx, 6, 2, 1, 2, '#f0ece0'); px(ctx, 6, 1, 1, 1, '#c83020'); px(ctx, 7, 3, 1, 1, '#e8a020');
      px(ctx, 5, 6 - step, 1, 1, '#e8a020');
    } else if (kind === 'cochon') {
      px(ctx, 2, 8, 7, 1, 'rgba(0,0,0,0.2)');
      px(ctx, 3, 6, 1, 2 - step, '#c88878'); px(ctx, 7, 6, 1, 1 + step, '#c88878');
      px(ctx, 2, 3, 7, 4, '#e8a898'); px(ctx, 9, 4, 2, 2, '#d89888'); px(ctx, 10, 5, 1, 1, '#a86858'); px(ctx, 2, 3, 1, 1, '#d89888');
    }
    return c;
  });
}

// dessine un sprite ancré par les pieds (sx, sy en pixels écran), k = taille d'un pixel du sprite
export function drawAt(ctx, spr, sx, sy, k, flip = false, ax = 0.5, ay = 1) {
  const w = spr.width * k, h = spr.height * k;
  const x = Math.round(sx - w * ax), y = Math.round(sy - h * ay);
  if (flip) {
    ctx.save(); ctx.translate(x + Math.round(w), y); ctx.scale(-1, 1);
    ctx.drawImage(spr.img, spr.sx, spr.sy, spr.width, spr.height, 0, 0, Math.round(w), Math.round(h));
    ctx.restore();
  } else ctx.drawImage(spr.img, spr.sx, spr.sy, spr.width, spr.height, x, y, Math.round(w), Math.round(h));
}
