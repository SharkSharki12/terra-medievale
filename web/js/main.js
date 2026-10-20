// Terra Médiévale — orchestration : écran titre, globe 3D, carte 2D, partie solo et multijoueur,
// villages IA, guerre, simulation en arrière-plan
import { GeoData, tileToLatLon, latLonToTile, haversine } from './geo.js';
import { Globe, ALT_MAP, PATCH_LEVEL } from './globe.js';
import { MapView } from './map2d.js';
import { Game, evaluateSite, key as tileKey, unkey } from './game.js';
import { UI } from './ui.js';
import { Sfx } from './audio.js';
import { GROUND_NAMES, TREE_NAMES, isWater } from './terrain.js';
import { BUILDINGS, iconURL, getSprite, RANKS } from './buildings.js';
import { Multiplayer, COLORS, cityCenter, newCode, codeSeed } from './mp.js';
import { BotWorld, BotView } from './bots.js';
import { War } from './war.js';
import { Lord, fmtDist } from './lord.js';
import { Diplomacy } from './diplo.js';
import { pathQueue } from './nav.js';
import { Peam, ACH } from './peam.js';
import { personSprite, horseSprite, boatSprite, drawAt, TOOLS, flushAtlas } from './actors.js';
import { lookOf, M_NAMES, F_NAMES } from './people.js';

const $ = (s) => document.querySelector(s);
const NAMES = ['Bellerive', 'Montfort', 'Clairval', 'Hautecombe', 'Rochebrune', 'Valombre', 'Beaumont', 'Fontclaire', 'Castelnau', 'Boisjoli',
  'Pierrefeu', 'Villeneuve', 'Sainte-Aube', 'Roquebelle', 'Vauclair', 'Aubeterre', 'Frênebois', 'Montjoie', 'Belcastel', 'Clairefont', 'Mirevent', 'Orbeval'];
const FOV_TAN = Math.tan(22.5 * Math.PI / 180);
const MIN_CITY_DIST = 2800;            // m entre deux villes (manoirs)
const FRAME_RANGE = 350000;            // m : portée d'un cadre de coordonnées
const PATCH_CH = 32 << PATCH_LEVEL;    // 8192 cases : pas de recentrage des régions
const sameAnchor = (a, b) => a && b && Math.abs(a.lat0 - b.lat0) < 1e-9 && Math.abs(a.lon0 - b.lon0) < 1e-9;
const sameRegion = (a, b) => sameAnchor(a, b) && (a.ctx || 0) === (b.ctx || 0) && (a.cty || 0) === (b.cty || 0);
const withCos = (f) => ({ lat0: f.lat0, lon0: f.lon0, cos0: Math.cos(f.lat0 * Math.PI / 180) });

// Construction des régions dans un worker (l'interface ne gèle pas)
class RegionService {
  constructor() {
    this.w = new Worker(new URL('./regionworker.js', import.meta.url), { type: 'module' });
    this.seq = 0; this.pending = new Map();
    this.w.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'region') p.res(m.region); else p.rej(new Error(m.message));
    };
  }
  build(a) {
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.w.postMessage({ type: 'build', id, lat: a.lat0, lon: a.lon0, ctx: a.ctx || 0, cty: a.cty || 0 }); });
  }
}

class App {
  constructor() {
    this.mode = 'loading';
    this.game = null;
    this.region = null; this.regionId = 0;
    this.keys = new Set();
    this.foundMode = false;
    this.lastUI = 0; this.lastMarkers = 0; this.lastBots = 0; this.lastBotPoints = 0;
    this.switchT = 0;
    this.remoteGames = new Map();
    this.regionChain = Promise.resolve();
    this.bots = null;
    this.world = null;       // monde solo { seed, bots, events }
    this.preClock = 0;       // horloge du monde solo avant la fondation
    this.lastFrame = performance.now(); this.lastSim = performance.now();
  }

  loader(text) {
    if (text) { $('#loader-text').textContent = text; $('#loader').classList.remove('hidden'); }
    else $('#loader').classList.add('hidden');
  }

  async start() {
    this.loader('Chargement de la Terre…');
    this.audio = new Sfx();
    this.settings = await this.loadSettings();
    this.geo = new GeoData();
    this.regions = new RegionService();
    await this.geo.loadPlaces();
    this.loader('Préparation du globe…');
    this.globe = new Globe($('#globe'));
    await this.globe.init();
    this.map = new MapView($('#map'));
    this.map.clearedProvider = (x0, y0, n) => this.clearedIn(x0, y0, n);
    this.map.onChunk = (key, e) => this.onChunk(key, e);
    this.ui = new UI(this);
    this.mp = new Multiplayer(this);
    this.war = new War(this);
    this.lord = new Lord(this);
    this.diplo = new Diplomacy(this);
    this.peam = new Peam(this);
    this.botView = new BotView(this);
    this.crestURL = iconURL('manoir', 64);
    this.crestImg = new Image(); this.crestImg.src = this.crestURL;
    document.querySelector('.title-crest').style.backgroundImage = `url(${iconURL('chateau', 84)})`;
    this.bindMap();
    this.bindGlobe();
    this.bindKeys();
    this.bindNative();
    this.soloSave = await this.readSave();
    this.refreshTitle();
    $('#btn-new').addEventListener('click', () => { this.audio.play('click'); this.newGame(); });
    $('#btn-continue').addEventListener('click', () => { this.audio.play('click'); this.loadGame(this.soloSave); });
    $('#btn-mp').addEventListener('click', () => { this.audio.play('click'); this.mp.openLobby(); });
    $('#btn-found').addEventListener('click', () => this.onFoundButton());
    $('#btn-gocity').addEventListener('click', () => this.goCity());
    this.loader(null);
    this.setMode('title');
    this.globe.setView(25, 10, 2.6);
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      try { this.frame(dt, t); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // horloge d'arrière-plan : le monde continue quand la fenêtre est cachée (zone de notification)
    try {
      const tick = new Worker(new URL('./ticker.js', import.meta.url));
      tick.onmessage = () => { if (performance.now() - this.lastFrame > 1500) { try { this.background(); } catch (e) { console.error(e); } } };
    } catch (e) { console.warn('ticker', e); }
    window.addEventListener('beforeunload', () => this.writeSave(true));
    setInterval(() => { if (this.game || this.mp.active) this.writeSave(); }, 20000);
    if (this.startHidden) this.ui.toast('Terra Médiévale tourne en arrière-plan.');
    // lancé depuis une invitation d'un ami sur PEAM : on rejoint sa partie
    this.peam.ready.then((i) => { if (i && i.active && i.join) setTimeout(() => this.peam.join(i.join), 800); });
  }

  refreshTitle() {
    const s = this.soloSave;
    $('#btn-continue').classList.toggle('hidden', !s);
    if (s) $('#btn-continue').textContent = `Continuer : ${s.name}`;
  }

  // ---------- intégration Windows (zone de notification, mises à jour) ----------
  bindNative() {
    this.native = typeof window.appInfo === 'function';
    window.onUpdateReady = (info) => this.onUpdateReady(info);
    window.onTrayShow = () => { this.lastFrame = performance.now(); };
    if (this.native) window.appInfo().then((i) => { this.appInfo = i; }).catch(() => { });
  }
  notify(title, text) {
    try { if (typeof window.trayNotify === 'function' && (document.hidden || !document.hasFocus())) window.trayNotify(title, text); } catch { }
  }
  onUpdateReady(info) {
    if (!info || !info.version) return;
    this.updateInfo = info;
    this.ui.modal(`<h2>Mise à jour disponible</h2><p>La version <b>${esc(info.version)}</b> de Terra Médiévale est téléchargée et prête.</p>${info.notes ? `<p class="hint">${esc(info.notes)}</p>` : ''}<p>Ta partie est sauvegardée automatiquement avant le redémarrage.</p>`,
      [{ text: 'Plus tard' }, { text: 'Redémarrer et mettre à jour', cls: 'green', fn: () => this.applyUpdate() }]);
  }
  applyUpdate() {
    this.writeSave();
    setTimeout(() => { if (typeof window.applyUpdate === 'function') window.applyUpdate(); }, 600);
  }
  async openSettings() {
    const info = this.native ? await window.appInfo().catch(() => null) : null;
    const auto = info ? info.autostart : false, tray = info ? info.closeToTray : true;
    this.ui.modal(`<h2>Réglages</h2><div class="lobby">
      <div class="set-row"><span>Version</span><b>${esc(info ? info.version : 'navigateur')}</b></div>
      ${info && info.peam ? '<div class="set-row"><span>Mises à jour</span><b>gérées par PEAM</b></div>' : info ? `<div class="set-row"><span>Mises à jour automatiques</span><b>${info.updateURL ? 'activées (vérifiées toutes les 3 h)' : 'pas encore de serveur de mise à jour'}</b></div>
      <div class="set-row"><label><input type="checkbox" id="st-auto" ${auto ? 'checked' : ''}> Lancer Terra Médiévale au démarrage de Windows (en arrière-plan)</label></div>
      <div class="set-row"><label><input type="checkbox" id="st-tray" ${tray ? 'checked' : ''}> La croix ✕ réduit le jeu dans la zone de notification (en bas à droite) au lieu de le quitter</label></div>
      ${info.updateURL ? '<div class="set-row"><button class="btn small" id="st-check">Vérifier les mises à jour maintenant</button><span id="st-msg"></span></div>' : ''}` : '<p class="hint">Ces réglages sont disponibles dans la version .exe.</p>'}
      </div>`, [{ text: 'Fermer' }], (box) => {
      const a = box.querySelector('#st-auto'), t = box.querySelector('#st-tray'), c = box.querySelector('#st-check');
      if (a) a.onchange = () => window.setAutostart(a.checked);
      if (t) t.onchange = () => window.setCloseToTray(t.checked);
      if (c) c.onclick = () => {
        const msg = box.querySelector('#st-msg');
        msg.textContent = ' Recherche…';
        window.onUpdateCheck = (r) => { msg.textContent = r && r.error ? ' ' + r.error : r && r.available ? ` Version ${r.version} : téléchargement en cours…` : ' Tu as déjà la dernière version.'; };
        window.checkUpdate().catch(e => { msg.textContent = ' ' + e; });
      };
    });
  }

  // ---------- stockage ----------
  async kvGet(name) {
    let a = null, b = null;
    try { const r = await fetch('api/kv/' + name, { cache: 'no-store' }); if (r.ok) a = await r.json(); } catch { }
    try { const t = localStorage.getItem('tm-' + name); if (t) b = JSON.parse(t); } catch { }
    if (a && b) return (b.savedAt || b.saved || 0) > (a.savedAt || a.saved || 0) ? b : a;
    return a || b;
  }
  kvSet(name, obj, unload = false) {
    const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
    try { localStorage.setItem('tm-' + name, data); } catch { }
    try { fetch('api/kv/' + name, { method: 'POST', body: data, keepalive: unload && data.length < 60000, headers: { 'Content-Type': 'application/json' } }).catch(() => { }); } catch { }
  }
  kvDelete(name) {
    try { localStorage.removeItem('tm-' + name); } catch { }
    try { fetch('api/kv/' + name, { method: 'DELETE' }).catch(() => { }); } catch { }
  }
  async loadSettings() {
    let s = await this.kvGet('settings');
    if (!s || !s.pid) {
      s = { pid: 'u' + Math.random().toString(36).slice(2, 12), name: 'Seigneur ' + Math.floor(100 + Math.random() * 900), color: COLORS[Math.floor(Math.random() * COLORS.length)], rooms: [] };
      this.kvSet('settings', s);
    }
    return s;
  }
  saveSettings() { this.kvSet('settings', this.settings); }
  async readSave() {
    const j = await this.kvGet('save');
    if (j && j.buildings) return j;
    try { const t = localStorage.getItem('terra-medievale-save'); if (t) return JSON.parse(t); } catch { }
    return null;
  }
  writeSave(unload = false) {
    if (this.mp.active) {
      const g = this.game;
      if (g) g.s.savedAt = Date.now();
      this.kvSet(this.mp.worldKey, {
        code: this.mp.code, mode: this.mp.mode, city: g ? JSON.parse(g.serialize()) : null, known: this.mp.knownCities(),
        t0: this.mp.t0, events: this.mp.events.slice(-3000), relations: this.mp.relations, saved: Date.now(),
      }, unload);
      const r = (this.settings.rooms || []).find(x => x.code === this.mp.code && x.mode === this.mp.mode);
      if (r && g) { r.city = g.s.name; r.rank = g.s.rank; r.pop = g.s.pop; r.last = Date.now(); this.saveSettings(); }
      return;
    }
    if (!this.game) return;
    this.game.s.savedAt = Date.now();
    const data = this.game.serialize();
    this.kvSet('save', data, unload);
    this.soloSave = JSON.parse(data);
  }

  // ---------- monde : horloge, villages IA ----------
  worldClock() {
    if (this.mp.active) return (Date.now() - this.mp.t0) / 1000;
    return this.game ? this.game.s.time : this.preClock;
  }
  worldEvents() {
    if (this.mp.active) return this.mp.events;
    if (this.game && this.game.s.world) return this.game.s.world.events;
    return this.world ? this.world.events : [];
  }
  setupBots(seed, events, enabled) {
    this.botView.reset();
    if (!enabled) { this.bots = null; this.globe.setBotPoints([]); return; }
    this.bots = new BotWorld(this.geo.places).init(seed);
    this.bots.setEvents(events || []);
    this.lastBots = 0; this.lastBotPoints = 0;
  }
  onBotEvents() { this.lastBots = 0; this.lastBotPoints = 0; if (this.war) this.war.render(true); }

  // ---------- modes ----------
  setMode(m) {
    this.mode = m;
    this.switchT = 0.6;
    document.body.classList.remove('mode-title', 'mode-globe', 'mode-map');
    document.body.classList.add('mode-' + m);
    $('#title').classList.toggle('hidden', m !== 'title');
    $('#globe-ui').classList.toggle('hidden', m !== 'globe');
    $('#map-ui').classList.toggle('hidden', m !== 'map');
    $('#globe').classList.toggle('hidden-layer', m === 'map');
    $('#map').classList.toggle('hidden-layer', m !== 'map');
    this.globe.interactive = m === 'globe';
    this.map.active = m === 'map';
    if (m === 'title') { this.globe.autoRotate = true; this.refreshTitle(); this.war.toggle(false); }
    $('#btn-gocity').classList.toggle('hidden', !this.game);
    if (m === 'map') this.refreshMapUI();
    if (m !== 'map') { this.foundMode = false; if (this.game) this.game.tool = null; this.lord.exit(); }
    this.updateMarkers();
  }

  get cityActive() { return !!this.game && !!this.region; }

  refreshMapUI() {
    const city = this.cityActive;
    $('#buildbar').classList.toggle('hidden', !city);
    $('#objectives').classList.toggle('hidden', !city);
    $('#topbar').classList.toggle('hidden', !this.game);
    $('#explore-bar').classList.toggle('hidden', city);
    if (!city) $('#info').classList.add('hidden');
    $('#btn-found').classList.toggle('hidden', !!this.game);
    this.updateExploreText();
    if (city) { this.ui.buildCards(); this.ui.update(); }
  }

  updateExploreText() {
    let t;
    if (this.foundMode) t = '<b>Clique sur la carte</b> pour poser ton manoir · <b>Échap</b> pour annuler';
    else if (this.mp.active) t = 'Choisis où fonder ta ville dans ce monde partagé (à au moins 3 km des autres villes).';
    else if (this.bots) t = 'Explore la Terre et choisis où fonder ta ville. Des seigneurs IA fondent leurs villages en même temps que toi !';
    else t = 'Explore la région et choisis où fonder ta ville. Survole la carte pour évaluer les terres.';
    $('#explore-text').innerHTML = t;
    $('#site-eval').classList.toggle('hidden', !!this.game);
  }

  cityLatLon() { return this.game.manoirLatLon(); }
  mapCenterLatLon() { return tileToLatLon(this.region, this.map.cx, this.map.cy); }
  regionCenterLatLon() { return tileToLatLon(this.region, this.region.ctx || 0, this.region.cty || 0); }

  // ---------- régions (cadre de coordonnées + centre) ----------
  remoteFrames() {
    const out = [];
    if (this.mp.active) for (const snap of this.mp.knownCities()) {
      const c = cityCenter(snap);
      const m = snap.b.find(b => b[0] === 'manoir');
      const f = snap.frames ? snap.frames[(m && m[4]) || 0] : { lat0: snap.lat0, lon0: snap.lon0 };
      if (c && f) out.push({ f, lat: c.lat, lon: c.lon });
    }
    return out;
  }
  chooseRegion(lat, lon) {
    let frame = null, bd = FRAME_RANGE;
    if (this.game) for (const f of this.game.s.frames) { const d = haversine(lat, lon, f.lat0, f.lon0); if (d < bd) { bd = d; frame = f; } }
    if (!frame) { let b2 = 80000; for (const r of this.remoteFrames()) { const d = haversine(lat, lon, r.lat, r.lon); if (d < b2) { b2 = d; frame = r.f; } } }
    if (!frame && this.region && haversine(lat, lon, this.region.lat0, this.region.lon0) < FRAME_RANGE) frame = this.region;
    if (!frame) frame = { lat0: Math.round(lat * 1e4) / 1e4, lon0: Math.round(lon * 1e4) / 1e4 };
    const t = latLonToTile(withCos(frame), lat, lon);
    return { lat0: frame.lat0, lon0: frame.lon0, ctx: Math.round(t.tx / PATCH_CH) * PATCH_CH, cty: Math.round(t.ty / PATCH_CH) * PATCH_CH };
  }
  ensureRegion(a, text) {
    const run = async () => {
      if (this.region && sameRegion(this.region, a)) return this.region;
      if (text) this.loader(text);
      this.buildingRegion = a;
      try {
        const region = await this.regions.build(a);
        const lordSaved = this.lord.beforeRegion();
        this.region = region;
        this.regionId++;
        this.map.setRegion(region, this.regionId);
        this.setupPatch();
        if (this.game) this.game.setView(region);
        this.lord.afterRegion(lordSaved);
        this.botView.reset();
        this.refreshRemotes();
        this.lastBots = 0;
        if (this.mode === 'map') this.refreshMapUI();
        return region;
      } finally { this.buildingRegion = null; if (text) this.loader(null); }
    };
    this.regionChain = this.regionChain.then(run, run);
    return this.regionChain;
  }

  // morceau détaillé sur le globe : mêmes images que la carte 2D
  setupPatch() {
    const c = document.createElement('canvas');
    c.width = c.height = 2048;
    this.patchCanvas = c; this.patchCtx = c.getContext('2d');
    this.globe.setPatch(this.region, c);
    const rcx = (this.region.ctx || 0) / PATCH_CH, rcy = (this.region.cty || 0) / PATCH_CH;
    this.patchOrigin = [rcx, rcy];
    const list = [];
    for (let cy = -2; cy <= 1; cy++) for (let cx = -2; cx <= 1; cx++) list.push([PATCH_LEVEL, rcx + cx, rcy + cy]);
    this.map.setExtra(list);
  }
  onChunk(key, e) {
    if (!this.patchCtx || e.level !== PATCH_LEVEL || !this.patchOrigin) return;
    const [, cx, cy] = key.split(':').map(Number);
    const ix = cx - this.patchOrigin[0], iy = cy - this.patchOrigin[1];
    if (ix < -2 || ix > 1 || iy < -2 || iy > 1) return;
    this.patchCtx.drawImage(e.bitmap, (ix + 2) * 512, (iy + 2) * 512);
    this.globe.updatePatch();
  }

  async enterMap(lat, lon, altM) {
    if (this.entering) return;
    this.entering = true;
    try {
      await this.ensureRegion(this.chooseRegion(lat, lon), 'Arpentage des terres…');
      const t = latLonToTile(this.region, lat, lon);
      this.map.cx = t.tx; this.map.cy = t.ty;
      const viewH = 2 * altM * FOV_TAN / 10;
      this.map.z = Math.max(this.map.zSwitch * 1.08, this.map.H / viewH);
      this.setMode('map');
    } catch (e) { console.error(e); this.ui.toast('Erreur de chargement de la région', 'bad'); }
    finally { this.entering = false; }
  }

  toGlobe() {
    if (this.mode !== 'map') return;
    const ll = this.mapCenterLatLon();
    this.globe.setView(ll.lat, ll.lon, ALT_MAP * 1.35);
    this.setMode('globe');
  }

  goCity() {
    if (!this.game) return;
    const c = this.cityLatLon();
    if (this.mode === 'map' && this.region) {
      const t = latLonToTile(this.region, c.lat, c.lon);
      if (Math.abs(t.tx - (this.region.ctx || 0)) < 9000 && Math.abs(t.ty - (this.region.cty || 0)) < 9000) { this.centerOnCity(); return; }
      this.toGlobe();
    }
    if (this.mode === 'title') this.setMode('globe');
    this.globe.flyTo(c.lat, c.lon, ALT_MAP * 0.8);
  }
  flyToLatLon(lat, lon) {
    if (this.mode === 'map' && this.region) {
      const t = latLonToTile(this.region, lat, lon);
      if (Math.abs(t.tx - (this.region.ctx || 0)) < 9000 && Math.abs(t.ty - (this.region.cty || 0)) < 9000) { this.map.flyTo(t.tx, t.ty + 2, Math.max(this.map.z, 14 * this.map.dpr)); return; }
      this.toGlobe();
    }
    if (this.mode === 'title') this.setMode('globe');
    this.globe.flyTo(lat, lon, ALT_MAP * 0.8);
  }
  goToRemote(pid) {
    const o = this.mp.others.get(pid);
    if (!o || !o.city) return;
    const c = cityCenter(o.city);
    if (c) this.flyToLatLon(c.lat, c.lon);
  }
  goToBot(id) {
    const b = this.bots && this.bots.byId.get(id);
    if (!b) return;
    const g = this.botView.games.get(id);
    if (this.mode === 'map' && g) { const m = g.manoir; this.map.flyTo(m.x + 1.5, m.y + 3, Math.max(this.map.z, 14 * this.map.dpr)); this.war.toggle(false); return; }
    this.war.toggle(false);
    this.flyToLatLon(b.lat, b.lon);
  }

  async checkReanchor() {
    if (this.entering || this.mode !== 'map' || !this.region) return;
    const dx = this.map.cx - (this.region.ctx || 0), dy = this.map.cy - (this.region.cty || 0);
    if (Math.hypot(dx, dy) < 5200) return;
    const ll = this.mapCenterLatLon();
    const a = this.chooseRegion(ll.lat, ll.lon);
    if (sameRegion(a, this.region)) return;
    const z = this.map.z, sameF = sameAnchor(a, this.region);
    const cx = this.map.cx, cy = this.map.cy;
    this.entering = true;
    try {
      await this.ensureRegion(a, 'Nouvelles terres en vue…');
      if (this.lord.active) { this.map.cx = this.lord.x; this.map.cy = this.lord.y; }
      else if (sameF) { this.map.cx = cx; this.map.cy = cy; }
      else { const t = latLonToTile(this.region, ll.lat, ll.lon); this.map.cx = t.tx; this.map.cy = t.ty; }
      this.map.z = z;
    } finally { this.entering = false; }
  }

  // ---------- villes des autres joueurs et des IA ----------
  onRemoteCity(o) { this.refreshRemote(o.pid); this.updateMarkers(); this.mp.renderPlayers(); }
  onRemoteStat(o) {
    const g = this.remoteGames.get(o.pid);
    if (g) { g.s.pop = o.city.pop; g.s.rank = o.city.rank; }
  }
  refreshRemotes() {
    for (const pid of [...this.remoteGames.keys()]) if (!this.mp.others.has(pid)) this.dropRemote(pid);
    if (this.mp.active) for (const pid of this.mp.others.keys()) this.refreshRemote(pid);
  }
  dropRemote(pid) {
    const old = this.remoteGames.get(pid);
    if (!old) return;
    this.invalidateGame(old);
    this.remoteGames.delete(pid);
  }
  refreshRemote(pid) {
    const o = this.mp.others.get(pid);
    const old = this.remoteGames.get(pid);
    const c = o && o.city && cityCenter(o.city);
    if (!c || !this.region) { this.dropRemote(pid); return; }
    const rc = this.regionCenterLatLon();
    if (haversine(c.lat, c.lon, rc.lat, rc.lon) > 400000) { this.dropRemote(pid); return; }
    const g = Game.fromSnapshot(this, o.city, this.region);
    if (old) { g.adoptLife(old); this.invalidateDiff(old, g); } else this.invalidateGame(g);
    this.remoteGames.set(pid, g);
  }
  invalidateGame(g) { for (const k of g.cleared) { const [x, y] = unkey(k); this.map.invalidate(x, y); } }
  invalidateDiff(old, g) {
    for (const k of g.cleared) if (!old.cleared.has(k)) { const [x, y] = unkey(k); this.map.invalidate(x, y); }
    for (const k of old.cleared) if (!g.cleared.has(k)) { const [x, y] = unkey(k); this.map.invalidate(x, y); }
  }
  *otherGames() { yield* this.remoteGames.values(); yield* this.botView.games.values(); }
  othersAt(k) { for (const g of this.otherGames()) if (g.occ.has(k)) return true; return false; }
  blockedForBots(k, botId) {
    if (this.game && this.game.occ.has(k)) return true;
    for (const g of this.remoteGames.values()) if (g.occ.has(k)) return true;
    for (const [id, g] of this.botView.games) if (id !== botId && g.occ.has(k)) return true;
    return false;
  }
  siteTakenByPlayer(b) {
    if (this.game) { const c = this.cityLatLon(); if (haversine(c.lat, c.lon, b.lat, b.lon) < MIN_CITY_DIST) return true; }
    if (this.mp.active) for (const snap of this.mp.knownCities()) { const c = cityCenter(snap); if (c && haversine(c.lat, c.lon, b.lat, b.lon) < MIN_CITY_DIST) return true; }
    return false;
  }
  clearedIn(x0, y0, n) {
    let out = this.game ? this.game.clearedIn(x0, y0, n) : [];
    for (const g of this.otherGames()) { const c = g.clearedIn(x0, y0, n); if (c.length) out = out.concat(c); }
    return out;
  }
  tooCloseTo(lat, lon) {
    for (const snap of this.mp.active ? this.mp.knownCities() : []) {
      const c = cityCenter(snap);
      if (c && haversine(lat, lon, c.lat, c.lon) < MIN_CITY_DIST) return { name: snap.name, owner: snap.owner };
    }
    if (this.bots) for (const { b, st } of this.bots.near(lat, lon, MIN_CITY_DIST, this.worldClock())) return { name: b.name, owner: this.bots.title(b, st.rank) };
    return null;
  }

  // position du joueur pour les autres (globe ou carte)
  presence() {
    if (this.mode === 'map' && this.region) {
      const ll = this.mapCenterLatLon();
      const cur = this.hover ? tileToLatLon(this.region, this.hover.fx, this.hover.fy) : null;
      const lord = this.lord.presence();
      return { mode: 'map', lat: ll.lat, lon: ll.lon, cur, lord };
    }
    if (this.mode === 'globe') return { mode: 'globe', lat: this.globe.lat, lon: this.globe.lon, alt: this.globe.alt };
    return null;
  }

  updateMarkers() {
    if (!this.globe) return;
    const list = [];
    if (this.game) {
      const c = this.cityLatLon();
      list.push({ id: 'me', kind: 'city', lat: c.lat, lon: c.lon, label: this.game.s.name, sub: this.mp.active ? this.settings.name : '', color: this.mp.active ? this.settings.color : null, icon: iconURL('manoir', 64, this.game.s.rank) });
    }
    if (this.mp.active) for (const o of this.mp.others.values()) {
      if (o.city) {
        const c = cityCenter(o.city);
        if (c) list.push({ id: 'c:' + o.pid, kind: 'city', lat: c.lat, lon: c.lon, label: o.city.name, sub: o.name, color: o.color, icon: iconURL('manoir', 64, o.city.rank || 0), dim: !o.online });
      }
      if (o.online && o.pos && o.pos.lat != null) list.push({ id: 'p:' + o.pid, kind: 'player', lat: o.pos.lat, lon: o.pos.lon, label: o.name, color: o.color });
    }
    // étiquettes des villages IA les plus proches du regard
    if (this.bots && this.globe.alt < 0.6) {
      const T = this.worldClock();
      const cand = this.bots.near(this.globe.lat, this.globe.lon, Math.max(150000, this.globe.alt * 2500000), T);
      cand.sort((a, b) => (b.st.rank - a.st.rank) || (a.d - b.d));
      const sep = Math.max(20000, this.globe.alt * 1100000), near = [];
      for (const n of cand) {
        if (near.length >= 9) break;
        if (near.some(m => haversine(m.b.lat, m.b.lon, n.b.lat, n.b.lon) < sep)) continue;
        near.push(n);
      }
      for (const { b, st } of near) list.push({ id: 'b:' + b.id, kind: 'city', lat: b.lat, lon: b.lon, label: b.name, sub: this.bots.title(b, st.rank), color: st.vassal ? st.vassal.color : b.color, icon: iconURL('manoir', 64, st.rank) });
    }
    if (this.war && this.game) for (const m of this.war.globeMarkers()) list.push(m);
    this.globe.setMarkers(list);
  }
  updateBotPoints() {
    if (!this.bots) { this.globe.setBotPoints([]); return; }
    const T = this.worldClock(), pts = [];
    for (const b of this.bots.bots) {
      const st = this.bots.state(b, T);
      if (st.founded) pts.push({ lat: b.lat, lon: b.lon, rank: st.rank, color: st.vassal ? st.vassal.color : b.color });
    }
    this.globe.setBotPoints(pts);
  }

  // ---------- parties ----------
  newGame() {
    const go = (withBots) => {
      if (this.mp.active) this.leaveMultiplayer(false);
      this.game = null;
      this.world = { seed: Math.floor(Math.random() * 4294967295), bots: withBots, events: [] };
      this.preClock = 0;
      this.setupBots(this.world.seed, this.world.events, withBots);
      this.updateMarkers();
      this.setMode('globe');
      this.globe.autoRotate = false;
      this.globe.flyTo(30, 5, 2.2, 1.5);
      this.ui.toast(withBots ? 'Les seigneurs IA fondent leurs villages en ce moment même partout sur Terre…' : 'Tourne le globe et zoome pour choisir où fonder ta ville.', 'big');
    };
    const ask = () => this.ui.modal(`<h2>Bienvenue, fondateur !</h2><div class="help"><ul>
        <li>Voici la <b>vraie Terre</b>. Tourne-la et <b>zoome</b> (molette) là où tu veux vivre, ou cherche un lieu en haut à gauche.</li>
        <li>En zoomant au maximum, tu passes sur la <b>carte 2D à taille réelle</b> : 1 case = 10 mètres. Tu peux construire <b>n'importe où</b>, sans limite.</li>
        <li><b>Villages IA</b> : des centaines de seigneurs fondent leur village en même temps que toi, aux emplacements de vraies villes, et partent de zéro. Certains sont paisibles, d'autres belliqueux…</li></ul></div>`,
      [{ text: 'Seul au monde', fn: () => go(false) }, { text: 'Avec les villages IA', cls: 'green', fn: () => go(true) }]);
    if (this.soloSave && !this.mp.active) {
      this.ui.modal('<h2>Nouvelle partie</h2><p>Ta ville actuelle sera remplacée lorsque tu fonderas la nouvelle. Continuer ?</p>',
        [{ text: 'Annuler' }, { text: 'Nouvelle partie', cls: 'red', fn: () => setTimeout(ask, 50) }]);
    } else ask();
  }

  async loadGame(data, mpMode = false) {
    try {
      this.lord.exit();
      this.entering = true;
      this.game = null;
      Game.migrate(data);
      if (!mpMode) {
        data.world ||= { seed: (data.founded || 1) >>> 0, bots: true, events: [] };
        this.world = data.world;
        this.setupBots(data.world.seed, data.world.events, data.world.bots);
      }
      const m = data.buildings.find(b => b.type === 'manoir');
      const f = data.frames[m.f || 0];
      const ll = tileToLatLon(withCos(f), m.px + 1.5, m.py + 1.5);
      const g = new Game(this, data);
      this.game = g;
      await this.ensureRegion(this.chooseRegion(ll.lat, ll.lon), 'Retour dans ta ville…');
      g.setView(this.region);
      this.invalidateGame(g);
      const mm = g.manoir;
      this.map.cx = mm.x + 1.5; this.map.cy = mm.y + 4; this.map.z = 24 * this.map.dpr;
      this.setMode('map');
      this.ui.toast(`Bon retour à ${data.name} !`);
      this.peam.ready.then(() => this.peam.restore(g));
    } catch (e) {
      console.error(e);
      this.ui.toast('Impossible de charger la ville', 'bad');
    } finally { this.entering = false; }
  }

  // ---------- multijoueur ----------
  async startMultiplayer(code, mode, host, isNew = false) {
    if (this.game && !this.mp.active) this.writeSave();
    if (this.mp.active) this.leaveMultiplayer(false);
    this.loader(mode === 'direct' ? 'Connexion à l\'hôte…' : 'Connexion à la partie en ligne…');
    this.game = null;
    for (const pid of [...this.remoteGames.keys()]) this.dropRemote(pid);
    let world;
    try { world = await this.mp.join(code, mode, host); } finally { this.loader(null); }
    if (world && world.city && world.city.buildings) {
      await this.loadGame(world.city, true);
      if (this.game) this.game.dirty = true;
      this.refreshRemotes();
    } else {
      this.setMode('globe');
      this.globe.autoRotate = false;
      this.globe.flyTo(30, 5, 2.2, 1.5);
      this.refreshRemotes();
      this.ui.modal(`<h2>Partie ${esc(this.mp.code)}</h2><div class="help"><ul>
        ${isNew ? `<li>Donne ce code à tes amis : <span class="ipbox">${esc(this.mp.code)}</span> Ils cliquent sur « Multijoueur en ligne » et le tapent.</li>` : ''}
        <li>Vous partagez la <b>même Terre</b> avec des centaines de <b>villages IA</b> qui grandissent en même temps que vous.</li>
        <li>Chacun développe sa ville. Vous pouvez vous allier (cadeaux, chat) ou vous <b>déclarer la guerre</b> et vous attaquer.</li>
        <li>La partie est sauvegardée sur ton PC : tu la retrouves dans « Mes parties sauvegardées ».</li></ul></div>`, [{ text: 'C\'est parti !', cls: 'green' }]);
    }
    this.updateMarkers();
    this.mp.renderPlayers();
  }

  async hostDirect(code) {
    code = code || newCode();
    const r = await fetch(`api/host/start?port=7777&code=${encodeURIComponent(code)}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (!r || !r.running) throw new Error(r && r.error ? r.error : 'le serveur n\'a pas pu démarrer (port 7777 occupé ?)');
    await this.startMultiplayer(null, 'direct', '127.0.0.1:' + r.port, true);
    const rooms = this.settings.rooms;
    if (rooms[0]) { rooms[0].host = 'localhost-host'; rooms[0].code = r.code || code; this.saveSettings(); }
    const ips = (r.ips || []).map(ip => `<div class="ipbox">${esc(ip)}</div>`).join('') || '<p>(adresse introuvable)</p>';
    this.directAddr = r.ips && r.ips[0] ? (String(r.ips[0]).includes(':') ? String(r.ips[0]) : r.ips[0] + ':' + r.port) : null;
    this.ui.modal(`<h2>Serveur lancé</h2><p>Tes amis cliquent sur « Multijoueur en ligne », puis entrent cette adresse dans <b>Connexion directe</b> :</p>${ips}
      <p class="hint" style="font-size:13px">Même réseau (Wi-Fi/maison) : ça marche directement. Si Windows le demande, autorise l'accès au réseau.<br>
      Par Internet : ouvre le port TCP <b>${r.port}</b> sur ta box et donne ton IP publique, ou utilisez un VPN de jeu (ex. Radmin VPN).<br>
      Garde le jeu ouvert (il peut rester dans la zone de notification) : c'est ton PC qui relie les joueurs.</p>`, [{ text: 'Compris', cls: 'green' }]);
  }

  leaveMultiplayer(toTitle = true) {
    this.writeSave();
    this.mp.leave();
    this.game = null;
    for (const pid of [...this.remoteGames.keys()]) this.dropRemote(pid);
    this.setupBots(0, [], false);
    this.updateMarkers();
    if (toTitle) this.setMode('title');
  }

  onFoundButton() {
    if (this.game) return;
    this.foundMode = !this.foundMode;
    if (this.foundMode && this.map.z < 6 * this.map.dpr) this.map.flyTo(this.map.cx, this.map.cy, 12 * this.map.dpr);
    $('#btn-found').textContent = this.foundMode ? 'Annuler' : 'Fonder ma ville ici';
    this.updateExploreText();
    this.audio.play('click');
  }

  foundCheck(x, y) {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const g = this.map.getTile(x + i, y + j).g;
      if (isWater(g) || g >= 15) return 'Le manoir doit être posé sur la terre ferme';
      if (this.othersAt(tileKey(x + i, y + j))) return 'Ces terres appartiennent déjà à un autre seigneur';
    }
    const ll = tileToLatLon(this.region, x + 1.5, y + 1.5);
    const near = this.tooCloseTo(ll.lat, ll.lon);
    if (near) return `Trop près de ${near.name} (${near.owner}) : éloigne-toi d'au moins 3 km`;
    return null;
  }

  tryFound(tx, ty) {
    const x = Math.floor(tx) - 1, y = Math.floor(ty) - 1;
    const why = this.foundCheck(x, y);
    if (why) { this.ui.toast(why, 'bad'); this.audio.play('error'); return; }
    const sugg = NAMES[Math.floor(Math.random() * NAMES.length)];
    const ll = tileToLatLon(this.region, x + 1.5, y + 1.5);
    const lastLord = this.settings.lord || {};
    const female = !!lastLord.female;
    const lsugg = lastLord.name || (female ? F_NAMES : M_NAMES)[Math.floor(Math.random() * 20)];
    const go = (box) => {
      const fem = box.querySelector('#lord-f').checked;
      const ln = (box.querySelector('#lord-input').value.trim() || lsugg).slice(0, 20);
      this.settings.lord = { name: ln, female: fem }; this.saveSettings();
      this.found(x, y, box.querySelector('#city-input').value.trim() || sugg, ln, fem);
    };
    this.ui.modal(`<h2>Fonder ta ville</h2><p>${fmtLatLon(ll.lat, ll.lon)}</p><p>Quel sera son nom ?</p><input id="city-input" maxlength="28" value="${sugg}">
      <p>Et toi, qui es-tu ? Le prénom de ton seigneur :</p><input id="lord-input" maxlength="20" value="${esc(lsugg)}">
      <div class="sexrow"><label><input type="radio" name="lsex" id="lord-m" ${female ? '' : 'checked'}> Seigneur</label><label><input type="radio" name="lsex" id="lord-f" ${female ? 'checked' : ''}> Dame</label></div>
      <p class="hint" style="font-size:13px">Ton seigneur arrive avec sa famille et quelques villageois. Chaque habitant a sa propre vie : clique sur eux pour la découvrir.</p>`,
      [{ text: 'Annuler' }, { text: 'Fonder !', cls: 'green', fn: (box) => go(box) }],
      (box, close) => {
        const inp = box.querySelector('#city-input');
        inp.focus(); inp.select();
        for (const el of box.querySelectorAll('input[type=text],input:not([type])')) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { close(); go(box); } });
      });
  }

  found(x, y, name, lordName, female) {
    const s = Game.newState(name.slice(0, 28), this.region.lat0, this.region.lon0, x, y);
    if (!this.mp.active) { s.world = this.world || { seed: 1, bots: false, events: [] }; s.time = this.preClock; s.nextEvent = s.time + 150; }
    this.game = new Game(this, s, { region: this.region });
    this.game.pp.populateInitial(6, lordName, !!female, s.name);
    this.peam.unlock(ACH.fondation);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) this.map.invalidate(x + i, y + j);
    this.foundMode = false;
    $('#btn-found').textContent = 'Fonder ma ville ici';
    this.map.flyTo(x + 1.5, y + 3, Math.max(this.map.z, 24 * this.map.dpr));
    this.game.spawnDust(x + 1.5, y + 1.5, 3);
    this.setMode('map');
    this.audio.play('found');
    this.ui.toast(`La ville de ${name} est fondée !`, 'big');
    setTimeout(() => this.ui.toast('Commence par des maisons, un bûcheron et une ferme. Tu peux construire n\'importe où ! Touche L pour incarner ton seigneur.'), 1800);
    if (this.mp.active) this.mp.system(`Tu as fondé la ville de ${name}.`);
    this.lastBots = 0;
    this.writeSave();
  }

  onRankUp(rank) {
    const r = RANKS[rank];
    const art = { Village: 'un village', Bourg: 'un bourg', Ville: 'une ville', Cité: 'une cité', Capitale: 'une capitale' }[r.name] || r.name;
    const msg = `${this.game.s.name} devient ${art} ! Nouveaux bâtiments débloqués.`;
    this.ui.toast(msg, 'big');
    this.notify('Ta ville grandit !', msg);
    this.audio.play('rankup');
    this.ui.buildCards();
    this.game.dirty = true;
    this.updateMarkers();
    this.writeSave();
  }

  selectTool(t) {
    if (!this.game) return;
    this.game.tool = t;
    this.game.selected = null;
    this.ui.showInfo(null);
    this.ui.refreshCards();
    this.audio.play('click');
    if (t && this.map.z < 3 * this.map.dpr) this.map.flyTo(this.map.cx, this.map.cy, 10 * this.map.dpr);
  }

  setSpeed(v) { if (this.game) { this.game.s.speed = v; this.ui.update(); } }

  centerOnCity() {
    if (!this.game) return;
    const c = this.cityLatLon();
    const t = latLonToTile(this.region, c.lat, c.lon);
    if (Math.abs(t.tx - (this.region.ctx || 0)) > 9000 || Math.abs(t.ty - (this.region.cty || 0)) > 9000) { this.goCity(); return; }
    this.map.flyTo(t.tx, t.ty + 1.5, Math.max(10 * this.map.dpr, Math.min(this.map.z, 24 * this.map.dpr)));
  }

  openMenu() {
    const has = !!this.game, mp = this.mp.active;
    this.ui.modal(`<h2>Menu</h2><div class="menu-col">
      <button class="btn" id="m-resume">Reprendre</button>
      ${has || mp ? '<button class="btn" id="m-save">Sauvegarder</button>' : ''}
      ${this.peam.active ? '<button class="btn green" id="m-invite">👥 Inviter des amis</button>' : ''}
      ${has ? '<button class="btn" id="m-war">⚔ Guerre, armée &amp; diplomatie</button><button class="btn" id="m-reg">📜 Registre des habitants</button><button class="btn" id="m-lord">👑 Incarner mon seigneur</button>' : ''}
      ${mp ? '<button class="btn" id="m-leave">Quitter la partie en ligne</button>' : '<button class="btn" id="m-mp">Multijoueur en ligne</button>'}
      <button class="btn" id="m-help">Aide &amp; commandes</button>
      <button class="btn" id="m-settings">Réglages &amp; mises à jour</button>
      <button class="btn" id="m-fs">Plein écran (F11)</button>
      ${mp ? '' : '<button class="btn" id="m-new">Nouvelle partie</button>'}
      ${this.native ? '<button class="btn" id="m-hide">Réduire en arrière-plan</button>' : ''}
      <button class="btn red" id="m-quit">Quitter le jeu</button></div>`, [], (box, close) => {
      box.querySelector('#m-resume').onclick = close;
      const on = (id, f) => { const b = box.querySelector(id); if (b) b.onclick = f; };
      on('#m-save', () => { this.writeSave(); close(); this.ui.toast('Partie sauvegardée'); });
      on('#m-war', () => { close(); this.war.toggle(true); });
      on('#m-invite', () => { close(); this.peam.openInvite(); });
      on('#m-reg', () => { close(); setTimeout(() => this.ui.openRegistry(), 30); });
      on('#m-lord', () => { close(); if (this.mode !== 'map') { this.goCity(); } else this.lord.toggle(true); });
      on('#m-leave', () => { close(); this.leaveMultiplayer(); });
      on('#m-mp', () => { close(); this.mp.openLobby(); });
      on('#m-help', () => this.openHelp());
      on('#m-settings', () => this.openSettings());
      on('#m-fs', () => { close(); this.toggleFullscreen(); });
      on('#m-new', () => { close(); this.newGame(); });
      on('#m-hide', () => { close(); this.writeSave(); window.hideToTray && window.hideToTray(); });
      on('#m-quit', () => { this.writeSave(); setTimeout(() => { if (window.quitApp) window.quitApp(); else window.close(); }, 300); });
    });
  }

  openHelp() {
    this.ui.modal(`<h2>Aide</h2><ul class="help">
      <li><b>Globe</b> : glisse pour tourner, molette pour zoomer, double-clic pour plonger. Cherche un lieu en haut à gauche.</li>
      <li>Zoome au maximum sur le globe : tu passes sur la <b>carte 2D à taille réelle</b> (1 case = 10 m). Dézoome à fond pour revenir au globe.</li>
      <li><b>Carte</b> : glisse pour te déplacer, <kbd>ZQSD</kbd>/<kbd>WASD</kbd> ou flèches, molette pour zoomer. Tu peux <b>construire n'importe où</b>, même très loin de ton manoir.</li>
      <li>Choisis un bâtiment en bas puis clique sur la carte. Chemins, routes, rues pavées et remparts : <b>clique-glisse</b> pour tracer, même en diagonale. Trace une rue pavée sur un chemin pour l'améliorer ; une route qui croise un rempart y perce une porte.</li>
      <li><b>Habitants</b> : chacun a un nom, une famille, une maison, un métier et une vie. Clique sur un habitant pour voir sa fiche (naissance, mariage, enfants…). <kbd>R</kbd> ouvre le registre (habitants, défunts, chronique). Les gens naissent, vieillissent et meurent : un apothicaire et un puits les gardent en bonne santé, un cimetière apaise le deuil.</li>
      <li><b>Mode Seigneur</b> (<kbd>L</kbd>) : incarne ton seigneur et parcours le monde <b>à toute vitesse</b> (routes de tous les villages comprises) avec <kbd>ZQSD</kbd>/flèches. <kbd>Maj</kbd> pour courir ou galoper, <kbd>E</kbd> pour monter à cheval (au manoir ou à l'écurie) ou prendre une barque (à un embarcadère), <kbd>H</kbd> pour siffler ton cheval.</li>
      <li><b>Diplomatie</b> : les seigneurs IA t'écrivent (alliances, mariages, commerce, tributs, menaces). Réponds-leur dans le panneau Guerre (<kbd>G</kbd>) ou clique sur leur village → Diplomatie.</li>
      <li><b>Guerre</b> (<kbd>G</kbd>) : construis une caserne, entraîne des troupes, attaque les villages IA pour les piller ou en faire tes vassaux. Les seigneurs belliqueux peuvent t'attaquer : tours, remparts et château te protègent.</li>
      <li><kbd>Échap</kbd> annule, <kbd>Clic droit</kbd> annule l'outil, <kbd>Suppr</kbd> démolir, <kbd>Espace</kbd> pause, <kbd>C</kbd> centre sur la ville, <kbd>R</kbd> registre, <kbd>L</kbd> mode Seigneur, <kbd>F11</kbd> plein écran.</li>
      <li><b>Multijoueur</b> : crée une partie et donne le code à tes amis. <kbd>T</kbd> pour le chat. Déclare la guerre ou offre des ressources.</li>
      <li>La croix ✕ réduit le jeu dans la <b>zone de notification</b> (en bas à droite) : ta ville continue de grandir en arrière-plan.</li></ul>`, [{ text: 'Compris !' }]);
  }

  toggleFullscreen() {
    if (typeof window.toggleFullscreen === 'function') { window.toggleFullscreen(); return; }
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.();
  }

  // ---------- entrées ----------
  bindGlobe() {
    this.globe.onEnterMap = (lat, lon, altM) => this.enterMap(lat, lon, altM);
    this.globe.onHover = (p) => { $('#globe-coords').textContent = p ? fmtLatLon(p.lat, p.lon) : ''; };
    const inp = $('#search'), res = $('#search-results');
    let sel = 0, items = [];
    const render = () => {
      res.innerHTML = items.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}">${esc(p[0])} <small>${esc(p[2] || '')}</small></div>`).join('');
      res.querySelectorAll('div').forEach(d => d.addEventListener('mousedown', (e) => { e.preventDefault(); pick(items[+d.dataset.i]); }));
    };
    const pick = (p) => {
      if (!p) return;
      inp.value = p[0]; items = []; render(); inp.blur();
      this.audio.play('click');
      this.globe.flyTo(p[3], p[4], ALT_MAP * 0.85);
    };
    inp.addEventListener('input', () => {
      const v = inp.value;
      const m = v.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
      if (m) { items = [[`Coordonnées ${m[1]}, ${m[2]}`, '', '', parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))]]; }
      else items = this.geo.search(v, 8);
      sel = 0; render();
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') pick(items[sel]);
      else if (e.key === 'Escape') { items = []; render(); inp.blur(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { items = []; render(); }, 150));
  }

  bindMap() {
    const map = this.map;
    map.handlers = {
      hasTool: () => this.foundMode || (this.cityActive && !!this.game.tool),
      toolDown: (tx, ty) => { if (!this.foundMode) this.game.toolDown(tx, ty); },
      toolMove: (tx, ty) => { if (!this.foundMode) this.game.toolMove(tx, ty); },
      toolUp: (tx, ty) => { if (this.foundMode) this.tryFound(tx, ty); else this.game.toolUp(tx, ty); this.ui.refreshCards(); },
      click: (tx, ty, button) => {
        if (button === 2) {
          if (this.foundMode) this.onFoundButton();
          else if (this.game && this.game.tool) this.selectTool(null);
          else if (this.game) { this.game.selected = null; this.ui.showInfo(null); }
          return;
        }
        // un habitant sous le curseur ?
        if (this.map.z >= 4 * this.map.dpr * 0.5) {
          if (this.cityActive) {
            const w = this.game.life.hit(tx, ty);
            if (w && w.pid) { this.game.selected = null; this.ui.showPerson(w.pid); this.audio.play('click'); return; }
          }
          for (const rg of this.otherGames()) {
            const w = rg.life.hit(tx, ty);
            if (w && w.aidx !== undefined && w.anon) { if (this.game) { this.game.selected = null; this.game.selPerson = 0; } this.ui.showAnon(rg, w); this.audio.play('click'); return; }
          }
        }
        for (const rg of this.otherGames()) {
          const b = rg.buildingAt(tx, ty);
          if (b && !b.road) { if (this.game) { this.game.selected = null; this.game.selPerson = 0; } this.ui.showRemoteInfo(rg, b); this.audio.play('click'); return; }
        }
        if (!this.cityActive) { this.ui.showInfo(null); return; }
        const b = this.game.buildingAt(tx, ty);
        this.game.selPerson = 0; this.followPid = 0;
        if (b && !b.road) { this.game.selected = b; this.ui.showInfo(b); this.audio.play('click'); }
        else { this.game.selected = null; this.ui.showInfo(null); }
      },
      hover: (tx, ty) => this.onHover(tx, ty),
      zoomOut: () => this.toGlobe(),
    };
  }

  onHover(tx, ty) {
    if (tx === null || !this.region) { this.ui.tileInfo(null); this.hover = null; if (this.game) this.game.hoverTile = null; return; }
    const x = Math.floor(tx), y = Math.floor(ty);
    this.hover = { x, y, fx: tx, fy: ty };
    if (this.cityActive) {
      this.game.hoverTile = { x, y };
      const b = this.game.buildingAt(x, y);
      this.game.hoverB = b && !b.road ? b : null;
    }
    for (const rg of this.otherGames()) { const b = rg.buildingAt(x, y); rg.hoverB = b && !b.road ? b : null; }
    const now = performance.now();
    if (now - (this.lastHoverInfo || 0) < 60) return;
    this.lastHoverInfo = now;
    const t = this.map.getTile(x, y);
    const ll = tileToLatLon(this.region, x + 0.5, y + 0.5);
    if (this.cityActive && this.map.z >= 2 * this.map.dpr) {
      const w = this.game.life.hit(tx, ty);
      const p = w && w.pid && this.game.pp.get(w.pid);
      if (p) { this.ui.tileInfo(`<b>${esc(this.game.pp.fullName(p))}</b>, ${Math.floor(this.game.pp.age(p))} ans<br>${esc(this.game.pp.jobName(p))}${w.why ? ' · ' + esc(w.why) : ''}<br><small>Clique pour voir sa vie</small>`); return; }
    }
    let txt = `<b>${GROUND_NAMES[t.g]}</b>`;
    const k = tileKey(x, y);
    let cleared = this.cityActive && this.game.cleared.has(k);
    for (const rg of this.otherGames()) if (rg.cleared.has(k)) cleared = true;
    if (t.t && !cleared) txt += ` · ${TREE_NAMES[t.t]}`;
    if (!isWater(t.g) && t.g < 15) txt += ` · alt. ${Math.round(t.h)} m`;
    txt += `<br>${fmtLatLon(ll.lat, ll.lon)}`;
    this.ui.tileInfo(txt);
    if (!this.game && now - (this.lastEval || 0) > 120) {
      this.lastEval = now;
      const ev = evaluateSite(this.map, x, y);
      const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
      $('#site-eval').innerHTML = [['Bois', ev.wood], ['Terres', ev.food], ['Pierre', ev.stone], ['Eau', ev.water], ['Espace', ev.space]]
        .map(([a, b]) => `<div class="ev">${a}<div class="stars">${stars(b)}</div></div>`).join('');
    }
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'F11') { e.preventDefault(); this.toggleFullscreen(); return; }
      if (e.code === 'Escape') {
        if (this.ui.modalOpen) { this.ui.closeModal(); return; }
        if (this.war.open) { this.war.toggle(false); return; }
        if (this.foundMode) { this.onFoundButton(); return; }
        if (this.lord.active) { this.lord.exit(); return; }
        if (this.game && this.game.tool) { this.selectTool(null); return; }
        if (this.game && this.game.selected) { this.game.selected = null; this.ui.showInfo(null); return; }
        if (this.mode === 'map' || this.mode === 'globe') this.openMenu();
        return;
      }
      if (this.ui.modalOpen) return;
      if ((e.code === 'KeyT' || e.code === 'Enter') && this.mp.active && this.mode !== 'title') { e.preventDefault(); $('#chat-input').focus(); return; }
      if (e.code === 'KeyG' && this.game && this.mode !== 'title') { this.war.toggle(); return; }
      if (e.code === 'KeyR' && this.game && this.mode !== 'title' && !e.ctrlKey) { this.ui.openRegistry(); return; }
      this.keys.add(e.code);
      if (this.mode !== 'map') return;
      if (e.code === 'KeyL' && this.game) { this.lord.toggle(); return; }
      if (this.lord.active) {
        if (e.code === 'KeyE') { this.lord.action(); return; }
        if (e.code === 'KeyH') { this.lord.whistle(); return; }
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      }
      if (this.followPid && /^(Arrow|Key[WASDZQ])/.test(e.code)) this.followPid = 0;
      if (e.code === 'Space' && this.game) { e.preventDefault(); this.setSpeed(this.game.s.speed ? 0 : (this.lastSpeed || 1)); if (this.game.s.speed) this.lastSpeed = this.game.s.speed; }
      if (e.code === 'KeyC') this.centerOnCity();
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.cityActive) this.selectTool(this.game.tool === 'demolish' ? null : 'demolish');
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.map.zoomAt(this.map.W / 2, this.map.H / 2, 1.25);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.map.zoomAt(this.map.W / 2, this.map.H / 2, 0.8);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---------- simulation ----------
  simulate(dt) {
    const solo = !this.mp.active;
    if (!this.game && this.bots && solo) this.preClock += dt;
    if (this.game && (!this.ui.modalOpen || !solo || this.bgMode)) this.game.update(dt);
    this.war.update();
    this.mp.tick(dt, performance.now());
  }
  // appelé par l'horloge d'arrière-plan quand la fenêtre est cachée
  background() {
    const now = performance.now();
    let dt = Math.min(6 * 3600, (now - this.lastSim) / 1000);
    this.lastSim = now;
    this.bgMode = true;
    while (dt > 0) { const d = Math.min(dt, 60); this.simulate(d); dt -= d; }
    this.bgMode = false;
  }

  frame(dt, t) {
    const now = performance.now();
    // reprise après une longue absence (fenêtre cachée sans horloge) : rattrapage
    const gap = (now - this.lastSim) / 1000;
    if (gap > 2) { this.lastSim = now - 100; this.bgMode = true; let r = Math.min(6 * 3600, gap); while (r > 0) { const d = Math.min(r, 60); this.simulate(d); r -= d; } this.bgMode = false; }
    this.lastFrame = now; this.lastSim = now;
    this.simulate(dt);
    for (const g of this.otherGames()) g.update(dt);
    const showGlobe = this.mode !== 'map' || this.switchT > 0;
    const showMap = this.mode === 'map' || this.switchT > 0;
    this.switchT = Math.max(0, this.switchT - dt);
    if (showGlobe) {
      this.globe.update(dt);
      this.globe.render();
      $('#reticle').classList.toggle('hidden', !(this.mode === 'globe' && this.globe.alt < 0.6));
      // préchargement de la région sous le regard : transition fluide globe -> carte
      if (this.mode === 'globe' && this.globe.alt < 0.4 && this.globe.settled && !this.entering && !this.buildingRegion) {
        const a = this.chooseRegion(this.globe.lat, this.globe.lon);
        if (!sameRegion(this.region, a)) this.ensureRegion(a).catch(() => { });
      }
    } else $('#reticle').classList.add('hidden');
    pathQueue.run(this.mode === 'map' ? 4 : 1.5);
    flushAtlas();
    if (showMap && this.region) {
      this.map.update(dt, this.mode === 'map' && !this.lord.active ? this.keys : null);
      if (this.mode === 'map') { this.lord.update(dt, this.keys); this.followStep(dt); }
      this.map.draw(t, (ctx, map, time) => this.drawWorld(ctx, map, time));
    } else if (this.region) this.map.pump();
    // villages IA autour de la région
    if (this.bots && this.region && (this.mode === 'map' || this.globe.alt < 0.5) && t - this.lastBots > 400) {
      this.lastBots = t;
      this.botView.update(this.bots, this.region, this.worldClock(), this.mode === 'map' ? 14 : 6);
    }
    if (this.bots && t - this.lastBotPoints > 5000) { this.lastBotPoints = t; this.updateBotPoints(); }
    if (t - this.lastUI > 250) {
      this.lastUI = t;
      if (this.game && this.mode === 'map') this.ui.update();
      this.peam.tick();
      if (this.mode === 'map') this.checkReanchor();
    }
    if (t - this.lastMarkers > 700) { this.lastMarkers = t; if (this.mode !== 'map') this.updateMarkers(); }
  }

  drawWorld(ctx, map, time) {
    for (const g of this.otherGames()) g.draw(ctx, map, time);
    if (this.cityActive) this.game.draw(ctx, map, time);
    if (this.game) this.war.draw(ctx, map);
    if (this.mp.active) this.drawPresence(ctx, map);
    if (this.foundMode && this.hover) {
      const x = this.hover.x - 1, y = this.hover.y - 1;
      const z = map.z, k = z / 16;
      const [sx, sy] = map.toScreen(x, y);
      const ok = !this.foundCheck(x, y);
      ctx.fillStyle = ok ? 'rgba(120,230,120,0.35)' : 'rgba(240,80,60,0.45)';
      ctx.fillRect(sx, sy, 3 * z, 3 * z);
      if (z >= 2) {
        const spr = getSprite('manoir', 0, 0);
        ctx.globalAlpha = 0.75;
        ctx.drawImage(spr, Math.round(sx), Math.round(sy - BUILDINGS.manoir.top * k), spr.width * k, spr.height * k);
        ctx.globalAlpha = 1;
      }
    }
  }

  // caméra qui suit un habitant
  follow(pid) {
    if (!this.game) return;
    this.followPid = pid;
    const w = this.game.life.walkers.find(x => x.pid === pid);
    if (w) this.map.flyTo(w.x, w.y, Math.max(this.map.z, 22 * this.map.dpr));
  }
  followStep(dt) {
    const g = this.game;
    if (!this.followPid || !g || this.map.fly) return;
    if (g.selPerson !== this.followPid || this.lord.active) { this.followPid = 0; return; }
    const w = g.life.walkers.find(x => x.pid === this.followPid);
    if (!w) return;
    const k = Math.min(1, dt * 3);
    this.map.cx += (w.x - this.map.cx) * k; this.map.cy += (w.y - this.map.cy) * k;
  }

  // seigneurs et curseurs des autres joueurs présents dans la même région
  drawPresence(ctx, map) {
    const d = map.dpr;
    for (const o of this.mp.others.values()) {
      const p = o.online && o.pos;
      if (!p || p.mode !== 'map') continue;
      if (p.lord && map.z >= 2) this.drawOtherLord(ctx, map, o, p.lord);
      if (!p.cur) continue;
      const t = latLonToTile(this.region, p.cur.lat, p.cur.lon);
      if (Math.abs(t.tx - (this.region.ctx || 0)) > 9800 || Math.abs(t.ty - (this.region.cty || 0)) > 9800) continue;
      const [x, y] = map.toScreen(t.tx, t.ty);
      if (x < -50 || y < -50 || x > map.W + 50 || y > map.H + 50) continue;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.fillStyle = o.color; ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16 * d); ctx.lineTo(4.5 * d, 12 * d); ctx.lineTo(10 * d, 12 * d); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.font = `bold ${12 * d}px "Palatino Linotype", Georgia, serif`;
      ctx.lineWidth = 3 * d; ctx.strokeText(o.name, 12 * d, 24 * d);
      ctx.fillStyle = o.color; ctx.fillText(o.name, 12 * d, 24 * d);
      ctx.restore();
    }
  }
}

App.prototype.drawOtherLord = function (ctx, map, o, L) {
  const t = latLonToTile(this.region, L.lat, L.lon);
  const [x, y] = map.toScreen(t.tx, t.ty);
  if (x < -60 || y < -60 || x > map.W + 60 || y > map.H + 60) return;
  const k = map.z / 16, d = map.dpr;
  const look = { ...lookOf(L.lk || 0, L.s || 0, 30), role: 'lord', color: o.color, tool: TOOLS.sword };
  const fr = L.mv ? 1 + (Math.floor(performance.now() / 250) % 2) : 0;
  if (L.m === 'horse') drawAt(ctx, horseSprite('noir', L.mv ? 1 + (Math.floor(performance.now() / 120) % 4) : 0, look), x, y, k * 0.8, L.d < 0, 0.5, 1);
  else if (L.m === 'boat') drawAt(ctx, boatSprite('barque', fr % 2, o.color, look), x, y + 3 * k, k, L.d < 0, 0.5, 1);
  else drawAt(ctx, personSprite(look, 2, fr), x, y + k, k, L.d < 0, 0.45, 1);
  ctx.save();
  ctx.font = `bold ${12 * d}px "Palatino Linotype", Georgia, serif`;
  ctx.textAlign = 'center'; ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(20,14,8,0.9)';
  const ty = y - (L.m === 'foot' ? 12 : 17) * k - 6 * d;
  ctx.strokeText('👑 ' + o.name, x, ty); ctx.fillStyle = o.color; ctx.fillText('👑 ' + o.name, x, ty);
  ctx.restore();
};

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'O'}`;
}

const app = new App();
window.app = app;
app.start().catch((e) => {
  console.error(e);
  document.getElementById('loader-text').textContent = 'Erreur au démarrage : ' + e.message;
});
