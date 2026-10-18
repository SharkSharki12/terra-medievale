// Définitions des bâtiments + sprites pixel-art dessinés par code (16 px par case)
import { mulberry32 } from './noise.js';

export const RES = ['wood', 'stone', 'food', 'gold', 'iron'];
export const RES_NAMES = { wood: 'Bois', stone: 'Pierre', food: 'Nourriture', gold: 'Or', iron: 'Fer' };
export const RANKS = [
  { name: 'Hameau', pop: 0, radius: 28 },
  { name: 'Village', pop: 25, radius: 40 },
  { name: 'Bourg', pop: 70, radius: 56 },
  { name: 'Ville', pop: 160, radius: 76 },
  { name: 'Cité', pop: 350, radius: 100 },
  { name: 'Capitale', pop: 700, radius: 130 },
];
export const CATS = [
  { id: 'habitat', name: 'Habitat' },
  { id: 'prod', name: 'Production' },
  { id: 'service', name: 'Services' },
  { id: 'routes', name: 'Routes' },
  { id: 'guerre', name: 'Guerre & défense' },
  { id: 'prestige', name: 'Prestige' },
];

// prod = par seconde de jeu ; site = facteur selon le terrain
export const BUILDINGS = {
  manoir: { name: 'Manoir', cat: null, w: 3, h: 3, top: 22, cost: {}, rank: 0, pop: 10, jobs: 0, prod: { food: 0.32, gold: 0.1, wood: 0.1 }, happy: 2, smoke: [[30, 6]],
    desc: 'Le cœur de ta ville. Il loge les premiers habitants et définit ton territoire.' },
  maison: { name: 'Maison', cat: 'habitat', w: 2, h: 2, top: 12, cost: { wood: 18 }, rank: 0, pop: 6, smoke: [[22, 2]],
    desc: 'Loge 6 habitants. Plus d\'habitants = plus de travailleurs et d\'impôts.' },
  ferme: { name: 'Ferme', cat: 'prod', w: 4, h: 4, top: 10, cost: { wood: 30 }, rank: 0, jobs: 2, prod: { food: 0.9 }, site: 'fertile',
    desc: 'Produit de la nourriture. Meilleure sur une prairie fertile.' },
  bucheron: { name: 'Bûcheron', cat: 'prod', w: 2, h: 2, top: 10, cost: { wood: 20 }, rank: 0, jobs: 2, prod: { wood: 0.7 }, site: 'forest', smoke: [[8, 4]],
    desc: 'Produit du bois. Place-le près d\'une forêt.' },
  carriere: { name: 'Carrière', cat: 'prod', w: 3, h: 3, top: 6, cost: { wood: 35 }, rank: 0, jobs: 2, prod: { stone: 0.45 }, site: 'rock',
    desc: 'Produit de la pierre. Bien plus efficace près des rochers.' },
  pecheur: { name: 'Cabane de pêcheur', cat: 'prod', w: 2, h: 2, top: 10, cost: { wood: 22 }, rank: 0, jobs: 1, prod: { food: 0.7 }, site: 'water', needWater: true,
    desc: 'Produit du poisson. Doit toucher l\'eau (mer, lac ou rivière).' },
  puits: { name: 'Puits', cat: 'service', w: 1, h: 1, top: 10, cost: { stone: 12 }, rank: 0, happy: 3,
    desc: 'De l\'eau fraîche pour tous : +bonheur.' },
  chemin: { name: 'Chemin', cat: 'routes', w: 1, h: 1, top: 0, cost: {}, rank: 0, road: 1,
    desc: 'Gratuit. Glisse pour tracer un chemin de terre, même en diagonale. Passerelle sur rivière : 4 bois.' },
  route: { name: 'Route', cat: 'routes', w: 1, h: 1, top: 0, cost: { wood: 1 }, rank: 0, road: 2,
    desc: 'Glisse pour tracer (en diagonale aussi). Les bâtiments reliés au manoir par la route produisent +20 % et les habitants marchent plus vite. Pont : 6 bois.' },
  pave: { name: 'Rue pavée', cat: 'routes', w: 1, h: 1, top: 0, cost: { stone: 2 }, rank: 1, road: 3,
    desc: 'La plus rapide et la plus belle. Trace-la par-dessus un chemin ou une route pour l\'améliorer. Pont de pierre : 10 pierre.' },
  marche: { name: 'Marché', cat: 'prod', w: 3, h: 3, top: 10, cost: { wood: 50, stone: 30 }, rank: 1, jobs: 2, prod: { gold: 0.6 }, happy: 4,
    desc: 'Les marchands rapportent de l\'or et rendent les habitants heureux.' },
  moulin: { name: 'Moulin', cat: 'prod', w: 2, h: 2, top: 30, cost: { wood: 40, stone: 20 }, rank: 1, jobs: 1,
    desc: 'Les fermes dans un rayon de 12 cases produisent +50 %.' },
  taverne: { name: 'Taverne', cat: 'service', w: 2, h: 2, top: 16, cost: { wood: 45, stone: 15 }, rank: 1, jobs: 2, prod: { gold: 0.25 }, happy: 7, smoke: [[24, 2]],
    desc: 'Bière et chansons : +bonheur et un peu d\'or.' },
  eglise: { name: 'Église', cat: 'service', w: 3, h: 4, top: 38, cost: { wood: 60, stone: 90, gold: 40 }, rank: 1, happy: 12, jobs: 1,
    desc: 'Les cloches du dimanche : gros bonus de bonheur.' },
  jardin: { name: 'Fontaine', cat: 'service', w: 2, h: 2, top: 4, cost: { stone: 25, gold: 10 }, rank: 1, happy: 5,
    desc: 'Une jolie place fleurie avec une fontaine.' },
  tour: { name: 'Tour de guet', cat: 'guerre', w: 1, h: 1, top: 30, cost: { stone: 30 }, rank: 1, happy: 1,
    desc: 'Une tour de pierre qui veille sur la ville : +10 défense.' },
  caserne: { name: 'Caserne', cat: 'guerre', w: 3, h: 3, top: 14, cost: { wood: 60, stone: 30 }, rank: 0, jobs: 2, smoke: [[40, 2]],
    desc: 'Entraîne des soldats pour défendre ta ville et attaquer tes ennemis. Clique dessus pour entraîner.' },
  archerie: { name: 'Camp d\'archers', cat: 'guerre', w: 2, h: 2, top: 8, cost: { wood: 50, gold: 20 }, rank: 1, jobs: 1,
    desc: 'Entraîne des archers, redoutables en défense. Clique dessus pour entraîner.' },
  ecurie: { name: 'Écurie', cat: 'guerre', w: 3, h: 2, top: 12, cost: { wood: 80, stone: 40, gold: 40 }, rank: 2, jobs: 2,
    desc: 'Entraîne des chevaliers, la meilleure troupe d\'attaque. Clique dessus pour entraîner.' },
  grandemaison: { name: 'Maison de pierre', cat: 'habitat', w: 2, h: 2, top: 20, cost: { wood: 30, stone: 35 }, rank: 2, pop: 16, smoke: [[24, 1]],
    desc: 'Grande demeure à étages : loge 16 habitants.' },
  mine: { name: 'Mine de fer', cat: 'prod', w: 2, h: 2, top: 12, cost: { wood: 50, stone: 30 }, rank: 2, jobs: 2, prod: { iron: 0.3 }, site: 'mountain',
    desc: 'Produit du fer. Meilleure près des rochers et en altitude.' },
  forge: { name: 'Forge', cat: 'prod', w: 2, h: 2, top: 18, cost: { wood: 40, stone: 50, iron: 15 }, rank: 2, jobs: 2, smoke: [[25, 0]],
    desc: 'De meilleurs outils : toute la production +8 % (jusqu\'à 3 forges).' },
  port: { name: 'Port', cat: 'prod', w: 3, h: 3, top: 8, cost: { wood: 80, stone: 40 }, rank: 2, jobs: 3, prod: { food: 0.5, gold: 0.5 }, needWater: true,
    desc: 'Commerce et pêche. Doit toucher l\'eau.' },
  rempart: { name: 'Rempart', cat: 'guerre', w: 1, h: 1, top: 10, cost: { stone: 3 }, rank: 1, wall: true, happy: 0.06,
    desc: 'Glisse pour tracer des murailles : +1,5 défense chacun, et +25 % de défense à partir de 20 segments.' },
  statue: { name: 'Statue', cat: 'prestige', w: 1, h: 1, top: 20, cost: { stone: 40, gold: 60 }, rank: 3, happy: 6,
    desc: 'Une statue à la gloire de ta ville.' },
  chateau: { name: 'Château', cat: 'guerre', w: 6, h: 6, top: 40, cost: { wood: 250, stone: 400, iron: 80, gold: 250 }, rank: 3, pop: 25, happy: 15,
    desc: 'Le château fort, fierté de la région : +80 défense !' },
  cathedrale: { name: 'Cathédrale', cat: 'prestige', w: 4, h: 6, top: 54, cost: { wood: 200, stone: 600, iron: 60, gold: 500 }, rank: 4, happy: 30,
    desc: 'Un chef-d\'œuvre gothique visible à des lieues.' },
  porte: { name: 'Porte fortifiée', cat: 'guerre', w: 1, h: 1, top: 26, cost: { stone: 25, wood: 10 }, rank: 1, wall: true, gate: true, happy: 0.5,
    desc: 'Une porte dans tes remparts : habitants et charrettes passent, pas les ennemis. Pose-la sur un rempart ou une route (automatique quand un rempart croise une route).' },
  cimetiere: { name: 'Cimetière', cat: 'service', w: 3, h: 3, top: 12, cost: { stone: 20, wood: 10 }, rank: 0, happy: 2,
    desc: 'Les défunts y reposent. Sans cimetière, les décès attristent la ville.' },
  bergerie: { name: 'Bergerie', cat: 'prod', w: 3, h: 3, top: 12, cost: { wood: 35 }, rank: 0, jobs: 1, prod: { food: 0.35, gold: 0.12 }, site: 'fertile',
    desc: 'Des moutons : nourriture et laine. Le tisserand transforme la laine en or.' },
  boulangerie: { name: 'Boulangerie', cat: 'prod', w: 2, h: 2, top: 14, cost: { wood: 30, stone: 20 }, rank: 1, jobs: 2, prod: { food: 0.6 }, smoke: [[24, 0]],
    desc: 'Du bon pain : +50 % s\'il y a un moulin à moins de 15 cases.' },
  apothicaire: { name: 'Apothicaire', cat: 'service', w: 2, h: 2, top: 14, cost: { wood: 30, stone: 25, gold: 25 }, rank: 1, jobs: 1, happy: 2,
    desc: 'Soigne les malades : -18 % de décès (2 apothicaires au maximum) et les épidémies sont bien moins graves.' },
  tisserand: { name: 'Tisserand', cat: 'prod', w: 2, h: 2, top: 12, cost: { wood: 35, stone: 10 }, rank: 1, jobs: 2, prod: { gold: 0.35 },
    desc: 'Tisse draps et habits : +50 % d\'or s\'il y a une bergerie.' },
  grenier: { name: 'Grenier', cat: 'prod', w: 3, h: 2, top: 18, cost: { wood: 50, stone: 20 }, rank: 1, jobs: 1, happy: 1,
    desc: 'Conserve les récoltes : -15 % de nourriture consommée (2 au maximum) et l\'hiver rude fait moitié moins de dégâts.' },
  embarcadere: { name: 'Embarcadère', cat: 'prod', w: 2, h: 2, top: 6, cost: { wood: 25 }, rank: 0, jobs: 1, prod: { food: 0.25 }, site: 'water', needWater: true,
    desc: 'Un ponton au bord de l\'eau : une barque de pêche… et une barque pour toi en mode Seigneur.' },
  scierie: { name: 'Scierie', cat: 'prod', w: 3, h: 2, top: 14, cost: { wood: 40, stone: 25 }, rank: 1, jobs: 2, prod: { wood: 0.35 },
    desc: 'Scie les troncs : les bûcherons à moins de 15 cases produisent +30 %.' },
  vignoble: { name: 'Vignoble', cat: 'prod', w: 4, h: 3, top: 8, cost: { wood: 45 }, rank: 1, jobs: 2, prod: { gold: 0.45 }, happy: 3, site: 'vigne',
    desc: 'Des vignes au soleil : or et bonne humeur. Meilleur sur les terres sèches et chaudes.' },
  monastere: { name: 'Monastère', cat: 'service', w: 4, h: 4, top: 32, cost: { wood: 120, stone: 200, gold: 80 }, rank: 2, jobs: 3, prod: { food: 0.3, gold: 0.2 }, happy: 10,
    desc: 'Des moines prient, soignent et cultivent : beaucoup de bonheur et -10 % de décès.' },
};

// ---------- outils de dessin pixel ----------
const C = {
  outline: '#2a1e16',
  stone: ['#6d675f', '#8f897f', '#aaa499', '#c4beb2'],
  timber: '#5a3a22', plaster: ['#d8c8a2', '#e8dab6'],
  wood: ['#4e3220', '#6e4a2e', '#8a6038', '#a87a48'],
  thatch: ['#7a5a24', '#a07c34', '#c09a48', '#d8b862'],
  redroof: ['#6e2418', '#9a3a26', '#b84e32', '#d06a44'],
  brownroof: ['#4a3024', '#6a4430', '#86583c', '#a06c4a'],
  slate: ['#2e3440', '#47505e', '#5e6878', '#7a8494'],
  blueroof: ['#1e3462', '#2c4a86', '#3e62a6', '#5c80c4'],
  window: '#2a2a3a', windowLit: '#f0d070', glass: '#5e7ea8',
};

function mk(w, h, cpu = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', cpu ? { willReadFrequently: true } : undefined);
  return [c, ctx];
}
function R(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

function shadow(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 3, y + 3, w, h);
}

function roof(ctx, x, y, w, h, c, rnd, thatch = false) {
  const mid = y + Math.floor(h * 0.4);
  R(ctx, x, y, w, mid - y, c[2]);
  R(ctx, x, mid, w, y + h - mid, c[1]);
  if (thatch) {
    for (let i = 0; i < w * h * 0.35; i++) {
      const px = x + 1 + Math.floor(rnd() * (w - 2)), py = y + 1 + Math.floor(rnd() * (h - 2));
      R(ctx, px, py, 1, 2, py < mid ? c[3] : c[0]);
    }
  } else {
    for (let yy = mid + 2; yy < y + h - 1; yy += 3) R(ctx, x + 1, yy, w - 2, 1, c[0]);
    for (let yy = y + 2; yy < mid; yy += 3) R(ctx, x + 1, yy, w - 2, 1, c[1]);
  }
  R(ctx, x + 1, mid, w - 2, 1, c[3]);
  R(ctx, x, y, w, 1, c[0]); R(ctx, x, y + h - 1, w, 1, c[0]);
  R(ctx, x, y, 1, h, c[0]); R(ctx, x + w - 1, y, 1, h, c[0]);
}

function wall(ctx, x, y, w, h, style, rnd) {
  if (style === 'timber') {
    R(ctx, x, y, w, h, C.plaster[1]);
    for (let i = 0; i < 12; i++) R(ctx, x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1, C.plaster[0]);
    R(ctx, x, y, w, 1, C.timber); R(ctx, x, y + h - 1, w, 1, C.timber);
    R(ctx, x, y + Math.floor(h / 2), w, 1, C.timber);
    for (let xx = x; xx < x + w; xx += 6) R(ctx, xx, y, 1, h, C.timber);
    R(ctx, x + w - 1, y, 1, h, C.timber);
  } else if (style === 'stone') {
    R(ctx, x, y, w, h, C.stone[2]);
    for (let yy = y; yy < y + h; yy += 3) {
      R(ctx, x, yy, w, 1, C.stone[1]);
      const off = ((yy - y) / 3) % 2 ? 2 : 0;
      for (let xx = x + off; xx < x + w; xx += 4) R(ctx, xx, yy, 1, 3, C.stone[1]);
    }
    for (let i = 0; i < w * h * 0.06; i++) R(ctx, x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1, C.stone[3]);
    R(ctx, x, y + h - 1, w, 1, C.stone[0]);
  } else if (style === 'logs') {
    for (let yy = y; yy < y + h; yy += 2) {
      R(ctx, x, yy, w, 1, ((yy - y) / 2) % 2 ? C.wood[2] : C.wood[3]);
      R(ctx, x, yy + 1, w, 1, C.wood[0]);
    }
  } else if (style === 'white') {
    R(ctx, x, y, w, h, '#e6e2d6');
    for (let i = 0; i < 10; i++) R(ctx, x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1, '#cfc9b8');
    R(ctx, x, y + h - 1, w, 1, '#a8a294');
  }
  R(ctx, x, y, 1, h, C.outline); R(ctx, x + w - 1, y, 1, h, C.outline); R(ctx, x, y + h - 1, w, 1, C.outline);
}
function door(ctx, x, y, w = 4, h = 6) {
  R(ctx, x - 1, y - 1, w + 2, h + 1, C.outline);
  R(ctx, x, y, w, h, '#5a3418');
  R(ctx, x + 1, y + 1, w - 2, h - 1, '#74461f');
  R(ctx, x + w - 2, y + Math.floor(h / 2), 1, 1, '#d0b060');
}
function win(ctx, x, y, lit = false) {
  R(ctx, x - 1, y - 1, 5, 5, C.outline);
  R(ctx, x, y, 3, 3, lit ? C.windowLit : C.glass);
  R(ctx, x + 1, y, 1, 3, C.outline); R(ctx, x, y + 1, 3, 1, C.outline);
}
function chimney(ctx, x, y) {
  R(ctx, x - 1, y - 1, 5, 7, C.outline);
  R(ctx, x, y, 3, 6, C.stone[1]); R(ctx, x, y, 3, 1, C.stone[3]);
}
function flag(ctx, x, y, col) {
  R(ctx, x, y, 1, 9, '#3a2a1a');
  R(ctx, x + 1, y, 5, 3, col); R(ctx, x + 1, y + 3, 4, 1, col);
}
function crenel(ctx, x, y, w, col) {
  for (let xx = x; xx < x + w; xx += 3) { R(ctx, xx, y - 2, 2, 2, col); R(ctx, xx, y - 3, 2, 1, C.outline); }
}
// tour ronde vue de 3/4
function roundTower(ctx, x, y, w, h, roofC, rnd, coneH = 10) {
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    const shade = t < 0.3 ? C.stone[3] : t < 0.65 ? C.stone[2] : t < 0.9 ? C.stone[1] : C.stone[0];
    R(ctx, x + i, y, 1, h, shade);
  }
  for (let yy = y + 2; yy < y + h; yy += 3) for (let xx = x + ((yy / 3) % 2 ? 1 : 3); xx < x + w - 1; xx += 4) R(ctx, xx, yy, 1, 1, C.stone[0]);
  R(ctx, x, y, 1, h, C.outline); R(ctx, x + w - 1, y, 1, h, C.outline); R(ctx, x, y + h - 1, w, 1, C.outline);
  if (roofC) {
    for (let k = 0; k < coneH; k++) {
      const hw = Math.max(1, Math.round(((k + 1) / coneH) * (w / 2 + 1)));
      const cx = x + w / 2;
      R(ctx, Math.round(cx - hw), y - coneH + k, hw * 2, 1, roofC[1]);
      R(ctx, Math.round(cx - hw), y - coneH + k, Math.max(1, Math.round(hw * 0.7)), 1, roofC[2]);
      R(ctx, Math.round(cx - hw), y - coneH + k, 1, 1, roofC[0]); R(ctx, Math.round(cx + hw) - 1, y - coneH + k, 1, 1, roofC[0]);
    }
  } else {
    R(ctx, x - 1, y - 1, w + 2, 2, C.stone[2]);
    crenel(ctx, x - 1, y - 1, w + 2, C.stone[2]);
  }
  win(ctx, x + Math.floor(w / 2) - 1, y + 4);
}

// ---------- sprites ----------
function spriteFor(type, variant, rank) {
  const B = BUILDINGS[type];
  const W = B.w * 16, H = B.h * 16, T = B.top;
  const [c, ctx] = mk(W, H + T);
  const rnd = mulberry32(type.length * 977 + variant * 31 + 7);
  const oy = T; // y du haut de l'emprise
  switch (type) {
    case 'maison': {
      const roofs = [C.thatch, C.redroof, C.brownroof];
      const rc = roofs[variant % 3];
      shadow(ctx, 3, oy + 8, 26, 22);
      wall(ctx, 3, oy + 14, 26, 15, variant === 2 ? 'stone' : 'timber', rnd);
      roof(ctx, 1, oy - 10, 30, 25, rc, rnd, rc === C.thatch);
      chimney(ctx, 22, oy - 12);
      door(ctx, 8 + (variant % 2) * 10, oy + 22, 4, 6);
      win(ctx, variant % 2 ? 7 : 20, oy + 19);
      break;
    }
    case 'grandemaison': {
      shadow(ctx, 2, oy + 4, 28, 26);
      wall(ctx, 2, oy + 8, 28, 21, 'stone', rnd);
      roof(ctx, 0, oy - 19, 32, 28, variant % 2 ? C.slate : C.redroof, rnd);
      chimney(ctx, 24, oy - 18);
      door(ctx, 14, oy + 22, 4, 6);
      win(ctx, 5, oy + 12); win(ctx, 24, oy + 12); win(ctx, 5, oy + 20); win(ctx, 24, oy + 20);
      R(ctx, 2, oy + 17, 28, 1, C.stone[0]);
      break;
    }
    case 'manoir': {
      shadow(ctx, 4, oy + 6, 42, 40);
      const rc = rank >= 4 ? C.blueroof : rank >= 2 ? C.slate : C.redroof;
      // corps principal
      wall(ctx, 6, oy + 18, 36, 26, rank >= 2 ? 'white' : 'stone', rnd);
      roof(ctx, 4, oy - 6, 40, 26, rc, rnd);
      door(ctx, 22, oy + 36, 5, 8);
      win(ctx, 11, oy + 24); win(ctx, 35, oy + 24); win(ctx, 11, oy + 34); win(ctx, 35, oy + 34);
      if (rank >= 2) { win(ctx, 18, oy + 24); win(ctx, 28, oy + 24); }
      // tour
      roundTower(ctx, 0, oy + 4, 11, 40, rank >= 4 ? C.blueroof : C.blueroof, rnd, 14);
      flag(ctx, 5, oy - 18, rank >= 4 ? '#d4a020' : '#b02828');
      if (rank >= 2) {
        // clocher central
        R(ctx, 20, oy - 18, 10, 14, C.stone[2]); R(ctx, 20, oy - 18, 1, 14, C.outline); R(ctx, 29, oy - 18, 1, 14, C.outline);
        R(ctx, 23, oy - 15, 4, 4, '#f0e8c8'); R(ctx, 24, oy - 14, 1, 2, C.outline); R(ctx, 25, oy - 13, 1, 1, C.outline);
        for (let k = 0; k < 8; k++) R(ctx, 25 - Math.ceil((k + 1) * 0.7), oy - 26 + k, Math.ceil((k + 1) * 0.7) * 2, 1, rc[1]);
        flag(ctx, 25, oy - 34, rank >= 4 ? '#d4a020' : '#b02828');
      }
      chimney(ctx, 36, oy - 6);
      break;
    }
    case 'ferme': {
      // champ
      const crops = variant % 2 ? ['#c8a83a', '#a88a2a'] : ['#7aa040', '#5a8030'];
      R(ctx, 1, oy + 1, 62, 62, '#7a5a34');
      for (let yy = oy + 2; yy < oy + 63; yy += 3) {
        R(ctx, 2, yy, 60, 2, crops[0]);
        for (let xx = 2; xx < 62; xx += 2) if (rnd() < 0.3) R(ctx, xx, yy, 1, 1, crops[1]);
      }
      // clôture
      for (let xx = 0; xx < 64; xx += 4) { R(ctx, xx, oy, 1, 3, '#5a3a22'); R(ctx, xx, oy + 61, 1, 3, '#5a3a22'); }
      for (let yy = oy; yy < oy + 64; yy += 4) { R(ctx, 0, yy, 2, 1, '#5a3a22'); R(ctx, 62, yy, 2, 1, '#5a3a22'); }
      R(ctx, 0, oy + 1, 64, 1, '#8a6a42'); R(ctx, 0, oy + 62, 64, 1, '#8a6a42');
      // grange
      R(ctx, 2, oy + 2, 30, 26, '#8a6a3a');
      shadow(ctx, 4, oy + 4, 26, 22);
      wall(ctx, 4, oy + 14, 26, 13, 'logs', rnd);
      R(ctx, 13, oy + 18, 8, 9, '#3a2414'); R(ctx, 14, oy + 19, 6, 8, '#5a3a20'); R(ctx, 16, oy + 19, 1, 8, '#3a2414');
      roof(ctx, 2, oy - 8, 30, 23, C.thatch, rnd, true);
      // botte de foin
      R(ctx, 38, oy + 8, 8, 6, '#d8b850'); R(ctx, 38, oy + 13, 8, 1, '#a08030'); R(ctx, 39, oy + 9, 6, 1, '#f0d070');
      break;
    }
    case 'bucheron': {
      shadow(ctx, 2, oy + 8, 20, 20);
      wall(ctx, 2, oy + 14, 20, 14, 'logs', rnd);
      roof(ctx, 0, oy - 8, 24, 23, C.brownroof, rnd);
      door(ctx, 9, oy + 21, 4, 7);
      chimney(ctx, 6, oy - 7);
      // tas de bûches
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3 - r; k++) {
        const x = 23 + k * 3 + r * 1.5, y = oy + 25 - r * 3;
        R(ctx, x, y, 3, 3, '#6e4a2e'); R(ctx, x + 1, y + 1, 1, 1, '#c8a070');
      }
      // billot et hache
      R(ctx, 25, oy + 11, 5, 4, '#7a5432'); R(ctx, 25, oy + 11, 5, 1, '#c8a070');
      R(ctx, 28, oy + 6, 1, 6, '#5a3a22'); R(ctx, 27, oy + 6, 3, 2, '#b0b0b8');
      break;
    }
    case 'carriere': {
      R(ctx, 2, oy + 2, 44, 44, '#7a746a');
      R(ctx, 6, oy + 6, 36, 36, '#68625a');
      R(ctx, 11, oy + 11, 26, 26, '#58524c');
      R(ctx, 16, oy + 16, 16, 16, '#48443e');
      for (const [x, y, s] of [[6, 6, 36], [11, 11, 26], [16, 16, 16]]) { R(ctx, x, y, s, 1, '#9a948a'); R(ctx, x, y, 1, s, '#9a948a'); }
      // blocs
      for (let i = 0; i < 7; i++) {
        const x = 4 + Math.floor(rnd() * 36), y = oy + 3 + (i % 2 ? 36 : Math.floor(rnd() * 6));
        R(ctx, x, y, 5, 4, '#c4beb2'); R(ctx, x, y + 3, 5, 1, '#8f897f'); R(ctx, x + 4, y, 1, 4, '#8f897f');
      }
      // treuil en bois
      R(ctx, 36, oy - 4, 2, 16, '#5a3a22'); R(ctx, 28, oy - 4, 12, 2, '#6e4a2e'); R(ctx, 30, oy - 2, 1, 14, '#b0a080');
      R(ctx, 28, oy + 12, 5, 4, '#c4beb2');
      break;
    }
    case 'pecheur': {
      shadow(ctx, 2, oy + 8, 18, 20);
      wall(ctx, 2, oy + 14, 18, 14, 'logs', rnd);
      roof(ctx, 0, oy - 8, 22, 23, C.slate, rnd);
      door(ctx, 8, oy + 21, 4, 7);
      // séchoir à poissons
      R(ctx, 23, oy + 6, 1, 18, '#5a3a22'); R(ctx, 30, oy + 6, 1, 18, '#5a3a22'); R(ctx, 22, oy + 7, 10, 1, '#6e4a2e');
      for (let k = 0; k < 3; k++) { R(ctx, 24 + k * 2, oy + 8, 1, 4, '#a8b8c8'); R(ctx, 24 + k * 2, oy + 12, 1, 1, '#6a7a8a'); }
      // filet
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2 === 0) R(ctx, 22 + xx, oy + 22 + yy, 1, 1, '#c8b890');
      break;
    }
    case 'puits': {
      R(ctx, 2, oy + 6, 12, 9, C.outline);
      R(ctx, 3, oy + 6, 10, 8, C.stone[2]); R(ctx, 3, oy + 6, 10, 2, C.stone[3]);
      R(ctx, 5, oy + 7, 6, 3, '#24384e');
      R(ctx, 3, oy - 6, 1, 13, '#5a3a22'); R(ctx, 12, oy - 6, 1, 13, '#5a3a22');
      R(ctx, 1, oy - 9, 14, 4, C.redroof[1]); R(ctx, 1, oy - 9, 14, 1, C.redroof[2]); R(ctx, 1, oy - 6, 14, 1, C.redroof[0]);
      R(ctx, 4, oy - 4, 8, 1, '#6e4a2e'); R(ctx, 7, oy - 3, 1, 4, '#b0a080'); R(ctx, 6, oy + 1, 3, 3, '#7a5432');
      break;
    }
    case 'marche': {
      R(ctx, 1, oy + 1, 46, 46, '#a89a80');
      for (let i = 0; i < 120; i++) R(ctx, 1 + Math.floor(rnd() * 46), oy + 1 + Math.floor(rnd() * 46), 2, 1, '#928670');
      const stall = (x, y, a, b) => {
        R(ctx, x + 2, y + 6, 14, 8, '#6e4a2e'); R(ctx, x + 2, y + 6, 14, 1, '#8a6038');
        for (let k = 0; k < 4; k++) R(ctx, x + 3 + k * 3, y + 7, 2, 2, ['#d04030', '#e0c040', '#60a040', '#e08030'][(k + x) % 4]);
        R(ctx, x + 2, y + 6, 1, 8, '#4a3020'); R(ctx, x + 15, y + 6, 1, 8, '#4a3020');
        for (let k = 0; k < 18; k += 2) { R(ctx, x + k, y, 2, 6, k % 4 ? a : b); }
        R(ctx, x, y + 5, 18, 1, C.outline);
      };
      stall(3, oy + 2, '#c83a2a', '#f0e8d8');
      stall(26, oy + 6, '#2a5aa8', '#f0e8d8');
      stall(12, oy + 26, '#d8b030', '#7a3a1a');
      R(ctx, 33, oy + 32, 6, 7, '#7a5432'); R(ctx, 33, oy + 33, 6, 1, '#4a3020'); R(ctx, 33, oy + 37, 6, 1, '#4a3020');
      R(ctx, 6, oy + 36, 5, 5, '#a07a4a'); R(ctx, 6, oy + 36, 5, 1, '#c09a60');
      break;
    }
    case 'moulin': {
      shadow(ctx, 6, oy + 6, 20, 22);
      // tour du moulin (blanche, conique)
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        R(ctx, 7 + i, oy - 4 + Math.round(Math.abs(t - 0.5) * 4), 1, 34 - Math.round(Math.abs(t - 0.5) * 4), t < 0.35 ? '#f2eee4' : t < 0.7 ? '#dcd6c8' : '#bcb6a8');
      }
      R(ctx, 7, oy - 4, 1, 34, C.outline); R(ctx, 24, oy - 4, 1, 34, C.outline); R(ctx, 7, oy + 29, 18, 1, C.outline);
      for (let k = 0; k < 10; k++) { const hw = Math.round((k + 1) * 1.0); R(ctx, 16 - hw, oy - 14 + k, hw * 2, 1, k < 5 ? C.brownroof[2] : C.brownroof[1]); }
      door(ctx, 14, oy + 22, 4, 7); win(ctx, 14, oy + 6);
      break;
    }
    case 'taverne': {
      shadow(ctx, 2, oy + 4, 28, 26);
      wall(ctx, 2, oy + 8, 28, 21, 'timber', rnd);
      roof(ctx, 0, oy - 15, 32, 24, C.redroof, rnd);
      chimney(ctx, 24, oy - 14);
      door(ctx, 6, oy + 22, 5, 6); win(ctx, 18, oy + 12, true); win(ctx, 24, oy + 12, true); win(ctx, 18, oy + 21, true);
      // enseigne
      R(ctx, 13, oy + 12, 1, 6, '#3a2a1a'); R(ctx, 11, oy + 17, 5, 5, '#8a6038'); R(ctx, 12, oy + 18, 3, 3, '#f0d070');
      // tonneaux
      R(ctx, 26, oy + 24, 4, 5, '#7a5432'); R(ctx, 26, oy + 25, 4, 1, '#3a2a1a'); R(ctx, 26, oy + 27, 4, 1, '#3a2a1a');
      break;
    }
    case 'eglise': {
      shadow(ctx, 6, oy + 2, 36, 60);
      // nef
      wall(ctx, 8, oy + 10, 32, 50, 'stone', rnd);
      roof(ctx, 6, oy - 14, 36, 50, C.slate, rnd);
      // vitraux latéraux
      for (let k = 0; k < 3; k++) { R(ctx, 11, oy + 40 + k * 0, 3, 5, '#3a6ab0'); }
      // clocher en façade
      R(ctx, 16, oy + 18, 16, 42, C.outline);
      wall(ctx, 17, oy + 18, 14, 41, 'stone', rnd);
      for (let k = 0; k < 18; k++) { const hw = Math.max(1, Math.round((k + 1) * 0.42)); R(ctx, 24 - hw, oy - 2 + k, hw * 2, 1, k % 3 ? C.slate[1] : C.slate[2]); }
      R(ctx, 23, oy - 6, 2, 5, '#d0b040'); R(ctx, 22, oy - 4, 4, 1, '#d0b040');
      R(ctx, 21, oy + 22, 6, 6, '#e8e0c8'); R(ctx, 22, oy + 23, 4, 4, '#3a6ab0'); R(ctx, 23, oy + 24, 2, 2, '#c03030');
      R(ctx, 21, oy + 32, 6, 5, C.outline); R(ctx, 22, oy + 33, 4, 4, '#4a3a2a');
      door(ctx, 21, oy + 50, 6, 9);
      break;
    }
    case 'jardin': {
      R(ctx, 1, oy + 1, 30, 30, '#5a9a44');
      for (let i = 0; i < 40; i++) R(ctx, 2 + Math.floor(rnd() * 28), oy + 2 + Math.floor(rnd() * 28), 1, 1, ['#e8d048', '#e070a0', '#f0f0f0', '#c04040'][i % 4]);
      // haies
      R(ctx, 1, oy + 1, 30, 3, '#2e6a2a'); R(ctx, 1, oy + 28, 12, 3, '#2e6a2a'); R(ctx, 19, oy + 28, 12, 3, '#2e6a2a');
      R(ctx, 1, oy + 1, 3, 30, '#2e6a2a'); R(ctx, 28, oy + 1, 3, 30, '#2e6a2a');
      R(ctx, 13, oy + 20, 6, 11, '#c8b48a');
      // fontaine
      R(ctx, 7, oy + 8, 18, 14, C.outline); R(ctx, 8, oy + 8, 16, 13, C.stone[2]); R(ctx, 10, oy + 10, 12, 9, '#3a7ac0');
      R(ctx, 11, oy + 11, 4, 1, '#a0d0f0'); R(ctx, 15, oy + 6, 2, 9, C.stone[3]); R(ctx, 14, oy + 3, 4, 3, '#7ab8e8');
      break;
    }
    case 'caserne': {
      R(ctx, 1, oy + 1, 46, 46, '#8a7a5a');
      for (let i = 0; i < 80; i++) R(ctx, 2 + Math.floor(rnd() * 44), oy + 2 + Math.floor(rnd() * 44), 2, 1, '#7a6a4c');
      shadow(ctx, 3, oy + 2, 40, 22);
      wall(ctx, 3, oy + 6, 40, 18, 'stone', rnd);
      roof(ctx, 1, oy - 12, 44, 20, C.redroof, rnd);
      door(ctx, 20, oy + 16, 6, 8); win(ctx, 8, oy + 12); win(ctx, 35, oy + 12);
      flag(ctx, 22, oy - 22, '#b02828');
      chimney(ctx, 39, oy - 10);
      // cour d'entraînement : mannequins + râtelier
      for (const xx of [8, 18, 28]) { R(ctx, xx, oy + 30, 1, 10, '#5a3a22'); R(ctx, xx - 3, oy + 32, 7, 1, '#5a3a22'); R(ctx, xx - 2, oy + 27, 5, 4, '#c8a870'); R(ctx, xx - 1, oy + 28, 3, 2, '#a08050'); }
      R(ctx, 36, oy + 30, 9, 8, '#5a3a22'); R(ctx, 37, oy + 31, 7, 1, '#6e4a2e');
      for (let k = 0; k < 4; k++) { R(ctx, 37 + k * 2, oy + 26, 1, 11, '#7a5432'); R(ctx, 37 + k * 2, oy + 25, 1, 2, '#c8c8d0'); }
      break;
    }
    case 'archerie': {
      R(ctx, 1, oy + 1, 30, 30, '#6a9a44');
      shadow(ctx, 2, oy + 4, 16, 14);
      wall(ctx, 2, oy + 8, 16, 12, 'logs', rnd);
      roof(ctx, 0, oy - 6, 20, 16, C.thatch, rnd, true);
      door(ctx, 7, oy + 14, 4, 6);
      // cible
      R(ctx, 22, oy + 4, 8, 8, '#f0e8d8'); R(ctx, 23, oy + 5, 6, 6, '#c03030'); R(ctx, 24, oy + 6, 4, 4, '#f0e8d8'); R(ctx, 25, oy + 7, 2, 2, '#c03030');
      R(ctx, 25, oy + 12, 1, 6, '#5a3a22');
      // flèches plantées
      for (const [xx, yy] of [[6, 24], [12, 26], [20, 22], [26, 25]]) { R(ctx, xx, oy + yy, 1, 4, '#7a5432'); R(ctx, xx - 1, oy + yy, 3, 1, '#e8e0d0'); }
      break;
    }
    case 'ecurie': {
      R(ctx, 1, oy + 1, 46, 30, '#8a6a42');
      for (let i = 0; i < 60; i++) R(ctx, 2 + Math.floor(rnd() * 44), oy + 2 + Math.floor(rnd() * 28), 2, 1, i % 2 ? '#c8a850' : '#7a5a34');
      shadow(ctx, 2, oy + 2, 32, 18);
      wall(ctx, 2, oy + 6, 32, 14, 'logs', rnd);
      roof(ctx, 0, oy - 10, 36, 18, C.brownroof, rnd);
      for (let k = 0; k < 3; k++) { R(ctx, 5 + k * 10, oy + 11, 7, 9, '#3a2414'); R(ctx, 5 + k * 10, oy + 14, 7, 1, '#6e4a2e'); }
      // cheval
      R(ctx, 37, oy + 18, 8, 4, '#6a4428'); R(ctx, 44, oy + 15, 3, 4, '#6a4428'); R(ctx, 45, oy + 14, 2, 2, '#4a2e1a');
      R(ctx, 37, oy + 22, 1, 4, '#4a2e1a'); R(ctx, 43, oy + 22, 1, 4, '#4a2e1a'); R(ctx, 36, oy + 18, 1, 3, '#2a1a10');
      // clôture
      for (let xx = 35; xx < 48; xx += 3) R(ctx, xx, oy + 26, 1, 4, '#5a3a22');
      R(ctx, 35, oy + 27, 13, 1, '#7a5432');
      break;
    }
    case 'porte': {
      // corps de garde : deux tourelles et une arche avec herse
      R(ctx, 0, oy - 18, 16, 34, C.outline);
      R(ctx, 1, oy - 17, 14, 32, C.stone[2]);
      for (let yy = oy - 15; yy < oy + 15; yy += 3) R(ctx, 1, yy, 14, 1, C.stone[1]);
      R(ctx, 0, oy - 20, 5, 4, C.stone[3]); R(ctx, 11, oy - 20, 5, 4, C.stone[3]); R(ctx, 6, oy - 19, 4, 2, C.stone[3]);
      R(ctx, 0, oy - 21, 2, 1, C.outline); R(ctx, 3, oy - 21, 2, 1, C.outline); R(ctx, 11, oy - 21, 2, 1, C.outline); R(ctx, 14, oy - 21, 2, 1, C.outline);
      R(ctx, 4, oy + 2, 8, 13, '#2a1a10'); R(ctx, 5, oy + 1, 6, 1, '#2a1a10');
      for (let xx = 5; xx < 12; xx += 2) R(ctx, xx, oy + 2, 1, 12, '#6a6e76');
      for (let yy = oy + 4; yy < oy + 15; yy += 3) R(ctx, 4, yy, 8, 1, '#6a6e76');
      R(ctx, 6, oy - 10, 4, 3, C.outline); R(ctx, 7, oy - 9, 2, 2, '#f0d070');
      R(ctx, 7, oy - 28, 1, 8, '#3a2a1a'); R(ctx, 8, oy - 28, 5, 3, '#b02828');
      break;
    }
    case 'cimetiere': {
      R(ctx, 1, oy + 1, 46, 46, '#5a8a40');
      for (let i = 0; i < 70; i++) R(ctx, 2 + Math.floor(rnd() * 44), oy + 2 + Math.floor(rnd() * 44), 1, 1, i % 3 ? '#6a9a4a' : '#4a7a36');
      // muret
      R(ctx, 0, oy, 48, 3, C.stone[1]); R(ctx, 0, oy, 48, 1, C.stone[3]); R(ctx, 0, oy + 45, 20, 3, C.stone[1]); R(ctx, 28, oy + 45, 20, 3, C.stone[1]);
      R(ctx, 0, oy, 3, 48, C.stone[1]); R(ctx, 45, oy, 3, 48, C.stone[1]);
      R(ctx, 21, oy + 44, 6, 4, '#5a3a22');
      // tombes et croix
      for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
        const x = 7 + col * 8, y = oy + 8 + row * 12;
        if ((row + col) % 3 === 0) { R(ctx, x + 1, y - 4, 2, 8, '#d8d4cc'); R(ctx, x - 1, y - 2, 6, 2, '#d8d4cc'); R(ctx, x + 1, y + 3, 2, 1, C.outline); }
        else { R(ctx, x, y - 2, 4, 6, C.stone[3]); R(ctx, x, y - 3, 4, 1, C.stone[2]); R(ctx, x + 3, y - 2, 1, 6, C.stone[1]); R(ctx, x, y + 4, 4, 1, C.outline); }
        R(ctx, x - 1, y + 5, 6, 2, '#6a5a3a');
      }
      // if
      R(ctx, 38, oy - 8, 8, 14, '#1e3a1e'); R(ctx, 39, oy - 10, 6, 3, '#2a4a28'); R(ctx, 41, oy + 6, 2, 3, '#4a3020');
      break;
    }
    case 'bergerie': {
      R(ctx, 1, oy + 1, 46, 46, '#8aa050');
      for (let i = 0; i < 90; i++) R(ctx, 2 + Math.floor(rnd() * 44), oy + 2 + Math.floor(rnd() * 44), 2, 1, i % 2 ? '#c8b870' : '#7a9044');
      // clôture
      for (let xx = 0; xx < 48; xx += 4) { R(ctx, xx, oy, 1, 4, '#5a3a22'); R(ctx, xx, oy + 44, 1, 4, '#5a3a22'); }
      for (let yy = oy; yy < oy + 48; yy += 4) { R(ctx, 0, yy, 1, 3, '#5a3a22'); R(ctx, 47, yy, 1, 3, '#5a3a22'); }
      R(ctx, 0, oy + 1, 48, 1, '#8a6a42'); R(ctx, 0, oy + 45, 18, 1, '#8a6a42'); R(ctx, 30, oy + 45, 18, 1, '#8a6a42');
      R(ctx, 0, oy, 1, 48, '#8a6a42'); R(ctx, 47, oy, 1, 48, '#8a6a42');
      // abri
      shadow(ctx, 4, oy + 2, 22, 16);
      wall(ctx, 4, oy + 8, 22, 10, 'logs', rnd);
      roof(ctx, 2, oy - 8, 26, 17, C.thatch, rnd, true);
      R(ctx, 10, oy + 11, 8, 7, '#2a1a10');
      // foin et abreuvoir
      R(ctx, 32, oy + 8, 9, 6, '#d8b850'); R(ctx, 32, oy + 13, 9, 1, '#a08030'); R(ctx, 33, oy + 9, 7, 1, '#f0d070');
      R(ctx, 30, oy + 30, 12, 4, '#6e4a2e'); R(ctx, 31, oy + 31, 10, 2, '#4a7ab0');
      break;
    }
    case 'boulangerie': {
      shadow(ctx, 2, oy + 4, 28, 26);
      wall(ctx, 2, oy + 9, 28, 20, 'timber', rnd);
      roof(ctx, 0, oy - 14, 32, 24, C.redroof, rnd);
      // four en briques
      R(ctx, 22, oy - 16, 6, 18, C.outline); R(ctx, 23, oy - 15, 4, 17, '#a85a3a'); for (let yy = oy - 14; yy < oy + 2; yy += 2) R(ctx, 23, yy, 4, 1, '#8a4a2a');
      door(ctx, 5, oy + 22, 5, 6); win(ctx, 15, oy + 14, true); win(ctx, 22, oy + 20, true);
      // enseigne : pain
      R(ctx, 13, oy + 21, 1, 4, '#3a2a1a'); R(ctx, 11, oy + 24, 7, 4, '#7a5432'); R(ctx, 12, oy + 25, 5, 2, '#d8a050'); R(ctx, 13, oy + 25, 3, 1, '#f0c070');
      // pains sur l'étal
      R(ctx, 2, oy + 29, 10, 2, '#6e4a2e'); for (let k2 = 0; k2 < 4; k2++) R(ctx, 3 + k2 * 2, oy + 28, 2, 1, '#d8a050');
      break;
    }
    case 'apothicaire': {
      shadow(ctx, 2, oy + 4, 28, 26);
      wall(ctx, 2, oy + 9, 28, 20, 'stone', rnd);
      roof(ctx, 0, oy - 14, 32, 24, C.slate, rnd);
      door(ctx, 13, oy + 22, 5, 6); win(ctx, 5, oy + 14); win(ctx, 24, oy + 14);
      // enseigne : croix verte
      R(ctx, 22, oy + 19, 7, 7, '#e8e0c8'); R(ctx, 24, oy + 20, 3, 5, '#2e8a3e'); R(ctx, 23, oy + 21, 5, 3, '#2e8a3e');
      // herbes séchées et fioles
      for (let k2 = 0; k2 < 3; k2++) { R(ctx, 4 + k2 * 3, oy + 21, 1, 4, '#5a8a3a'); R(ctx, 4 + k2 * 3, oy + 20, 1, 1, '#3a2a1a'); }
      R(ctx, 4, oy + 28, 2, 2, '#4a7ab0'); R(ctx, 7, oy + 28, 2, 2, '#b04a7a'); R(ctx, 10, oy + 28, 2, 2, '#4ab07a');
      chimney(ctx, 6, oy - 12);
      break;
    }
    case 'tisserand': {
      shadow(ctx, 2, oy + 6, 22, 24);
      wall(ctx, 2, oy + 12, 22, 17, 'timber', rnd);
      roof(ctx, 0, oy - 10, 26, 23, C.brownroof, rnd);
      door(ctx, 7, oy + 22, 4, 6); win(ctx, 16, oy + 16);
      // métier à tisser et draps colorés
      R(ctx, 25, oy + 6, 1, 18, '#5a3a22'); R(ctx, 31, oy + 6, 1, 18, '#5a3a22'); R(ctx, 25, oy + 6, 7, 1, '#6e4a2e');
      R(ctx, 26, oy + 7, 2, 10, '#b02828'); R(ctx, 28, oy + 7, 2, 12, '#2e6fd8'); R(ctx, 30, oy + 7, 1, 9, '#d4a020');
      R(ctx, 24, oy + 26, 8, 4, '#c8b890'); R(ctx, 24, oy + 26, 8, 1, '#e8dcb0');
      break;
    }
    case 'grenier': {
      shadow(ctx, 4, oy + 4, 40, 26);
      // pilotis de pierre
      for (const xx of [6, 18, 30, 40]) { R(ctx, xx, oy + 24, 4, 7, C.stone[1]); R(ctx, xx, oy + 24, 4, 1, C.stone[3]); }
      wall(ctx, 4, oy + 6, 40, 18, 'logs', rnd);
      roof(ctx, 2, oy - 18, 44, 26, C.thatch, rnd, true);
      R(ctx, 20, oy + 10, 8, 12, '#3a2414'); R(ctx, 21, oy + 11, 6, 11, '#5a3a20');
      R(ctx, 18, oy + 24, 12, 2, '#6e4a2e'); // escalier
      // sacs
      for (const [xx, yy] of [[8, 28], [12, 29], [36, 28]]) { R(ctx, xx, oy + yy, 4, 4, '#d8c890'); R(ctx, xx + 1, oy + yy - 1, 2, 1, '#b8a870'); }
      break;
    }
    case 'embarcadere': {
      // ponton de planches au bord de l'eau
      R(ctx, 0, oy + 2, 32, 28, '#8a6038');
      for (let yy = oy + 2; yy < oy + 30; yy += 3) R(ctx, 0, yy, 32, 1, '#6a4428');
      R(ctx, 0, oy + 2, 32, 1, '#a87a48');
      for (const [xx, yy] of [[0, 0], [29, 0], [0, 27], [29, 27]]) { R(ctx, xx, oy + yy, 3, 5, '#4a3020'); R(ctx, xx, oy + yy, 3, 1, '#7a5432'); }
      // cordes, tonneaux, filets
      R(ctx, 4, oy + 8, 5, 6, '#7a5432'); R(ctx, 4, oy + 9, 5, 1, '#3a2a1a'); R(ctx, 4, oy + 12, 5, 1, '#3a2a1a');
      for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2 === 0) R(ctx, 16 + xx, oy + 18 + yy, 1, 1, '#c8b890');
      R(ctx, 20, oy - 2, 1, 10, '#5a3a22'); R(ctx, 21, oy - 2, 4, 1, '#c8b890');
      break;
    }
    case 'scierie': {
      R(ctx, 1, oy + 1, 46, 30, '#8a7a5a');
      for (let i = 0; i < 50; i++) R(ctx, 2 + Math.floor(rnd() * 44), oy + 2 + Math.floor(rnd() * 28), 1, 1, '#c8a870');
      shadow(ctx, 2, oy + 2, 26, 18);
      wall(ctx, 2, oy + 8, 26, 12, 'logs', rnd);
      roof(ctx, 0, oy - 12, 30, 21, C.brownroof, rnd);
      R(ctx, 8, oy + 12, 14, 8, '#2a1a10');
      // scie et rondins
      R(ctx, 10, oy + 16, 10, 2, '#7a5432'); R(ctx, 14, oy + 13, 1, 4, '#c8ccd4');
      for (let r2 = 0; r2 < 3; r2++) for (let k2 = 0; k2 < 4 - r2; k2++) { const x = 31 + k2 * 4 + r2 * 2, y = oy + 22 - r2 * 3; R(ctx, x, y, 4, 3, '#6e4a2e'); R(ctx, x, y, 2, 3, '#c8a070'); }
      R(ctx, 32, oy + 6, 12, 2, '#a8865a'); R(ctx, 32, oy + 9, 12, 2, '#a8865a');
      break;
    }
    case 'vignoble': {
      R(ctx, 1, oy + 1, 62, 46, '#9a8a50');
      for (let i = 0; i < 80; i++) R(ctx, 2 + Math.floor(rnd() * 60), oy + 2 + Math.floor(rnd() * 44), 1, 1, '#b8a060');
      for (let row = 0; row < 5; row++) {
        const y = oy + 5 + row * 9;
        R(ctx, 3, y + 3, 50, 1, '#6a4a2a');
        for (let x = 4; x < 52; x += 4) { R(ctx, x, y - 1, 3, 4, row % 2 ? '#3e6a2a' : '#4a7a32'); R(ctx, x + 1, y - 2, 1, 1, '#6a9a44'); if ((x + row) % 3 === 0) R(ctx, x + 1, y + 1, 2, 2, '#5a2a5a'); }
        R(ctx, 3, y - 2, 1, 6, '#5a3a22'); R(ctx, 52, y - 2, 1, 6, '#5a3a22');
      }
      // cabane
      shadow(ctx, 54, oy + 4, 8, 10);
      wall(ctx, 54, oy + 6, 8, 8, 'stone', rnd);
      roof(ctx, 53, oy - 2, 10, 9, C.redroof, rnd);
      break;
    }
    case 'monastere': {
      R(ctx, 1, oy + 1, 62, 62, '#7a9a54');
      // cloître (cour carrée)
      R(ctx, 16, oy + 22, 32, 28, C.outline); R(ctx, 17, oy + 23, 30, 26, C.stone[2]);
      R(ctx, 22, oy + 28, 20, 16, '#5a9a44'); R(ctx, 31, oy + 34, 2, 4, '#3a7ab0');
      for (let xx = 18; xx < 46; xx += 4) { R(ctx, xx, oy + 26, 1, 2, C.stone[0]); R(ctx, xx, oy + 45, 1, 2, C.stone[0]); }
      roof(ctx, 14, oy + 14, 36, 10, C.redroof, rnd);
      // église abbatiale
      shadow(ctx, 2, oy - 2, 18, 56);
      wall(ctx, 2, oy + 4, 16, 52, 'stone', rnd);
      roof(ctx, 0, oy - 12, 20, 18, C.slate, rnd);
      R(ctx, 6, oy - 26, 8, 16, C.outline); R(ctx, 7, oy - 25, 6, 15, C.stone[2]);
      for (let k2 = 0; k2 < 8; k2++) R(ctx, 10 - Math.ceil((k2 + 1) * 0.5), oy - 34 + k2, Math.ceil((k2 + 1) * 0.5) * 2, 1, C.slate[1]);
      R(ctx, 9, oy - 38, 2, 5, '#d0b040'); R(ctx, 8, oy - 36, 4, 1, '#d0b040');
      R(ctx, 8, oy - 21, 4, 4, '#3a2a1a');
      door(ctx, 7, oy + 48, 6, 8);
      // potager
      for (let row = 0; row < 3; row++) R(ctx, 50, oy + 8 + row * 6, 11, 3, row % 2 ? '#4a8a3a' : '#6a4a2a');
      R(ctx, 52, oy + 40, 8, 10, '#e8e0cc'); R(ctx, 52, oy + 38, 8, 3, C.redroof[1]);
      break;
    }
    case 'tour': {
      shadow(ctx, 3, oy + 6, 10, 10);
      roundTower(ctx, 2, oy - 18, 12, 33, null, rnd);
      break;
    }
    case 'statue': {
      R(ctx, 3, oy + 8, 10, 7, C.outline); R(ctx, 4, oy + 8, 8, 6, C.stone[2]); R(ctx, 4, oy + 8, 8, 1, C.stone[3]);
      R(ctx, 6, oy - 12, 4, 20, '#b08a2a'); R(ctx, 7, oy - 15, 2, 3, '#c8a040'); R(ctx, 5, oy - 8, 1, 6, '#b08a2a'); R(ctx, 10, oy - 11, 1, 8, '#b08a2a');
      R(ctx, 10, oy - 14, 1, 4, '#d8d8e0'); R(ctx, 6, oy - 12, 1, 20, '#e0c060');
      break;
    }
    case 'mine': {
      R(ctx, 1, oy + 4, 30, 26, '#6a5a48');
      for (let k = 0; k < 14; k++) { const hw = 15 - k; R(ctx, 16 - hw, oy - 10 + k, hw * 2, 1, k < 6 ? '#8a7a66' : '#7a6a56'); }
      for (let i = 0; i < 40; i++) R(ctx, 2 + Math.floor(rnd() * 28), oy - 2 + Math.floor(rnd() * 30), 2, 1, i % 3 ? '#5a4c3c' : '#9a8a74');
      R(ctx, 10, oy + 12, 12, 14, '#5a3a22'); R(ctx, 12, oy + 14, 8, 12, '#141210'); R(ctx, 10, oy + 12, 12, 2, '#7a5432');
      // rails + chariot
      R(ctx, 13, oy + 26, 1, 6, '#5a5a5a'); R(ctx, 18, oy + 26, 1, 6, '#5a5a5a');
      R(ctx, 22, oy + 22, 8, 5, '#5a4a3a'); R(ctx, 23, oy + 21, 6, 2, '#a06a4a'); R(ctx, 23, oy + 27, 2, 2, '#2a2a2a'); R(ctx, 27, oy + 27, 2, 2, '#2a2a2a');
      break;
    }
    case 'forge': {
      shadow(ctx, 2, oy + 6, 28, 24);
      wall(ctx, 2, oy + 10, 28, 19, 'stone', rnd);
      roof(ctx, 0, oy - 10, 32, 21, C.slate, rnd);
      R(ctx, 23, oy - 18, 6, 20, C.outline); R(ctx, 24, oy - 17, 4, 19, C.stone[1]); R(ctx, 24, oy - 17, 4, 1, C.stone[3]);
      // atelier ouvert
      R(ctx, 5, oy + 15, 14, 13, '#2a1a12'); R(ctx, 7, oy + 22, 5, 5, '#ff8a20'); R(ctx, 8, oy + 23, 3, 3, '#ffd060');
      R(ctx, 14, oy + 24, 4, 2, '#4a4a52'); R(ctx, 15, oy + 26, 2, 2, '#3a3a42');
      break;
    }
    case 'port': {
      R(ctx, 0, oy, 48, 48, '#8a6a42');
      for (let yy = oy; yy < oy + 48; yy += 3) { R(ctx, 0, yy, 48, 1, '#6e5232'); }
      for (let xx = 0; xx < 48; xx += 8) R(ctx, xx, oy, 1, 48, '#5a4026');
      R(ctx, 0, oy, 48, 1, C.outline); R(ctx, 0, oy + 47, 48, 1, C.outline); R(ctx, 0, oy, 1, 48, C.outline); R(ctx, 47, oy, 1, 48, C.outline);
      // caisses & tonneaux
      for (const [x, y] of [[4, 6], [10, 6], [4, 12]]) { R(ctx, x, oy + y, 6, 6, '#a07a4a'); R(ctx, x, oy + y, 6, 1, '#c8a070'); R(ctx, x, oy + y, 1, 6, '#6e4a2e'); }
      for (const [x, y] of [[36, 34], [41, 34], [38, 39]]) { R(ctx, x, oy + y, 4, 5, '#7a5432'); R(ctx, x, oy + y + 1, 4, 1, '#3a2a1a'); }
      // grue
      R(ctx, 30, oy - 6, 3, 30, '#5a3a22'); R(ctx, 18, oy - 6, 16, 2, '#6e4a2e'); R(ctx, 19, oy - 4, 1, 14, '#c8b890'); R(ctx, 17, oy + 10, 5, 4, '#a07a4a');
      // barque
      R(ctx, 14, oy + 30, 16, 6, '#5a3a22'); R(ctx, 15, oy + 31, 14, 3, '#8a6038'); R(ctx, 21, oy + 22, 1, 10, '#4a3020'); R(ctx, 22, oy + 23, 6, 7, '#f0e8d8');
      break;
    }
    case 'chateau': {
      R(ctx, 2, oy + 2, 92, 92, '#8a8060');
      for (let i = 0; i < 200; i++) R(ctx, 4 + Math.floor(rnd() * 88), oy + 4 + Math.floor(rnd() * 88), 2, 1, '#7a7054');
      // murailles
      const wallH = 12;
      R(ctx, 6, oy + 6 - wallH, 84, wallH + 6, C.outline); wall(ctx, 7, oy + 6 - wallH + 1, 82, wallH + 4, 'stone', rnd); crenel(ctx, 7, oy + 6 - wallH + 1, 82, C.stone[2]);
      R(ctx, 6, oy + 6, 6, 82, C.stone[1]); R(ctx, 84, oy + 6, 6, 82, C.stone[1]);
      R(ctx, 6, oy + 6, 1, 82, C.outline); R(ctx, 89, oy + 6, 1, 82, C.outline);
      for (let yy = oy + 8; yy < oy + 88; yy += 4) { R(ctx, 6, yy, 2, 2, C.stone[3]); R(ctx, 88, yy, 2, 2, C.stone[3]); }
      // donjon
      shadow(ctx, 30, oy + 20, 36, 40);
      R(ctx, 29, oy - 12, 38, 64, C.outline);
      wall(ctx, 30, oy + 20, 36, 31, 'stone', rnd);
      R(ctx, 30, oy - 11, 36, 31, C.stone[1]);
      for (let yy = oy - 9; yy < oy + 20; yy += 3) R(ctx, 31, yy, 34, 1, C.stone[0]);
      crenel(ctx, 30, oy - 11, 36, C.stone[2]);
      win(ctx, 36, oy + 28); win(ctx, 57, oy + 28); win(ctx, 46, oy + 26); win(ctx, 46, oy + 36);
      flag(ctx, 47, oy - 26, '#b02828');
      // mur avant + porte
      R(ctx, 6, oy + 80, 84, 14, C.outline); wall(ctx, 7, oy + 81, 82, 12, 'stone', rnd); crenel(ctx, 7, oy + 81, 82, C.stone[2]);
      R(ctx, 41, oy + 82, 14, 12, C.outline); R(ctx, 42, oy + 83, 12, 11, '#3a2414');
      for (let xx = 43; xx < 54; xx += 2) R(ctx, xx, oy + 83, 1, 11, '#5a5a62');
      // tours d'angle
      for (const [x, y] of [[0, oy - 4], [80, oy - 4], [0, oy + 70], [80, oy + 70]]) roundTower(ctx, x, y, 16, 26, C.blueroof, rnd, 14);
      flag(ctx, 8, oy - 26, '#d4a020'); flag(ctx, 88, oy - 26, '#d4a020');
      break;
    }
    case 'cathedrale': {
      shadow(ctx, 6, oy + 4, 54, 90);
      wall(ctx, 6, oy + 8, 52, 84, 'stone', rnd);
      roof(ctx, 4, oy - 22, 56, 82, C.slate, rnd);
      // arcs-boutants
      for (let yy = oy + 4; yy < oy + 60; yy += 10) { R(ctx, 0, yy, 5, 3, C.stone[2]); R(ctx, 59, yy, 5, 3, C.stone[2]); R(ctx, 0, yy, 1, 6, C.stone[1]); R(ctx, 63, yy, 1, 6, C.stone[1]); }
      // façade
      R(ctx, 8, oy + 58, 48, 38, C.outline);
      wall(ctx, 9, oy + 58, 46, 37, 'stone', rnd);
      // deux tours
      for (const x of [9, 41]) {
        R(ctx, x - 1, oy + 14, 16, 46, C.outline); wall(ctx, x, oy + 14, 14, 45, 'stone', rnd);
        for (let k = 0; k < 26; k++) { const hw = Math.max(1, Math.round((k + 1) * 0.3)); R(ctx, x + 7 - hw, oy - 12 + k, hw * 2, 1, k % 4 ? C.slate[1] : C.slate[2]); }
        R(ctx, x + 5, oy + 22, 4, 8, '#3a6ab0'); R(ctx, x + 6, oy + 22, 2, 1, '#e8e0c8');
      }
      // rosace
      R(ctx, 26, oy + 62, 12, 12, '#e8e0c8'); R(ctx, 27, oy + 63, 10, 10, '#3a5aa8');
      R(ctx, 31, oy + 63, 2, 10, '#c03030'); R(ctx, 27, oy + 67, 10, 2, '#c03030'); R(ctx, 30, oy + 66, 4, 4, '#e8c040');
      door(ctx, 28, oy + 82, 8, 13);
      R(ctx, 31, oy - 34, 2, 6, '#d0b040'); R(ctx, 30, oy - 32, 4, 1, '#d0b040');
      break;
    }
  }
  return c;
}

// cache de sprites
const cache = new Map();
export function getSprite(type, variant = 0, rank = 0) {
  const nv = type === 'maison' ? 3 : type === 'ferme' || type === 'grandemaison' ? 2 : 1;
  const rk = type === 'manoir' ? (rank >= 4 ? 4 : rank >= 2 ? 2 : 0) : 0;
  const key = `${type}:${variant % nv}:${rk}`;
  let s = cache.get(key);
  if (!s) { s = spriteFor(type, variant % nv, rk); cache.set(key, s); }
  return s;
}

// icône pour l'interface (carré, fond transparent)
const iconCache = new Map();
export function iconURL(type, size = 56, rank = 0) {
  const rk = type === 'manoir' ? (rank >= 4 ? 4 : rank >= 2 ? 2 : 0) : 0;
  const key = `${type}:${size}:${rk}`;
  let u = iconCache.get(key);
  if (!u) { u = makeIconURL(type, size, rk); iconCache.set(key, u); }
  return u;
}
function makeIconURL(type, size, rank) {
  if (BUILDINGS[type] && BUILDINGS[type].road) return roadIcon(size, BUILDINGS[type].road);
  if (type === 'rempart') return wallIcon(size);
  const s = getSprite(type, 0, rank);
  const [c, ctx] = mk(size, size, true);
  ctx.imageSmoothingEnabled = false;
  const sc = Math.min(size / s.width, size / s.height);
  const k = sc >= 1 ? Math.floor(sc) : sc;
  const w = s.width * k, h = s.height * k;
  ctx.drawImage(s, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return c.toDataURL();
}
function roadIcon(size, t = 2) {
  const [c, ctx] = mk(16, 16, true);
  R(ctx, 0, 0, 16, 16, '#5a9a44');
  for (let i = 0; i < 16; i++) {
    const w = t === 1 ? 3 : t === 2 ? 5 : 7, y = 15 - i - Math.floor(w / 2);
    R(ctx, i, y - 1, 1, w + 2, t === 3 ? '#4a4640' : '#6e5430');
    R(ctx, i, y, 1, w, t === 3 ? ((i >> 1) % 2 ? '#a49e92' : '#8a847a') : t === 2 ? '#b4935e' : '#9c7e50');
    if (t === 3 && i % 3 === 0) R(ctx, i, y + 1, 1, 1, '#c4beb2');
  }
  return up(c, size);
}
function wallIcon(size) {
  const [c, ctx] = mk(16, 16, true);
  R(ctx, 0, 6, 16, 9, C.outline); R(ctx, 0, 7, 16, 7, C.stone[2]); R(ctx, 0, 3, 16, 4, C.stone[3]); crenel(ctx, 0, 3, 16, C.stone[3]);
  R(ctx, 0, 10, 16, 1, C.stone[1]);
  return up(c, size);
}
function up(c, size) {
  const [d, dctx] = mk(size, size, true);
  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(c, 0, 0, size, size);
  return d.toDataURL();
}

// Icônes de ressources (pixel art)
export function resIconURL(kind, size = 20) {
  const [c, ctx] = mk(12, 12, true);
  if (kind === 'wood') {
    R(ctx, 1, 4, 10, 4, '#7a5432'); R(ctx, 1, 4, 10, 1, '#9a7048'); R(ctx, 1, 7, 10, 1, '#4e3220');
    R(ctx, 0, 4, 2, 4, '#c8a070'); R(ctx, 1, 5, 1, 2, '#9a7048');
    R(ctx, 3, 8, 8, 3, '#6e4a2e'); R(ctx, 2, 8, 2, 3, '#c8a070');
  } else if (kind === 'stone') {
    R(ctx, 2, 3, 8, 7, '#6d675f'); R(ctx, 3, 2, 6, 8, '#8f897f'); R(ctx, 3, 3, 4, 3, '#c4beb2'); R(ctx, 1, 6, 2, 3, '#6d675f');
  } else if (kind === 'food') {
    R(ctx, 3, 3, 7, 7, '#b02a20'); R(ctx, 2, 4, 9, 5, '#c83a2a'); R(ctx, 4, 4, 2, 2, '#f08070'); R(ctx, 6, 1, 1, 3, '#5a3a22'); R(ctx, 7, 1, 3, 2, '#5a9a3a');
  } else if (kind === 'gold') {
    R(ctx, 2, 2, 8, 8, '#a87a10'); R(ctx, 1, 3, 10, 6, '#d4a020'); R(ctx, 3, 1, 6, 10, '#d4a020'); R(ctx, 3, 3, 3, 3, '#f8e070'); R(ctx, 5, 4, 2, 4, '#a87a10');
  } else if (kind === 'iron') {
    R(ctx, 1, 5, 10, 5, '#4a4e58'); R(ctx, 2, 4, 8, 1, '#7a808c'); R(ctx, 2, 5, 8, 1, '#9aa0ac'); R(ctx, 1, 9, 10, 1, '#2e3038');
  } else if (kind === 'pop') {
    R(ctx, 4, 1, 4, 4, '#e8b890'); R(ctx, 4, 1, 4, 1, '#6a4428'); R(ctx, 3, 5, 6, 5, '#3a5aa8'); R(ctx, 3, 10, 2, 2, '#4a3020'); R(ctx, 7, 10, 2, 2, '#4a3020');
  } else if (kind === 'happy') {
    R(ctx, 2, 1, 8, 10, '#e8c040'); R(ctx, 1, 2, 10, 8, '#e8c040'); R(ctx, 4, 4, 1, 2, '#3a2a1a'); R(ctx, 7, 4, 1, 2, '#3a2a1a');
    R(ctx, 3, 7, 1, 1, '#3a2a1a'); R(ctx, 8, 7, 1, 1, '#3a2a1a'); R(ctx, 4, 8, 4, 1, '#3a2a1a');
  } else if (kind === 'army') {
    R(ctx, 1, 1, 2, 2, '#c8c8d0'); R(ctx, 2, 2, 2, 2, '#c8c8d0'); R(ctx, 3, 3, 2, 2, '#a8a8b0'); R(ctx, 4, 4, 2, 2, '#a8a8b0'); R(ctx, 5, 5, 2, 2, '#8a8a92');
    R(ctx, 9, 1, 2, 2, '#c8c8d0'); R(ctx, 8, 2, 2, 2, '#c8c8d0'); R(ctx, 7, 3, 2, 2, '#a8a8b0'); R(ctx, 6, 4, 2, 2, '#a8a8b0');
    R(ctx, 3, 7, 2, 2, '#a87a10'); R(ctx, 7, 7, 2, 2, '#a87a10'); R(ctx, 2, 8, 2, 2, '#6e4a2e'); R(ctx, 8, 8, 2, 2, '#6e4a2e'); R(ctx, 1, 9, 2, 2, '#d4a020'); R(ctx, 9, 9, 2, 2, '#d4a020');
  } else if (kind === 'shield') {
    R(ctx, 2, 1, 8, 6, '#3060c0'); R(ctx, 3, 7, 6, 2, '#3060c0'); R(ctx, 4, 9, 4, 1, '#3060c0'); R(ctx, 5, 10, 2, 1, '#3060c0');
    R(ctx, 5, 1, 2, 9, '#e8c040'); R(ctx, 2, 4, 8, 2, '#e8c040'); R(ctx, 1, 1, 1, 6, '#1a2a50'); R(ctx, 10, 1, 1, 6, '#1a2a50');
  } else if (kind === 'crown') {
    R(ctx, 1, 4, 10, 6, '#d4a020'); R(ctx, 1, 2, 2, 2, '#d4a020'); R(ctx, 5, 1, 2, 3, '#d4a020'); R(ctx, 9, 2, 2, 2, '#d4a020');
    R(ctx, 2, 6, 2, 2, '#c03030'); R(ctx, 5, 6, 2, 2, '#3060c0'); R(ctx, 8, 6, 2, 2, '#c03030'); R(ctx, 1, 9, 10, 1, '#a87a10');
  }
  return up(c, size);
}

// villageois : petites silhouettes (4x7)
export function makeVillagerSprites() {
  const out = [];
  const shirts = ['#3a5aa8', '#a83a3a', '#5a8a3a', '#8a6a3a', '#7a4a8a', '#c8a040', '#d8d0c0'];
  for (let i = 0; i < shirts.length; i++) {
    for (let f = 0; f < 2; f++) {
      const [c, ctx] = mk(5, 8);
      R(ctx, 1, 0, 3, 3, '#e8b890'); R(ctx, 1, 0, 3, 1, i % 2 ? '#3a2414' : '#c89a50');
      R(ctx, 0, 3, 5, 3, shirts[i]); R(ctx, 0, 5, 5, 1, '#3a2a1a');
      if (f === 0) { R(ctx, 1, 6, 1, 2, '#3a2a1a'); R(ctx, 3, 6, 1, 2, '#3a2a1a'); }
      else { R(ctx, 2, 6, 1, 2, '#3a2a1a'); }
      out.push(c);
    }
  }
  return out;
}
