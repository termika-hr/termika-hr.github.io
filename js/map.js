// Termika — map view. Leaflet is loaded from unpkg the first time the map opens.
// The map element is created once and moved into each new page render, so zoom and position survive.

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let loading = null;
let map = null, el = null, current = null, fitted = false;
let baseKey = null, kk7Key = null;
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
  const add = (group, list, size, cls) => {
    group.clearLayers();
    for (const s of list) {
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: cls, html: s.icon, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2], popupAnchor: [0, -size[1] / 2] }),
        title: s.name, keyboard: true, riseOnHover: true,
      }).bindPopup(s.popup).addTo(group);
    }
  };
  add(layers.sites, data.sites, [30, 30], 'pin-wrap');
  add(layers.stations, data.stations, [46, 22], 'stn-wrap');
  syncStations();
  if (!fitted && data.sites.length) {
    map.fitBounds(L.latLngBounds(data.sites.map((s) => [s.lat, s.lon])).pad(0.12));
    fitted = true;
  }
}
