// Worker : construit les données d'une région (rasterisation des côtes, rivières, biomes) sans bloquer l'interface
import { GeoData } from './geo.js';

const geo = new GeoData();
const ready = geo.load();

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'build') return;
  try {
    await ready;
    const r = geo.buildRegion(m.lat, m.lon, m.seed || 1, m.ctx || 0, m.cty || 0);
    const tr = [r.raster.land.buffer, r.raster.lake.buffer, r.coarse.E.buffer, r.coarse.forest.buffer, r.coarse.arid.buffer, r.coarse.snow.buffer,
      r.rivers.starts.buffer, r.rivers.items.buffer, r.rivers.segs.buffer];
    self.postMessage({ type: 'region', id: m.id, region: r }, tr);
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
ready.then(() => self.postMessage({ type: 'ready' }), (err) => self.postMessage({ type: 'error', id: -1, message: String(err) }));
