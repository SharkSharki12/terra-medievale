// PEAM : succès, statistiques, présence, overlay et invitations d'amis (via le lanceur : /api/peam/…).
// Tout est asynchrone et silencieux : sans PEAM (ou dans un navigateur), le jeu fonctionne normalement.
import { RANKS } from './buildings.js';
import { fromPlace } from './people.js';

// identifiants IDENTIQUES à ceux importés dans le Studio PEAM
export const ACH = {
  fondation: 'fondation', village: 'village', bourg: 'bourg', ville: 'ville', cite: 'cite', capitale: 'capitale',
  batisseur: 'batisseur', grandBatisseur: 'grand-batisseur', bebe: 'bebe', babyBoom: 'baby-boom',
  mariage: 'mariage-royal', succession: 'succession', cavalier: 'cavalier', marin: 'marin', voyageur: 'voyageur',
  victoire: 'premiere-victoire', conquerant: 'conquerant', suzerain: 'suzerain', empire: 'empire',
  allie: 'allie', marchand: 'marchand', ensemble: 'ensemble', forteresse: 'forteresse', cathedrale: 'cathedrale',
  peste: 'survivant-peste', royaume: 'royaume-accompli',
};
// statistiques envoyées avec setStat (valeurs TOTALES)
export const STATS = ['habitants', 'batiments', 'naissances', 'km_parcourus', 'victoires', 'vassaux', 'objectifs'];

export class Peam {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.info = null;
    this.sent = {}; this.lastPresence = ''; this.presenceT = 0; this.statT = 0; this.party = '';
    this.ready = fetch('api/peam/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then((i) => {
      this.info = i;
      this.active = !!(i && i.active);
      document.body.classList.toggle('peam-on', this.active);
      if (this.active) setInterval(() => this.poll(), 2000);
      return i;
    }).catch(() => null);
  }

  call(route, body = {}) {
    if (!this.active) return Promise.resolve({ ok: false, error: 'not_launched' });
    return fetch('api/peam/call/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, error: 'peam_unavailable' }));
  }

  // ---------- succès ----------
  unlock(id) {
    const g = this.app.game;
    if (g && !g.remote) { const l = (g.s.ach ||= []); if (!l.includes(id)) l.push(id); }
    if (this.active) this.call('achievements/unlock', { achievementId: id });
  }
  stat(name, value) {
    value = Math.max(0, Math.floor(value || 0));
    if (this.sent[name] === value) return;
    this.sent[name] = value;
    if (this.active) this.call('stats', { name, value });
  }
  // rattrapage au chargement d'une partie (PEAM ignore les doublons)
  restore(g) {
    this.sent = {};
    for (const id of g.s.ach || []) if (this.active) this.call('achievements/unlock', { achievementId: id });
    this.tick(true);
  }

  // ---------- boucle (toutes les 250 ms depuis main) ----------
  tick(force = false) {
    const app = this.app, g = app.game;
    const now = performance.now();
    if (g && !g.remote && (force || now - this.statT > 10000)) {
      this.statT = now;
      const s = g.s;
      this.stat('habitants', s.pop);
      this.stat('batiments', s.buildings.length);
      this.stat('naissances', s.births || 0);
      this.stat('km_parcourus', (s.lordKm || 0));
      this.stat('victoires', s.wins || 0);
      this.stat('vassaux', app.war.vassalCount || 0);
      this.stat('objectifs', s.obj || 0);
      if (g.count('cathedrale')) this.unlock(ACH.cathedrale);
      if (app.mp.active && app.mp.onlineCount() > 0) this.unlock(ACH.ensemble);
    }
    if (force || now - this.presenceT > 5000) { this.presenceT = now; this.updatePresence(); this.updateParty(); }
  }
  updatePresence() {
    const app = this.app, g = app.game;
    let t;
    if (app.mode === 'title') t = 'Au menu principal';
    else if (!g) t = app.mp.active ? 'Cherche où fonder sa ville (en ligne)' : 'Cherche où fonder sa ville sur la Terre';
    else {
      const L = g.pp && g.pp.lord;
      t = `${L ? g.pp.lordTitle(L) + ' ' : ''}${fromPlace(g.s.name)} · ${RANKS[g.s.rank].name} · ${g.s.pop} hab.`;
      if (app.lord.active) t = (app.lord.mount === 'horse' ? 'À cheval · ' : app.lord.mount === 'boat' ? 'En barque · ' : 'Explore à pied · ') + t;
      if (app.mp.active) t += ' · en ligne';
    }
    t = t.slice(0, 80);
    if (t === this.lastPresence) return;
    this.lastPresence = t;
    this.call('presence', { details: t });
  }

  // ---------- multijoueur : partie ouverte aux amis ----------
  joinSecret() {
    const mp = this.app.mp;
    if (!mp.active || !mp.code) return '';
    if (mp.mode === 'direct') return this.app.directAddr ? JSON.stringify({ m: 'direct', h: this.app.directAddr, c: mp.code }) : '';
    return JSON.stringify({ m: 'online', c: mp.code });
  }
  updateParty() {
    if (!this.active) return;
    const secret = this.joinSecret();
    const size = this.app.mp.active ? this.app.mp.onlineCount() + 1 : 0;
    const sig = secret + '|' + size;
    if (sig === this.party) return;
    this.party = sig;
    if (secret) this.call('party', { secret, size, max: 16 });
    else this.call('party', { secret: '' });
  }
  openInvite() {
    const app = this.app;
    if (!this.active) { app.ui.toast('Les invitations d\'amis fonctionnent quand le jeu est lancé depuis PEAM', 'bad'); return; }
    if (!app.mp.active) {
      app.ui.toast('Crée d\'abord une partie en ligne : tes amis pourront la rejoindre en un clic.', 'big');
      app.mp.openLobby();
      return;
    }
    this.updateParty();
    this.call('invite/open', { position: 'center' });
  }
  openOverlay() { this.call('overlay/open', {}); }

  // ---------- rejoindre la partie d'un ami ----------
  async poll() {
    const r = await this.call('invite/poll', {});
    if (r && r.ok && Array.isArray(r.joins)) for (const j of r.joins) this.join(j);
  }
  join(j) {
    if (!j || !j.secret) return;
    let d = null;
    try { d = JSON.parse(j.secret); } catch { d = { m: 'online', c: String(j.secret) }; }
    const app = this.app, mp = app.mp;
    if (!d || !d.c) return;
    if (mp.active && mp.code === d.c) { app.ui.toast(`Tu es déjà dans la partie de ${j.fromName || 'ton ami'}`); return; }
    app.ui.toast(`Connexion à la partie de ${j.fromName || 'ton ami'}…`, 'big');
    const go = d.m === 'direct' && d.h ? () => app.startMultiplayer(null, 'direct', d.h) : () => app.startMultiplayer(d.c, 'online');
    go().catch((e) => app.ui.toast('Impossible de rejoindre cette partie : ' + (e && e.message ? e.message : 'elle est peut-être terminée'), 'bad'));
  }
}
