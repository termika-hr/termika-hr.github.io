// Termika — map view. Leaflet is loaded from unpkg the first time the map opens.
// The map element is created once and moved into each new page render, so zoom and position survive.

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let loading = null;
let map = null, el = null, current = null, fitted = false;
let baseKey = null, kk7Key = null, focusKey = null;
const siteMarkers = {};
const base = {};
const layers = {};

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET + 'leaflet.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET + 'leaflet.js';
      js.onload = () => resolve(window.L);
      js.onerror = () => { loading = null; reject(new Error('Leaflet did not load')); };
      document.head.appendChild(js);
    });
  }
  return loading;
}

// data: { sites: [{lat, lon, name, icon, popup}], stations: [...same], base: 'topo'|'osm',
//         kk7: layer name or null, pointPopup(lat, lon) -> html, failText }
export async function showMap(slot, data) {
  current = data;
  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    slot.innerHTML = `<p class="map-fail">${data.failText}</p>`;
    return;
  }
  if (!slot.isConnected) return; // the user left the map while Leaflet was loading
  if (!el) {
    el = document.createElement('div');
    el.className = 'map';
    slot.appendChild(el);
    map = L.map(el, { zoomControl: true });
    base.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    });
    base.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    layers.sites = L.layerGroup().addTo(map);
    layers.stations = L.layerGroup();
    map.setView([45.6, 15.6], 8);
    map.on('zoomend', syncStations);
    const Notice = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'map-notice');
        div.innerHTML = '<span></span><button type="button" class="btn small"></button>';
        L.DomEvent.disableClickPropagation(div);
        div.querySelector('button').addEventListener('click', () => map.setZoom(Math.max(map.getZoom() + 2, THERMAL_ZOOM)));
        return div;
      },
    });
    notice = new Notice({ position: 'topright' }).addTo(map).getContainer();
    notice.hidden = true;
    // Buttons inside popups (Leaflet stops their clicks from bubbling to the document).
    // Handled here and stopped, so the document listener never sees the same click twice.
    map.on('popupopen', (e) => {
      const root = e.popup.getElement();
      if (!root || root.dataset.wired) return;
      root.dataset.wired = '1';
      root.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-act]');
        if (!b) return;
        ev.stopPropagation();
        if (current && current.onAction) current.onAction(b);
      });
    });
    map.on('click', (e) => {
      if (!current) return;
      L.popup().setLatLng(e.latlng).setContent(current.pointPopup(e.latlng.lat, e.latlng.lng)).openOn(map);
    });
  } else if (el.parentNode !== slot) {
    slot.appendChild(el);
  }
  update(L, data);
  requestAnimationFrame(() => map.invalidateSize());
}

// Stations crowd the map when zoomed out, so they appear from zoom 8 on; kk7 thermal patches
// are too small to see below zoom 9. A notice on the map says so and offers to zoom in.
const STATION_ZOOM = 8, THERMAL_ZOOM = 9;
let notice = null;
function syncStations() {
  const z = map.getZoom();
  const show = current && current.stations.length && z >= STATION_ZOOM;
  if (show && !map.hasLayer(layers.stations)) layers.stations.addTo(map);
  if (!show && map.hasLayer(layers.stations)) map.removeLayer(layers.stations);
  if (!notice) return;
  const need = current && ((current.stations.length && z < STATION_ZOOM) || (current.kk7 && z < THERMAL_ZOOM));
  notice.hidden = !need;
  if (need) {
    notice.querySelector('span').textContent = current.zoomHint;
    notice.querySelector('button').textContent = current.zoomBtn;
  }
}

// ---------- wind streamlines ----------
// Particles drift with the wind, leaving short fading trails (the Windy look). They are drawn on
// one canvas in their own pane, above the tiles and below the markers, and ignore clicks.
// Colours by speed (km/h): blue → purple → magenta → red → dark red for storms. Motion grows with
// speed^0.62, so light near-ground winds still move visibly while strong winds don't streak.
export const WIND_COLORS = [[10, '#1d4ed8'], [20, '#6d28d9'], [30, '#be185d'], [45, '#dc2626'], [Infinity, '#7f1d1d']];
let WindLayer = null, windLayer = null;

function windClass(L) {
  return L.Layer.extend({
    onAdd(m) {
      if (!m.getPane('wind')) { const p = m.createPane('wind'); p.style.zIndex = 450; p.style.pointerEvents = 'none'; }
      this._canvas = L.DomUtil.create('canvas', 'wind-canvas', m.getPane('wind'));
      this._ctx = this._canvas.getContext('2d');
      m.on('movestart zoomstart', this._stop, this);
      m.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove(m) {
      this._stop();
      m.off('movestart zoomstart', this._stop, this);
      m.off('moveend zoomend resize', this._reset, this);
      this._canvas.remove();
    },
    setField(f) { this._f = f; if (this._map) this._reset(); },
    _stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      if (this._ctx) this._ctx.clearRect(0, 0, this._w || 0, this._h || 0);
    },
    _reset() {
      this._stop();
      const m = this._map, f = this._f;
      if (!m || !f) return;
      const size = m.getSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      L.DomUtil.setPosition(this._canvas, m.containerPointToLayerPoint([0, 0]));
      this._canvas.width = size.x * dpr; this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + 'px'; this._canvas.style.height = size.y + 'px';
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._w = size.x; this._h = size.y;
      // Wind on a 10 px screen grid: pixels per frame plus speed, so the animation only does lookups.
      const C = 10, cols = Math.ceil(size.x / C) + 1, rows = Math.ceil(size.y / C) + 1;
      const grid = new Float32Array(cols * rows * 3);
      // Pixels per frame: 0.22 · speed^0.62 (5 km/h ≈ 0.6, 12 ≈ 1.0, 50 ≈ 2.5).
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const ll = m.containerPointToLatLng([c * C, r * C]);
        const w = sample(f, ll.lat, ll.lng), o = (r * cols + c) * 3;
        if (!w) { grid[o] = NaN; continue; }
        const sp = Math.hypot(w[0], w[1]), k = sp < 0.5 ? 0 : (0.22 * sp ** 0.62) / sp;
        grid[o] = w[0] * k; grid[o + 1] = -w[1] * k; grid[o + 2] = sp;
      }
      this._g = { grid, cols, rows, C };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this._static(); return; }
      const n = Math.min(2000, Math.round((size.x * size.y) / 400));
      this._p = Array.from({ length: n }, () => this._spawn({}));
      this._loop();
    },
    _at(x, y) {
      const { grid, cols, rows, C } = this._g;
      const c = Math.round(x / C), r = Math.round(y / C);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
      const o = (r * cols + c) * 3;
      return Number.isNaN(grid[o]) ? null : o;
    },
    _spawn(p) {
      p.x = Math.random() * this._w; p.y = Math.random() * this._h; p.age = Math.floor(Math.random() * 80);
      return p;
    },
    _loop() {
      if (!this._canvas.isConnected) { this._raf = null; return; } // map view closed
      this._raf = requestAnimationFrame(() => this._loop());
      if (document.hidden) return;
      const ctx = this._ctx, g = this._g.grid;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(0, 0, this._w, this._h);
      ctx.globalCompositeOperation = 'source-over';
      const paths = WIND_COLORS.map(() => new Path2D());
      for (const p of this._p) {
        const o = this._at(p.x, p.y);
        if (o == null || p.age++ > 90) { this._spawn(p); continue; }
        const nx = p.x + g[o], ny = p.y + g[o + 1], s = g[o + 2];
        const b = WIND_COLORS.findIndex(([lim]) => s < lim);
        paths[b].moveTo(p.x, p.y); paths[b].lineTo(nx, ny);
        p.x = nx; p.y = ny;
      }
      ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
      paths.forEach((path, i) => { ctx.strokeStyle = WIND_COLORS[i][1]; ctx.stroke(path); });
      ctx.globalAlpha = 1;
    },
    // No animation for people who asked their system for less motion: short arrows instead.
    _static() {
      const ctx = this._ctx, g = this._g.grid;
      ctx.lineWidth = 1.6;
      for (let y = 20; y < this._h; y += 40) for (let x = 20; x < this._w; x += 40) {
        const o = this._at(x, y);
        if (o == null) continue;
        const s = g[o + 2], len = Math.hypot(g[o], g[o + 1]) || 1, ux = g[o] / len, uy = g[o + 1] / len;
        ctx.strokeStyle = WIND_COLORS[WIND_COLORS.findIndex(([lim]) => s < lim)][1];
        ctx.beginPath(); ctx.moveTo(x - ux * 12, y - uy * 12); ctx.lineTo(x + ux * 12, y + uy * 12);
        ctx.lineTo(x + ux * 6 - uy * 5, y + uy * 6 + ux * 5); ctx.moveTo(x + ux * 12, y + uy * 12);
        ctx.lineTo(x + ux * 6 + uy * 5, y + uy * 6 - ux * 5); ctx.stroke();
      }
    },
  });
}

// Bilinear wind (u, v in km/h) at a point, or null outside the grid. A field may hold several
// grids (finest first, e.g. ALADIN-SI over the north, ICON for the rest); the first that covers
// the point is used.
function sampleGrid(f, lat, lon) {
  const dLat = f.dLat || f.step, dLon = f.dLon || f.step;
  const fi = (lon - f.lon0) / dLon, fj = (lat - f.lat0) / dLat;
  if (fi < 0 || fj < 0 || fi > f.nLon - 1 || fj > f.nLat - 1) return null;
  const i = Math.min(Math.floor(fi), f.nLon - 2), j = Math.min(Math.floor(fj), f.nLat - 2);
  const a = fi - i, b = fj - j, k = j * f.nLon + i;
  const mix = (A) => (A[k] * (1 - a) + A[k + 1] * a) * (1 - b) + (A[k + f.nLon] * (1 - a) + A[k + f.nLon + 1] * a) * b;
  const u = mix(f.u), v = mix(f.v);
  return Number.isNaN(u) || Number.isNaN(v) ? null : [u, v];
}
function sample(f, lat, lon) {
  for (const g of f.grids || [f]) { const w = sampleGrid(g, lat, lon); if (w) return w; }
  return null;
}

function syncWind(L, wind) {
  if (!wind) { if (windLayer && map.hasLayer(windLayer)) map.removeLayer(windLayer); return; }
  if (!WindLayer) WindLayer = windClass(L);
  if (!windLayer) windLayer = new WindLayer();
  if (!map.hasLayer(windLayer)) windLayer.addTo(map);
  windLayer.setField(wind);
}

function update(L, data) {
  if (baseKey !== data.base) {
    if (baseKey) map.removeLayer(base[baseKey]);
    base[data.base].addTo(map);
    base[data.base].bringToBack();
    baseKey = data.base;
  }
  if (kk7Key !== data.kk7) {
    if (layers.kk7) { map.removeLayer(layers.kk7); layers.kk7 = null; }
    if (data.kk7) {
      // kk7 usage policy: name the requesting site in ?src= and fetch tiles on demand only.
      layers.kk7 = L.tileLayer(`https://thermal.kk7.ch/tiles/${data.kk7}/{z}/{x}/{y}.png?src=${encodeURIComponent(location.hostname)}`, {
        tms: true, maxNativeZoom: 12, maxZoom: 17, opacity: 0.75,
        attribution: '<a href="https://thermal.kk7.ch/">thermal.kk7.ch</a> <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC-BY-NC-SA</a>',
      }).addTo(map);
    }
    kk7Key = data.kk7;
  }
  // Rebuild markers only when they changed, so a re-render doesn't close an open popup.
  const add = (group, list, size, cls) => {
    const sig = list.map((s) => `${s.lat},${s.lon}|${s.icon}|${s.popup}`).join('#');
    if (group._sig === sig) return;
    group._sig = sig;
    group.clearLayers();
    for (const s of list) {
      const mk = L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: cls, html: s.icon, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2], popupAnchor: [0, -size[1] / 2] }),
        title: s.name, keyboard: true, riseOnHover: true,
      }).bindPopup(s.popup).addTo(group);
      if (s.id) siteMarkers[s.id] = mk;
    }
  };
  add(layers.sites, data.sites, [30, 30], 'pin-wrap');
  add(layers.stations, data.stations, [46, 22], 'stn-wrap');
  syncStations();
  syncWind(L, data.wind);
  // Opened from a site page: centre on that site (or point) once and open its popup.
  const f = data.focus;
  if (f && f.key !== focusKey) {
    map.invalidateSize();
    map.setView([f.lat, f.lon], Math.max(map.getZoom(), 13));
    if (f.id && siteMarkers[f.id]) siteMarkers[f.id].openPopup();
    else L.popup().setLatLng([f.lat, f.lon]).setContent(data.pointPopup(f.lat, f.lon)).openOn(map);
    fitted = true;
  }
  focusKey = f ? f.key : null;
  if (!fitted && data.sites.length) {
    map.fitBounds(L.latLngBounds(data.sites.map((s) => [s.lat, s.lon])).pad(0.12));
    fitted = true;
  }
}
