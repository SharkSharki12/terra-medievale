// Réseau multijoueur.
// - « En ligne » : WebRTC pair-à-pair (Trystero), mise en relation via des relais Nostr publics — aucun réglage.
// - « Direct » : WebSocket vers un joueur qui héberge (réseau local, IP publique ou VPN).
export class Net {
  constructor() {
    this.handlers = {};
    this.selfId = null;
    this.mode = null;
    this.status = 'off';
    this.peers = new Set();
  }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, ...a) { for (const f of this.handlers[type] || []) { try { f(...a); } catch (e) { console.error(e); } } }

  async joinOnline(code) {
    this.leave();
    const mod = await import('../lib/trystero.min.js');
    const cfg = { appId: 'terra-medievale-v1', relayConfig: { redundancy: 8 } };
    if (window.TERRA_RELAYS) cfg.relayConfig.urls = window.TERRA_RELAYS;
    if (window.TERRA_TEST_LOOPBACK) cfg._test_only_mdnsHostFallbackToLoopback = true;
    const room = mod.joinRoom(cfg, 'tm-' + code);
    const act = room.makeAction('m');
    this.room = room;
    this.mode = 'online';
    this.selfId = mod.selfId;
    this._send = (msg, to) => { act.send(msg, to ? { target: to } : undefined)?.catch?.(() => { }); };
    act.onMessage = (msg, info) => { if (msg && msg.t) this.emit('msg', info.peerId, msg); };
    room.onPeerJoin = (id) => { this.peers.add(id); this.emit('join', id); };
    room.onPeerLeave = (id) => { this.peers.delete(id); this.emit('leave', id); };
    this.status = 'online';
    this.emit('status', this.status);
    return code;
  }

  // connexion directe : renvoie le code du salon donné par l'hôte
  joinDirect(host) {
    this.leave();
    this.mode = 'direct';
    this.host = host.includes(':') ? host : host + ':7777';
    this.wantOpen = true;
    this.selfId = 'p' + Math.random().toString(36).slice(2, 10);
    return new Promise((resolve, reject) => {
      let first = true;
      const connect = () => {
        let ws;
        try { ws = new WebSocket(`ws://${this.host}/ws?room=main&id=${this.selfId}`); } catch (e) { reject(e); return; }
        this.ws = ws;
        const timer = setTimeout(() => { if (first) { ws.close(); first = false; reject(new Error('timeout')); } }, 8000);
        ws.onmessage = (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === '_welcome') {
            clearTimeout(timer);
            this.selfId = m.d.id;
            this.status = 'online'; this.emit('status', this.status);
            for (const p of m.d.peers || []) { this.peers.add(p); this.emit('join', p); }
            if (first) { first = false; resolve(m.d.room || 'DIRECT'); }
          } else if (m.t === '_join') { this.peers.add(m.from); this.emit('join', m.from); }
          else if (m.t === '_leave') { this.peers.delete(m.from); this.emit('leave', m.from); }
          else this.emit('msg', m.from, { t: m.t, d: m.d });
        };
        ws.onclose = () => {
          clearTimeout(timer);
          for (const p of this.peers) this.emit('leave', p);
          this.peers.clear();
          if (first) { first = false; reject(new Error('closed')); return; }
          if (this.wantOpen && this.ws === ws) {
            this.status = 'reconnecting'; this.emit('status', this.status);
            setTimeout(() => { if (this.wantOpen && this.ws === ws) connect(); }, 3000);
          }
        };
      };
      connect();
      this._send = (msg, to) => {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(to ? { ...msg, to } : msg));
      };
    });
  }

  send(t, d, to) { if (this._send) this._send({ t, d }, to); }

  leave() {
    this.wantOpen = false;
    if (this.room) { try { this.room.leave(); } catch { } this.room = null; }
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { } }
    this.peers.clear();
    this._send = null;
    this.status = 'off';
    this.mode = null;
  }
}
