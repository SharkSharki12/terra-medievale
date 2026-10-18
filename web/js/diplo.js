// Diplomatie avec les seigneurs IA : chaque seigneur a une opinion de toi (de -100 à +100) et t'écrit tout seul
// (alliances, mariages, commerce, tributs, menaces, déclarations de guerre, paix, cadeaux, appels à l'aide).
// Tu peux aussi agir : cadeaux, alliances, accords commerciaux, mariages, tributs, guerre ou paix.
// Entre eux, les seigneurs IA mènent leurs propres guerres et alliances (déterministes, voir bots.js).
import { RANKS, RES_NAMES } from './buildings.js';
import { TEMPER_NAMES } from './bots.js';
import { mulberry32 } from './noise.js';
import { YEAR, fromPlace } from './people.js';

const RANGE = 150000;      // m : seigneurs avec qui tu as des relations
const MAIL_LIFE = 300;     // s : délai pour répondre à une lettre
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtRes = (r) => Object.entries(r).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${RES_NAMES[k].toLowerCase()}`).join(', ');

export class Diplomacy {
  constructor(app) { this.app = app; this.tickT = 0; }
  get g() { return this.app.game; }
  get T() { return this.app.worldClock(); }
  get d() {
    const s = this.g.s;
    if (!s.diplo) s.diplo = { rel: {}, mail: [], nextMail: this.T + 200, newsT: this.T, seq: 1 };
    return s.diplo;
  }
  bot(id) { return this.app.bots && this.app.bots.byId.get(+id); }
  st(b) { return this.app.bots.state(b, this.T); }
  base(b) {
    const r = mulberry32((b.seed ^ 0x51ed27) >>> 0)();
    return (b.temper === 'paisible' ? 14 : b.temper === 'belliqueux' ? -16 : 0) + (r - 0.5) * 20;
  }
  rel(id) {
    const d = this.d;
    let r = d.rel[id];
    if (!r) {
      const b = this.bot(id);
      r = d.rel[id] = { v: Math.round(b ? this.base(b) : 0), st: 'paix', trade: 0, since: this.T, wed: 0 };
    }
    return r;
  }
  statusName(r) {
    if (r.st === 'guerre') return 'En guerre';
    if (r.st === 'alliance') return 'Allié';
    if (r.payer) return 'Te verse un tribut';
    if (r.trade) return 'Partenaire commercial';
    return r.v >= 35 ? 'Amical' : r.v <= -35 ? 'Hostile' : 'Neutre';
  }
  change(id, dv) { const r = this.rel(id); r.v = clamp(r.v + dv, -100, 100); return r; }
  title(b) { return this.app.bots.title(b, this.st(b).rank); }
  isVassal(st) { return st.vassal && st.vassal.pid === this.app.settings.pid; }
  myPower() { const g = this.g; let a = 0; for (const u in g.s.army) a += (g.s.army[u] || 0) * (u === 'chevalier' ? 3.5 : u === 'archer' ? 1.3 : 1); return a; }
  theirAttack(st) { const u = st.units; return (u.soldat || 0) + (u.archer || 0) * 1.3 + (u.chevalier || 0) * 3.5; }
  neighbors(max = 20) {
    if (!this.app.bots || !this.g) return [];
    const m = this.g.manoirLatLon();
    return this.app.bots.near(m.lat, m.lon, RANGE, this.T).slice(0, max);
  }
  // enfant noble à marier (fils ou fille du seigneur)
  marriageable() {
    const pp = this.g.pp;
    if (!pp || !pp.lord) return null;
    const kids = (pp.lord.k || []).map(i => pp.get(i)).filter(p => p && !p.sp && pp.age(p) >= 16 && pp.age(p) <= 32);
    return kids[0] || null;
  }

  // ---------- boucle (appelée par la guerre à chaque image) ----------
  update() {
    const g = this.g, app = this.app;
    if (!g || g.remote || !app.bots) return;
    const T = this.T;
    if (T < this.tickT) return;
    this.tickT = T + 20;
    const d = this.d;
    const near = this.neighbors(25);
    const ids = new Set(near.map(n => n.b.id));
    let gold = 0, food = 0, paid = 0, got = 0;
    for (const { b, st } of near) {
      const r = this.rel(b.id);
      // l'opinion revient lentement vers le caractère du seigneur
      r.v += (this.base(b) + (r.st === 'alliance' ? 25 : r.trade ? 10 : r.st === 'guerre' ? -40 : 0) - r.v) * 0.015;
      if (r.trade && r.st !== 'guerre') { gold += Math.sqrt(st.pop) * 0.35; food += Math.sqrt(st.pop) * 0.25; }
      if (r.trib && T < r.tribUntil) {
        if ((g.s.res.gold || 0) >= r.trib) { g.s.res.gold -= r.trib; paid += r.trib; }
        else { r.trib = 0; this.declareWarFrom(b, `Tu n'as pas payé le tribut promis. ${this.title(b)} te déclare la guerre !`); }
      } else if (r.trib) { r.trib = 0; this.app.ui.toast(`Tu as fini de payer le tribut à ${b.name}.`); }
      if (r.payer && T < r.payerUntil) got += r.payer; else if (r.payer) r.payer = 0;
    }
    if (gold || food) g.add({ gold: Math.round(gold), food: Math.round(food) });
    if (got) g.add({ gold: Math.round(got) });
    this.tradeIncome = { gold: Math.round(gold * 3), food: Math.round(food * 3) };
    // lettres expirées : refus par défaut
    for (const m of d.mail.slice()) if (T > m.until) this.answer(m.id, false, true);
    // nouvelles lettres
    if (T >= d.nextMail && near.length) {
      d.nextMail = T + 140 + Math.random() * 220;
      this.writeLetter(near);
    }
    // nouvelles des guerres entre seigneurs IA voisins
    const m = g.manoirLatLon();
    const wars = app.bots.warsBetween(m.lat, m.lon, 110000, d.newsT, T);
    d.newsT = T;
    for (const w of wars.slice(-3)) this.warNews(w, ids);
  }

  warNews(w, ids) {
    const a = this.bot(w.a), b = this.bot(w.d);
    if (!a || !b) return;
    const txt = w.win
      ? `⚔ ${this.app.bots.title(a, this.st(a).rank || 0)} ${fromPlace(a.name)} a vaincu ${b.name}${w.crushing ? ', qui devient son vassal' : ''}.`
      : `⚔ ${a.name} a attaqué ${b.name}, mais a été repoussé.`;
    const pp = this.g.pp;
    if (pp) pp.chron(txt);
    this.app.ui.toast(txt);
    // un allié attaqué demande de l'aide
    const r = this.d.rel[b.id];
    if (r && r.st === 'alliance' && !this.d.mail.some(x => x.bot === b.id)) this.addMail(b, 'aide', { foe: a.name, gold: 40 + Math.round(this.st(b).pop * 0.3) });
  }

  // ---------- lettres des seigneurs IA ----------
  writeLetter(near) {
    const g = this.g, d = this.d, T = this.T;
    const myDef = g.defensePower();
    const opts = [];
    for (const { b, st, d: dist } of near.slice(0, 15)) {
      if (this.isVassal(st) || d.mail.some(m => m.bot === b.id)) continue;
      const r = this.rel(b.id);
      const w = 1 / (1 + dist / 40000);
      if (r.st === 'guerre') { if (T - r.since > 900) opts.push([w * 3, b, 'paix']); continue; }
      if (r.v <= -50 && b.temper !== 'paisible') opts.push([w * 2.5, b, 'guerre']);
      if (b.temper !== 'paisible' && r.v < 15 && g.s.rank >= 1 && g.s.time > 1200 && this.theirAttack(st) > myDef * 1.25 && !r.trib) opts.push([w * (b.temper === 'belliqueux' ? 3 : 1), b, 'tribut']);
      if (r.st !== 'alliance' && r.v >= 35 && (b.temper !== 'belliqueux' || r.v >= 60)) opts.push([w * 2, b, 'alliance']);
      if (!r.trade && r.v >= 12) opts.push([w * 2, b, 'commerce']);
      if (!r.wed && r.v >= 30 && this.marriageable()) opts.push([w * 1.5, b, 'mariage']);
      if (r.v >= 25) opts.push([w * 0.8, b, 'cadeau']);
      if (r.v < -20 && r.v > -50 && b.temper === 'belliqueux') opts.push([w * 0.8, b, 'menace']);
    }
    if (!opts.length) return;
    let tot = opts.reduce((a, o) => a + o[0], 0), x = Math.random() * tot;
    for (const [w, b, kind] of opts) { x -= w; if (x <= 0) { this.makeLetter(b, kind); return; } }
  }
  makeLetter(b, kind) {
    const st = this.st(b);
    const extra = {};
    if (kind === 'tribut') { extra.gold = Math.round(4 + st.pop * 0.04); extra.dur = 600; }
    if (kind === 'cadeau') { const r = Math.random(); extra.res = r < 0.4 ? { gold: 30 + Math.round(st.pop * 0.3) } : r < 0.7 ? { food: 50 + Math.round(st.pop * 0.5) } : { wood: 40 + Math.round(st.pop * 0.4), stone: 20 + Math.round(st.pop * 0.2) }; }
    if (kind === 'mariage') { const k = this.marriageable(); if (!k) return; extra.kid = k.i; extra.dowry = 60 + Math.round(st.pop * 0.6); extra.spouse = k.s ? pickName(b, 0) : pickName(b, 1); }
    if (kind === 'guerre') { this.declareWarFrom(b, null); }
    if (kind === 'aide') { const o = this.app.bots.byId.get(b.nb && b.nb[0]); extra.foe = o ? o.name : 'Un seigneur voisin'; extra.gold = 40 + Math.round(st.pop * 0.3); }
    this.addMail(b, kind, extra);
  }
  addMail(b, kind, extra = {}) {
    const d = this.d, T = this.T;
    const m = { id: d.seq++, bot: b.id, kind, t: T, until: T + MAIL_LIFE, ...extra };
    d.mail.push(m);
    if (d.mail.length > 10) d.mail.shift();
    const who = `${this.title(b)} ${fromPlace(b.name)}`;
    this.app.ui.toast(`✉ Une lettre de ${who} : ${MAIL_TITLES[kind]}. Ouvre le panneau Guerre (G) pour répondre.`, kind === 'guerre' || kind === 'tribut' || kind === 'menace' ? 'bad' : 'big');
    this.app.notify('Une lettre est arrivée', `${who} : ${MAIL_TITLES[kind]}`);
    this.app.audio.play(kind === 'guerre' || kind === 'tribut' ? 'bad' : 'coin');
    if (this.app.war.open) this.app.war.render(true);
  }
  letterText(m) {
    const b = this.bot(m.bot);
    if (!b) return '';
    const g = this.g, pp = g.pp;
    const me = pp && pp.lord ? `${pp.lordTitle()} ${pp.lord.n}` : 'Seigneur';
    const sig = `— ${this.title(b)} ${fromPlace(b.name)}`;
    switch (m.kind) {
      case 'alliance': return `« ${me}, nos terres sont voisines et nos peuples s'apprécient. Unissons nos bannières : mes soldats défendront ${g.s.name} si on l'attaque. » ${sig}`;
      case 'commerce': return `« Mes marchands aimeraient vendre leurs étoffes à ${g.s.name} et acheter votre blé. Signons un accord commercial : nous y gagnerons tous les deux. » ${sig}`;
      case 'mariage': { const k = pp && pp.get(m.kid); return `« Ma famille propose d'unir ${k ? (k.s ? 'votre fille ' : 'votre fils ') + k.n : 'votre enfant'} à ${m.spouse.split('|')[0]} ${fromPlace(b.name)}. La dot sera de ${m.dowry} or, et nos maisons seront liées à jamais. » ${sig}`; }
      case 'tribut': return `« ${g.s.name} est bien mal défendue… Versez-moi ${m.gold} or toutes les 20 secondes pendant ${Math.round(m.dur / 60)} minutes, et mes hommes resteront chez eux. Sinon, gare ! » ${sig}`;
      case 'guerre': return `« ${me}, vos offenses ne resteront pas impunies. À partir de ce jour, ${b.name} est en guerre contre ${g.s.name} ! » ${sig}`;
      case 'paix': return `« Cette guerre a coûté trop de vies des deux côtés. Je vous propose la paix. » ${sig}`;
      case 'cadeau': return `« En signe d'amitié, acceptez ce présent : ${fmtRes(m.res)}. » ${sig}`;
      case 'menace': return `« J'ai entendu dire que vous convoitiez mes terres. Prenez garde, mes chevaliers sont prêts. » ${sig}`;
      case 'aide': return `« ${m.foe} nous attaque ! En vertu de notre alliance, envoyez-nous ${m.gold} or pour lever des troupes. » ${sig}`;
    }
    return sig;
  }
  // réponse du joueur (ou refus automatique à l'expiration)
  answer(id, yes, expired = false) {
    const d = this.d;
    const m = d.mail.find(x => x.id === id);
    if (!m) return;
    d.mail = d.mail.filter(x => x !== m);
    const b = this.bot(m.bot);
    if (!b) return;
    const g = this.g, app = this.app, T = this.T;
    const r = this.rel(b.id);
    const say = (t, cls = '') => { if (!expired || cls === 'bad') app.ui.toast(t, cls); if (g.pp) g.pp.chron(t); };
    switch (m.kind) {
      case 'alliance':
        if (yes) { r.st = 'alliance'; r.since = T; this.change(b.id, 12); say(`🤝 Alliance conclue avec ${b.name} !`, 'big'); }
        else this.change(b.id, -8);
        break;
      case 'commerce':
        if (yes) { r.trade = 1; this.change(b.id, 6); say(`Accord commercial signé avec ${b.name} : de l'or et de la nourriture arriveront régulièrement.`, 'big'); }
        else this.change(b.id, -3);
        break;
      case 'mariage':
        if (yes) this.wedding(b, m); else this.change(b.id, -10);
        break;
      case 'tribut':
        if (yes) { r.trib = Math.max(1, Math.round(m.gold)); r.tribUntil = T + m.dur; this.change(b.id, 6); say(`Tu acceptes de payer un tribut à ${b.name}.`); }
        else { this.declareWarFrom(b, `${this.title(b)} ${fromPlace(b.name)} n'a pas reçu son tribut : c'est la guerre !`); if (!expired) app.war.forceRaid(b); }
        break;
      case 'paix':
        if (yes) { r.st = 'paix'; r.since = T; r.v = Math.max(r.v, -15); this.change(b.id, 10); say(`🕊 La paix est signée avec ${b.name}.`, 'big'); }
        else this.change(b.id, -5);
        break;
      case 'cadeau':
        if (yes || expired) { g.add(m.res); if (yes) this.change(b.id, 4); if (yes) say(`Tu remercies ${b.name} pour son présent (${fmtRes(m.res)}).`); }
        break;
      case 'aide':
        if (yes) {
          if ((g.s.res.gold || 0) < m.gold) { app.ui.toast('Pas assez d\'or', 'bad'); d.mail.push(m); return; }
          g.s.res.gold -= m.gold; this.change(b.id, 15); say(`Tu envoies ${m.gold} or à ton allié ${b.name}.`);
        } else { this.change(b.id, -12); if (r.st === 'alliance' && r.v < 20) { r.st = 'paix'; say(`${b.name} rompt votre alliance : tu ne l'as pas aidé.`, 'bad'); } }
        break;
      case 'menace': case 'guerre': break;
    }
    if (app.war.open) app.war.render(true);
  }
  wedding(b, m) {
    const g = this.g, pp = g.pp;
    const k = pp && pp.get(m.kid);
    if (!k || k.sp) { this.app.ui.toast('Ce mariage n\'est plus possible', 'bad'); return; }
    const [n, f] = m.spouse.split('|');
    const sp = pp.newPerson({ s: 1 - k.s, n, f: fromPlace(b.name), b: pp.t - (17 + Math.random() * 9) * YEAR, h: k.h || g.manoir.id, o: b.name });
    pp.log(sp, 'nais', b.name, sp.b);
    pp.log(sp, 'arr', b.name);
    pp.marry(k, sp);
    sp.h = k.h || g.manoir.id;
    g.add({ gold: m.dowry });
    const r = this.rel(b.id);
    r.wed = 1;
    this.change(b.id, 25);
    if (r.v >= 45 && r.st !== 'alliance') { r.st = 'alliance'; r.since = this.T; }
    const txt = `💍 Mariage de ${pp.fullName(k)} et ${n} ${fromPlace(b.name)} ! Dot : ${m.dowry} or.${r.st === 'alliance' ? ' Vos maisons sont désormais alliées.' : ''}`;
    pp.chron(txt, true);
    this.app.audio.play('reward');
  }
  declareWarFrom(b, text) {
    const r = this.rel(b.id);
    if (r.st === 'guerre') return;
    r.st = 'guerre'; r.since = this.T; r.trade = 0;
    r.v = Math.min(r.v, -50);
    if (text) { this.app.ui.toast(text, 'bad'); if (this.g.pp) this.g.pp.chron(text); this.app.notify('Déclaration de guerre', text); }
  }

  // ---------- actions du joueur ----------
  // le joueur attaque un village : la guerre est déclarée (et les voisins s'en souviennent)
  onPlayerAttack(id) {
    const b = this.bot(id);
    if (!b) return;
    const r = this.rel(id);
    if (r.st !== 'guerre') {
      const ally = r.st === 'alliance';
      r.st = 'guerre'; r.since = this.T; r.trade = 0;
      for (const { b: o } of this.neighbors(25)) {
        if (o.id === id) continue;
        this.change(o.id, this.app.bots.allied(o, b) ? -20 : ally ? -12 : -4);
      }
    }
    this.change(id, -30);
  }
  act(id, what) {
    const b = this.bot(id);
    const g = this.g, app = this.app;
    if (!b || !g) return;
    const st = this.st(b), r = this.rel(id), T = this.T;
    const lord = this.title(b);
    const reply = (yes, txt) => { app.ui.toast(txt, yes ? 'big' : 'bad'); app.audio.play(yes ? 'reward' : 'error'); if (g.pp) g.pp.chron(txt); };
    const pay = (cost) => { for (const k in cost) if ((g.s.res[k] || 0) < cost[k]) { app.ui.toast('Pas assez de ressources', 'bad'); return false; } for (const k in cost) g.s.res[k] -= cost[k]; return true; };
    r.gifts = (r.gifts || []).filter(t => T - t < 600);
    const damp = Math.pow(0.7, r.gifts.length);
    switch (what) {
      case 'gift50': if (!pay({ gold: 50 })) return; r.gifts.push(T); this.change(id, 7 * damp); reply(true, `${lord} accepte ton présent de 50 or.`); break;
      case 'gift200': if (!pay({ gold: 200 })) return; r.gifts.push(T); this.change(id, 22 * damp); reply(true, `${lord} est ravi${b.female ? 'e' : ''} de ton présent de 200 or !`); break;
      case 'giftfood': if (!pay({ food: 120 })) return; r.gifts.push(T); this.change(id, 9 * damp); reply(true, `${b.name} reçoit tes 120 vivres avec gratitude.`); break;
      case 'alliance': {
        const need = b.temper === 'paisible' ? 30 : b.temper === 'neutre' ? 40 : 60;
        if (r.st === 'guerre') return reply(false, `${lord} refuse : vous êtes en guerre !`);
        if (r.v >= need) { r.st = 'alliance'; r.since = T; this.change(id, 10); reply(true, `🤝 ${lord} accepte l'alliance avec ${g.s.name} !`); }
        else { this.change(id, -2); reply(false, `${lord} refuse ton alliance (opinion ${Math.round(r.v)} / ${need} requis). Offre-lui des présents.`); }
        break;
      }
      case 'trade':
        if (r.st === 'guerre') return reply(false, `${lord} refuse : vous êtes en guerre !`);
        if (r.v >= 8) { r.trade = 1; this.change(id, 5); reply(true, `${b.name} signe un accord commercial avec ${g.s.name}.`); }
        else { this.change(id, -1); reply(false, `${lord} ne te fait pas encore confiance (opinion ${Math.round(r.v)} / 8 requis).`); }
        break;
      case 'marry': {
        const k = this.marriageable();
        if (!k) return reply(false, 'Aucun enfant de ta famille n\'est en âge de se marier (16 à 32 ans).');
        if (r.st === 'guerre') return reply(false, `${lord} refuse : vous êtes en guerre !`);
        if (r.v >= 25) this.wedding(b, { kid: k.i, dowry: 40 + Math.round(st.pop * 0.4), spouse: k.s ? pickName(b, 0) : pickName(b, 1) });
        else { this.change(id, -3); reply(false, `${lord} refuse ce mariage (opinion ${Math.round(r.v)} / 25 requis).`); }
        break;
      }
      case 'tribute': {
        const ratio = this.myPower() / Math.max(1, st.def);
        if (ratio > 1.5 && !this.isVassal(st)) { r.payer = Math.max(1, Math.round(st.pop * 0.05)); r.payerUntil = T + 1200; this.change(id, -25); reply(true, `${lord} cède : ${b.name} te versera ${r.payer} or toutes les 20 secondes pendant 20 minutes.`); }
        else { this.change(id, -15); reply(false, `${lord} rit de ta demande : ton armée ne l'impressionne pas.`); if (b.temper === 'belliqueux' && r.v < -40) this.declareWarFrom(b, `${lord} ${fromPlace(b.name)}, insulté${b.female ? 'e' : ''}, te déclare la guerre !`); }
        break;
      }
      case 'peace': {
        const tired = T - r.since > 600;
        const weaker = this.theirAttack(st) < g.defensePower();
        if (r.v > -80 && (tired || weaker || Math.random() < 0.25)) { r.st = 'paix'; r.since = T; r.v = Math.max(r.v, -20); reply(true, `🕊 ${lord} accepte la paix.`); }
        else { this.change(id, -2); reply(false, `${lord} refuse la paix… pour l'instant.`); }
        break;
      }
      case 'war':
        this.onPlayerAttack(id);
        reply(false, `⚔ Tu déclares la guerre à ${b.name} !`);
        break;
      case 'break':
        if (r.st === 'alliance') { r.st = 'paix'; this.change(id, -25); reply(false, `Tu romps ton alliance avec ${b.name}.`); }
        break;
    }
    if (app.war.open) app.war.render(true);
  }

  // alliés qui viennent défendre ta ville
  alliesHelp() {
    let def = 0; const names = [];
    for (const { b, st, d } of this.neighbors(25)) {
      const r = this.d.rel[b.id];
      if (r && r.st === 'alliance' && d < 90000) { def += st.def * 0.3; names.push(b.name); }
    }
    return { def, names };
  }
  // multiplicateur de la probabilité de raid d'un seigneur IA
  raidFactor(b) {
    const r = this.d.rel[b.id];
    if (!r) return b.temper === 'paisible' ? 0 : 1;
    if (r.st === 'alliance' || r.trib || r.payer) return 0;
    if (r.st === 'guerre') return 3;
    if (b.temper === 'paisible') return 0;
    return r.v < -30 ? 2 : r.v > 30 ? 0.2 : r.trade ? 0.5 : 1;
  }

  // ---------- fenêtre de diplomatie ----------
  open(id) {
    const b = this.bot(id);
    if (!b || !this.g) return;
    const render = (box) => {
      const st = this.st(b), r = this.rel(id), g = this.g;
      const pct = (r.v + 100) / 2;
      const m = g.manoirLatLon();
      const km = Math.round(Math.hypot(b.lat - m.lat, (b.lon - m.lon) * Math.cos(m.lat * Math.PI / 180)) * 111);
      const kid = this.marriageable();
      const btn = (a, t, cls = '') => `<button class="btn small ${cls}" data-a="${a}">${t}</button>`;
      let h = `<h2>🕊 ${esc(b.name)}</h2><p><b style="color:${esc(b.color)}">${esc(this.title(b))}</b> · ${RANKS[st.rank].name} · ${st.pop} habitants · ${TEMPER_NAMES[b.temper]} · ~${km} km</p>`;
      h += `<div class="relbar"><div style="width:${pct}%;background:${r.v >= 0 ? '#4caf50' : '#c0392b'}"></div></div><p>Opinion de toi : <b>${Math.round(r.v)}</b> · ${this.statusName(r)}${r.wed ? ' · liés par un mariage' : ''}</p>`;
      if (st.overlord) h += `<p class="hint">Vassal de ${esc(st.overlord.name)}.</p>`;
      if (st.lastWar && this.T - st.lastWar.t < 1800) { const w = st.lastWar, o = this.bot(w.a === b.id ? w.d : w.a); h += `<p class="hint">Récemment : ${w.a === b.id ? 'a attaqué' : 'attaqué par'} ${esc(o ? o.name : '?')} (${(w.a === b.id) === w.win ? 'victoire' : 'défaite'}).</p>`; }
      h += `<div class="diplo-btns">${btn('gift50', 'Offrir 50 or')}${btn('gift200', 'Offrir 200 or')}${btn('giftfood', 'Offrir 120 vivres')}`;
      if (r.st === 'guerre') h += btn('peace', 'Proposer la paix', 'green');
      else {
        if (r.st !== 'alliance') h += btn('alliance', 'Proposer une alliance', 'green'); else h += btn('break', 'Rompre l\'alliance');
        if (!r.trade) h += btn('trade', 'Accord commercial');
        if (kid) h += btn('marry', `Marier ${esc(kid.n)}`);
        h += btn('tribute', 'Exiger un tribut') + btn('war', 'Déclarer la guerre', 'red');
      }
      h += '</div>';
      box.querySelector('.dip').innerHTML = h;
    };
    this.app.ui.modal('<div class="dip"></div>', [{ text: 'Fermer' }, { text: '⚔ Attaquer', cls: 'red', fn: () => this.app.war.openAttack('bot', id) }], (box) => {
      render(box);
      box.querySelector('.dip').addEventListener('click', (e) => {
        const bt = e.target.closest('[data-a]');
        if (!bt) return;
        this.app.audio.play('click');
        this.act(id, bt.dataset.a);
        render(box);
      });
    });
  }
}

export const MAIL_TITLES = {
  alliance: 'proposition d\'alliance', commerce: 'proposition d\'accord commercial', mariage: 'proposition de mariage', tribut: 'exigence de tribut',
  guerre: 'déclaration de guerre', paix: 'proposition de paix', cadeau: 'un présent', menace: 'une menace', aide: 'appel à l\'aide',
};
const NAMES_M = ['Aymeric', 'Bertrand', 'Foulques', 'Gauthier', 'Hugues', 'Renaud', 'Thibaut', 'Enguerrand', 'Amaury', 'Godefroy'];
const NAMES_F = ['Aliénor', 'Blanche', 'Constance', 'Isabeau', 'Mahaut', 'Mathilde', 'Sibylle', 'Yolande', 'Béatrice', 'Héloïse'];
function pickName(b, female) { const r = mulberry32((b.seed ^ (female ? 0xf00d : 0xbeef)) >>> 0)(); return (female ? NAMES_F : NAMES_M)[Math.floor(r * 10)] + '|' + fromPlace(b.name); }
