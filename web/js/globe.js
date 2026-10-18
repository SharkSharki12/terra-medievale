// Globe 3D (three.js) dans le même style que la carte 2D : rotation, zoom, marqueurs, passage à la carte
import * as THREE from 'three';
import { tileToLatLon } from './geo.js';

export const ALT_MAP = 0.02;       // altitude (rayons terrestres) où l'on bascule en 2D (~130 km)
const ALT_MAX = 4.0;
const FOV = 45;
const D2R = Math.PI / 180;
const PATCH_TILES = 9800;          // demi-taille du morceau détaillé (cases)
export const PATCH_LEVEL = 8;      // niveau de chunk utilisé pour le morceau détaillé

export function dirFromLatLon(lat, lon, r = 1) {
  const phi = (lon + 180) * D2R, th = (90 - lat) * D2R;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
}
export function latLonFromPoint(p) {
  const r = p.length();
  const lat = Math.asin(p.y / r) / D2R;
  let lon = Math.atan2(p.z, -p.x) / D2R - 180;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

export class Globe {
  constructor(canvas) {
    this.canvas = canvas;
    this.lat = 30; this.lon = 0; this.alt = 2.6;
    this.vel = { lat: 0, lon: 0 };
    this.autoRotate = true;
    this.interactive = false;
    this.anim = null;
    this.onEnterMap = null;
    this.onHover = null;
    this.markers = new Map();
    this.patch = null;
    this.lastMove = 0;
  }

  async init() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    let soft = false;
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      soft = /swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch { }
    this.soft = soft;
    if (soft) r.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.0005, 200);
    const tex = await new Promise((res, rej) => new THREE.TextureLoader().load('data/globe.jpg', res, undefined, rej));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = soft ? 1 : Math.min(8, r.capabilities.getMaxAnisotropy());
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const geo = new THREE.SphereGeometry(1, soft ? 96 : 192, soft ? 64 : 128);
    this.earth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.earth);
    // atmosphère stylisée
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uO; varying vec3 vN; void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0,0.0,1.0))), 2.2); gl_FragColor = vec4(0.42,0.66,1.0,1.0) * i * uO; }`,
      uniforms: { uO: { value: 1 } },
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.11, 96, 64), atmoMat);
    this.scene.add(this.atmo);
    this.scene.add(this.makeStars());
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.raycaster = new THREE.Raycaster();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // étoiles pixelisées procédurales
  makeStars() {
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * rr * 80; pos[i * 3 + 1] = u * 80; pos[i * 3 + 2] = Math.sin(a) * rr * 80;
      const b = 0.45 + rnd() * 0.55, warm = rnd();
      col[i * 3] = b; col[i * 3 + 1] = b * (warm > 0.8 ? 0.85 : 1); col[i * 3 + 2] = b * (warm > 0.8 ? 0.6 : warm < 0.2 ? 1.15 : 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- morceau détaillé (mêmes images que la carte 2D) -----
  setPatch(region, canvas) {
    this.clearPatch();
    const N = 48, verts = [], uvs = [], cols = [], idx = [];
    const CH = 32 << PATCH_LEVEL;
    const span = CH * 4; // 2 chunks de chaque côté du centre
    const ox = region.ctx || 0, oy = region.cty || 0;
    const u0 = ox - span / 2, v0 = oy - span / 2;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const tx = ox - PATCH_TILES + (2 * PATCH_TILES * i) / N, ty = oy - PATCH_TILES + (2 * PATCH_TILES * j) / N;
      const ll = tileToLatLon(region, tx, ty);
      const p = dirFromLatLon(ll.lat, ll.lon, 1.00004);
      verts.push(p.x, p.y, p.z);
      uvs.push((tx - u0) / span, 1 - (ty - v0) / span);
      const edge = Math.min(i, j, N - i, N - j) / 8;
      cols.push(1, 1, 1, Math.min(1, edge));
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false }));
    m.renderOrder = 1;
    this.patch = { mesh: m, tex, region };
    this.scene.add(m);
  }
  updatePatch() { if (this.patch) this.patch.tex.needsUpdate = true; }
  clearPatch() {
    if (!this.patch) return;
    this.scene.remove(this.patch.mesh);
    this.patch.mesh.geometry.dispose(); this.patch.tex.dispose(); this.patch.mesh.material.dispose();
    this.patch = null;
  }

  // ----- villages IA : nuage de points (couleur du seigneur, taille selon le rang) -----
  setBotPoints(list) {
    if (!this.botLayers) {
      this.botLayers = [2.5, 4, 6].map((size) => {
        const g = new THREE.BufferGeometry();
        const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: true, depthWrite: false }));
        p.renderOrder = 2;
        this.scene.add(p);
        return p;
      });
    }
    const buckets = [[], [], []];
    for (const b of list) buckets[b.rank >= 4 ? 2 : b.rank >= 2 ? 1 : 0].push(b);
    buckets.forEach((arr, i) => {
      const pos = new Float32Array(arr.length * 3), col = new Float32Array(arr.length * 3);
      const c = new THREE.Color();
      arr.forEach((b, j) => {
        const v = dirFromLatLon(b.lat, b.lon, 1.0015);
        pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
        c.set(b.color); c.offsetHSL(0, 0, 0.12);
        col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
      });
      const g = this.botLayers[i].geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
    });
  }

  // ----- marqueurs (villes, joueurs) -----
  setMarkers(list) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let e = this.markers.get(m.id);
      const sig = `${m.label}|${m.sub || ''}|${m.icon || ''}|${m.color || ''}|${m.kind}`;
      if (!e) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 176;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
        sp.renderOrder = 2;
        sp.center.set(0.5, m.kind === 'player' ? 0.5 : 0.28);
        e = { sp, tex, c, sig: '' };
        this.markers.set(m.id, e);
        this.scene.add(sp);
      }
      e.kind = m.kind;
      e.sp.position.copy(dirFromLatLon(m.lat, m.lon, 1.002));
      e.sp.material.opacity = m.dim ? 0.55 : 1;
      if (e.sig !== sig) { e.sig = sig; this.drawMarker(e, m); }
    }
    for (const [id, e] of this.markers) if (!seen.has(id)) { this.scene.remove(e.sp); e.tex.dispose(); e.sp.material.dispose(); this.markers.delete(id); }
  }
  drawMarker(e, m) {
    const ctx = e.c.getContext('2d');
    ctx.clearRect(0, 0, 512, 176);
    ctx.imageSmoothingEnabled = false;
    ctx.textAlign = 'center';
    const text = (t, y, size, fill) => {
      ctx.font = `bold ${size}px "Palatino Linotype", Georgia, serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(25,18,10,0.92)';
      ctx.strokeText(t, 256, y); ctx.fillStyle = fill; ctx.fillText(t, 256, y);
    };
    if (m.kind === 'player') {
      ctx.fillStyle = m.color || '#fff';
      ctx.beginPath(); ctx.arc(256, 88, 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#1a120a'; ctx.stroke();
      text(m.label, 60, 30, m.color || '#fff');
    } else {
      const draw = () => {
        ctx.drawImage(img, 256 - 46, 6, 92, 92);
        if (m.color) { ctx.fillStyle = m.color; ctx.fillRect(256 - 30, 100, 60, 6); }
        text(m.label, 140, 34, '#f3d77a');
        if (m.sub) text(m.sub, 170, 24, m.color || '#f3e4c0');
        e.tex.needsUpdate = true;
      };
      const img = new Image();
      img.onload = draw;
      img.src = m.icon;
    }
    e.tex.needsUpdate = true;
  }

  pick(x, y) {
    const v = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    return hit ? latLonFromPoint(hit.point) : null;
  }

  radPerPx() { return Math.min(2 * this.alt * Math.tan((FOV / 2) * D2R), 2.2) / window.innerHeight; }

  bindInput() {
    const el = this.canvas;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      this.anim = null; this.autoRotate = false;
      drag = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.vel.lat = this.vel.lon = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.interactive) return;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        const k = this.radPerPx() / D2R;
        const dLat = dy * k, dLon = -dx * k / Math.max(0.2, Math.cos(this.lat * D2R));
        this.lat = Math.max(-85, Math.min(85, this.lat + dLat));
        this.lon = wrap(this.lon + dLon);
        const now = performance.now(), dt = Math.max(1, now - drag.t);
        this.vel.lat = dLat / dt * 16; this.vel.lon = dLon / dt * 16;
        drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
        this.lastMove = now;
      }
      if (this.onHover) this.onHover(this.pick(e.clientX, e.clientY));
    });
    const end = () => {
      if (drag && performance.now() - drag.t > 80) this.vel.lat = this.vel.lon = 0;
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      if (!this.interactive) return;
      e.preventDefault();
      this.anim = null; this.autoRotate = false;
      const old = this.alt;
      const d = Math.max(-120, Math.min(120, e.deltaY));
      this.alt = Math.max(ALT_MAP * 0.9, Math.min(ALT_MAX, this.alt * Math.exp(d * 0.0022)));
      if (this.alt < old) {
        const p = this.pick(e.clientX, e.clientY);
        if (p) {
          const f = 1 - this.alt / old;
          this.lat += (p.lat - this.lat) * f;
          this.lon = wrap(this.lon + wrap(p.lon - this.lon) * f);
        }
      }
      this.lastMove = performance.now();
      this.checkEnter();
    }, { passive: false });
    el.addEventListener('dblclick', (e) => {
      if (!this.interactive) return;
      const p = this.pick(e.clientX, e.clientY);
      if (p) this.flyTo(p.lat, p.lon, ALT_MAP * 0.8);
    });
  }

  checkEnter() {
    if (this.alt <= ALT_MAP && this.onEnterMap && this.interactive) this.onEnterMap(this.lat, this.lon, this.alt * 6371000);
  }

  flyTo(lat, lon, alt, dur) {
    const dist = angDist(this.lat, this.lon, lat, lon);
    this.anim = {
      t: 0, dur: dur || Math.min(3.2, 1.2 + dist / 60),
      lat0: this.lat, lon0: this.lon, alt0: this.alt,
      lat1: Math.max(-85, Math.min(85, lat)), lon1: lon, alt1: alt,
      bump: Math.min(2.0, dist / 70),
    };
    this.autoRotate = false;
  }

  setView(lat, lon, alt) { this.lat = Math.max(-85, Math.min(85, lat)); this.lon = lon; this.alt = alt; this.anim = null; this.vel.lat = this.vel.lon = 0; }

  get settled() { return !this.anim && Math.abs(this.vel.lat) + Math.abs(this.vel.lon) < 1e-3 && performance.now() - this.lastMove > 250; }

  update(dt) {
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const t = Math.min(1, a.t);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.lat = a.lat0 + (a.lat1 - a.lat0) * e;
      this.lon = wrap(a.lon0 + wrap(a.lon1 - a.lon0) * e);
      const la = Math.log(a.alt0) + (Math.log(a.alt1) - Math.log(a.alt0)) * e;
      this.alt = Math.exp(la) + a.bump * Math.sin(Math.PI * t);
      this.lastMove = performance.now();
      if (t >= 1) { this.anim = null; this.checkEnter(); }
    } else if (this.autoRotate) {
      this.lon = wrap(this.lon + dt * 4);
    } else if (Math.abs(this.vel.lat) + Math.abs(this.vel.lon) > 1e-4) {
      this.lat = Math.max(-85, Math.min(85, this.lat + this.vel.lat));
      this.lon = wrap(this.lon + this.vel.lon);
      const f = Math.pow(0.05, dt);
      this.vel.lat *= f; this.vel.lon *= f;
      this.lastMove = performance.now();
    }
  }

  render() {
    const cam = this.camera;
    const p = dirFromLatLon(this.lat, this.lon, 1 + this.alt);
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    const right = new THREE.Vector3().crossVectors(p, new THREE.Vector3(0, 1, 0)).normalize();
    this.sun.position.copy(p.clone().normalize().multiplyScalar(5).add(right.multiplyScalar(-2.2)).add(new THREE.Vector3(0, 2, 0)));
    this.atmo.material.uniforms.uO.value = Math.min(1, Math.max(0, (this.alt - 0.08) / 0.5));
    cam.near = Math.max(0.0002, this.alt * 0.2);
    cam.updateProjectionMatrix();
    if (this.patch) this.patch.mesh.material.opacity = Math.min(1, Math.max(0, (0.6 - this.alt) / 0.25));
    for (const e of this.markers.values()) {
      const s = this.alt * (e.kind === 'player' ? 0.045 : 0.07);
      e.sp.scale.set(s * 2.9, s, 1);
    }
    this.renderer.render(this.scene, cam);
  }
}

function wrap(l) { return ((l + 540) % 360) - 180; }
function angDist(la1, lo1, la2, lo2) {
  const a = dirFromLatLon(la1, lo1), b = dirFromLatLon(la2, lo2);
  return Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / D2R;
}
