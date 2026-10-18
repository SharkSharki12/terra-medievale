// Multijoueur : salon par code, villes des autres joueurs, chat, cadeaux, présence sur le globe et la carte
import { Net } from './net.js';
import { RES, RES_NAMES, RANKS, resIconURL } from './buildings.js';
import { tileToLatLon } from './geo.js';

export const COLORS = ['#c0392b', '#2e6fd8', '#2f9e44', '#d4a020', '#8e44ad', '#e67e22', '#16a085', '#d6336c'];
const WORDS = ['LOUP', 'OURS', 'AIGLE', 'CERF', 'LION', 'DRAGON', 'FAUCON', 'RENARD', 'CHENE', 'LICORNE', 'HIBOU', 'SANGLIER', 'GRIFFON', 'CORBEAU'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function newCode() { return WORDS[Math.floor(Math.random() * WORDS.length)] + '-' + (1000 + Math.floor(Math.random() * 9000)); }
export function normCode(c) { return String(c || '').toUpperCase().trim().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 24); }
export function cityCenter(snap) {
  const m = snap.b.find(b => b[0] === 'manoir');
  if (!m) return null;
  const f = (snap.frames && snap.frames[m[4] || 0]) || { lat0: snap.lat0, lon0: snap.lon0 };
  return tileToLatLon({ lat0: f.lat0, lon0: f.lon0, cos0: Math.cos(f.lat0 * Math.PI / 180) }, m[1] + 1.5, m[2] + 1.5);
}
export function codeSeed(code) { let h = 2166136261; for (const c of String(code)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

export class Multiplayer {
  constructor(app) {
    this.app = app;
    this.net = new Net();
    this.code = null; this.mode = null; this.host = null;
    this.others = new Map();      // pid -> joueur
    this.peerPid = new Map();     // id réseau -> pid
    this.chat = [];
    this.relations = {};
    this.t0 = Date.now();
    this.events = [];
    this.tCity = 0; this.tPos = 0; this.tStat = 0; this.lastPosSig = '';
    this.net.on('join', (peer) => this.net.send('hello', this.hello(), peer));
    this.net.on('leave', (peer) => this.onLeave(peer));
    this.net.on('msg', (peer, m) => this.onMsg(peer, m));
    this.net.on('status', () => this.renderPlayers());
    this.bindUI();
  }

  get active() { return !!this.code; }
  get me() { return this.app.settings; }
  get worldKey() { return 'mp_' + this.code.replace(/[^A-Za-z0-9_-]/g, '_'); }
  onlineCount() { let n = 0; for (const o of this.others.values()) if (o.online) n++; return n; }

  // ---------- connexion ----------
  async join(code, mode, host) {
    if (mode === 'direct') code = normCode(await this.net.joinDirect(host)) || 'DIRECT';
    else { code = normCode(code); await this.net.joinOnline(code); }
    this.code = code; this.mode = mode; this.host = host || null;
    this.others.clear(); this.peerPid.clear(); this.chat = [];
    const world = await this.app.kvGet(this.worldKey);
    this.t0 = (world && world.t0) || Date.now();
    this.events = (world && world.events) || [];
    this.relations = (world && world.relations) || {};
    this.app.setupBots(codeSeed(code), this.events, true);
    if (world && world.known) for (const snap of world.known) this.mergeCity(snap, false);
    const rooms = (this.me.rooms || []).filter(r => !(r.code === code && r.mode === mode));
    rooms.unshift({ code, mode, host: host || null, last: Date.now() });
    this.me.rooms = rooms.slice(0, 6);
    this.app.saveSettings();
    this.system(`Tu as rejoint la partie ${code}.`);
    document.body.classList.add('mp-on');
    this.renderPlayers();
    return world;
  }

  leave() {
    this.net.leave();
    this.code = null;
    this.others.clear(); this.peerPid.clear();
    document.body.classList.remove('mp-on');
    this.renderPlayers();
  }

  hello() {
    const g = this.app.game;
    const known = [];
    for (const o of this.others.values()) if (o.city) known.push(o.city);
    return { pid: this.me.pid, name: this.me.name, color: this.me.color, city: g ? this.mySnapshot() : null, known, world: { t0: this.t0, events: this.events.slice(-400) }, rel: this.relations };
  }
  mySnapshot() { return this.app.game.snapshot(this.me.pid, this.me.name, this.me.color); }

  player(pid) {
    let o = this.others.get(pid);
    if (!o) { o = { pid, name: '?', color: '#ffffff', city: null, online: false, peer: null, pos: null }; this.others.set(pid, o); }
    return o;
  }

  mergeCity(snap, notify = true) {
    if (!snap || !snap.pid || snap.pid === this.me.pid || !Array.isArray(snap.b)) return;
    const o = this.player(snap.pid);
    if (o.name === '?' && snap.owner) { o.name = snap.owner; o.color = snap.color || o.color; }
    const isNew = !o.city;
    if (o.city && (snap.updated || 0) <= (o.city.updated || 0)) return;
    o.city = snap;
    this.app.onRemoteCity(o);
    if (isNew && notify && o.online) this.system(`${o.name} a fondé la ville de ${snap.name}.`);
  }

  onMsg(peer, { t, d }) {
    if (!d) return;
    if (t === 'hello') {
      if (!d.pid || d.pid === this.me.pid) return;
      this.peerPid.set(peer, d.pid);
      const o = this.player(d.pid);
      const was = o.online;
      o.name = String(d.name || 'Joueur').slice(0, 24); o.color = d.color || o.color; o.online = true; o.peer = peer;
      if (d.city) this.mergeCity(d.city, false);
      for (const k of d.known || []) this.mergeCity(k, false);
      if (d.world) this.mergeWorld(d.world);
      if (d.rel && d.rel[this.me.pid]) this.relations[d.pid] = d.rel[this.me.pid];
      if (!was) { this.system(`${o.name} a rejoint la partie.`); this.app.audio.play('coin'); }
      this.renderPlayers();
      return;
    }
    const pid = this.peerPid.get(peer);
    const o = pid && this.others.get(pid);
    if (t === 'botev' && Array.isArray(d.events)) this.mergeWorld({ events: d.events });
    else if (t === 'war' && o) {
      const st = d.state === 'guerre' ? 'guerre' : d.state === 'alliance' ? 'alliance' : 'paix';
      if (this.relations[o.pid] !== st) {
        const was = this.relations[o.pid];
        this.relations[o.pid] = st;
        const msg = st === 'guerre' ? `⚔ ${o.name} t'a déclaré la guerre !` : st === 'alliance' ? `🤝 Tu es maintenant allié avec ${o.name} !` : was === 'alliance' ? `${o.name} a rompu votre alliance.` : `🕊 La paix est conclue avec ${o.name}.`;
        this.system(msg); this.app.ui.toast(msg, st === 'guerre' ? 'bad' : 'big');
        if (st === 'guerre') this.app.notify('Déclaration de guerre', msg);
        this.app.audio.play(st === 'guerre' ? 'bad' : 'reward');
      }
    }
    else if (t === 'peace?' && o) {
      this.app.ui.modal(`<h2>Proposition de paix</h2><p><b style="color:${esc(o.color)}">${esc(o.name)}</b> te propose la paix.</p>`,
        [{ text: 'Refuser' }, { text: 'Accepter la paix', cls: 'green', fn: () => { this.relations[o.pid] = 'paix'; this.net.send('war', { state: 'paix' }, o.peer); this.system(`🕊 La paix est conclue avec ${o.name}.`); this.renderPlayers(); } }]);
    }
    else if (t === 'ally?' && o) {
      if (this.relations[o.pid] === 'alliance') return;
      this.app.ui.modal(`<h2>Proposition d'alliance</h2><p><b style="color:${esc(o.color)}">${esc(o.name)}</b> te propose une alliance : vos armées défendront la ville de l'autre et vous ne pourrez plus vous attaquer.</p>`,
        [{ text: 'Refuser', fn: () => this.net.send('ally-no', {}, o.peer) }, { text: 'Accepter l\'alliance', cls: 'green', fn: () => { this.relations[o.pid] = 'alliance'; this.net.send('war', { state: 'alliance' }, o.peer); this.system(`🤝 Alliance conclue avec ${o.name}.`); this.app.audio.play('reward'); this.renderPlayers(); this.app.war.render(true); } }]);
      this.app.notify('Proposition d\'alliance', `${o.name} te propose une alliance`);
    }
    else if (t === 'ally-no' && o) { this.system(`${o.name} a refusé ton alliance.`); this.app.ui.toast(`${o.name} a refusé ton alliance.`, 'bad'); }
    else if (t === 'attack' && o) this.app.war.onAttack(o.pid, d, o);
    else if (t === 'battle' && o) this.app.war.onBattle(o.pid, d);
    else if (t === 'city') this.mergeCity(d);
    else if (t === 'stat' && o && o.city) { o.city.pop = d.pop; o.city.rank = d.rank; if (d.def != null) o.city.def = d.def; if (d.army != null) o.city.army = d.army; this.app.onRemoteStat(o); }
    else if (t === 'pos' && o) o.pos = d;
    else if (t === 'chat' && o) this.addChat(o.name, o.color, String(d.text || '').slice(0, 300));
    else if (t === 'gift' && o && d.to === this.me.pid && this.app.game) {
      const got = {};
      for (const r of RES) { const v = Math.max(0, Math.min(5000, Math.floor(+d.res?.[r] || 0))); if (v) got[r] = v; }
      this.app.game.add(got);
      const txt = Object.entries(got).map(([r, v]) => `${v} ${RES_NAMES[r].toLowerCase()}`).join(', ');
      this.app.ui.toast(`${o.name} t'offre ${txt} !`, 'big');
      this.system(`${o.name} t'a offert ${txt}.`);
      this.app.audio.play('reward');
    }
    if (o) this.renderPlayers();
  }

  onLeave(peer) {
    const pid = this.peerPid.get(peer);
    this.peerPid.delete(peer);
    const o = pid && this.others.get(pid);
    if (o && o.online) { o.online = false; o.pos = null; this.system(`${o.name} s'est déconnecté.`); }
    this.renderPlayers();
  }

  // ---------- envoi périodique ----------
  tick(dt, now) {
    if (!this.active) return;
    const g = this.app.game;
    if (g && g.dirty && now - this.tCity > 1500) {
      g.dirty = false; this.tCity = now;
      this.net.send('city', this.mySnapshot());
    }
    if (g && now - this.tStat > 8000) { this.tStat = now; this.net.send('stat', { pop: g.s.pop, rank: g.s.rank, def: Math.round(g.defensePower()), army: g.armyAtHome }); }
    if (now - this.tPos > 300) {
      this.tPos = now;
      const p = this.app.presence();
      const sig = p ? `${p.mode}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}|${p.cur ? p.cur.lat.toFixed(5) + p.cur.lon.toFixed(5) : ''}` : '';
      if (sig !== this.lastPosSig || now - (this.tPosFull || 0) > 5000) { this.lastPosSig = sig; this.tPosFull = now; if (p) this.net.send('pos', p); }
    }
  }

  sendChat(text) {
    text = text.trim().slice(0, 300);
    if (!text) return;
    this.net.send('chat', { text });
    this.addChat(this.me.name, this.me.color, text);
  }
  sendGift(pid, res) {
    const g = this.app.game;
    for (const r in res) if ((g.s.res[r] || 0) < res[r]) { this.app.ui.toast('Pas assez de ressources', 'bad'); return false; }
    for (const r in res) g.s.res[r] -= res[r];
    const o = this.others.get(pid);
    this.net.send('gift', { to: pid, res }, o && o.peer);
    const txt = Object.entries(res).map(([r, v]) => `${v} ${RES_NAMES[r].toLowerCase()}`).join(', ');
    this.system(`Tu as offert ${txt} à ${o ? o.name : '?'}.`);
    this.app.audio.play('coin');
    return true;
  }

  relation(pid) { return this.relations[pid] || 'paix'; }
  proposeAlliance(pid) {
    const o = this.others.get(pid);
    if (!o) return;
    if (!o.online) { this.app.ui.toast(`${o.name} n'est pas connecté`, 'bad'); return; }
    this.net.send('ally?', {}, o.peer);
    this.system(`Tu proposes une alliance à ${o.name}…`);
    this.app.ui.toast(`Proposition d'alliance envoyée à ${o.name}`);
  }
  breakAlliance(pid) {
    const o = this.others.get(pid);
    if (!o || this.relation(pid) !== 'alliance') return;
    this.relations[pid] = 'paix';
    this.net.send('war', { state: 'paix' }, o.peer);
    this.system(`Tu romps ton alliance avec ${o.name}.`);
    this.renderPlayers(); this.app.war.render(true);
  }
  // alliés en ligne : leur défense vient renforcer la tienne
  allies() { return [...this.others.values()].filter(o => this.relation(o.pid) === 'alliance' && o.city); }
  declareWar(pid) {
    const o = this.others.get(pid);
    if (!o) return;
    const ally = this.relation(pid) === 'alliance';
    this.app.ui.modal(`<h2>Déclarer la guerre</h2><p>${ally ? 'Rompre ton alliance et d' : 'D'}éclarer la guerre à <b style="color:${esc(o.color)}">${esc(o.name)}</b> ? Vous pourrez vous attaquer mutuellement.</p>`,
      [{ text: 'Annuler' }, { text: 'Déclarer la guerre', cls: 'red', fn: () => {
        this.relations[pid] = 'guerre';
        this.net.send('war', { state: 'guerre' }, o.peer);
        this.system(`⚔ Tu as déclaré la guerre à ${o.name}.`);
        this.renderPlayers(); this.app.war.render(true);
      } }]);
  }
  askPeace(pid) {
    const o = this.others.get(pid);
    if (!o) return;
    this.net.send('peace?', {}, o.peer);
    this.system(`Tu proposes la paix à ${o.name}.`);
  }
  mergeWorld(w) {
    if (w.t0 && w.t0 < this.t0) { this.t0 = w.t0; }
    let added = false;
    for (const e of w.events || []) {
      if (!e || !e.id || typeof e.bot !== 'number') continue;
      if (this.app.bots && this.app.bots.addEvent(e)) { this.events.push(e); added = true; }
      else if (!this.app.bots && !this.events.some(x => x.id === e.id)) { this.events.push(e); added = true; }
    }
    if (added) this.app.onBotEvents();
  }

  knownCities() { const out = []; for (const o of this.others.values()) if (o.city) out.push(o.city); return out; }

  // ---------- interface : joueurs + chat ----------
  bindUI() {
    const inp = $('#chat-input');
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.sendChat(inp.value); inp.value = ''; }
      if (e.key === 'Escape') inp.blur();
    });
    $('#mp-players').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) { if (e.target.closest('.mp-head')) $('#mp-players').classList.toggle('collapsed'); return; }
      const pid = b.dataset.pid;
      if (b.dataset.act === 'see') this.app.goToRemote(pid);
      if (b.dataset.act === 'gift') this.openGift(pid);
      if (b.dataset.act === 'ally') this.proposeAlliance(pid);
      if (b.dataset.act === 'war') this.app.war.toggle(true);
      if (b.dataset.act === 'copy') { navigator.clipboard?.writeText(this.code).catch(() => { }); this.app.ui.toast(`Code ${this.code} copié`); }
    });
  }

  system(text) { this.addChat(null, null, text); }
  addChat(name, color, text) {
    this.chat.push({ name, color, text, t: Date.now() });
    if (this.chat.length > 80) this.chat.shift();
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = name ? 'msg' : 'msg sys';
    div.innerHTML = name ? `<b style="color:${esc(color)}">${esc(name)}</b> ${esc(text)}` : esc(text);
    log.appendChild(div);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (name && name !== this.me.name) this.app.audio.play('tick');
  }

  renderPlayers() {
    const el = $('#mp-players');
    if (!this.active) { el.innerHTML = ''; return; }
    const st = this.net.status === 'reconnecting' ? ' · reconnexion…' : '';
    const n = this.onlineCount();
    let h = `<div class="mp-head"><b>Partie ${esc(this.code)}</b> <button class="btn tiny" data-act="copy" title="Copier le code">Copier</button>
      <div class="mp-sub">${this.mode === 'direct' ? 'Connexion directe' : 'En ligne'} · ${n + 1} joueur${n ? 's' : ''} connecté${n ? 's' : ''}${st}</div></div><div class="mp-list">`;
    const g = this.app.game;
    h += `<div class="pl"><span class="dot" style="background:${esc(this.me.color)}"></span><div class="pl-txt"><b>${esc(this.me.name)}</b> (toi)<br><small>${g ? esc(g.s.name) + ' · ' + RANKS[g.s.rank].name + ' · ' + g.s.pop + ' hab.' : 'pas encore de ville'}</small></div></div>`;
    const list = [...this.others.values()].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    for (const o of list) {
      const c = o.city;
      h += `<div class="pl ${o.online ? '' : 'off'}"><span class="dot" style="background:${esc(o.color)}"></span><div class="pl-txt"><b>${esc(o.name)}</b>${o.online ? '' : ' <small>(absent)</small>'}<br>
        <small>${c ? esc(c.name) + ' · ' + RANKS[c.rank || 0].name + ' · ' + (c.pop || 0) + ' hab.' : 'cherche où fonder sa ville'}</small></div>
        ${this.relation(o.pid) === 'guerre' ? '<span class="atwar-badge" title="En guerre">⚔</span>' : this.relation(o.pid) === 'alliance' ? '<span class="ally-badge" title="Allié">🤝</span>' : ''}
        <div class="pl-btns">${c ? `<button class="btn tiny" data-act="see" data-pid="${esc(o.pid)}">Voir</button>` : ''}${o.online && g ? `<button class="btn tiny" data-act="gift" data-pid="${esc(o.pid)}">Offrir</button>` : ''}${o.online && g && this.relation(o.pid) === 'paix' ? `<button class="btn tiny green" data-act="ally" data-pid="${esc(o.pid)}">Alliance</button>` : ''}${g && c ? `<button class="btn tiny" data-act="war" data-pid="${esc(o.pid)}">Guerre</button>` : ''}</div></div>`;
    }
    if (!list.length) h += `<div class="mp-wait">En attente d'autres joueurs… Donne-leur le code <b>${esc(this.code)}</b> !</div>`;
    h += '</div>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
  }

  openGift(pid) {
    const o = this.others.get(pid);
    if (!o || !this.app.game) return;
    const icons = Object.fromEntries(RES.map(r => [r, resIconURL(r, 20)]));
    const amounts = { wood: 0, stone: 0, food: 0, gold: 0, iron: 0 };
    const row = (r) => `<div class="gift-row"><img src="${icons[r]}"> ${RES_NAMES[r]} <span class="have">(tu as ${Math.floor(this.app.game.s.res[r])})</span>
      <span class="gift-btns">${[0, 25, 100, 250].map(v => `<button class="btn tiny" data-r="${r}" data-v="${v}">${v}</button>`).join('')}</span> <b data-show="${r}">0</b></div>`;
    this.app.ui.modal(`<h2>Offrir à ${esc(o.name)}</h2><div class="gift">${RES.map(row).join('')}</div>`,
      [{ text: 'Annuler' }, { text: 'Envoyer', cls: 'green', fn: () => { const res = {}; for (const r of RES) if (amounts[r]) res[r] = amounts[r]; if (Object.keys(res).length) this.sendGift(pid, res); } }],
      (box) => box.querySelectorAll('.gift-btns .btn').forEach(b => b.addEventListener('click', () => {
        amounts[b.dataset.r] = +b.dataset.v; box.querySelector(`[data-show="${b.dataset.r}"]`).textContent = b.dataset.v;
      })));
  }

  // ---------- salon (lobby) ----------
  openLobby() {
    const s = this.me;
    const recent = (s.rooms || []).map((r, i) => `<div class="recent"><span><b>${esc(r.code)}</b> <small>${r.mode === 'direct' ? (r.host === 'localhost-host' ? 'hébergée sur ce PC' : 'IP ' + esc(r.host)) : 'en ligne'}${r.city ? ' · ' + esc(r.city) + ' (' + RANKS[r.rank || 0].name + ', ' + (r.pop || 0) + ' hab.)' : ''}${r.last ? ' · ' + new Date(r.last).toLocaleDateString('fr-FR') : ''}</small></span><span><button class="btn tiny green" data-recent="${i}">Reprendre</button> <button class="btn tiny red" data-del="${i}" title="Supprimer la sauvegarde">✕</button></span></div>`).join('');
    this.app.ui.modal(`<h2>Multijoueur</h2>
      <div class="lobby">
        <div class="lob-row"><label>Ton nom</label><input id="mp-name" maxlength="20" value="${esc(s.name)}"></div>
        <div class="lob-row"><label>Ta couleur</label><div id="mp-colors">${COLORS.map(c => `<span class="sw ${c === s.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>
        <h3>Jouer en ligne</h3>
        <p class="hint">Partage le code avec tes amis : ils le tapent et vous êtes dans le même monde, sans rien régler.</p>
        <div class="lob-row"><input id="mp-code" placeholder="Code de la partie (ex : LOUP-4821)" maxlength="24"><button class="btn green" id="mp-join">Rejoindre</button></div>
        <div class="lob-row"><button class="btn" id="mp-create">Créer une nouvelle partie</button></div>
        ${recent ? `<h3>Mes parties sauvegardées</h3><p class="hint">Ta ville, les villes des autres et l'état du monde sont sauvegardés sur ton PC.</p>${recent}` : ''}
        <h3>Connexion directe (réseau local / IP)</h3>
        <p class="hint">Si la connexion en ligne ne marche pas : un joueur héberge sur son PC, les autres entrent son adresse IP.</p>
        <div class="lob-row"><button class="btn" id="mp-host">Héberger sur ce PC</button></div>
        <div class="lob-row"><input id="mp-ip" placeholder="IP de l'hôte (ex : 192.168.1.20)" maxlength="60"><button class="btn" id="mp-ipjoin">Se connecter</button></div>
      </div>`, [{ text: 'Fermer' }], (box, close) => {
      box.querySelectorAll('.sw').forEach(sw => sw.addEventListener('click', () => {
        box.querySelectorAll('.sw').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); s.color = sw.dataset.c;
      }));
      const saveName = () => { s.name = (box.querySelector('#mp-name').value.trim() || s.name).slice(0, 20); this.app.saveSettings(); };
      const go = async (fn) => { saveName(); close(); try { await fn(); } catch (e) { console.error(e); this.app.loader(null); this.app.ui.toast('Connexion impossible : ' + (e.message || e), 'bad'); } };
      box.querySelector('#mp-join').onclick = () => {
        const c = normCode(box.querySelector('#mp-code').value);
        if (!c) { this.app.ui.toast('Entre un code de partie', 'bad'); return; }
        go(() => this.app.startMultiplayer(c, 'online'));
      };
      box.querySelector('#mp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('#mp-join').click(); });
      box.querySelector('#mp-create').onclick = () => go(() => this.app.startMultiplayer(newCode(), 'online', null, true));
      box.querySelector('#mp-host').onclick = () => go(() => this.app.hostDirect());
      box.querySelector('#mp-ipjoin').onclick = () => {
        const ip = box.querySelector('#mp-ip').value.trim();
        if (!ip) { this.app.ui.toast('Entre l\'adresse IP de l\'hôte', 'bad'); return; }
        go(() => this.app.startMultiplayer(null, 'direct', ip));
      };
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const r = s.rooms[+b.dataset.del];
        if (!r) return;
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Supprimer ?'; return; }
        this.app.kvDelete('mp_' + r.code.replace(/[^A-Za-z0-9_-]/g, '_'));
        s.rooms.splice(+b.dataset.del, 1); this.app.saveSettings();
        close(); this.openLobby();
      }));
      box.querySelectorAll('[data-recent]').forEach(b => b.addEventListener('click', () => {
        const r = s.rooms[+b.dataset.recent];
        go(() => (r.mode === 'direct' && r.host === 'localhost-host') ? this.app.hostDirect(r.code) : this.app.startMultiplayer(r.code, r.mode, r.host));
      }));
    });
  }
}
