// Habitants simulés un par un : naissance, famille, maison, métier, santé, mort, succession du seigneur.
// Une année de jeu = 300 secondes (4 saisons de 75 s).
import { BUILDINGS } from './buildings.js';
import { mulberry32, hash2 } from './noise.js';

export const YEAR = 300;
export const SEASON_NAMES = ['printemps', 'été', 'automne', 'hiver'];
export const M_NAMES = ['Aldric', 'Bertrand', 'Guillaume', 'Hugues', 'Thibaut', 'Raoul', 'Gauthier', 'Renaud', 'Jehan', 'Pierre', 'Jacques', 'Martin',
  'Étienne', 'Nicolas', 'Simon', 'Robert', 'Arnaud', 'Bernard', 'Gérard', 'Henri', 'Louis', 'Mathieu', 'Olivier', 'Philippe', 'Roland', 'Baudouin',
  'Godefroy', 'Enguerrand', 'Foulques', 'Aymeric', 'Eudes', 'Thomas', 'Colin', 'Gilles', 'Gervais', 'Josselin', 'Lambert', 'Mahieu', 'Perrin',
  'Quentin', 'Rémi', 'Tristan', 'Yvain', 'Anseau', 'Benoît', 'Clément', 'Denis', 'Fiacre', 'Gaspard', 'Hervé', 'Jourdain', 'Léon', 'Marc', 'Odon',
  'Paul', 'Richard', 'Tanguy', 'Amaury', 'Lothaire', 'Tancrède'];
export const F_NAMES = ['Adèle', 'Agnès', 'Aliénor', 'Alix', 'Anne', 'Béatrice', 'Blanche', 'Catherine', 'Cécile', 'Clémence', 'Constance', 'Denise',
  'Ermengarde', 'Éléonore', 'Gisèle', 'Guillemette', 'Héloïse', 'Isabeau', 'Isaure', 'Jeanne', 'Julienne', 'Marguerite', 'Marie', 'Mathilde', 'Mahaut',
  'Oriane', 'Pernelle', 'Perrette', 'Pétronille', 'Sibylle', 'Tiphaine', 'Yolande', 'Ysabeau', 'Bérengère', 'Adélaïde', 'Aude', 'Berthe', 'Colette',
  'Douce', 'Emmeline', 'Flore', 'Hildegarde', 'Ide', 'Jacquette', 'Laure', 'Lucie', 'Mélisende', 'Nicole', 'Odile', 'Sancie', 'Gersende', 'Richarde'];
export const FAMILIES = ['Dubois', 'Lefèvre', 'Meunier', 'Boulanger', 'Charpentier', 'Tisserand', 'Lemaire', 'Fournier', 'Dumoulin', 'Delaroche',
  'Duchêne', 'Mercier', 'Marchand', 'Lebrun', 'Leblanc', 'Leroux', 'Morel', 'Girard', 'Bonnet', 'Fabre', 'Faure', 'Garnier', 'Moreau', 'Petit',
  'Renard', 'Roussel', 'Vasseur', 'Berger', 'Ferrand', 'Masson', 'Tonnelier', 'Vigneron', 'Bouvier', 'Cordier', 'Potier', 'Barbier', 'Charron',
  'Couturier', 'Drapier', 'Fontaine', 'Lacroix', 'Legrand', 'Lenoir', 'Martel', 'Pelletier', 'Rivière', 'Sabatier', 'Tessier', 'Vidal', 'Lagarde',
  'Bastide', 'Delpech', 'Dupont', 'Duval', 'Laforêt', 'Delaunay', 'Montagne', 'Chauvin', 'Gauthier', 'Brunet', 'Colin', 'Perrot', 'Royer'];
export const TRAITS = ['travailleur', 'pieux', 'joyeux', 'courageux', 'prudent', 'bavard', 'rêveur', 'robuste', 'fragile', 'généreux', 'avare', 'curieux'];
const T_ROBUSTE = 7, T_FRAGILE = 8;
export const PLACES = ['la campagne voisine', 'un hameau des collines', 'la vallée', 'un village de la côte', 'la forêt profonde', 'un bourg lointain', 'les montagnes'];
export const TITLES_M = ['Seigneur', 'Baron', 'Vicomte', 'Comte', 'Duc', 'Roi'];
export const TITLES_F = ['Dame', 'Baronne', 'Vicomtesse', 'Comtesse', 'Duchesse', 'Reine'];

// métier selon le lieu de travail [masculin, féminin]
export const JOBS = {
  ferme: ['Paysan', 'Paysanne'], bucheron: ['Bûcheron', 'Bûcheronne'], carriere: ['Carrier', 'Carrière'], pecheur: ['Pêcheur', 'Pêcheuse'],
  marche: ['Marchand', 'Marchande'], moulin: ['Meunier', 'Meunière'], taverne: ['Tavernier', 'Tavernière'], caserne: ['Maître d\'armes', 'Maîtresse d\'armes'],
  archerie: ['Maître archer', 'Maîtresse archère'], ecurie: ['Palefrenier', 'Palefrenière'], mine: ['Mineur', 'Mineuse'], forge: ['Forgeron', 'Forgeronne'],
  port: ['Marin', 'Marin'], boulangerie: ['Boulanger', 'Boulangère'], apothicaire: ['Apothicaire', 'Apothicaire'], tisserand: ['Tisserand', 'Tisserande'],
  grenier: ['Grenetier', 'Grenetière'], embarcadere: ['Batelier', 'Batelière'], scierie: ['Scieur', 'Scieuse'], vignoble: ['Vigneron', 'Vigneronne'],
  monastere: ['Moine', 'Moniale'], bergerie: ['Berger', 'Bergère'], eglise: ['Prêtre', 'Religieuse'],
};
export const CAUSES = {
  vieillesse: 'de vieillesse', maladie: 'de maladie', epidemie: 'de la peste', famine: 'de faim', combat: 'au combat', accident: 'd\'un accident',
  couches: 'en couches', enfance: 'd\'une fièvre infantile', noyade: 'noyé(e)', depart: 'parti(e)',
};
const DANGEROUS = { bucheron: 1, carriere: 1, mine: 2, pecheur: 1, port: 1, embarcadere: 1, forge: 0.5 };

export function yearOf(t) { return 1100 + Math.floor(t / YEAR); }
export function seasonOf(t) { return SEASON_NAMES[((Math.floor(t / (YEAR / 4)) % 4) + 4) % 4]; }
export function fmtDate(t) { return `${seasonOf(t)} ${yearOf(t)}`; }
// « de » + lieu : de la vallée, des montagnes, d'un hameau, de Lyon, d'Orléans
export function fromPlace(pl) {
  pl = String(pl || '');
  if (pl.startsWith('les ')) return 'des ' + pl.slice(4);
  if (pl.startsWith('le ')) return 'du ' + pl.slice(3);
  if (/^(un|une) /.test(pl)) return 'd\'' + pl;
  if (/^[AEIOUYÉÈÂÎaeiouyéèâî]/.test(pl) && !pl.startsWith('la ') && !pl.startsWith('l\'')) return 'd\'' + pl;
  return 'de ' + pl;
}
export function plural(n, w) { return `${n} ${w}${n > 1 ? 's' : ''}`; }
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
const fem = (p, m, f) => (p.s ? f : m);

// mortalité annuelle selon l'âge (atténuée pour rester un jeu facile)
function baseMortality(a) {
  if (a < 1) return 0.05;
  if (a < 5) return 0.012;
  if (a < 15) return 0.004;
  if (a < 40) return 0.006;
  if (a < 50) return 0.012;
  if (a < 60) return 0.03;
  if (a < 70) return 0.07;
  if (a < 80) return 0.15;
  return 0.3;
}

export class People {
  constructor(game) {
    this.g = game;
    this.s = game.s;
    this.acc = 0; this.jobT = 0; this.jobDirty = true;
    this.rnd = Math.random;
    this.rebuildIndex();
  }
  get list() { return this.s.people; }
  get t() { return this.s.time; }
  rebuildIndex() { this.byId = new Map(this.s.people.map(p => [p.i, p])); }
  get(i) { return i ? this.byId.get(i) : null; }
  age(p) { return (this.t - p.b) / YEAR; }
  get lord() { return this.get(this.s.lordId); }
  isNoble(p) { const l = this.lord; return !!l && (p === l || p.i === l.sp || (l.k && l.k.includes(p.i))); }
  lordTitle(p = this.lord) { if (!p) return ''; return (p.s ? TITLES_F : TITLES_M)[Math.min(5, this.s.rank)]; }
  fullName(p) { return `${p.n} ${p.f}`; }
  jobName(p) {
    if (p.i === this.s.lordId) return this.lordTitle(p) + ' ' + fromPlace(this.s.name);
    if (p.aw) return `${p.m === 'chevalier' ? 'Chevalier' : p.m === 'archer' ? fem(p, 'Archer', 'Archère') : 'Soldat'} (en campagne)`;
    if (p.m) return p.m === 'chevalier' ? 'Chevalier' : p.m === 'archer' ? fem(p, 'Archer', 'Archère') : fem(p, 'Soldat', 'Soldate');
    const a = this.age(p);
    if (a < 6) return fem(p, 'Petit enfant', 'Petite enfant');
    if (a < 14) return 'Enfant';
    if (this.isNoble(p)) return p.i === this.lord.sp ? fem(p, 'Époux du seigneur', 'Épouse du seigneur') : fem(p, 'Fils du seigneur', 'Fille du seigneur');
    const b = this.g.byId.get(p.w);
    if (b && JOBS[b.type]) return JOBS[b.type][p.s];
    if (a >= 62) return fem(p, 'Ancien', 'Ancienne');
    return fem(p, 'Sans emploi', 'Sans emploi');
  }

  log(p, code, arg, t = this.t) {
    if (!p) return;
    (p.e ||= []).push([Math.round(t), code, arg]);
    if (p.e.length > 16) p.e.splice(1, 1); // garde la naissance/arrivée
  }
  chron(text, important = false) {
    (this.s.chron ||= []).push([Math.round(this.t), text]);
    if (this.s.chron.length > 250) this.s.chron.shift();
    if (important) this.g.app.ui.toast(text, 'big');
  }

  newPerson(o = {}) {
    const r = this.rnd;
    const sx = o.s ?? (r() < 0.5 ? 0 : 1);
    const p = {
      i: this.s.nextPid++, n: o.n || pick(sx ? F_NAMES : M_NAMES, r), f: o.f || pick(FAMILIES, r), s: sx,
      b: o.b ?? this.t - (18 + r() * 20) * YEAR, h: o.h || 0, w: 0, sp: 0, fa: o.fa || 0, mo: o.mo || 0, k: [],
      hp: 100, sick: 0, m: 0, aw: 0, o: o.o || '', t: Math.floor(r() * TRAITS.length), lk: Math.floor(r() * 4096), e: [],
    };
    this.s.people.push(p);
    this.byId.set(p.i, p);
    this.s.pop = this.s.people.length;
    this.jobDirty = true;
    return p;
  }

  // ---------- logements ----------
  houses() { return this.g.s.buildings.filter(b => BUILDINGS[b.type].pop); }
  occupancy() {
    const occ = new Map();
    for (const p of this.s.people) if (p.h) occ.set(p.h, (occ.get(p.h) || 0) + 1);
    return occ;
  }
  freeHome(n = 1, prefer) {
    const occ = this.occupancy();
    const cand = this.houses().filter(b => BUILDINGS[b.type].pop - (occ.get(b.id) || 0) >= n && (b.type !== 'manoir' && b.type !== 'chateau'));
    if (!cand.length) {
      const any = this.houses().filter(b => BUILDINGS[b.type].pop - (occ.get(b.id) || 0) >= n);
      if (!any.length) return 0;
      cand.push(...any);
    }
    if (prefer) cand.sort((a, b) => Math.hypot(a.x - prefer.x, a.y - prefer.y) - Math.hypot(b.x - prefer.x, b.y - prefer.y));
    else cand.sort(() => this.rnd() - 0.5);
    return cand[0].id;
  }
  roomIn(id) {
    const b = this.g.byId.get(id);
    if (!b || !BUILDINGS[b.type].pop) return 0;
    let n = 0; for (const p of this.s.people) if (p.h === id) n++;
    return BUILDINGS[b.type].pop - n;
  }
  moveFamily(p, home) {
    const fam = [p];
    if (p.sp) { const sp = this.get(p.sp); if (sp && sp.h === p.h) fam.push(sp); }
    for (const k of p.k || []) { const c = this.get(k); if (c && c.h === p.h && this.age(c) < 16) fam.push(c); }
    for (const q of fam) q.h = home;
  }

  // ---------- fondation ----------
  populateInitial(n, lordName, female, cityName) {
    const r = this.rnd;
    const manor = this.g.manoir;
    const fam = fromPlace(cityName);
    const ls = female ? 1 : 0;
    const lord = this.newPerson({ s: ls, n: lordName || pick(ls ? F_NAMES : M_NAMES, r), f: fam, b: this.t - (24 + r() * 10) * YEAR, h: manor.id, o: cityName });
    this.s.lordId = lord.i;
    this.log(lord, 'nais', 'une famille noble', lord.b); this.log(lord, 'sei', cityName);
    const spouse = this.newPerson({ s: 1 - ls, f: fam, b: this.t - (20 + r() * 10) * YEAR, h: manor.id, o: '' });
    this.log(spouse, 'nais', pick(PLACES, r), spouse.b);
    this.marry(lord, spouse, true);
    const kid = this.newPerson({ f: fam, b: this.t - (1 + r() * 5) * YEAR, h: manor.id, fa: ls ? spouse.i : lord.i, mo: ls ? lord.i : spouse.i });
    lord.k.push(kid.i); spouse.k.push(kid.i);
    this.log(kid, 'nais', cityName, kid.b);
    for (let i = 3; i < n; i++) {
      const p = this.newPerson({ h: manor.id, o: pick(PLACES, r) });
      this.log(p, 'arr', 'pour fonder ' + cityName);
    }
    this.chron(`Fondation ${fromPlace(cityName)} par ${this.lordTitle(lord)} ${this.fullName(lord)}.`);
  }

  // anciennes parties : on invente les habitants existants
  populateFromCount(n) {
    const r = this.rnd;
    const manor = this.g.manoir;
    if (!this.lord) {
      const lord = this.newPerson({ n: pick(M_NAMES, r), f: fromPlace(this.s.name), b: this.t - (30 + r() * 8) * YEAR, h: manor.id, o: this.s.name });
      this.s.lordId = lord.i; this.log(lord, 'sei', this.s.name);
      const sp = this.newPerson({ s: 1, f: lord.f, b: this.t - (26 + r() * 8) * YEAR, h: manor.id });
      this.marry(lord, sp, true);
    }
    while (this.s.people.length < n) {
      const home = this.freeHome(1) || manor.id;
      if (r() < 0.45 && n - this.s.people.length >= 3) this.immigrantFamily(home, 'les environs', true);
      else { const p = this.newPerson({ h: home, b: this.t - (14 + r() * 45) * YEAR, o: pick(PLACES, r) }); this.log(p, 'arr', p.o, this.t - r() * YEAR * 3); }
    }
  }
  immigrantFamily(home, from, quiet = false) {
    const r = this.rnd;
    const f = pick(FAMILIES, r);
    const a = this.newPerson({ s: 0, f, h: home, b: this.t - (20 + r() * 18) * YEAR, o: from });
    const b = this.newPerson({ s: 1, f, h: home, b: this.t - (18 + r() * 16) * YEAR, o: from });
    this.marry(a, b, true);
    const nk = Math.min(Math.floor(r() * 3), Math.max(0, this.roomIn(home)));
    for (let i = 0; i < nk; i++) {
      const c = this.newPerson({ f, h: home, b: this.t - r() * 12 * YEAR, fa: a.i, mo: b.i, o: from });
      a.k.push(c.i); b.k.push(c.i);
      this.log(c, 'nais', from, c.b);
    }
    for (const p of [a, b]) this.log(p, 'arr', from);
    if (!quiet) this.chron(`La famille ${f} arrive ${fromPlace(from)}.`);
    return [a, b];
  }

  marry(a, b, quiet = false) {
    a.sp = b.i; b.sp = a.i;
    this.log(a, 'mar', this.fullName(b)); this.log(b, 'mar', this.fullName(a));
    if (!quiet && (this.isNoble(a) || this.isNoble(b))) this.chron(`Mariage de ${this.fullName(a)} et ${this.fullName(b)}.`);
  }
  related(a, b) {
    if (a.fa && (a.fa === b.fa || a.fa === b.i)) return true;
    if (a.mo && (a.mo === b.mo || a.mo === b.i)) return true;
    if (b.fa === a.i || b.mo === a.i) return true;
    return false;
  }

  // ---------- emplois ----------
  assignJobs() {
    const g = this.g;
    const slots = new Map(), filled = new Map();
    for (const b of g.s.buildings) { const B = BUILDINGS[b.type]; if (B.jobs) slots.set(b.id, B.jobs); }
    for (const p of this.s.people) {
      const a = this.age(p);
      const ok = p.w && slots.has(p.w) && !p.m && a >= 14 && a < 63 && !this.isNoble(p) && (filled.get(p.w) || 0) < slots.get(p.w);
      if (ok) filled.set(p.w, (filled.get(p.w) || 0) + 1);
      else if (p.w) { p.w = 0; }
    }
    const free = [...slots.keys()].filter(id => (filled.get(id) || 0) < slots.get(id));
    if (free.length) {
      for (const p of this.s.people) {
        if (p.w || p.m || this.isNoble(p)) continue;
        const a = this.age(p);
        if (a < 14 || a >= 63) continue;
        const home = g.byId.get(p.h) || g.manoir;
        let best = -1, bd = 1e9;
        for (let i = 0; i < free.length; i++) {
          const b = g.byId.get(free[i]);
          const d = Math.abs(b.x - home.x) + Math.abs(b.y - home.y);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) break;
        const id = free[best];
        p.w = id;
        this.log(p, 'tra', g.byId.get(id).type);
        filled.set(id, (filled.get(id) || 0) + 1);
        if (filled.get(id) >= slots.get(id)) free.splice(best, 1);
        if (!free.length) break;
      }
    }
    let tot = 0, fil = 0, unemployed = 0;
    for (const [id, n] of slots) { tot += n; const f = filled.get(id) || 0; fil += f; const b = g.byId.get(id); if (b) b.staff = f / n; }
    for (const p of this.s.people) { const a = this.age(p); if (!p.w && !p.m && a >= 14 && a < 63 && !this.isNoble(p)) unemployed++; }
    g.jobs = tot; g.staffing = tot ? fil / tot : 1;
    this.unemployed = unemployed;
    this.jobDirty = false;
  }
  // personnes disponibles pour l'armée
  recruitable() {
    return this.s.people.filter(p => !p.m && !this.isNoble(p) && this.age(p) >= 16 && this.age(p) < 50 && !p.sick);
  }
  military(type) { return this.s.people.filter(p => p.m === type); }

  // aligne les soldats (personnes) sur les effectifs de l'armée
  syncMilitary() {
    const s = this.s;
    for (const u of ['soldat', 'archer', 'chevalier']) {
      const want = (s.army[u] || 0);
      const home = this.s.people.filter(p => p.m === u && !p.aw);
      if (home.length > want) for (const p of home.slice(want)) { p.m = 0; this.log(p, 'dem_m'); }
      else if (home.length < want) {
        const pool = this.recruitable().sort((a, b) => (a.w ? 1 : 0) - (b.w ? 1 : 0) || (this.age(a) - 24) ** 2 - (this.age(b) - 24) ** 2);
        let need = want - home.length;
        for (const p of pool) { if (need <= 0) break; if (u === 'chevalier' && this.age(p) > 40) continue; p.m = u; p.w = 0; this.log(p, 'sol', u); need--; }
        if (need > 0) s.army[u] -= need; // pas assez d'habitants : l'armée réelle est plus petite
      }
    }
    this.jobDirty = true;
  }
  sendArmy(id, units) {
    for (const u in units) {
      let n = units[u];
      for (const p of this.s.people) { if (n <= 0) break; if (p.m === u && !p.aw) { p.aw = id; n--; } }
    }
  }
  // l'armée rentre : survivants reviennent, les autres sont morts au combat
  returnArmy(id, survivors, place) {
    for (const u in survivors) {
      const group = this.s.people.filter(p => p.aw === id && p.m === u);
      const keep = survivors[u] || 0;
      group.forEach((p, i) => {
        if (i < keep) { p.aw = 0; this.log(p, 'ret', place); }
      });
    }
    for (const p of this.s.people.filter(q => q.aw === id)) this.kill(p, 'combat', place);
  }
  // pertes d'une armée encore en campagne (le reste continue)
  armyLosses(id, before, after, place) {
    for (const u in before) {
      let n = (before[u] || 0) - (after[u] || 0);
      for (const p of this.s.people.filter(q => q.aw === id && q.m === u)) { if (n-- <= 0) break; this.kill(p, 'combat', place); }
    }
  }
  // pertes en défense (soldats présents en ville)
  homeLosses(lost, place) {
    for (const u in lost) {
      let n = lost[u] || 0;
      for (const p of this.s.people.filter(q => q.m === u && !q.aw)) { if (n-- <= 0) break; this.kill(p, 'combat', place, true); }
    }
  }

  // ---------- mort et succession ----------
  kill(p, cause, place = '', keepArmy = false) {
    const s = this.s, t = this.t;
    const idx = s.people.indexOf(p);
    if (idx < 0) return;
    s.people.splice(idx, 1);
    this.byId.delete(p.i);
    const wasLord = p.i === s.lordId;
    const rec = { i: p.i, n: p.n, f: p.f, s: p.s, b: p.b, d: Math.round(t), c: cause, pl: place || '', j: this.jobNameDead(p) };
    if (wasLord) rec.lord = this.lordTitle(p);
    (s.dead ||= []).push(rec);
    if (s.dead.length > 400) s.dead.shift();
    s.deaths = (s.deaths || 0) + 1;
    (s.recentDeaths ||= []).push(t);
    if (p.m && !keepArmy && cause !== 'combat') {
      if (!p.aw && s.army[p.m] > 0) s.army[p.m]--;
      else if (p.aw) { const a = s.armies.find(x => x.id === p.aw); if (a && a.units[p.m] > 0) a.units[p.m]--; }
    }
    if (p.sp) { const sp = this.get(p.sp); if (sp) { sp.sp = 0; this.log(sp, 'veu', this.fullName(p)); } }
    s.pop = s.people.length;
    this.jobDirty = true;
    if (cause === 'depart') return;
    if (this.g.life) this.g.life.forget(p.i);
    const famous = wasLord || this.isNobleId(p.i);
    if (famous || this.rnd() < 0.08 || cause === 'combat') {
      const txt = `${this.fullName(p)} est ${p.s ? 'morte' : 'mort'} ${CAUSES[cause] || ''}${place ? ' à ' + place : ''}, à ${Math.floor((t - p.b) / YEAR)} ans.`;
      if (famous && !wasLord) this.chron(txt);
      if (!wasLord && cause !== 'combat' && !this.g.app.bgMode) this.g.app.ui.toast('✝ ' + txt);
    }
    if (wasLord) this.succession(p, cause);
  }
  isNobleId(i) { const l = this.lord; return !!l && (i === l.sp || (l.k || []).includes(i)); }
  jobNameDead(p) { try { return this.jobName(p); } catch { return ''; } }

  succession(old, cause) {
    const s = this.s;
    const kids = (old.k || []).map(k => this.get(k)).filter(Boolean).sort((a, b) => a.b - b.b);
    let heir = kids[0] || null, how = 'enfant';
    if (!heir && old.sp) { heir = this.get(old.sp); how = 'conjoint'; }
    if (!heir) {
      const adults = s.people.filter(p => this.age(p) >= 18 && !p.aw).sort((a, b) => a.b - b.b);
      heir = adults[0] || s.people[0] || null; how = 'élu';
    }
    const msgDeath = `${this.lordTitleOf(old)} ${this.fullName(old)} est ${old.s ? 'morte' : 'mort'} ${CAUSES[cause] || ''}.`;
    if (!heir) { s.lordId = 0; this.chron(msgDeath + ' La ville n\'a plus de seigneur…', true); return; }
    s.lordId = heir.i;
    this.g.app.peam?.unlock('succession');
    heir.w = 0; heir.m = heir.m && heir.aw ? heir.m : 0;
    const manor = this.g.manoir;
    if (manor && heir.h !== manor.id) this.moveFamily(heir, manor.id);
    this.log(heir, 'sei', s.name);
    const young = this.age(heir) < 16;
    const who = how === 'enfant' ? `${heir.s ? 'Sa fille' : 'Son fils'} ${this.fullName(heir)}` : how === 'conjoint' ? `${heir.s ? 'Son épouse' : 'Son époux'} ${this.fullName(heir)}` : `Les habitants ont choisi ${this.fullName(heir)}`;
    const reg = young && heir.mo && this.get(heir.mo) ? ` sous la régence de sa mère ${this.get(heir.mo).n}` : young && heir.fa && this.get(heir.fa) ? ` sous la régence de son père ${this.get(heir.fa).n}` : '';
    const txt = `${msgDeath} ${who} ${how === 'élu' ? 'comme nouveau seigneur' : 'lui succède'}${reg}.`;
    this.chron(txt, true);
    this.g.app.notify && this.g.app.notify('Succession', txt);
    this.jobDirty = true;
  }
  lordTitleOf(p) { return (p.s ? TITLES_F : TITLES_M)[Math.min(5, this.s.rank)]; }

  startEpidemic(sev = 0.6 + this.rnd() * 0.5) {
    this.s.epi = { until: this.t + 90 + this.rnd() * 60, sev };
    this.chron(`La peste frappe ${this.s.name} ! Un apothicaire aiderait à soigner les malades.`, true);
  }

  // ---------- simulation (appelée à chaque pas de 0,5 s de jeu) ----------
  step(dt) {
    this.acc += dt;
    this.jobT += dt;
    if (this.jobDirty || this.jobT > 6) { this.jobT = 0; this.assignJobs(); }
    if (this.acc < 1) return;
    const DT = this.acc; this.acc = 0;
    const g = this.g, s = this.s, t = this.t, r = this.rnd;
    const yr = DT / YEAR;
    const apo = Math.min(2, g.count('apothicaire')), mona = g.count('monastere') ? 1 : 0, wells = Math.min(1, g.count('puits'));
    const health = (1 - 0.18 * apo) * (mona ? 0.9 : 1) * (wells ? 0.95 : 1.05);
    const starving = s.res.food <= 0.5;
    const unhappy = g.happy < 30 ? 1.3 : 1;
    const epi = s.epi && s.epi.until > t ? s.epi : null;
    if (s.epi && !epi) { this.chron(`L'épidémie est terminée à ${s.name}.`); s.epi = null; if (s.people.length) this.g.app.peam?.unlock('survivant-peste'); }
    const people = s.people.slice();
    for (const p of people) {
      if (!this.byId.has(p.i)) continue;
      const a = (t - p.b) / YEAR;
      if (p.aw) continue; // en campagne : géré par la guerre
      // maladie (épidémie)
      if (p.sick) {
        if (t >= p.sick) { p.sick = 0; this.log(p, 'gue'); }
        else {
          const af = a < 5 || a > 60 ? 2 : 1;
          const d = 0.16 * (epi ? epi.sev : 0.5) * af * (1 - 0.25 * apo) * DT / 45;
          if (r() < d) { this.kill(p, 'epidemie'); continue; }
        }
      } else if (epi && r() < 0.9 * yr * epi.sev * (1 - 0.2 * apo)) { p.sick = t + 30 + r() * 30; this.log(p, 'mal'); }
      // mortalité naturelle
      let m = baseMortality(a) * health * unhappy;
      if (p.t === T_ROBUSTE) m *= 0.75; else if (p.t === T_FRAGILE) m *= 1.3;
      if (r() < m * yr) {
        const b = g.byId.get(p.w);
        const danger = b ? DANGEROUS[b.type] || 0 : 0;
        const cause = a < 5 ? 'enfance' : a >= 60 ? (r() < 0.8 ? 'vieillesse' : 'maladie') : (danger && r() < 0.35 * danger ? (b.type === 'pecheur' || b.type === 'port' || b.type === 'embarcadere' ? 'noyade' : 'accident') : 'maladie');
        this.kill(p, cause);
        continue;
      }
      if (starving && r() < (a < 10 || a > 60 ? 0.12 : 0.04) * yr * 3) { this.kill(p, 'famine'); continue; }
      // naissances
      if (p.s === 1 && p.sp && a >= 16 && a <= 42 && !p.sick) {
        const sp = this.get(p.sp);
        if (sp && !sp.aw) {
          const room = s.pop < g.cap ? 1 : s.pop < g.cap + 3 ? 0.15 : 0;
          const rate = 0.3 * room * (starving ? 0.2 : 1) * Math.max(0.4, Math.min(1.3, g.happy / 60)) * (p.k.length >= 6 ? 0.2 : 1);
          if (r() < rate * yr) this.birth(p, sp, apo);
        }
      }
      // mariages
      if (!p.sp && a >= 17 && a <= 45 && r() < 0.6 * yr) this.findSpouse(p);
    }
    // immigration (principale source de croissance : jeu facile)
    this.immigration(DT);
    // logement : les sans-abri cherchent un toit, ou partent
    this.housing(DT);
    // décès récents (cimetière)
    if (s.recentDeaths) while (s.recentDeaths.length && s.recentDeaths[0] < t - YEAR) s.recentDeaths.shift();
    s.pop = s.people.length;
  }

  birth(mother, father, apo) {
    const s = this.s, r = this.rnd;
    const fa = mother.sp ? this.get(mother.sp) : father;
    const c = this.newPerson({ s: r() < 0.5 ? 0 : 1, f: fa ? fa.f : mother.f, b: this.t, h: mother.h, fa: fa ? fa.i : 0, mo: mother.i, o: s.name });
    mother.k.push(c.i); if (fa) fa.k.push(c.i);
    this.log(c, 'nais', s.name);
    this.log(mother, 'enf', c.n); if (fa) this.log(fa, 'enf', c.n);
    s.births = (s.births || 0) + 1;
    if (this.isNobleId(mother.i) || mother.i === s.lordId || (fa && (fa.i === s.lordId))) this.chron(`Naissance de ${this.fullName(c)}, ${c.s ? 'fille' : 'fils'} de ${this.lordTitle()} ${this.fullName(this.lord)}.`, true);
    if (r() < 0.008 * (1 - 0.3 * apo)) this.kill(mother, 'couches');
  }

  findSpouse(p) {
    const r = this.rnd;
    const a = this.age(p);
    let best = null;
    for (let k = 0; k < 25; k++) {
      const q = this.s.people[Math.floor(r() * this.s.people.length)];
      if (!q || q === p || q.sp || q.s === p.s || q.aw || this.related(p, q)) continue;
      const aq = this.age(q);
      if (aq < 17 || aq > 50 || Math.abs(aq - a) > 14) continue;
      if (this.isNoble(q) !== this.isNoble(p) && r() < 0.8) continue;
      best = q; break;
    }
    if (!best) return;
    this.marry(p, best);
    // installation : dans la maison qui a le plus de place
    const h1 = p.h, h2 = best.h;
    if (h1 !== h2) {
      const man = p.s === 0 ? p : best, wom = p.s === 0 ? best : p;
      if (this.isNoble(man) || this.roomIn(man.h) >= 1) wom.h = man.h;
      else if (this.roomIn(wom.h) >= 1) man.h = wom.h;
      else { const nh = this.freeHome(2); if (nh) { man.h = nh; wom.h = nh; } }
      this.log(wom, 'dem', '');
    }
  }

  immigration(DT) {
    const g = this.g, s = this.s, r = this.rnd;
    if (s.res.food > 0.5 && g.happy > 25) g.growT += DT * (g.happy / 60);
    while (g.growT >= 3.2) {
      g.growT -= 3.2;
      const room = g.cap - s.pop;
      if (room <= 0) { g.growT = 0; break; }
      const n = 1 + (s.rank >= 3 ? 1 : 0) + (s.rank >= 5 ? 1 : 0);
      for (let i = 0; i < n && g.cap - s.pop > 0; i++) {
        const from = this.originName();
        const home = this.freeHome(1);
        if (!home) break;
        if (r() < 0.3 && this.roomIn(home) >= 2) this.immigrantFamily(home, from, r() > 0.15);
        else {
          const p = this.newPerson({ h: home, o: from, b: this.t - (16 + r() * 22) * YEAR });
          this.log(p, 'arr', from);
        }
      }
    }
  }
  originName() {
    const app = this.g.app;
    const r = this.rnd;
    if (app.bots && r() < 0.7) {
      try {
        const me = this.g.manoirLatLon();
        if (!this._near || this.t - this._nearT > 120) { this._near = app.bots.near(me.lat, me.lon, 120000, app.worldClock()).slice(0, 12); this._nearT = this.t; }
        if (this._near.length) return this._near[Math.floor(r() * this._near.length)].b.name;
      } catch { }
    }
    return pick(PLACES, r);
  }
  housing(DT) {
    const s = this.s;
    const occ = this.occupancy();
    // maisons démolies ou surpeuplées
    for (const p of s.people) {
      const b = this.g.byId.get(p.h);
      if (!b || !BUILDINGS[b.type].pop) p.h = 0;
    }
    for (const [id, n] of occ) {
      const b = this.g.byId.get(id);
      if (!b) continue;
      const cap = BUILDINGS[b.type].pop;
      if (n > cap) {
        let extra = n - cap;
        for (const p of s.people) { if (extra <= 0) break; if (p.h === id && !this.isNoble(p) && this.age(p) >= 16) { p.h = 0; extra--; } }
      }
    }
    const homeless = s.people.filter(p => !p.h && !p.aw);
    for (const p of homeless) {
      const h = this.freeHome(1);
      if (h) { p.h = h; p.homelessT = 0; continue; }
      p.homelessT = (p.homelessT || 0) + DT;
      if (p.homelessT > 40 && !this.isNoble(p) && p.i !== s.lordId) {
        this.log(p, 'part');
        this.kill(p, 'depart');
      }
    }
  }

  // ---------- statistiques ----------
  stats() {
    const s = this.s;
    let kids = 0, adults = 0, elders = 0, sick = 0, sumA = 0;
    for (const p of s.people) { const a = this.age(p); sumA += a; if (a < 14) kids++; else if (a < 60) adults++; else elders++; if (p.sick) sick++; }
    const dead = (s.dead || []).filter(d => d.c !== 'depart');
    const life = dead.length ? dead.reduce((a, d) => a + (d.d - d.b) / YEAR, 0) / dead.length : 0;
    return { kids, adults, elders, sick, avgAge: s.people.length ? sumA / s.people.length : 0, births: s.births || 0, deaths: (s.dead || []).filter(d => d.c !== 'depart').length, life };
  }
}

// ---------- habitants anonymes (villages IA, autres joueurs) : identité déterministe ----------
export function anonPerson(townSeed, idx, townName, T) {
  const r = mulberry32((townSeed ^ Math.imul(idx + 1, 2246822519)) >>> 0);
  const s = r() < 0.5 ? 0 : 1;
  const age = Math.floor(r() < 0.25 ? 5 + r() * 10 : 16 + r() * 50);
  const birth = T - age * YEAR - r() * YEAR;
  return {
    n: pick(s ? F_NAMES : M_NAMES, r), f: pick(FAMILIES, r), s, age, b: birth, t: Math.floor(r() * TRAITS.length), lk: Math.floor(r() * 4096),
    town: townName, kids: age > 22 ? Math.floor(r() * 4) : 0, married: age > 20 && r() < 0.7,
  };
}
export function lookOf(lk, s, ageYears) {
  return { hair: lk & 7, cloth: (lk >> 3) & 7, s, ac: ageYears < 14 ? 0 : ageYears >= 60 ? 2 : 1, skin: (lk >> 6) & 3 };
}
export { hash2 };
