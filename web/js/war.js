// Guerre : troupes, attaques (villages IA et joueurs), raids des seigneurs belliqueux, vassaux, rapports
import { UNITS, UNIT_TYPES } from './game.js';
import { RES, RES_NAMES, RANKS, BUILDINGS, resIconURL } from './buildings.js';
import { haversine, latLonToTile } from './geo.js';
import { TEMPER_NAMES } from './bots.js';
import { cityCenter } from './mp.js';
import { MAIL_TITLES } from './diplo.js';
import { fromPlace } from './people.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PROTECT_TIME = 1200; // secondes de jeu avant les premiers raids des IA

export function attackPower(units) { let a = 0; for (const u of UNIT_TYPES) a += (units[u] || 0) * UNITS[u].atk; return a; }
export function carry(units) { let c = 0; for (const u of UNIT_TYPES) c += (units[u] || 0) * UNITS[u].carry; return c; }
export function countUnits(units) { let n = 0; for (const u of UNIT_TYPES) n += units[u] || 0; return n; }
function scaleUnits(units, keepRatio) { const o = {}; for (const u of UNIT_TYPES) o[u] = Math.max(0, Math.round((units[u] || 0) * keepRatio)); return o; }
export function battle(A, D, rnd = Math.random) {
  const a = A * (0.85 + rnd() * 0.3), d = Math.max(1, D) * (0.85 + rnd() * 0.3);
  const win = a > d;
  return {
    win, ratio: a / d, crushing: a > 2.5 * d,
    attLoss: win ? Math.min(0.9, 0.6 * Math.pow(d / a, 1.3)) : 0.85,
    defLoss: win ? 0.85 : Math.min(0.9, 0.5 * Math.pow(a / d, 1.2)),
  };
}
// butin pris dans un stock (au plus `part` de chaque ressource, limité par la capacité de transport)
export function takeLoot(stock, cap, part = 0.3) {
  const avail = {}; let tot = 0;
  for (const r of RES) { avail[r] = Math.floor((stock[r] || 0) * part); tot += avail[r]; }
  const k = tot > cap ? cap / tot : 1;
  const out = {};
  for (const r of RES) { const v = Math.floor(avail[r] * k); if (v > 0) out[r] = v; }
  return out;
}
export function fmtUnits(u) { return UNIT_TYPES.filter(t => u[t]).map(t => `${u[t]} ${UNITS[t].name.toLowerCase()}`).join(', ') || 'aucune troupe'; }
export function fmtRes(r) { return Object.entries(r || {}).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${RES_NAMES[k].toLowerCase()}`).join(', ') || 'rien'; }
function fmtTime(s) { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; }

export class War {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.tickT = 0;
    const el = $('#war');
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('input', (e) => e.stopPropagation());
  }
  get g() { return this.app.game; }
  get T() { return this.app.worldClock(); }
  get me() { return this.app.settings; }
  travel(km) { return Math.round(Math.min(600, 20 + km * 2)); }
  myLatLon() { return this.g.manoirLatLon(); }

  // ---------- cibles ----------
  target(kind, id) {
    const app = this.app, T = this.T;
    if (kind === 'bot') {
      const b = app.bots && app.bots.byId.get(+id);
      if (!b) return null;
      const st = app.bots.state(b, T);
      if (!st.founded) return null;
      return { kind, id: b.id, name: b.name, owner: app.bots.title(b, st.rank), lat: b.lat, lon: b.lon, rank: st.rank, pop: st.pop, army: st.army, def: st.def, temper: b.temper, vassal: st.vassal, color: st.vassal ? st.vassal.color : b.color, st, b };
    }
    const o = app.mp.others.get(id);
    if (!o || !o.city) return null;
    const c = cityCenter(o.city);
    return { kind, id, name: o.city.name, owner: o.name, lat: c.lat, lon: c.lon, rank: o.city.rank || 0, pop: o.city.pop || 0, army: o.city.army || 0, def: o.city.def || 0, color: o.color, online: o.online, rel: app.mp.relation(id) };
  }
  distKm(t) { const m = this.myLatLon(); return haversine(m.lat, m.lon, t.lat, t.lon) / 1000; }
  nearbyBots(maxKm = 300, n = 14) {
    const app = this.app;
    if (!app.bots || !this.g) return [];
    const m = this.myLatLon();
    return app.bots.near(m.lat, m.lon, maxKm * 1000, this.T).slice(0, n).map(({ b }) => this.target('bot', b.id)).filter(Boolean);
  }
  canAttack(t) {
    const g = this.g;
    if (!g) return 'Fonde d\'abord ta ville';
    if (t.kind === 'bot') {
      if (t.vassal && t.vassal.pid === this.me.pid) return 'Ce village est déjà ton vassal';
      return null;
    }
    if (!t.online) return `${t.owner} n'est pas connecté`;
    if (t.rel === 'alliance') return `${t.owner} est ton allié`;
    if (t.rel !== 'guerre') return `Tu dois d'abord déclarer la guerre à ${t.owner}`;
    if ((t.rank || 0) < 1) return `${t.name} est encore un hameau : protégé des attaques`;
    if (g.s.rank < 1) return 'Ta ville doit être au moins un village pour attaquer un joueur';
    return null;
  }

  // ---------- lancer une attaque ----------
  launch(t, units) {
    const g = this.g, s = g.s;
    const why = this.canAttack(t);
    if (why) { this.app.ui.toast(why, 'bad'); return false; }
    for (const u of UNIT_TYPES) units[u] = Math.max(0, Math.min(s.army[u] || 0, Math.floor(units[u] || 0)));
    if (!countUnits(units)) { this.app.ui.toast('Choisis des troupes à envoyer', 'bad'); return false; }
    for (const u of UNIT_TYPES) s.army[u] -= units[u];
    const km = this.distKm(t), dur = this.travel(km), T = this.T;
    const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const from = this.myLatLon();
    const a = { id, kind: t.kind, tid: t.id, tname: t.name, towner: t.owner, units, dep: T, arr: T + dur, phase: 'go', from, to: { lat: t.lat, lon: t.lon } };
    s.armies.push(a);
    if (g.pp) g.pp.sendArmy(id, units);
    if (t.kind === 'bot' && this.app.diplo) this.app.diplo.onPlayerAttack(t.id);
    g.dirty = true;
    if (t.kind === 'player') {
      const o = this.app.mp.others.get(t.id);
      this.app.mp.net.send('attack', { aid: id, units, dur, city: s.name, lord: this.me.name, color: this.me.color, from }, o && o.peer);
    }
    this.app.ui.toast(`Ton armée (${fmtUnits(units)}) marche sur ${t.name} : arrivée dans ${fmtTime(dur)}`);
    this.app.audio.play('build');
    if (this.app.mp.active) this.app.mp.system(`Ton armée marche sur ${t.name}.`);
    this.render(true);
    return true;
  }

  report(text, win, notify = true) {
    const s = this.g.s;
    s.reports.unshift({ t: Date.now(), text, win });
    s.reports.length = Math.min(s.reports.length, 15);
    this.app.ui.toast(text, win ? 'big' : 'bad');
    if (this.app.mp.active) this.app.mp.system(text);
    if (notify) this.app.notify(win ? 'Victoire !' : 'Mauvaise nouvelle', text);
    this.app.audio.play(win ? 'reward' : 'bad');
  }

  botEvent(e) {
    e.id = e.id || ('e' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36));
    if (this.app.bots && this.app.bots.addEvent(e)) {
      this.app.worldEvents().push(e);
      if (this.app.mp.active) this.app.mp.net.send('botev', { events: [e] });
    }
  }

  // ---------- boucle ----------
  update() {
    const g = this.g;
    if (!g || g.remote) return;
    const s = g.s, T = this.T;
    for (const a of s.armies.slice()) {
      if (a.phase === 'go' && T >= a.arr) {
        if (a.kind === 'bot') this.resolveBot(a);
        else { a.phase = 'fight'; a.fightT = T; }
      } else if (a.phase === 'fight' && T - a.fightT > 90) {
        this.goBack(a, null);
        this.report(`Ton armée n'a trouvé personne à combattre à ${a.tname} et rentre.`, false, false);
      } else if (a.phase === 'back' && T >= a.arr) {
        for (const u of UNIT_TYPES) s.army[u] = (s.army[u] || 0) + (a.units[u] || 0);
        if (g.pp) g.pp.returnArmy(a.id, a.units, a.tname);
        g.add(a.loot || {});
        s.armies = s.armies.filter(x => x !== a);
        g.dirty = true;
        this.app.ui.toast(`Ton armée est rentrée (${fmtUnits(a.units)})${a.loot && Object.keys(a.loot).length ? ' avec ' + fmtRes(a.loot) : ''}.`);
        this.app.audio.play('coin');
      }
    }
    for (const inc of s.incoming.slice()) if (T >= inc.arr) this.resolveIncoming(inc);
    // raids des seigneurs IA, tributs des vassaux
    if (T >= (s.nextRaidCheck || 0)) { s.nextRaidCheck = T + 45; this.maybeBotRaid(); }
    if (T >= (s.nextTribute || 0)) { s.nextTribute = T + 60; this.tribute(); }
    if (this.app.diplo) this.app.diplo.update();
    if (this.open && performance.now() - this.tickT > 1000) { this.tickT = performance.now(); this.render(); }
  }

  goBack(a, loot) {
    a.phase = 'back'; a.loot = loot || {};
    const dur = a.arr - a.dep;
    a.dep = this.T; a.arr = this.T + dur;
    [a.from, a.to] = [a.to, a.from];
    if (!countUnits(a.units)) { this.g.s.armies = this.g.s.armies.filter(x => x !== a); if (this.g.pp) this.g.pp.returnArmy(a.id, a.units, a.tname); }
    this.g.dirty = true;
  }

  resolveBot(a) {
    const t = this.target('bot', a.tid);
    if (!t) { this.goBack(a, null); return; }
    let D = t.def;
    // les alliés du village viennent le défendre
    if (this.app.bots) for (const id of t.b.nb || []) { const o = this.app.bots.byId.get(id); if (o && this.app.bots.allied(o, t.b)) { const so = this.app.bots.state(o, this.T); if (so.founded) D += so.def * 0.15; } }
    const A = attackPower(a.units), res = battle(A, D);
    const before = { ...a.units };
    a.units = scaleUnits(a.units, 1 - res.attLoss);
    if (this.g.pp) this.g.pp.armyLosses(a.id, before, a.units, t.name);
    const T = this.T;
    if (res.win) {
      const loot = takeLoot(t.st.res, carry(a.units), 0.3);
      this.botEvent({ bot: t.id, t: T, type: 'raid', setback: Math.round(180 + 600 * Math.min(1, res.ratio - 1)), loss: Math.round(t.army * 0.85) });
      let extra = '';
      if (res.crushing && !(t.vassal && t.vassal.pid === this.me.pid)) {
        this.botEvent({ bot: t.id, t: T + 0.001, type: 'vassal', pid: this.me.pid, name: this.g.s.name, color: this.me.color });
        extra = ` ${t.name} devient ton vassal et te versera un tribut !`;
      }
      this.g.s.glory += 10 + t.rank * 10;
      this.goBack(a, loot);
      this.report(`Victoire à ${t.name} ! Butin : ${fmtRes(loot)}.${extra}`, true);
    } else {
      this.botEvent({ bot: t.id, t: T, type: 'raid', setback: 0, loss: Math.round(t.army * res.defLoss) });
      this.goBack(a, null);
      this.report(`Défaite à ${t.name}. Les survivants rentrent (${fmtUnits(a.units)}).`, false);
    }
  }

  maybeBotRaid() {
    const app = this.app, g = this.g, s = g.s, T = this.T;
    if (!app.bots || s.rank < 1 || s.time < PROTECT_TIME) return;
    if (T < (s.raidCooldown || 0) || s.incoming.some(i => i.kind === 'bot')) return;
    const m = this.myLatLon();
    const dip = app.diplo;
    const cand = app.bots.near(m.lat, m.lon, 60000, T).filter(({ b, st, d }) => st.army >= 6 && !(st.vassal && st.vassal.pid === this.me.pid) && (d < 40000 || (dip && dip.rel(b.id).st === 'guerre')));
    for (const { b, st, d } of cand) {
      const f = dip ? dip.raidFactor(b) : (b.temper === 'paisible' ? 0 : 1);
      const p = (b.temper === 'belliqueux' ? 0.07 : b.temper === 'neutre' ? 0.018 : 0.03) * f;
      if (Math.random() > p) continue;
      const k = 0.4 + Math.random() * 0.4;
      const units = scaleUnits(st.units, k);
      if (countUnits(units) < 3) continue;
      const dur = Math.max(70, this.travel(d / 1000));
      const inc = { id: 'r' + Date.now().toString(36), kind: 'bot', fid: b.id, fname: b.name, flord: app.bots.title(b, st.rank), units, arr: T + dur, from: { lat: b.lat, lon: b.lon }, to: m, color: b.color, dep: T };
      s.incoming.push(inc);
      s.raidCooldown = T + 480 + Math.random() * 300;
      const msg = `⚔ ${inc.flord} ${fromPlace(b.name)} attaque ${s.name} avec ${fmtUnits(units)} ! Arrivée dans ${fmtTime(dur)}. Entraîne des troupes, construis des tours et des remparts !`;
      app.ui.toast(msg, 'bad');
      app.notify('Ta ville est attaquée !', `${b.name} envoie une armée contre ${s.name}. Arrivée dans ${fmtTime(dur)}.`);
      app.audio.play('bad');
      if (app.mp.active) app.mp.system(msg);
      return;
    }
  }

  // raid immédiat d'un seigneur IA (refus de tribut, guerre déclarée)
  forceRaid(b) {
    const app = this.app, g = this.g, s = g.s, T = this.T;
    if (!app.bots || s.incoming.some(i => i.kind === 'bot' && i.fid === b.id)) return;
    const st = app.bots.state(b, T);
    if (!st.founded) return;
    const units = scaleUnits(st.units, 0.6);
    if (countUnits(units) < 2) return;
    const m = this.myLatLon();
    const d = haversine(m.lat, m.lon, b.lat, b.lon);
    const dur = Math.max(70, this.travel(d / 1000));
    s.incoming.push({ id: 'r' + Date.now().toString(36), kind: 'bot', fid: b.id, fname: b.name, flord: app.bots.title(b, st.rank), units, arr: T + dur, from: { lat: b.lat, lon: b.lon }, to: m, color: b.color, dep: T });
    app.ui.toast(`⚔ L'armée ${fromPlace(b.name)} (${fmtUnits(units)}) marche sur ${s.name} ! Arrivée dans ${fmtTime(dur)}.`, 'bad');
  }

  resolveIncoming(inc) {
    const g = this.g, s = g.s, T = this.T;
    s.incoming = s.incoming.filter(x => x !== inc);
    let D = g.defensePower();
    const help = this.app.diplo && inc.kind === 'bot' ? this.app.diplo.alliesHelp() : { def: 0, names: [] };
    if (this.app.mp.active) {
      const m = this.myLatLon();
      for (const o of this.app.mp.allies()) {
        if (o.pid === inc.fid) continue;
        const c = cityCenter(o.city);
        if (c && haversine(m.lat, m.lon, c.lat, c.lon) < 400000) { help.def += (o.city.def || 0) * 0.35; help.names.push(o.name); }
      }
    }
    D += help.def;
    if (help.names.length) this.app.ui.toast(`🤝 Tes alliés (${help.names.slice(0, 3).join(', ')}) viennent défendre ${s.name} !`, 'big');
    const A = attackPower(inc.units);
    const res = battle(A, D);
    const myBefore = { ...s.army };
    for (const u of UNIT_TYPES) s.army[u] = Math.max(0, Math.round((s.army[u] || 0) * (1 - res.defLoss)));
    const lost = {}; for (const u of UNIT_TYPES) lost[u] = myBefore[u] - s.army[u];
    if (g.pp) {
      g.pp.homeLosses(lost, s.name);
      // une ville pillée perd aussi quelques villageois
      if (res.win) {
        const civ = s.people.filter(p => !p.m && p.i !== s.lordId && g.pp.age(p) >= 14);
        const n = Math.min(civ.length, 1 + Math.floor(Math.random() * 3));
        for (let i = 0; i < n; i++) { const p = civ.splice(Math.floor(Math.random() * civ.length), 1)[0]; g.pp.kill(p, 'combat', s.name); }
      }
    }
    const surv = scaleUnits(inc.units, 1 - res.attLoss);
    let loot = {};
    if (res.win) {
      loot = takeLoot(s.res, carry(surv), 0.2);
      for (const r in loot) s.res[r] = Math.max(0, s.res[r] - loot[r]);
    }
    g.dirty = true;
    if (inc.kind === 'bot') {
      const dead = countUnits(inc.units) - countUnits(surv);
      this.botEvent({ bot: inc.fid, t: T, type: 'raid', setback: res.win ? 0 : 150, loss: dead });
      if (res.win) this.report(`${inc.fname} a pillé ${s.name} : -${fmtRes(loot)}. Pertes : ${fmtUnits(lost)}.`, false);
      else {
        const gold = 20 + countUnits(inc.units) * 2;
        g.add({ gold }); s.glory += 5;
        this.report(`Ta ville a repoussé l'attaque de ${inc.fname} ! +${gold} or. Pertes : ${fmtUnits(lost)}.`, true);
      }
    } else {
      const o = this.app.mp.others.get(inc.fid);
      this.app.mp.net.send('battle', { aid: inc.id, win: res.win, attLoss: res.attLoss, loot, city: s.name }, o && o.peer);
      if (res.win) this.report(`${inc.fname} (${inc.flord}) a pillé ${s.name} : -${fmtRes(loot)}. Pertes : ${fmtUnits(lost)}.`, false);
      else { s.glory += 10; this.report(`Ta ville a repoussé l'armée de ${inc.flord} !`, true); }
    }
  }

  tribute() {
    const app = this.app;
    if (!app.bots) return;
    let gold = 0, food = 0, n = 0;
    for (const b of app.bots.bots) {
      const st = app.bots.state(b, this.T);
      if (st.founded && st.vassal && st.vassal.pid === this.me.pid) { gold += st.pop * 0.12; food += st.pop * 0.15; n++; }
    }
    if (n) { this.g.add({ gold: Math.round(gold), food: Math.round(food) }); this.vassalCount = n; } else this.vassalCount = 0;
  }
  vassals() {
    const app = this.app, out = [];
    if (!app.bots) return out;
    for (const b of app.bots.bots) {
      const st = app.bots.state(b, this.T);
      if (st.founded && st.vassal && st.vassal.pid === this.me.pid) out.push({ b, st });
    }
    return out;
  }

  // ---------- messages multijoueur ----------
  onAttack(pid, d, o) {
    const g = this.g;
    if (!g || !d || !d.aid) return;
    if (this.app.mp.relation(pid) !== 'guerre') return;
    const units = {}; for (const u of UNIT_TYPES) units[u] = Math.max(0, Math.min(100000, Math.floor(+d.units?.[u] || 0)));
    const dur = Math.max(20, Math.min(900, +d.dur || 60));
    const T = this.T;
    g.s.incoming.push({ id: d.aid, kind: 'player', fid: pid, fname: String(d.city || '?').slice(0, 30), flord: String(d.lord || o.name).slice(0, 24), units, arr: T + dur, dep: T, from: d.from, to: g.manoirLatLon(), color: d.color || o.color });
    const msg = `⚔ ${o.name} attaque ${g.s.name} avec ${fmtUnits(units)} ! Arrivée dans ${fmtTime(dur)}.`;
    this.app.ui.toast(msg, 'bad');
    this.app.notify('Ta ville est attaquée !', msg);
    this.app.audio.play('bad');
    this.app.mp.system(msg);
  }
  onBattle(pid, d) {
    const g = this.g;
    if (!g || !d) return;
    const a = g.s.armies.find(x => x.id === d.aid && x.kind === 'player');
    if (!a || a.phase === 'back') return;
    const before = { ...a.units };
    a.units = scaleUnits(a.units, 1 - Math.max(0, Math.min(0.95, +d.attLoss || 0)));
    if (g.pp) g.pp.armyLosses(a.id, before, a.units, a.tname);
    const loot = {}; for (const r of RES) { const v = Math.max(0, Math.min(100000, Math.floor(+d.loot?.[r] || 0))); if (v) loot[r] = v; }
    if (a.phase === 'go') a.arr = this.T;
    this.goBack(a, d.win ? loot : null);
    if (d.win) { g.s.glory += 15; this.report(`Victoire contre ${a.tname} ! Butin : ${fmtRes(loot)}.`, true); }
    else this.report(`Ton armée a été repoussée à ${a.tname}. Survivants : ${fmtUnits(a.units)}.`, false);
  }

  // ---------- dessin des armées sur la carte ----------
  movers() {
    const g = this.g, out = [];
    if (!g) return out;
    const T = this.T;
    for (const a of g.s.armies) if (a.phase !== 'fight' && a.from && a.to) out.push({ from: a.from, to: a.to, f: Math.min(1, Math.max(0, (T - a.dep) / Math.max(1, a.arr - a.dep))), n: countUnits(a.units), color: this.me.color, label: a.phase === 'back' ? 'Retour' : a.tname, mine: true });
    for (const i of g.s.incoming) if (i.from && i.to) out.push({ from: i.from, to: i.to, f: Math.min(1, Math.max(0, (T - (i.dep ?? T)) / Math.max(1, i.arr - (i.dep ?? T)))), n: countUnits(i.units), color: i.color || '#900', label: i.fname, mine: false });
    return out;
  }
  draw(ctx, map) {
    const region = this.app.region;
    if (!region) return;
    const d = map.dpr, z = map.z;
    for (const m of this.movers()) {
      const a = latLonToTile(region, m.from.lat, m.from.lon), b = latLonToTile(region, m.to.lat, m.to.lon);
      const tx = a.tx + (b.tx - a.tx) * m.f, ty = a.ty + (b.ty - a.ty) * m.f;
      const [x, y] = map.toScreen(tx, ty);
      if (x < -80 || y < -80 || x > map.W + 80 || y > map.H + 80) continue;
      const dir = b.tx >= a.tx ? 1 : -1;
      const k = Math.max(1.5 * d, Math.min(z / 16, 3 * d) * 1.2);
      const n = Math.min(7, 2 + Math.floor(Math.log2(1 + m.n)));
      ctx.save();
      for (let i = 0; i < n; i++) {
        const ox = ((i % 3) - 1) * 6 * k - dir * Math.floor(i / 3) * 5 * k, oy = Math.floor(i / 3) * 3 * k + (i % 2) * 2 * k;
        const px = Math.round(x + ox), py = Math.round(y + oy);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px - 2 * k, py + 7 * k, 5 * k, 1.5 * k);
        ctx.fillStyle = '#e8b890'; ctx.fillRect(px, py, 3 * k, 2.5 * k);
        ctx.fillStyle = '#9aa0ac'; ctx.fillRect(px - 0.5 * k, py - 1 * k, 4 * k, 1.5 * k);
        ctx.fillStyle = m.color; ctx.fillRect(px - 1 * k, py + 2.5 * k, 5 * k, 3 * k);
        ctx.fillStyle = '#3a2a1a'; ctx.fillRect(px, py + 5.5 * k, 1 * k, 2 * k); ctx.fillRect(px + 2 * k, py + 5.5 * k, 1 * k, 2 * k);
        ctx.fillStyle = '#7a5432'; ctx.fillRect(px + (dir > 0 ? 4 : -2) * k, py - 4 * k, 0.8 * k, 10 * k);
        ctx.fillStyle = '#d8d8e0'; ctx.fillRect(px + (dir > 0 ? 3.6 : -2.4) * k, py - 5.5 * k, 1.6 * k, 2 * k);
      }
      // bannière
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(Math.round(x - 1 * k), Math.round(y - 14 * k), Math.max(1, 0.8 * k), 13 * k);
      ctx.fillStyle = m.color; ctx.fillRect(Math.round(x), Math.round(y - 14 * k), 7 * k, 5 * k);
      ctx.font = `bold ${11 * d}px "Palatino Linotype", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(20,14,8,0.9)';
      const lbl = `⚔ ${m.n} · ${m.label}`;
      ctx.strokeText(lbl, x, y - 17 * k); ctx.fillStyle = m.mine ? '#f3d77a' : '#ff9a8a'; ctx.fillText(lbl, x, y - 17 * k);
      ctx.restore();
    }
  }
  globeMarkers() {
    return this.movers().map((m, i) => {
      const f = m.f;
      return { id: 'army' + i, kind: 'player', lat: m.from.lat + (m.to.lat - m.from.lat) * f, lon: m.from.lon + (m.to.lon - m.from.lon) * f, label: `⚔ ${m.n}`, color: m.color };
    });
  }

  // ---------- panneau Guerre ----------
  toggle(force) {
    this.open = force ?? !this.open;
    $('#war').classList.toggle('hidden', !this.open);
    if (this.open) this.render(true);
  }
  render(force = false) {
    const el = $('#war');
    if (!this.open) return;
    const g = this.g;
    if (!g) { el.innerHTML = '<div class="war-head"><b>Guerre</b><button class="btn tiny" data-act="close">✕</button></div><p>Fonde d\'abord ta ville.</p>'; return; }
    if (!force && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const s = g.s, T = this.T;
    const icon = (u) => `<img src="${resIconURL(u === 'soldat' ? 'army' : u === 'archer' ? 'army' : 'army', 16)}">`;
    let h = `<div class="war-head"><b>⚔ Guerre</b><button class="btn tiny" data-act="close">✕</button></div>`;
    h += `<div class="war-sec"><div class="war-row"><span>Défense de ${esc(s.name)}</span><b>${Math.round(g.defensePower())}</b></div>`;
    h += `<div class="war-row"><span>Troupes</span><b>${g.armyAtHome} / ${g.armyCap}</b></div><div class="war-units">`;
    for (const u of UNIT_TYPES) {
      const U = UNITS[u], can = g.canTrain(u);
      h += `<div class="wu ${can ? '' : 'off'}"><div><b>${U.name}</b> : ${s.army[u] || 0}<br><small>att ${U.atk} · déf ${U.def} · ${Object.entries(U.cost).map(([r, v]) => v + ' ' + RES_NAMES[r].toLowerCase()).join(', ')}</small></div>`;
      h += can ? `<div class="wu-btns">${[1, 5, 10].map(n => `<button class="btn tiny" data-train="${u}" data-n="${n}">+${n}</button>`).join('')}</div>` : `<small class="need">Construis : ${BUILDINGS[U.needs].name}</small>`;
      h += '</div>';
    }
    h += '</div>';
    if (g.pp) h += `<div class="war-row"><span>Habitants en âge de combattre</span><b>${g.pp.recruitable().length}</b></div>`;
    if (s.queue.length) h += `<div class="war-q">Entraînement : ${s.queue.map(q => `${q.n} ${UNITS[q.u].name.toLowerCase()}`).join(', ')}</div>`;
    h += '</div>';
    if (s.incoming.length) {
      h += `<div class="war-sec danger"><b>Menaces</b>`;
      for (const i of s.incoming) h += `<div class="war-row"><span>${esc(i.fname)} : ${fmtUnits(i.units)} (att. ${Math.round(attackPower(i.units))})</span><b>${fmtTime(i.arr - T)}</b></div>`;
      h += '</div>';
    }
    if (s.armies.length) {
      h += `<div class="war-sec"><b>Armées en campagne</b>`;
      for (const a of s.armies) h += `<div class="war-row"><span>${a.phase === 'back' ? 'Retour de' : a.phase === 'fight' ? 'Combat à' : 'Vers'} ${esc(a.tname)} : ${fmtUnits(a.units)}</span><b>${a.phase === 'fight' ? '…' : fmtTime(a.arr - T)}</b></div>`;
      h += '</div>';
    }
    const vs = this.vassals();
    if (vs.length) {
      h += `<div class="war-sec"><b>Tes vassaux</b> <small>(tribut chaque minute)</small>`;
      for (const { b, st } of vs) h += `<div class="war-row"><span>${esc(b.name)} · ${RANKS[st.rank].name} · ${st.pop} hab.</span><b>+${Math.round(st.pop * 0.12)} or</b></div>`;
      h += '</div>';
    }
    const dip = this.app.diplo;
    if (dip && this.app.bots) {
      const mail = dip.d.mail;
      if (mail.length) {
        h += `<div class="war-sec mail"><b>✉ Courrier (${mail.length})</b>`;
        for (const m of mail.slice().reverse()) {
          const b = this.app.bots.byId.get(m.bot);
          if (!b) continue;
          const info = m.kind === 'guerre' || m.kind === 'menace';
          h += `<div class="letter"><div class="lt-head"><b style="color:${esc(b.color)}">${esc(b.name)}</b> · ${MAIL_TITLES[m.kind]} <small>(${fmtTime(m.until - T)})</small></div><div class="lt-body">${esc(dip.letterText(m))}</div><div class="wu-btns">`;
          h += info ? `<button class="btn tiny" data-mail="${m.id}" data-yes="1">Lu</button>` : m.kind === 'cadeau' ? `<button class="btn tiny green" data-mail="${m.id}" data-yes="1">Remercier</button>` : `<button class="btn tiny green" data-mail="${m.id}" data-yes="1">Accepter</button><button class="btn tiny red" data-mail="${m.id}" data-yes="0">Refuser</button>`;
          h += '</div></div>';
        }
        h += '</div>';
      }
      const ti = dip.tradeIncome;
      if (ti && (ti.gold || ti.food)) h += `<div class="war-sec"><small>Commerce : +${ti.gold} or et +${ti.food} vivres par minute</small></div>`;
    }
    if (this.app.mp.active) {
      const pl = [...this.app.mp.others.values()].filter(o => o.city);
      if (pl.length) {
        h += `<div class="war-sec"><b>Joueurs</b>`;
        for (const o of pl) {
          const t = this.target('player', o.pid);
          const rel = this.app.mp.relation(o.pid);
          h += `<div class="war-tgt"><div><b style="color:${esc(o.color)}">${esc(o.name)}</b> — ${esc(o.city.name)}<br><small>${RANKS[t.rank].name} · ${t.pop} hab. · déf. ~${t.def} · ${Math.round(this.distKm(t))} km · ${rel === 'guerre' ? '<span class="atwar">en guerre</span>' : rel === 'alliance' ? '<span class="ally">allié</span>' : 'en paix'}${o.online ? '' : ' · absent'}</small></div><div class="wu-btns">`;
          h += rel === 'guerre' ? `<button class="btn tiny" data-act="peace" data-pid="${esc(o.pid)}">Paix</button><button class="btn tiny red" data-act="attack" data-kind="player" data-id="${esc(o.pid)}">Attaquer</button>`
            : rel === 'alliance' ? `<button class="btn tiny" data-act="unally" data-pid="${esc(o.pid)}">Rompre l'alliance</button>`
            : `${o.online ? `<button class="btn tiny green" data-act="ally" data-pid="${esc(o.pid)}">Proposer une alliance</button>` : ''}<button class="btn tiny red" data-act="declare" data-pid="${esc(o.pid)}">Déclarer la guerre</button>`;
          h += '</div></div>';
        }
        h += '</div>';
      }
    }
    const bots = this.nearbyBots();
    if (bots.length) {
      h += `<div class="war-sec"><b>Villages voisins &amp; diplomatie</b>`;
      for (const t of bots) {
        const mine = t.vassal && t.vassal.pid === this.me.pid;
        const r = dip ? dip.rel(t.id) : null;
        const rel = r ? ` · <span class="${r.st === 'guerre' ? 'atwar' : r.st === 'alliance' ? 'ally' : ''}">${dip.statusName(r)} (${r.v > 0 ? '+' : ''}${Math.round(r.v)})</span>` : '';
        h += `<div class="war-tgt"><div><b style="color:${esc(t.color)}">${esc(t.name)}</b> — ${esc(t.owner)}<br><small>${RANKS[t.rank].name} · ${t.pop} hab. · armée ~${t.army} · déf. ~${t.def} · ${TEMPER_NAMES[t.temper]} · ${Math.round(this.distKm(t))} km${t.vassal ? ' · vassal de ' + esc(mine ? 'toi' : t.vassal.name) : t.st.overlord ? ' · vassal de ' + esc(t.st.overlord.name) : ''}${rel}</small></div>`;
        h += `<div class="wu-btns">${dip ? `<button class="btn tiny" data-act="diplo" data-id="${t.id}">🕊</button>` : ''}${mine ? '' : `<button class="btn tiny red" data-act="attack" data-kind="bot" data-id="${t.id}">Attaquer</button>`}<button class="btn tiny" data-act="see" data-kind="bot" data-id="${t.id}">Voir</button></div></div>`;
      }
      h += '</div>';
    } else if (this.app.bots) h += `<div class="war-sec"><small>Aucun village IA à moins de 300 km pour l'instant.</small></div>`;
    if (s.reports.length) {
      h += `<div class="war-sec"><b>Rapports</b>`;
      for (const r of s.reports.slice(0, 8)) h += `<div class="rep ${r.win ? 'win' : 'loss'}">${esc(r.text)}</div>`;
      h += '</div>';
    }
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
  }
  onClick(e) {
    const b = e.target.closest('[data-act],[data-train],[data-mail]');
    if (!b) return;
    this.app.audio.play('click');
    if (b.dataset.mail) { this.app.diplo.answer(+b.dataset.mail, b.dataset.yes === '1'); this.render(true); return; }
    if (b.dataset.train) {
      const err = this.g && this.g.train(b.dataset.train, +b.dataset.n);
      if (err) this.app.ui.toast(err, 'bad');
      this.render(true);
      return;
    }
    const act = b.dataset.act;
    if (act === 'close') this.toggle(false);
    else if (act === 'attack') this.openAttack(b.dataset.kind, b.dataset.kind === 'bot' ? +b.dataset.id : b.dataset.id);
    else if (act === 'see') this.app.goToBot(+b.dataset.id);
    else if (act === 'diplo') this.app.diplo.open(+b.dataset.id);
    else if (act === 'declare') this.app.mp.declareWar(b.dataset.pid);
    else if (act === 'peace') this.app.mp.askPeace(b.dataset.pid);
    else if (act === 'ally') this.app.mp.proposeAlliance(b.dataset.pid);
    else if (act === 'unally') this.app.mp.breakAlliance(b.dataset.pid);
  }

  openAttack(kind, id) {
    const t = this.target(kind, id);
    const g = this.g;
    if (!t || !g) return;
    const why = this.canAttack(t);
    if (why) { this.app.ui.toast(why, 'bad'); return; }
    const s = g.s, km = this.distKm(t), dur = this.travel(km);
    const sel = {}; for (const u of UNIT_TYPES) sel[u] = s.army[u] || 0;
    const rows = UNIT_TYPES.map(u => `<div class="atk-row"><span>${UNITS[u].name} (${s.army[u] || 0})</span><input type="range" min="0" max="${s.army[u] || 0}" value="${s.army[u] || 0}" data-u="${u}"><b data-show="${u}">${s.army[u] || 0}</b></div>`).join('');
    this.app.ui.modal(`<h2>Attaquer ${esc(t.name)}</h2>
      <p><b style="color:${esc(t.color)}">${esc(t.owner)}</b> · ${RANKS[t.rank].name} · ${t.pop} habitants<br>Défense estimée : <b>${Math.round(t.def)}</b> · Distance : ${Math.round(km)} km · Trajet : ${fmtTime(dur)}</p>
      <div class="atk">${rows}</div>
      <p>Puissance d'attaque : <b id="atk-pow">0</b> <span id="atk-odds"></span></p>`,
      [{ text: 'Annuler' }, { text: 'Lancer l\'attaque', cls: 'red', fn: () => this.launch(t, { ...sel }) }],
      (box) => {
        const upd = () => {
          const A = attackPower(sel);
          box.querySelector('#atk-pow').textContent = Math.round(A);
          const r = A / Math.max(1, t.def);
          box.querySelector('#atk-odds').textContent = A <= 0 ? '' : r > 2.5 ? '· victoire écrasante probable (vassalisation)' : r > 1.2 ? '· victoire probable' : r > 0.85 ? '· combat très serré' : '· défaite probable';
        };
        box.querySelectorAll('input[type=range]').forEach(inp => inp.addEventListener('input', () => { sel[inp.dataset.u] = +inp.value; box.querySelector(`[data-show="${inp.dataset.u}"]`).textContent = inp.value; upd(); }));
        upd();
      });
  }
}
