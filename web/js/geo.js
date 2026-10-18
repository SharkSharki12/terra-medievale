// Données géographiques réelles (Natural Earth + NASA Blue Marble) et construction d'une "région" locale
// autour d'un point (lat0, lon0). Échelle réelle : 1 case = 10 m.

export const R_EARTH = 6371000;
export const M_PER_DEG = Math.PI * R_EARTH / 180; // ≈ 111 195 m
export const TILE_M = 10;
export const REGION_HALF = 100000; // la région couvre ±100 km
export const RASTER = 2048;
export const COARSE_STEP = 2000;
export const COARSE_HALF = 110000;
export const RIVER_CELL = 2000;

function parsePolys(buf) {
  const dv = new DataView(buf);
  let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const bbox = new Float32Array(buf, o, 4); o += 16;
    const nr = dv.getUint32(o, true); o += 4;
    const rings = [];
    for (let r = 0; r < nr; r++) {
      const np = dv.getUint32(o, true); o += 4;
      rings.push(new Float32Array(buf, o, np * 2)); o += np * 8;
    }
    out[i] = { bbox, rings };
  }
  return out;
}

function parseLines(buf) {
  const dv = new DataView(buf);
  let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const np = dv.getUint32(o, true); o += 4;
    const w = dv.getFloat32(o, true); o += 4;
    const bbox = new Float32Array(buf, o, 4); o += 16;
    const pts = new Float32Array(buf, o, np * 2); o += np * 8;
    out[i] = { w, bbox, pts };
  }
  return out;
}

// Chargement compatible worker (pas de DOM)
async function loadImageData(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}
const DATA = (f) => new URL('../data/' + f, import.meta.url).href;

export class GeoData {
  // Lieux pour la recherche (thread principal)
  async loadPlaces() {
    this.places = await fetch(DATA('places.json')).then(r => r.json());
  }
  // Données lourdes pour construire les régions (dans le worker)
  async load() {
    const bin = async (u) => (await fetch(DATA(u))).arrayBuffer();
    const [land, lakes, rivers] = await Promise.all([bin('land.bin'), bin('lakes.bin'), bin('rivers.bin')]);
    this.land = parsePolys(land);
    this.lakes = parsePolys(lakes);
    this.rivers = parseLines(rivers);
    [this.earth, this.topo] = await Promise.all([loadImageData(DATA('earth.jpg')), loadImageData(DATA('topo.png'))]);
  }

  // Échantillonnage bilinéaire d'une image équirectangulaire globale
  sampleImg(im, lat, lon, ch) {
    const u = ((lon + 180) / 360) * im.w - 0.5;
    const v = ((90 - lat) / 180) * im.h - 0.5;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const W = im.w, H = im.h, d = im.data;
    const px = (x, y) => {
      x = ((x % W) + W) % W; y = Math.max(0, Math.min(H - 1, y));
      return d[(y * W + x) * 4 + ch];
    };
    const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), e = px(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  }

  elevation(lat, lon) { return this.sampleImg(this.topo, lat, lon, 0) * 25; }

  // Facteurs de biome d'après la couleur satellite
  biome(lat, lon) {
    const r = this.sampleImg(this.earth, lat, lon, 0);
    const g = this.sampleImg(this.earth, lat, lon, 1);
    const b = this.sampleImg(this.earth, lat, lon, 2);
    return biomeFromColor(r, g, b, lat);
  }

  // Lieu sous forme de nom pour la recherche
  search(q, max = 8) {
    q = norm(q.trim());
    if (!q) return [];
    const res = [];
    for (const p of this.places) {
      const n1 = norm(p[0]), n2 = norm(p[1]);
      if (n1.startsWith(q) || n2.startsWith(q)) { res.push(p); if (res.length >= max) break; }
    }
    if (res.length < max) {
      for (const p of this.places) {
        if (res.includes(p)) continue;
        const n1 = norm(p[0]), n2 = norm(p[1]);
        if (n1.includes(q) || n2.includes(q)) { res.push(p); if (res.length >= max) break; }
      }
    }
    return res;
  }

  // Construit les données d'une région de ±100 km : projection locale ancrée en (lat0, lon0) (le « cadre »),
  // région centrée sur la case (ctx, cty) de ce cadre — permet de recentrer sans changer de coordonnées.
  buildRegion(lat0, lon0, seed, ctx0 = 0, cty0 = 0) {
    const cos0 = Math.cos(lat0 * Math.PI / 180);
    const kx = M_PER_DEG * cos0;
    const half = REGION_HALF;
    const mpp = (2 * half) / RASTER;
    const cxm = ctx0 * TILE_M, cym = cty0 * TILE_M;      // centre en mètres dans le cadre
    const latC = lat0 - cym / M_PER_DEG, lonC = lon0 + cxm / kx;
    const marginDeg = 0.25;
    const latMin = latC - half / M_PER_DEG - marginDeg, latMax = latC + half / M_PER_DEG + marginDeg;
    const lonHalf = half / kx + marginDeg / Math.max(0.1, cos0);
    const lonMin = lonC - lonHalf, lonMax = lonC + lonHalf;

    const rasterize = (polys, blur) => {
      const s = new OffscreenCanvas(RASTER, RASTER);
      const ctx = s.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, RASTER, RASTER);
      ctx.fillStyle = '#fff';
      for (const p of polys) {
        const bb = p.bbox;
        if (bb[3] < latMin || bb[1] > latMax) continue;
        for (const k of [-360, 0, 360]) {
          if (bb[2] + k < lonMin || bb[0] + k > lonMax) continue;
          // transformation lon/lat -> pixels
          const A = kx / mpp, D = -M_PER_DEG / mpp;
          const E = ((k - lon0) * kx - cxm + half) / mpp, F = (lat0 * M_PER_DEG - cym + half) / mpp;
          ctx.setTransform(A, 0, 0, D, E, F);
          ctx.beginPath();
          for (const ring of p.rings) {
            ctx.moveTo(ring[0], ring[1]);
            for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
            ctx.closePath();
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fill('evenodd');
        }
      }
      const t = new OffscreenCanvas(RASTER, RASTER);
      const tc = t.getContext('2d', { willReadFrequently: true });
      tc.fillStyle = '#000'; tc.fillRect(0, 0, RASTER, RASTER);
      tc.filter = `blur(${blur}px)`;
      tc.drawImage(s, 0, 0);
      const d = tc.getImageData(0, 0, RASTER, RASTER).data;
      const out = new Uint8Array(RASTER * RASTER);
      for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j];
      return out;
    };
    const landR = rasterize(this.land, 2);
    const lakeR = rasterize(this.lakes, 1);

    // Grille grossière : altitude + biome
    const cn = Math.round((2 * COARSE_HALF) / COARSE_STEP) + 1;
    const E = new Float32Array(cn * cn), FO = new Float32Array(cn * cn), AR = new Float32Array(cn * cn), SN = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++) {
      const y = cym - COARSE_HALF + j * COARSE_STEP;
      const lat = lat0 - y / M_PER_DEG;
      for (let i = 0; i < cn; i++) {
        const x = cxm - COARSE_HALF + i * COARSE_STEP;
        const lon = wrapLon(lon0 + x / kx);
        const k = j * cn + i;
        E[k] = this.elevation(lat, lon);
        const bi = this.biome(lat, lon);
        FO[k] = bi.forest; AR[k] = bi.arid; SN[k] = bi.snow;
      }
    }

    // Rivières : segments projetés + grille spatiale
    const segs = [];
    const rnx = Math.ceil((2 * half + 20000) / RIVER_CELL);
    const rox = cxm - (half + 10000), roy = cym - (half + 10000);
    const rex = cxm + half + 10000, rey = cym + half + 10000;
    const cells = Array.from({ length: rnx * rnx }, () => []);
    for (const l of this.rivers) {
      const bb = l.bbox;
      if (bb[3] < latMin || bb[1] > latMax) continue;
      for (const k of [-360, 0, 360]) {
        if (bb[2] + k < lonMin || bb[0] + k > lonMax) continue;
        const hw = l.w / 2;
        const P = l.pts;
        let px = (P[0] + k - lon0) * kx, py = -(P[1] - lat0) * M_PER_DEG;
        for (let i = 2; i < P.length; i += 2) {
          const x = (P[i] + k - lon0) * kx, y = -(P[i + 1] - lat0) * M_PER_DEG;
          const m = hw + 900;
          const x0 = Math.min(px, x) - m, x1 = Math.max(px, x) + m;
          const y0 = Math.min(py, y) - m, y1 = Math.max(py, y) + m;
          if (x1 > rox && y1 > roy && x0 < rex && y0 < rey) {
            const si = segs.length / 5;
            segs.push(px, py, x, y, hw);
            const ci0 = Math.max(0, Math.floor((x0 - rox) / RIVER_CELL)), ci1 = Math.min(rnx - 1, Math.floor((x1 - rox) / RIVER_CELL));
            const cj0 = Math.max(0, Math.floor((y0 - roy) / RIVER_CELL)), cj1 = Math.min(rnx - 1, Math.floor((y1 - roy) / RIVER_CELL));
            for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) cells[cj * rnx + ci].push(si);
          }
          px = x; py = y;
        }
      }
    }
    const starts = new Int32Array(cells.length + 1);
    let tot = 0;
    for (let i = 0; i < cells.length; i++) { starts[i] = tot; tot += cells[i].length; }
    starts[cells.length] = tot;
    const items = new Int32Array(tot);
    let o = 0;
    for (const c of cells) for (const s of c) items[o++] = s;

    return {
      lat0, lon0, cos0, seed: seed >>> 0, ctx: ctx0, cty: cty0,
      raster: { size: RASTER, mpp, half, land: landR, lake: lakeR, cxm, cym },
      coarse: { n: cn, step: COARSE_STEP, half: COARSE_HALF, E, forest: FO, arid: AR, snow: SN, cxm, cym },
      rivers: { cell: RIVER_CELL, nx: rnx, ox: rox, oy: roy, starts, items, segs: new Float32Array(segs) },
    };
  }
}

export function biomeFromColor(r, g, b, lat) {
  const B = (r + g + b) / 3;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  const gn = (g - r) / (B + 10);
  const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const alat = Math.abs(lat);
  let arid = (c01((B - 55) / 90) * 0.75 + c01(-gn * 2) * 0.45) * c01((sat - 0.12) / 0.15);
  const snow = c01((B - 165) / 55) * c01(1 - sat * 3);
  let forest = c01((58 - B) / 28 + gn * 1.5) * (1 - c01(arid * 1.4));
  // forêts boréales enneigées (gris bleuté)
  if (alat > 46 && alat < 70 && sat < 0.2 && B < 125 && B > 40) forest = Math.max(forest, 0.6);
  if (snow > 0.4) arid *= 0.3;
  return { forest: c01(forest), arid: c01(arid), snow };
}

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Conversions locales (mètres <-> lat/lon) pour une région ancrée
export function tileToLatLon(region, tx, ty) {
  const mx = tx * TILE_M, my = ty * TILE_M;
  return { lat: region.lat0 - my / M_PER_DEG, lon: wrapLon(region.lon0 + mx / (M_PER_DEG * region.cos0)) };
}
export function latLonToTile(region, lat, lon) {
  let dl = lon - region.lon0;
  dl = ((dl + 540) % 360) - 180;
  return { tx: (dl * M_PER_DEG * region.cos0) / TILE_M, ty: (-(lat - region.lat0) * M_PER_DEG) / TILE_M };
}
export function wrapLon(lon) { return ((lon + 540) % 360) - 180; }

// Distance orthodromique en mètres
export function haversine(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
