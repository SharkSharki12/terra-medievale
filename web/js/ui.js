// Interface (DOM) : barre de ressources, construction, infos, objectifs, notifications, fenêtres
import { BUILDINGS, RANKS, RES, RES_NAMES, CATS, iconURL, resIconURL } from './buildings.js';
import { OBJECTIVES, fmtCost, UNITS, UNIT_TYPES } from './game.js';
import { TEMPER_NAMES } from './bots.js';
import { YEAR, JOBS, TRAITS, CAUSES, fmtDate, yearOf, seasonOf, lookOf, fromPlace } from './people.js';
import { personSprite, spriteCanvas } from './actors.js';

const $ = (s) => document.querySelector(s);

export class UI {
  constructor(app) {
    this.app = app;
    this.cat = 'habitat';
    this.icons = {};
    for (const r of [...RES, 'pop', 'happy', 'crown', 'army', 'shield']) this.icons[r] = resIconURL(r, 22);
    this.buildRes();
    this.buildTabs();
    $('#rank-icon').src = this.icons.crown;
    document.querySelectorAll('#speed .btn').forEach(b => b.addEventListener('click', () => { this.app.setSpeed(+b.dataset.speed); this.app.audio.play('click'); }));
    $('#btn-demolish').addEventListener('click', () => this.app.selectTool(this.app.game && this.app.game.tool === 'demolish' ? null : 'demolish'));
    $('#btn-center').addEventListener('click', () => this.app.centerOnCity());
    $('#btn-toglobe').addEventListener('click', () => this.app.toGlobe());
    $('#btn-menu').addEventListener('click', () => this.app.openMenu());
    $('#btn-globe-menu').addEventListener('click', () => this.app.openMenu());
    $('#btn-sound').addEventListener('click', () => { this.app.audio.on = !this.app.audio.on; this.refreshSound(); });
    $('#objectives').addEventListener('click', (e) => { if (e.target.tagName === 'H3') $('#objectives').classList.toggle('collapsed'); });
    $('#btn-war').addEventListener('click', () => { this.app.audio.play('click'); this.app.war.toggle(); });
    // boutons dans le panneau d'info (délégation : le contenu est régénéré)
    $('#info').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const g = this.app.game;
      this.app.audio.play('click');
      if (b.dataset.act === 'train' && g) { const err = g.train(b.dataset.u, +b.dataset.n); if (err) this.toast(err, 'bad'); }
      else if (b.dataset.act === 'attack') this.app.war.openAttack(b.dataset.kind, b.dataset.kind === 'bot' ? +b.dataset.id : b.dataset.id);
      else if (b.dataset.act === 'warpanel') this.app.war.toggle(true);
      else if (b.dataset.act === 'demolish' && g && g.selected) { const sb = g.selected; g.demolishAt(sb.x, sb.y); g.selected = null; this.showInfo(null); }
      else if (b.dataset.act === 'person' && g) this.showPerson(+b.dataset.pid, true);
      else if (b.dataset.act === 'follow' && g) this.app.follow(+b.dataset.pid);
      else if (b.dataset.act === 'lord') this.app.lord.toggle(true);
      else if (b.dataset.act === 'registry') this.openRegistry(b.dataset.tab || 'vivants');
      else if (b.dataset.act === 'diplo') this.app.diplo.open(+b.dataset.id);
      else if (b.dataset.act === 'pally') this.app.mp.proposeAlliance(b.dataset.pid);
      else if (b.dataset.act === 'building' && g) { const bb = g.byId.get(+b.dataset.id); if (bb) { g.selected = bb; g.selPerson = 0; this.showInfo(bb); const B = BUILDINGS[bb.type]; this.app.map.flyTo(bb.x + B.w / 2, bb.y + B.h / 2 + 1, Math.max(this.app.map.z, 16 * this.app.map.dpr)); } }
    });
    $('#res-army-wrap') && $('#res-army-wrap').addEventListener('click', () => this.app.war.toggle());
    $('#btn-registry').addEventListener('click', () => { this.app.audio.play('click'); this.openRegistry('vivants'); });
    $('#btn-lord').addEventListener('click', () => this.app.lord.toggle());
    this.refreshSound();
  }

  refreshSound() { $('#btn-sound').style.opacity = this.app.audio.on ? 1 : 0.45; }

  buildRes() {
    const el = $('#resources');
    el.innerHTML = '';
    this.resEls = {};
    const mk = (k, title) => {
      const d = document.createElement('div');
      d.className = 'res'; d.title = title;
      d.innerHTML = `<img src="${this.icons[k]}"><div class="val"><span class="n">0</span><span class="rate"></span></div>`;
      el.appendChild(d);
      this.resEls[k] = { n: d.querySelector('.n'), rate: d.querySelector('.rate') };
    };
    for (const r of RES) mk(r, RES_NAMES[r]);
    mk('pop', 'Habitants / capacité (clique pour ouvrir le registre — touche R)');
    { const d = el.lastChild; d.style.cursor = 'pointer'; d.addEventListener('click', () => this.openRegistry('vivants')); }
    mk('happy', 'Bonheur');
    mk('army', 'Troupes (clique pour ouvrir le panneau Guerre — touche G)');
    const last = el.lastChild; last.style.cursor = 'pointer'; last.addEventListener('click', () => this.app.war.toggle());
  }

  buildTabs() {
    const t = $('#build-tabs');
    t.innerHTML = '';
    for (const c of CATS) {
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = c.name; b.dataset.cat = c.id;
      b.addEventListener('click', () => { this.cat = c.id; this.app.audio.play('click'); this.buildCards(); });
      t.appendChild(b);
    }
    this.buildCards();
  }

  buildCards() {
    document.querySelectorAll('#build-tabs .btn').forEach(b => b.classList.toggle('active', b.dataset.cat === this.cat));
    const list = $('#build-list');
    list.innerHTML = '';
    this.cards = {};
    for (const [type, B] of Object.entries(BUILDINGS)) {
      if (B.cat !== this.cat) continue;
      const d = document.createElement('div');
      d.className = 'card';
      d.title = B.desc;
      const cost = Object.entries(B.cost).map(([r, v]) => `<span data-r="${r}"><img src="${this.icons[r]}">${v}</span>`).join('') || '<span>gratuit</span>';
      d.innerHTML = `<img src="${iconURL(type)}"><div class="nm">${B.name}</div><div class="cost">${cost}</div><div class="lockmsg"></div>`;
      d.addEventListener('click', () => {
        const g = this.app.game;
        if (!g) return;
        if (B.rank > g.s.rank) { this.toast(`${B.name} : débloqué au rang ${RANKS[B.rank].name}`, 'bad'); this.app.audio.play('error'); return; }
        this.app.selectTool(g.tool === type ? null : type);
      });
      list.appendChild(d);
      this.cards[type] = d;
    }
    this.refreshCards();
  }

  refreshCards() {
    const g = this.app.game;
    if (!g) return;
    for (const [type, d] of Object.entries(this.cards || {})) {
      const B = BUILDINGS[type];
      const locked = B.rank > g.s.rank;
      d.classList.toggle('locked', locked);
      d.querySelector('.lockmsg').textContent = locked ? `Rang ${RANKS[B.rank].name}` : '';
      d.classList.toggle('sel', g.tool === type);
      d.querySelectorAll('.cost span').forEach(sp => sp.classList.toggle('lack', (g.s.res[sp.dataset.r] || 0) < B.cost[sp.dataset.r]));
    }
    $('#btn-demolish').classList.toggle('active', g.tool === 'demolish');
  }

  update() {
    const g = this.app.game;
    if (!g) return;
    const s = g.s;
    $('#city-name').textContent = s.name;
    const next = RANKS[s.rank + 1];
    $('#city-rank').textContent = RANKS[s.rank].name + (next ? ` · prochain rang à ${next.pop} hab.` : '');
    for (const r of RES) {
      const e = this.resEls[r];
      e.n.textContent = fmt(s.res[r]);
      const rt = g.rates[r];
      e.rate.textContent = Math.abs(rt) < 0.05 ? '' : `${rt > 0 ? '+' : ''}${fmt(rt)}/min`;
      e.rate.classList.toggle('neg', rt < 0);
    }
    this.resEls.pop.n.textContent = `${s.pop}/${g.cap}`;
    const sick = g.pp ? s.people.reduce((a, p) => a + (p.sick ? 1 : 0), 0) : 0;
    this.resEls.pop.rate.textContent = s.epi && s.epi.until > s.time ? `☠ peste · ${sick} malades` : g.jobs ? `${g.jobs} emplois` : '';
    this.resEls.pop.rate.classList.toggle('neg', !!(s.epi && s.epi.until > s.time));
    this.resEls.happy.n.textContent = `${Math.round(g.happy)}%`;
    this.resEls.army.n.textContent = `${g.armyAtHome}`;
    const inc = s.incoming.length;
    this.resEls.army.rate.textContent = inc ? `⚠ ${inc} attaque${inc > 1 ? 's' : ''}` : s.armies.length ? `${s.armies.length} en campagne` : `déf. ${Math.round(g.defensePower())}`;
    this.resEls.army.rate.classList.toggle('neg', inc > 0);
    this.resEls.happy.rate.textContent = g.feast > 0 ? 'Fête !' : '';
    $('#date').textContent = g.dateText();
    document.querySelectorAll('#speed .btn').forEach(b => b.classList.toggle('active', +b.dataset.speed === s.speed));
    this.refreshCards();
    this.updateObjectives();
    if (g.selected) this.showInfo(g.selected);
    else if (g.selPerson) this.showPerson(g.selPerson);
    if (this.regOpen && $('#modal').classList.contains('hidden')) this.regOpen = false;
  }

  updateObjectives() {
    const g = this.app.game;
    const el = $('#objectives');
    const o = OBJECTIVES[g.s.obj];
    let html = '<h3>Objectifs ▾</h3><div class="body">';
    if (o) {
      const [a, b] = o.prog(g);
      html += `<div class="obj"><b>${o.text}</b><div class="prog"><div style="width:${Math.min(100, (a / b) * 100)}%"></div></div><div class="reward">${Math.min(a, b)}/${b} · récompense : ${fmtCost(o.reward)}</div></div>`;
    } else html += '<div class="obj">Tous les objectifs sont accomplis. Ta capitale rayonne sur le monde !</div>';
    html += `<div class="reward" style="margin-top:6px">Objectif ${Math.min(g.s.obj + 1, OBJECTIVES.length)} / ${OBJECTIVES.length}</div></div>`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }

  showInfo(b) {
    const g = this.app.game;
    const el = $('#info');
    if (!b) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const B = BUILDINGS[b.type];
    let h = `<h3><img src="${iconURL(b.type, 36, g.s.rank)}">${b.type === 'manoir' ? manoirName(g.s.rank) : B.name}</h3><div class="desc">${B.desc}</div>`;
    if (b.type === 'manoir') {
      h += line('Rang', RANKS[g.s.rank].name);
      h += line('Habitants', `${g.s.pop} / ${g.cap}`);
      h += line('Bonheur', `${Math.round(g.happy)} %`);
      h += line('Travailleurs', `${Math.round(g.staffing * 100)} % des emplois pourvus`);
      h += line('Défense', `${Math.round(g.defensePower())}`);
      h += line('Troupes', `${g.armyAtHome} / ${g.armyCap}`);
      if (g.pp) {
        const L = g.pp.lord;
        if (L) h += line(g.pp.lordTitle(L), personLink(g, L));
        const st = g.pp.stats();
        h += line('Enfants · adultes · anciens', `${st.kids} · ${st.adults} · ${st.elders}`);
        h += line('Naissances · décès', `${st.births} · ${st.deaths}`);
        if (g.pp.unemployed) h += line('Sans emploi', g.pp.unemployed);
      }
      h += `<div class="btns"><button class="btn small" data-act="registry">📜 Registre</button><button class="btn small" data-act="lord">👑 Incarner</button><button class="btn small" data-act="warpanel">⚔ Guerre</button></div>`;
      h += residents(g, b);
    } else {
      if (B.pop) h += line('Logement', `${B.pop} habitants`);
      if (B.prod) {
        const e = g.efficiency(b);
        for (const r in B.prod) h += line(RES_NAMES[r], `+${fmt(B.prod[r] * e * 60)}/min`);
        h += line('Efficacité', `${Math.round(e * 100)} %`);
      }
      if (B.site) h += line('Qualité du site', `${Math.round((b.site ?? 1) * 100)} %`);
      if (B.jobs) h += line('Emplois', g.pp ? `${g.s.people.filter(p => p.w === b.id).length} / ${B.jobs}` : `${B.jobs}`);
      if (B.happy) h += line('Bonheur', `+${B.happy}`);
      if (!B.wall) h += line('Relié par la route', g.connected.has(b.id) ? 'oui (+20 %)' : 'non');
      const unit = UNIT_TYPES.find(u => UNITS[u].needs === b.type);
      if (unit) {
        const U = UNITS[unit];
        h += `<div class="train"><b>${U.name}</b> : ${g.s.army[unit] || 0} · coût ${fmtCost(U.cost)}<div class="btns">${[1, 5, 10].map(n => `<button class="btn small green" data-act="train" data-u="${unit}" data-n="${n}">+${n}</button>`).join('')}</div>`;
        const q = g.s.queue.filter(x => x.u === unit).reduce((a, x) => a + x.n, 0);
        if (q) h += `<div class="desc">En entraînement : ${q}</div>`;
        h += `</div>`;
      }
      h += residents(g, b);
      h += `<div class="btns">${unit || b.type === 'tour' || b.type === 'chateau' ? '<button class="btn small" data-act="warpanel">⚔ Guerre</button>' : ''}<button class="btn small red" data-act="demolish">Démolir (rembourse 50 %)</button></div>`;
    }
    if (el.dataset.h === h) return;
    el.innerHTML = h; el.dataset.h = h;
  }

  showRemoteInfo(rg, b) {
    const el = $('#info');
    el.classList.remove('hidden');
    const B = BUILDINGS[b.type];
    const nm = b.type === 'manoir' ? manoirName(rg.s.rank) : B.name;
    let h = `<h3><img src="${iconURL(b.type, 36, rg.s.rank)}">${esc(nm)}</h3>` +
      line('Ville', esc(rg.s.name)) + line('Seigneur', `<span style="color:${esc(rg.color)}">${esc(rg.owner)}</span>`) +
      line('Rang', RANKS[rg.s.rank].name) + line('Habitants', rg.s.pop);
    if (rg.isBot) {
      const t = this.app.war.target('bot', rg.bot.id);
      if (t) {
        h += line('Caractère', TEMPER_NAMES[t.temper]) + line('Armée (estimée)', `~${t.army}`) + line('Défense (estimée)', `~${t.def}`);
        const W = this.app.bots, nm = (id) => { const o = W.byId.get(id); return o ? esc(o.name) : '?'; };
        if (rg.bot.allies && rg.bot.allies.length) h += line('Alliés', rg.bot.allies.slice(0, 4).map(nm).join(', '));
        if (t.st.overlord) h += line('Suzerain', esc(t.st.overlord.name));
        if (t.st.lastWar && this.app.worldClock() - t.st.lastWar.t < 1800) { const w = t.st.lastWar; const foe = w.a === rg.bot.id ? w.d : w.a; h += line('Dernière guerre', `${w.a === rg.bot.id ? 'contre' : 'attaqué par'} ${nm(foe)} · ${(w.a === rg.bot.id) === w.win ? 'victoire' : 'défaite'}`); }
        if (t.vassal) h += line('Vassal de', `<span style="color:${esc(t.vassal.color)}">${esc(t.vassal.pid === this.app.settings.pid ? 'toi' : t.vassal.name)}</span>`);
        if (this.app.diplo && this.app.game) { const d = this.app.diplo.rel(t.id); h += line('Relation avec toi', `${this.app.diplo.statusName(d)} (${d.v > 0 ? '+' : ''}${Math.round(d.v)})`); }
        if (this.app.game) h += `<div class="btns"><button class="btn small" data-act="diplo" data-id="${t.id}">🕊 Diplomatie</button>${!(t.vassal && t.vassal.pid === this.app.settings.pid) ? `<button class="btn small red" data-act="attack" data-kind="bot" data-id="${t.id}">⚔ Attaquer</button>` : ''}</div>`;
      }
    } else if (rg.pid && this.app.game) {
      const rel = this.app.mp.relation(rg.pid);
      h += line('Relation', rel === 'guerre' ? '<span class="atwar">en guerre</span>' : rel === 'alliance' ? '<span class="ally">allié</span>' : 'en paix');
      h += `<div class="btns"><button class="btn small" data-act="warpanel">⚔ Guerre</button>${rel === 'paix' ? `<button class="btn small green" data-act="pally" data-pid="${esc(rg.pid)}">🤝 Alliance</button>` : ''}${rel === 'guerre' ? `<button class="btn small red" data-act="attack" data-kind="player" data-id="${esc(rg.pid)}">Attaquer</button>` : ''}</div>`;
    }
    el.innerHTML = h; el.dataset.h = h;
    this.remoteShown = true;
  }

  // ---------- fiche d'un habitant ----------
  showPerson(pid, focus = false) {
    const g = this.app.game;
    const el = $('#info');
    if (!g || !g.pp) return;
    const pp = g.pp, p = pp.get(pid);
    if (!p) {
      const d = (g.s.dead || []).find(x => x.i === pid);
      if (d) { this.showDead(d); return; }
      g.selPerson = 0; el.classList.add('hidden'); return;
    }
    g.selPerson = pid; g.selected = null;
    el.classList.remove('hidden');
    const age = Math.floor(pp.age(p));
    const w = g.life.walkers.find(x => x.pid === pid);
    const sc = g.life.sched.get(pid);
    const home = g.byId.get(p.h), work = g.byId.get(p.w);
    const birth = (p.e || []).find(e => e[1] === 'nais');
    let h = `<h3><img class="portrait" src="${portrait(lookFor(g, p))}">${esc(pp.fullName(p))}</h3>`;
    h += `<div class="desc">${esc(pp.jobName(p))} · ${p.s ? 'femme' : 'homme'} ${esc(TRAITS[p.t] || '')}${pp.isNoble(p) && p.i !== g.s.lordId ? ' · famille seigneuriale' : ''}</div>`;
    h += line('Âge', `${age} an${age > 1 ? 's' : ''}`);
    h += line(p.s ? 'Née' : 'Né', `${fmtDate(p.b)}${birth && birth[2] ? ' · ' + esc(birth[2]) : ''}`);
    if (p.o && p.o !== g.s.name && (!birth || birth[2] !== p.o)) h += line('Origine', esc(p.o));
    if (home) h += line('Foyer', `<a data-act="building" data-id="${home.id}">${esc(bName(g, home))}</a>`);
    else if (!p.aw) h += line('Foyer', '<span class="neg">sans abri</span>');
    if (work) h += line('Travail', `<a data-act="building" data-id="${work.id}">${esc(bName(g, work))}</a>`);
    const sp = pp.get(p.sp);
    if (sp) h += line(sp.s ? 'Épouse' : 'Époux', personLink(g, sp));
    else { const wid = (p.e || []).filter(e => e[1] === 'veu').pop(); if (wid) h += line(p.s ? 'Veuve de' : 'Veuf de', esc(wid[2])); }
    const par = [p.fa, p.mo].map(i => personRef(g, i)).filter(Boolean);
    if (par.length) h += line('Parents', par.join(', '));
    const kids = (p.k || []).map(i => personRef(g, i, true)).filter(Boolean);
    if (kids.length) h += line('Enfants', kids.join(', '));
    h += line('Santé', p.sick ? '<span class="neg">malade (peste)</span>' : p.hp < 60 ? 'fragile' : 'bonne');
    const act = p.i === g.s.lordId && this.app.lord.active ? 'incarné' + (p.s ? 'e' : '') + ' par toi' : p.aw ? 'en campagne militaire' : w ? (w.wander ? (w.why || 'travaille') : (w.why || 'marche')) : sc && sc.at ? `${sc.at === p.h ? 'chez ' + (p.s ? 'elle' : 'lui') : sc.at === p.w ? 'au travail' : 'à ' + bName(g, g.byId.get(sc.at))}` : 'chez ' + (p.s ? 'elle' : 'lui');
    h += line('En ce moment', esc(act));
    const ev = (p.e || []).slice().reverse();
    if (ev.length) h += `<div class="life"><b>Sa vie</b>${ev.map(e => `<div><span>${fmtDate(e[0])}</span> ${esc(eventText(g, p, e))}</div>`).join('')}</div>`;
    h += `<div class="btns">${w ? `<button class="btn small" data-act="follow" data-pid="${p.i}">👁 Suivre</button>` : ''}${p.i === g.s.lordId ? '<button class="btn small" data-act="lord">👑 Incarner</button>' : ''}<button class="btn small" data-act="registry">📜 Registre</button></div>`;
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    if (focus && w) this.app.follow(pid);
  }
  showDead(d) {
    const g = this.app.game, el = $('#info');
    g.selPerson = 0; g.selected = null;
    el.classList.remove('hidden');
    const age = Math.floor((d.d - d.b) / YEAR);
    let h = `<h3><span class="cross">✝</span>${esc(d.n + ' ' + d.f)}</h3><div class="desc">${esc(d.lord ? d.lord + ' ' + fromPlace(g.s.name) : d.j || '')}</div>`;
    h += line(d.s ? 'Née' : 'Né', fmtDate(d.b));
    h += line(d.c === 'depart' ? 'Partie' : (d.s ? 'Morte' : 'Mort'), `${fmtDate(d.d)}${d.c !== 'depart' ? ' · ' + esc(CAUSES[d.c] || d.c) : ''}${d.pl ? ' à ' + esc(d.pl) : ''}`);
    h += line('Âge', `${age} ans`);
    if (g.count('cimetiere') && d.c !== 'depart') h += `<div class="desc">Repose au cimetière de ${esc(g.s.name)}.</div>`;
    h += `<div class="btns"><button class="btn small" data-act="registry" data-tab="morts">📜 Registre des défunts</button></div>`;
    el.innerHTML = h; el.dataset.h = h;
  }
  // habitant anonyme d'un village IA ou d'un autre joueur
  showAnon(rg, w) {
    const el = $('#info');
    if (!w.anon) return;
    const A = w.anon;
    el.classList.remove('hidden');
    const T = this.app.worldClock();
    let h = `<h3><img class="portrait" src="${portrait(lookOf(A.lk, A.s, A.age))}">${esc(A.n + ' ' + A.f)}</h3>`;
    h += `<div class="desc">${A.s ? 'Habitante' : 'Habitant'} de ${esc(rg.s.name)} · ${esc(TRAITS[A.t] || '')}</div>`;
    h += line('Âge', `${A.age} ans`) + line(A.s ? 'Née' : 'Né', `${seasonOf(A.b)} ${yearOf(A.b)}`);
    h += line('Seigneur', `<span style="color:${esc(rg.color)}">${esc(rg.owner)}</span>`);
    if (A.married) h += line('Situation', `${A.s ? 'mariée' : 'marié'}${A.kids ? ', ' + A.kids + ' enfant' + (A.kids > 1 ? 's' : '') : ''}`);
    el.innerHTML = h; el.dataset.h = h;
  }

  // ---------- registre de la ville ----------
  openRegistry(tab = 'vivants') {
    const g = this.app.game;
    if (!g || !g.pp) return;
    this.regTab = tab; this.regOpen = true;
    this.regFilter = this.regFilter || '';
    this.modal(`<h2>📜 Registre de ${esc(g.s.name)}</h2><div class="reg-tabs">${[['vivants', 'Habitants'], ['morts', 'Défunts'], ['chronique', 'Chronique'], ['stats', 'Statistiques']].map(([k, n]) => `<button class="btn small ${k === tab ? 'active' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      <input id="reg-q" placeholder="Chercher un nom, un métier…" value="${esc(this.regFilter)}" autocomplete="off"><div id="reg-body" class="reg-body"></div>`, [{ text: 'Fermer' }], (box, close) => {
      box.querySelectorAll('.reg-tabs .btn').forEach(b => b.onclick = () => { this.regTab = b.dataset.tab; box.querySelectorAll('.reg-tabs .btn').forEach(x => x.classList.toggle('active', x === b)); this.renderRegistry(box); this.app.audio.play('click'); });
      const q = box.querySelector('#reg-q');
      q.addEventListener('input', () => { this.regFilter = q.value; this.renderRegistry(box); });
      q.addEventListener('keydown', (e) => e.stopPropagation());
      box.querySelector('#reg-body').addEventListener('click', (e) => {
        const r = e.target.closest('[data-pid]');
        if (!r) return;
        close(); this.regOpen = false;
        this.showPerson(+r.dataset.pid, true);
      });
      this.renderRegistry(box);
    });
  }
  renderRegistry(box) {
    const g = this.app.game, pp = g.pp, s = g.s;
    const body = box.querySelector('#reg-body');
    const q = (this.regFilter || '').toLowerCase().trim();
    box.querySelector('#reg-q').classList.toggle('hidden', this.regTab === 'stats' || this.regTab === 'chronique');
    let h = '';
    if (this.regTab === 'vivants') {
      let list = s.people.map(p => ({ p, job: pp.jobName(p), age: pp.age(p) }));
      if (q) list = list.filter(r => (r.p.n + ' ' + r.p.f + ' ' + r.job).toLowerCase().includes(q));
      list.sort((a, b) => (b.p.i === s.lordId) - (a.p.i === s.lordId) || a.p.f.localeCompare(b.p.f) || b.age - a.age);
      h = `<div class="reg-count">${list.length} habitant${list.length > 1 ? 's' : ''}</div><table class="reg"><tr><th></th><th>Nom</th><th>Âge</th><th>Métier</th><th>Naissance</th></tr>`;
      for (const r of list.slice(0, 400)) h += `<tr data-pid="${r.p.i}"><td><img src="${portrait(lookFor(g, r.p), 2)}"></td><td>${r.p.i === s.lordId ? '👑 ' : ''}${esc(r.p.n + ' ' + r.p.f)}${r.p.sick ? ' <span class="neg">☠</span>' : ''}</td><td>${Math.floor(r.age)}</td><td>${esc(r.job)}</td><td>${yearOf(r.p.b)}</td></tr>`;
      h += '</table>';
      if (list.length > 400) h += `<div class="reg-count">… et ${list.length - 400} autres (affine la recherche)</div>`;
    } else if (this.regTab === 'morts') {
      let list = (s.dead || []).slice().reverse();
      if (q) list = list.filter(d => (d.n + ' ' + d.f + ' ' + (CAUSES[d.c] || '')).toLowerCase().includes(q));
      h = `<div class="reg-count">${(s.deaths || 0)} décès depuis la fondation${s.dead && s.dead.length >= 400 ? ' (les 400 derniers sont listés)' : ''}</div><table class="reg"><tr><th>Nom</th><th>Vie</th><th>Âge</th><th>Cause</th></tr>`;
      for (const d of list.slice(0, 400)) h += `<tr data-pid="${d.i}"><td>${d.lord ? '👑 ' : '✝ '}${esc(d.n + ' ' + d.f)}</td><td>${yearOf(d.b)} – ${yearOf(d.d)}</td><td>${Math.floor((d.d - d.b) / YEAR)}</td><td>${esc(d.c === 'depart' ? 'a quitté la ville' : CAUSES[d.c] || d.c)}${d.pl ? ' (' + esc(d.pl) + ')' : ''}</td></tr>`;
      h += '</table>';
      if (!list.length) h += '<p class="hint">Personne n\'est encore mort. Longue vie à tes habitants !</p>';
    } else if (this.regTab === 'chronique') {
      const c = (s.chron || []).slice().reverse();
      h = c.length ? `<div class="chron">${c.map(([t, txt]) => `<div><span>${fmtDate(t)}</span> ${esc(txt)}</div>`).join('')}</div>` : '<p class="hint">La chronique est vide.</p>';
    } else {
      const st = pp.stats();
      const L = pp.lord;
      h = `<div class="reg-stats">${[
        ['Habitants', s.pop], ['Capacité de logement', g.cap], ['Enfants (− 14 ans)', st.kids], ['Adultes', st.adults], ['Anciens (60 ans et +)', st.elders],
        ['Âge moyen', st.avgAge.toFixed(1) + ' ans'], ['Espérance de vie (défunts)', st.deaths ? st.life.toFixed(1) + ' ans' : '—'],
        ['Naissances', st.births], ['Décès', st.deaths], ['Malades', st.sick], ['Sans emploi', pp.unemployed || 0],
        ['Soldats', s.people.filter(p => p.m).length], ['Couples mariés', Math.floor(s.people.filter(p => p.sp).length / 2)],
        ['Seigneur', L ? esc(pp.lordTitle(L) + ' ' + pp.fullName(L)) + ', ' + Math.floor(pp.age(L)) + ' ans' : 'aucun'],
      ].map(([a, b]) => `<div class="line"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`;
    }
    body.innerHTML = h;
  }

  tileInfo(text) {
    const el = $('#tile-info');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (el.innerHTML !== text) el.innerHTML = text;
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = 0; setTimeout(() => el.remove(), 500); }, cls === 'big' ? 5000 : 4200);
  }

  modal(html, buttons = [], onOpen) {
    const m = $('#modal');
    const box = m.querySelector('.modal-box');
    box.innerHTML = html + (buttons.length ? `<div class="row">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.text}</button>`).join('')}</div>` : '');
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    box.querySelectorAll('.row > .btn').forEach(el => el.addEventListener('click', () => {
      const b = buttons[+el.dataset.i];
      this.app.audio.play('click');
      if (!b.keep) close();
      if (b.fn) b.fn(box);
    }));
    if (onOpen) onOpen(box, close);
    return close;
  }
  closeModal() { $('#modal').classList.add('hidden'); }
  get modalOpen() { return !$('#modal').classList.contains('hidden'); }
}

// ---------- aides : habitants ----------
const PORTRAITS = new Map();
function lookFor(g, p) {
  const L = lookOf(p.lk, p.s, g.pp.age(p));
  if (p.m) L.role = p.m;
  else if (p.i === g.s.lordId) { L.role = 'lord'; L.color = g.app.settings && g.app.settings.color; }
  else if (g.pp.isNoble(p)) { L.role = 'noble'; L.color = '#6a2a4a'; }
  if (p.sick) L.sick = 1;
  return L;
}
function portrait(L, scale = 4) {
  const k = JSON.stringify(L) + scale;
  let u = PORTRAITS.get(k);
  if (u) return u;
  const spr = spriteCanvas(personSprite(L, 0, 0));
  const c = document.createElement('canvas');
  c.width = spr.width * scale; c.height = Math.ceil(spr.height * 0.7) * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr, 0, 0, spr.width, Math.ceil(spr.height * 0.7), 0, 0, c.width, c.height);
  u = c.toDataURL();
  if (PORTRAITS.size > 600) PORTRAITS.clear();
  PORTRAITS.set(k, u);
  return u;
}
function personLink(g, p) { return `<a data-act="person" data-pid="${p.i}">${esc(g.pp.fullName(p))}</a>`; }
function personRef(g, i, withAge = false) {
  if (!i) return null;
  const p = g.pp.get(i);
  if (p) return personLink(g, p) + (withAge ? ` (${Math.floor(g.pp.age(p))})` : '');
  const d = (g.s.dead || []).find(x => x.i === i);
  if (d) return `<a data-act="person" data-pid="${d.i}">✝ ${esc(d.n + ' ' + d.f)}</a>`;
  return null;
}
function bName(g, b) {
  if (!b) return '?';
  if (b.type === 'manoir') return manoirName(g.s.rank);
  return BUILDINGS[b.type].name;
}
function residents(g, b) {
  if (!g.pp) return '';
  const res = g.s.people.filter(p => p.h === b.id);
  const wk = g.s.people.filter(p => p.w === b.id);
  let h = '';
  if (res.length) h += `<div class="ppl"><b>Habitants (${res.length})</b>${res.slice(0, 30).map(p => personLink(g, p)).join('')}</div>`;
  if (wk.length) h += `<div class="ppl"><b>Travailleurs</b>${wk.map(p => personLink(g, p)).join('')}</div>`;
  return h;
}
const UNIT_ONE = { soldat: ['soldat', 'soldate'], archer: ['archer', 'archère'], chevalier: ['chevalier', 'chevalière'] };
export function eventText(g, p, e) {
  const [, c, a] = e;
  const f = (m, w) => (p.s ? w : m);
  switch (c) {
    case 'nais': return a ? `Naissance${a === 'une famille noble' ? ' dans ' + a : /^(la |le |les |un |une |l')/.test(a) ? ' dans ' + a : ' à ' + a}` : 'Naissance';
    case 'arr': return String(a || '').startsWith('pour') ? `Arrive ${a}` : `S'installe à ${g.s.name}, ${f('venu', 'venue')} ${fromPlace(a)}`;
    case 'sei': return `Devient ${g.pp.lordTitleOf(p)} ${fromPlace(a)}`;
    case 'mar': return `Épouse ${a}`;
    case 'enf': return `Naissance de son enfant ${a}`;
    case 'tra': return `Devient ${(JOBS[a] || [a, a])[p.s].toLowerCase()} (${BUILDINGS[a] ? BUILDINGS[a].name.toLowerCase() : a})`;
    case 'sol': return `S'engage comme ${(UNIT_ONE[a] || ['soldat', 'soldate'])[p.s]}`;
    case 'dem_m': return 'Quitte l\'armée';
    case 'ret': return `Revient vivant${p.s ? 'e' : ''} de la campagne de ${a}`;
    case 'veu': return `Devient ${f('veuf', 'veuve')} : ${a} est mort${p.s ? '' : 'e'}`;
    case 'mal': return 'Tombe malade de la peste';
    case 'gue': return 'Guérit de la maladie';
    case 'dem': return 'Emménage avec son conjoint';
    case 'part': return 'Quitte la ville, faute de logement';
    default: return c;
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function manoirName(rank) { return rank >= 4 ? 'Palais' : rank >= 2 ? 'Hôtel de ville' : 'Manoir'; }
function line(a, b) { return `<div class="line"><span>${a}</span><b>${b}</b></div>`; }
export function fmt(v) {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 100) return Math.round(v).toString();
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(1).replace(/\.0$/, '');
}
