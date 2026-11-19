// Termika — user interface.
import { SITES, REGIONS } from './sites.js';
import * as M from './meteo.js';
import { STR, dirLabel, degLabel } from './i18n.js';
import { showMap, WIND_COLORS, AIR_COLORS } from './map.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Forecasts are kept for an hour: the models update every 1–6 hours, and Open-Meteo's free tier
// allows a limited number of requests per day for each internet connection.
const TTL = 60 * 60 * 1000;
// Recently opened sites stay in memory, so going back and forth costs no new requests.
const recent = { dt: new Map(), ens: new Map() };
function remember(map, key, val) { map.delete(key); map.set(key, val); if (map.size > 8) map.delete(map.keys().next().value); }
const APP_URL = 'https://termika-hr.github.io/';

const store = {
  get(k, d) { try { const v = localStorage.getItem('termika:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('termika:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

const S = {
  lang: store.get('lang', 'hr'),
  units: store.get('units', 'kmh'),
  theme: store.get('theme', 'auto'),  // auto | light | dark
  profile: store.get('profile', 'student'),
  model: store.get('model', 'icon_seamless'),
  custom: store.get('custom', []),
  favs: store.get('favs', []),
  limits: store.get('limits', null),
  ov: null, ovStatus: 'idle', ovError: null,
  dt: null, dtStatus: 'idle',
  al: null,        // ALADIN-SI extract (data/aladin-si.json)
  obs: null,       // live station data (data/obs.json)
  ens: null,       // ECMWF ensemble for the open site
  kpiHelp: null,   // which summary figure's explanation is open on the site page
  dmodel: null,    // model shown on the site page; null = main model
  hour: null,
  bestDay: 0,
  mapDay: 0, mapHour: 'day',
  mapOpts: { thermals: true, stations: true, base: 'topo', wind: false, windLevel: '850', airspace: false, ...store.get('mapOpts', {}) },
  wind: null,      // wind grid for the map's streamlines
  airspace: null,  // openAIP airspace (data/airspace.json), 'none' when not published yet
  points: {},      // "lat,lon" -> ground height in m, or 'loading' / 'error'
  shareCtx: null,
};
if (!M.MODELS[S.model] || M.MODELS[S.model].local) S.model = 'icon_seamless';
if (!M.PROFILES[S.profile]) S.profile = 'student';
if (S.limits) M.PROFILES.custom = { ...M.PROFILES.custom, ...S.limits };

const t = () => STR[S.lang];
const locale = () => (S.lang === 'hr' ? 'hr-HR' : 'en-GB');
const prof = () => M.PROFILES[S.profile];

function allSites() {
  return [...SITES, ...S.custom.map((c) => ({ ...c, region: 'custom', custom: true }))];
}
const findSite = (id) => allSites().find((s) => s.id === id);

// ---------- formatting ----------
const unitLabel = () => ({ kmh: 'km/h', ms: 'm/s', kt: 'kt' }[S.units]);
function wNum(kmh) {
  if (kmh == null) return '–';
  if (S.units === 'ms') { const v = kmh / 3.6; return v < 10 ? dec1(v) : Math.round(v); }
  if (S.units === 'kt') return Math.round(kmh / 1.852);
  return Math.round(kmh);
}
const F = {
  w: (kmh) => `${wNum(kmh)} ${unitLabel()}`,
  mm: (v) => (v < 1 ? v.toFixed(1) : Math.round(v)),
};
const dec1 = (v) => (S.lang === 'hr' ? v.toFixed(1).replace('.', ',') : v.toFixed(1));
// Wind is stored in km/h everywhere; these convert to and from the unit the pilot picked.
const PER_KMH = { kmh: 1, ms: 1 / 3.6, kt: 1 / 1.852 };
const toUnit = (kmh) => kmh * PER_KMH[S.units];
const fromUnit = (v) => v / PER_KMH[S.units];
// Inline km/h · m/s · kt switch; it changes the same setting as the one in Settings.
function unitSeg() {
  return `<div class="seg seg-sm" role="group" aria-label="${t().units}">${[['kmh', 'km/h'], ['ms', 'm/s'], ['kt', 'kt']].map(([v, l]) => `<button type="button" data-set="units" data-val="${v}" aria-pressed="${S.units === v}">${l}</button>`).join('')}</div>`;
}
const m50 = (v) => Math.round(v / 50) * 50;
const pad2 = (n) => String(n).padStart(2, '0');
function dayParts(date) {
  const d = new Date(date + 'T12:00:00');
  return {
    wd: new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d).replace('.', ''),
    dd: d.getDate() + '.',
    full: new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'numeric' }).format(d),
    weekend: d.getDay() === 0 || d.getDay() === 6,
  };
}
function timeStr(ms) {
  const d = new Date(ms), now = new Date();
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' })} ${hm}`;
}
function windowText(w) { return w ? t().windowH(w.from, w.to) : ''; }
function stars(n) {
  if (!n) return '';
  return `<span class="stars" title="${t().rating}: ${t().ratingOf(n)}" aria-label="${t().rating}: ${t().ratingOf(n)}">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
}
function distKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

// ---------- icons ----------
const IC = {
  logo: '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#3B82C4"/><path d="M150 182a44 44 0 0 1 44-44 62 62 0 0 1 118 12 40 40 0 0 1 52 38 34 34 0 0 1-34 34H178a40 40 0 0 1-28-40z" fill="#FFFFFF"/><path d="M115.0 310.6 C156.2 195.3 355.8 195.3 397.0 310.6 L383.3 320.9 C345.4 229.7 166.6 229.7 128.7 320.9 Z" fill="#13202A"/><line x1="148.2" y1="261.8" x2="158.9" y2="282.3" stroke="#3B82C4" stroke-width="3.4"/><line x1="196.2" y1="234.1" x2="202.1" y2="260.4" stroke="#3B82C4" stroke-width="3.4"/><line x1="256.0" y1="224.1" x2="256.0" y2="252.5" stroke="#3B82C4" stroke-width="3.4"/><line x1="315.8" y1="234.1" x2="309.9" y2="260.4" stroke="#3B82C4" stroke-width="3.4"/><line x1="363.8" y1="261.8" x2="353.1" y2="282.3" stroke="#3B82C4" stroke-width="3.4"/><line x1="371.6" y1="300.8" x2="256.0" y2="379.4" stroke="#13202A" stroke-width="4.3" stroke-linecap="round"/><line x1="318.8" y1="263.4" x2="256.0" y2="379.4" stroke="#13202A" stroke-width="4.3" stroke-linecap="round"/><line x1="256.0" y1="252.5" x2="256.0" y2="379.4" stroke="#13202A" stroke-width="4.3" stroke-linecap="round"/><line x1="193.2" y1="263.4" x2="256.0" y2="379.4" stroke="#13202A" stroke-width="4.3" stroke-linecap="round"/><line x1="140.4" y1="300.8" x2="256.0" y2="379.4" stroke="#13202A" stroke-width="4.3" stroke-linecap="round"/><circle cx="256.0" cy="374.2" r="9.5" fill="#F08A4E"/><rect x="244.0" y="382.8" width="24.1" height="22.4" rx="6.9" fill="#F08A4E"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const IC_SHARE_INLINE = IC.share.replace('<svg ', '<svg class="inline-ic" ');
// Arrow points where the wind blows to.
function arrow(wd) {
  if (wd == null) return '';
  return `<svg viewBox="-8 -8 16 16" aria-hidden="true" style="transform:rotate(${Math.round(wd + 180)}deg)"><path d="M0-7L5 5 0 2.4-5 5z"/></svg>`;
}
// Launch rose: shaded wedges show the wind directions the launch takes.
function rose(dirs, cls = '', labels = false) {
  const r = 10;
  const pt = (deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  const wedges = (dirs || []).map((d) => {
    const deg = M.DIR_DEG[d];
    if (deg == null) return '';
    const [x1, y1] = pt(deg - 22.5), [x2, y2] = pt(deg + 22.5);
    return `<path d="M0 0L${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z" fill="var(--accent)"/>`;
  }).join('');
  const lab = labels
    ? ['N', 'E', 'S', 'W'].map((d) => { const [x, y] = pt(M.DIR_DEG[d]).map((v) => v * 1.32); return `<text x="${x.toFixed(1)}" y="${(y + 1.6).toFixed(1)}" text-anchor="middle" font-size="4.4" font-weight="600" fill="var(--muted)" font-family="var(--f-display)">${dirLabel(d, S.lang)}</text>`; }).join('')
    : '';
  const vb = labels ? '-15.5 -15.5 31 31' : '-11 -11 22 22';
  return `<svg class="${cls}" viewBox="${vb}" aria-hidden="true"><circle r="${r}" fill="var(--surface-2)" stroke="var(--line)"/>${wedges}<circle r="${r}" fill="none" stroke="var(--muted)" stroke-width="0.8"/><path d="M0 -${r}V-${r - 3}" stroke="var(--ink)" stroke-width="1.2"/><circle r="1.3" fill="var(--ink)"/>${lab}</svg>`;
}
const tr = (v) => (v == null ? '' : typeof v === 'string' ? v : v[S.lang] || v.hr);
// "DWD · 2–7 km" plus the range when a model stops before day 7.
function modelLong(k) {
  const m = M.MODELS[k];
  const dec = (x) => (S.lang === 'hr' ? x.replace('.', ',') : x);
  if (m.fine) return `${m.org} · ${t().seamless(dec(m.res), m.fine, dec(m.then))}`;
  return `${m.org} · ${dec(m.res)}${m.days < 7 ? ` · ${m.days} ${t().days}` : ''}`;
}
const dirsText = (dirs) => (dirs || []).map((d) => dirLabel(d, S.lang)).join(', ');

// ---------- routing ----------
// #view=map · #site=<id>&day=<n> · #point=<lat>,<lon>&day=<n> · empty = list
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const day = Math.max(0, Math.min(6, +(p.get('day') || 0) || 0));
  if (p.get('view') === 'map') return { view: 'map', day, focus: p.get('focus') };
  const pt = (p.get('point') || '').split(',').map(Number);
  if (pt.length === 2 && pt.every(Number.isFinite) && Math.abs(pt[0]) <= 90 && Math.abs(pt[1]) <= 180) {
    return { view: 'site', day, point: { lat: pt[0], lon: pt[1], key: `${pt[0].toFixed(4)},${pt[1].toFixed(4)}` } };
  }
  if (p.get('site')) return { view: 'site', day, site: p.get('site') };
  return { view: 'list', day };
}
function currentSite(r = route()) {
  if (r.point) {
    const elev = S.points[r.point.key];
    if (typeof elev !== 'number') return null;
    return { id: 'pt:' + r.point.key, name: t().pointName(r.point.lat.toFixed(3), r.point.lon.toFixed(3)), lat: r.point.lat, lon: r.point.lon, elev, dirs: [], point: true };
  }
  return r.site ? findSite(r.site) : null;
}
function hrefFor(site, day = 0) {
  return site.point ? `#point=${site.lat.toFixed(4)},${site.lon.toFixed(4)}&day=${day}` : `#site=${encodeURIComponent(site.id)}&day=${day}`;
}

// ---------- data ----------
function siteKey(s) { return [s.id, s.lat, s.lon, s.elev, (s.dirs || []).join('')].join(':'); }

async function loadOverview(force = false) {
  const sites = allSites();
  const key = S.model + '#' + sites.map(siteKey).join('|');
  const cached = store.get('ov', null);
  if (cached && cached.key === key) {
    if (!S.ov || S.ov.t !== cached.t) applyOv(cached);
    if (!force && Date.now() - cached.t < TTL) { S.ovStatus = 'ok'; render(); return; }
  }
  S.ovStatus = 'loading'; render();
  try {
    const raw = await M.fetchForecast(sites, [S.model]);
    const c = { key, t: Date.now(), model: S.model, ids: sites.map((s) => s.id), raw };
    store.set('ov', c);
    applyOv(c);
    S.ovStatus = 'ok'; S.ovError = null; S.limitHit = false;
  } catch (e) {
    S.ovStatus = 'error'; S.ovError = e.message || String(e);
    if (e.status === 429) S.limitHit = true;
  }
  render();
}
function applyOv(c) {
  const parsed = {};
  c.ids.forEach((id, i) => { if (c.raw[i]) parsed[id] = M.parseLocation(c.raw[i], c.model); });
  S.ov = { t: c.t, model: c.model, parsed, days: {} };
  analyzeOv();
}
function analyzeOv() {
  if (!S.ov) return;
  S.ov.days = {};
  for (const s of allSites()) {
    const p = S.ov.parsed[s.id];
    if (p) S.ov.days[s.id] = M.analyzeSite(p, s, S.profile);
  }
}

async function loadDetail(site, force = false) {
  const key = siteKey(site);
  if (!force && S.dt && S.dt.key === key && Date.now() - S.dt.t < TTL) return;
  const cached = recent.dt.get(key) || store.get('dt', null);
  if (cached && cached.key === key && (!S.dt || S.dt.t !== cached.t)) applyDt(cached, site);
  if (!force && cached && cached.key === key && Date.now() - cached.t < TTL) { S.dtStatus = 'ok'; render(); return; }
  if (S.dt && S.dt.key !== key) S.dt = null;
  S.dtStatus = 'loading'; render();
  try {
    const raw = await M.fetchForecast([site], M.OM_MODELS());
    const c = { key, t: Date.now(), raw: raw[0] };
    store.set('dt', c);
    remember(recent.dt, key, c);
    applyDt(c, site);
    S.dtStatus = 'ok'; S.limitHit = false;
  } catch (e) {
    S.dtStatus = 'error';
    if (e.status === 429) S.limitHit = true;
  }
  render();
}
function applyDt(c, site) {
  const parsed = {};
  for (const m of M.OM_MODELS()) parsed[m] = M.parseLocation(c.raw, m);
  const al = S.al?.sites?.[site.id];
  if (al && !site.custom && !site.point) parsed.aladin_si = M.parseLocation(al, 'aladin_si');
  S.dt = { key: c.key, t: c.t, siteId: site.id, parsed, days: {} };
  analyzeDt(site);
}
function analyzeDt(site) {
  if (!S.dt || !site) return;
  for (const m of Object.keys(S.dt.parsed)) S.dt.days[m] = M.analyzeSite(S.dt.parsed[m], site, S.profile);
}
function siteDays(site) {
  if (S.dt && S.dt.siteId === site.id && S.dt.days[S.model]) return S.dt.days[S.model];
  return S.ov && S.ov.model === S.model ? S.ov.days[site.id] : null;
}

// ALADIN-SI comes from a file prepared by tools/aladin_si.py, not from Open-Meteo.
async function loadAladin() {
  try {
    const r = await fetch('data/aladin-si.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    S.al = await r.json();
  } catch (e) {
    S.al = null;
    return;
  }
  const s = currentSite();
  const loc = s && !s.custom && !s.point && S.al.sites?.[s.id];
  if (loc && S.dt && S.dt.siteId === s.id) {
    S.dt.parsed.aladin_si = M.parseLocation(loc, 'aladin_si');
    S.dt.days.aladin_si = M.analyzeSite(S.dt.parsed.aladin_si, s, S.profile);
    render();
  }
}

// Live stations come from a file refreshed every 30 minutes by tools/obs.py.
// ---------- airspace (openAIP, prepared by tools/airspace.py) ----------
async function loadAirspace() {
  if (S.airspace) return;
  S.airspace = 'loading';
  try {
    const r = await fetch('data/airspace.json', { cache: 'no-cache' });
    S.airspace = r.ok ? await r.json() : 'none';
  } catch (e) { S.airspace = 'none'; }
  render();
}
// Areas active only when booked (AMC) or announced (NOTAM) are drawn only on request.
let airView = null;
function airData() {
  if (!S.airspace) { loadAirspace(); return null; }
  if (!S.airspace.features) return null;
  const all = !!S.mapOpts.airAll, key = `${S.airspace.generated}|${all}`;
  if (!airView || airView.key !== key) {
    airView = { type: 'FeatureCollection', key, features: S.airspace.features.filter((f) => all || !f.properties.cond) };
  }
  return airView;
}
// Ray casting on the outer ring minus holes.
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(rings, x, y) { return inRing(rings[0], x, y) && !rings.slice(1).some((h) => inRing(h, x, y)); }
function airAt(lat, lon) {
  if (!S.airspace || !S.airspace.features) return [];
  return S.airspace.features.filter((f) => {
    const g = f.geometry;
    return g.type === 'Polygon' ? inPolygon(g.coordinates, lon, lat) : g.coordinates.some((p) => inPolygon(p, lon, lat));
  }).sort((a, b) => (a.properties.cond - b.properties.cond) || (a.properties.lowerM ?? 0) - (b.properties.lowerM ?? 0));
}
function limitText(label, m) {
  if (m == null || m <= 0) return esc(label);
  return `${esc(label)} (${/^FL/.test(label) ? '≈ ' : ''}${m50(m)} m${/AGL/.test(label) ? ` ${t().airAgl}` : ''})`;
}
function airRow(f) {
  const p = f.properties, c = AIR_COLORS[p.type] || '#64748b';
  const badge = (p.types || [p.type]).join('/');
  return `<li${p.cond ? ' class="cond"' : ''}><span class="air-badge" style="border-color:${c};color:${c}">${esc(badge)}${p.cls ? ' ' + p.cls : ''}</span><span><b>${esc(p.name)}</b><small>${limitText(p.lower, p.lowerM)} – ${limitText(p.upper, p.upperM)}</small>${p.cond ? `<small class="air-cond">${t().airCond}</small>` : ''}</span></li>`;
}
// compact (map popup): bookable areas are summed up in one line unless they are shown on the map.
function airList(lat, lon, compact) {
  if (!S.airspace || !S.airspace.features) return '';
  const all = airAt(lat, lon);
  if (!all.length) return `<span class="dim">${t().airNone}</span>`;
  const brief = compact && !S.mapOpts.airAll;
  const list = brief ? all.filter((f) => !f.properties.cond) : all;
  const cond = all.filter((f) => f.properties.cond);
  const more = brief && cond.length ? `<span class="dim air-more">${t().airMore(esc(cond.map((f) => f.properties.name.split(' / ')[0]).join(', ')))}</span>` : '';
  return `${compact ? `<span class="dim">${t().airHere}</span>` : ''}${list.length ? `<ul class="air-list">${list.map(airRow).join('')}</ul>` : ''}${more}`;
}
function airLegend() {
  const kinds = [['CTR', 'CTR / ATZ'], ['TMA', 'TMA'], ['R', 'R / P'], ['TMZ', 'TMZ / RMZ'], ...(S.mapOpts.airAll ? [['D', 'D'], ['TRA', 'TRA / TSA']] : [])];
  const state = S.airspace === 'none' ? `<span class="v-warn">${t().airMissing}</span>` : !S.airspace || S.airspace === 'loading' ? `<span>${t().loading}</span>` : '';
  return `<div class="legend"><span><b>${t().mapAir}</b></span>${kinds.map(([k, l]) => `<span><i class="air-sw" style="border-color:${AIR_COLORS[k]};background:${AIR_COLORS[k]}22"></i>${l}</span>`).join('')}${state}</div>
    <p class="hint">${t().airNote}</p>`;
}
function airspaceCard(site) {
  if (!S.airspace) { loadAirspace(); return ''; }
  if (!S.airspace.features) return '';
  return `<section class="card"><h2>${t().airAbove}</h2>${airList(site.lat, site.lon, false)}<p class="hint" style="margin:10px 0 0">${t().airNote}</p></section>`;
}

async function loadObs() {
  try {
    const r = await fetch('data/obs.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    S.obs = await r.json();
    S.obsAt = Date.now();
    render();
  } catch (e) { /* keep what we have */ }
}

// ECMWF ensemble for the open site.
async function loadEnsemble(site, force = false) {
  const key = siteKey(site);
  if (!force && S.ens && S.ens.key === key && Date.now() - S.ens.t < 2 * TTL) return;
  const cached = recent.ens.get(key) || store.get('ens', null);
  if (!force && cached && cached.key === key && Date.now() - cached.t < 2 * TTL) { S.ens = cached; render(); return; }
  try {
    const raw = await M.fetchEnsemble(site);
    S.ens = { key, t: Date.now(), raw };
    store.set('ens', S.ens);
    remember(recent.ens, key, S.ens);
  } catch (e) {
    if (cached && cached.key === key) S.ens = cached;
  }
  render();
}
let ensMemo = null;
function ensFor(site) {
  if (!S.ens || S.ens.key !== siteKey(site)) return null;
  const k = S.ens.t + '|' + S.profile + '|' + JSON.stringify(prof());
  if (!ensMemo || ensMemo.k !== k) ensMemo = { k, ...M.ensembleProb(S.ens.raw, site, prof()) };
  return ensMemo;
}

// A point picked on the map needs its ground height before it can be forecast.
async function ensurePoint(pt) {
  if (S.points[pt.key] === 'loading') return;
  S.points[pt.key] = 'loading'; render();
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${pt.lat}&longitude=${pt.lon}`);
    const j = await r.json();
    S.points[pt.key] = Math.round(j.elevation[0]);
  } catch (e) {
    S.points[pt.key] = 'error';
  }
  const r = route();
  if (r.point && r.point.key === pt.key) onRoute();
}

// ---------- shared pieces ----------
function header(r) {
  const busy = S.ovStatus === 'loading' || S.dtStatus === 'loading';
  const tab = (href, label, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top">
    <a class="brand" href="#">${IC.logo}<span><b>Termika</b><small>${t().tagline}</small></span></a>
    <div class="top-actions">
      <div class="seg" role="group" aria-label="${t().lang}">
        <button type="button" data-lang="hr" aria-pressed="${S.lang === 'hr'}">HR</button><button type="button" data-lang="en" aria-pressed="${S.lang === 'en'}">EN</button>
      </div>
      <button type="button" class="icon-btn${busy ? ' spin' : ''}" data-act="refresh" aria-label="${t().refresh}" title="${t().refresh}">${IC.refresh}</button>
      <button type="button" class="icon-btn" data-act="settings" aria-label="${t().settings}" title="${t().settings}">${IC.gear}</button>
    </div>
  </header>
  <div class="subbar">
    <nav class="views" aria-label="${t().viewList} / ${t().viewMap}">${tab('#', t().viewList, r.view === 'list')}${tab(r.view === 'site' && currentSite(r) ? mapHrefFor(currentSite(r), r.day) : '#view=map', t().viewMap, r.view === 'map')}</nav>
    <div class="status">
      ${S.ov ? `<span>${t().updated} <b>${timeStr(S.ov.t)}</b></span>` : ''}
      <span>${t().model} <b>${M.MODELS[S.model].label}</b></span>
      <span><b>${t().levels[S.profile]}</b></span>
      ${S.ovStatus === 'loading' ? `<span>${t().loading}</span>` : ''}
    </div>
  </div>
  ${S.limitHit && !S.limitHidden ? `<div class="banner banner-row" role="status"><span>${S.ov ? t().limitBanner(timeStr(S.ov.t)) : t().limitBannerNone}</span><button type="button" class="btn small" data-act="limit-hide">${t().ok}</button></div>` : S.limitHit ? '' : S.ovStatus === 'error' ? `<div class="banner ${S.ov ? '' : 'err'}" role="status">${S.ov ? t().stale(timeStr(S.ov.t)) : t().error(esc(S.ovError))}</div>` : ''}`;
}

function footer() {
  return `<footer class="foot"><p class="disc">${t().disclaimer}</p><p><button type="button" class="btn small" data-act="share">${t().share}</button></p><p>${t().attribution}</p></footer>`;
}

// ---------- install + share ----------
let installEvt = null; // Chrome/Edge/Samsung: the deferred install prompt
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);

function installBanner() {
  if (isStandalone() || Date.now() < store.get('installHide', 0)) return '';
  let body;
  if (installEvt) body = `<p>${t().instText}</p><button type="button" class="btn primary" data-act="install">${t().instBtn}</button>`;
  else if (isMobile()) body = `<p>${t().instText}</p><button type="button" class="btn primary" data-act="install-how">${t().instHow}</button>`;
  else return '';
  return `<section class="install" aria-label="${t().instTitle}">${IC.logo}${body}<button type="button" class="btn small" data-act="install-hide">${t().instLater}</button></section>`;
}

// Which menu to describe: the browser decides how a page gets onto the home screen.
function browserKind() {
  const ua = navigator.userAgent;
  if (isIOS()) return 'ios';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox/.test(ua)) return 'firefox';
  if (/EdgA|OPR|Opera|YaBrowser|MiuiBrowser/.test(ua)) return 'other';
  if (/Android/.test(ua)) return 'chrome';
  return 'other';
}
function openInstallHelp() {
  form = null;
  const kind = browserKind();
  const steps = kind === 'ios' ? t().instSteps.ios(IC_SHARE_INLINE) : t().instSteps[kind];
  const d = $('#dlg');
  d.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h2 id="dlg-title">${t().instTitle}</h2><button type="button" class="icon-btn" data-act="close" aria-label="${t().close}">${IC.close}</button></div>
    <ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    <p class="inst-result"><img src="icons/icon-192.png" alt="" width="56" height="56"><span>${t().instDone}</span></p>
    <p class="hint" style="margin:0">${t().instNote}</p>
    <p class="hint" style="margin:0">${t().instWhy}</p>
    <div class="btns"><button type="button" class="btn primary" data-act="close">${t().close}</button></div>
  </div>`;
  if (!d.open) d.showModal();
}

function shareHtml(msg = '', ok = true) {
  const c = S.shareCtx;
  return `<div class="dlg">
    <div class="dlg-head"><h2 id="dlg-title">${esc(c.title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="${t().close}">${IC.close}</button></div>
    <p class="hint" style="margin:0">${c.hint}</p>
    ${c.qr ? `<img class="share-qr" src="icons/qr.svg" alt="QR: ${APP_URL}" width="200" height="200">` : ''}
    <p class="share-url" id="share-url">${esc(c.url)}</p>
    <div class="btns">
      ${navigator.share ? `<button type="button" class="btn primary" data-act="share-send">${t().shareSend}</button>` : ''}
      <button type="button" class="btn" data-act="share-copy">${t().shareCopy}</button>
    </div>
    ${msg ? `<p class="${ok ? 'ok-msg' : 'err-msg'}" role="status">${msg}</p>` : ''}
    ${c.qr ? `<p class="hint" style="margin:0">${t().install}</p>` : ''}
  </div>`;
}
function openShare(ctx, msg, ok) {
  form = null;
  if (ctx) S.shareCtx = ctx;
  const d = $('#dlg');
  d.innerHTML = shareHtml(msg, ok);
  if (!d.open) d.showModal();
}

// ---------- list view ----------
function bestBets() {
  if (!S.ov) return '';
  const sites = allSites();
  const first = Object.values(S.ov.days)[0] || [];
  if (!first.length) return '';
  const di = Math.min(S.bestDay, first.length - 1);
  const goCount = (i) => sites.filter((s) => S.ov.days[s.id]?.[i]?.summary.state === 'go').length;
  const chips = first.map((d, i) => {
    const p = dayParts(d.date), n = goCount(i);
    return `<button type="button" class="chip${p.weekend ? ' wknd' : ''}" data-bestday="${i}" aria-pressed="${i === di}">${i === 0 ? t().today : i === 1 ? t().tomorrow : p.wd} <b>${p.dd}</b>${n ? `<i class="count">${n}</i>` : ''}</button>`;
  }).join('');
  const rows = sites.map((s) => ({ s, sum: S.ov.days[s.id]?.[di]?.summary })).filter((x) => x.sum);
  const go = rows.filter((x) => x.sum.state === 'go')
    .sort((a, b) => b.sum.rating - a.sum.rating || (b.sum.window?.n || 0) - (a.sum.window?.n || 0) || b.sum.topAgl - a.sum.topAgl)
    .slice(0, 6);
  const maybe = rows.filter((x) => x.sum.state === 'maybe');
  const items = go.map(({ s, sum }) => `<li><a href="${hrefFor(s, di)}"><span class="dot st-go"></span><b>${esc(s.name)}</b>${stars(sum.rating)}<span class="meta num">${windowText(sum.window)}${sum.topAgl >= 150 ? ` · ${t().thermalsTo(m50(sum.top))}` : ''}</span></a></li>`).join('');
  const caution = maybe.length ? `<p class="hint caution"><span class="dot st-maybe"></span> ${t().caution}: ${maybe.slice(0, 8).map(({ s }) => `<a href="${hrefFor(s, di)}">${esc(s.name)}</a>`).join(', ')}</p>` : '';
  return `<section class="best"><h2>${t().best}</h2><div class="chips" role="group">${chips}</div>
    <div class="best-day">${items ? `<ol>${items}</ol>` : `<p class="none">${t().noneGo}</p>`}${caution}</div></section>`;
}

function matrix() {
  if (!S.ov) return S.ovStatus === 'loading' ? `<p class="boot">${t().loading}</p>` : '';
  const sites = allSites();
  const first = Object.values(S.ov.days)[0] || [];
  const head = `<div class="mrow mhead" role="row"><div class="mname"></div>${first.map((d, i) => { const p = dayParts(d.date); return `<div class="mday${p.weekend ? ' wknd' : ''}" role="columnheader">${i === 0 ? t().today.slice(0, 5) : p.wd}<b>${p.dd}</b></div>`; }).join('')}</div>`;
  const row = (s) => {
    const days = S.ov.days[s.id] || [];
    const cells = days.map((d, i) => {
      const sum = d.summary;
      const tip = `${s.name} · ${dayParts(d.date).full}: ${t().state[sum.state]}${sum.window ? ' ' + windowText(sum.window) : ''}${sum.rating ? ' · ' + t().rating + ' ' + t().ratingOf(sum.rating) : ''}${sum.mainReason && sum.state === 'no' ? ' · ' + t().short[sum.mainReason] : ''}`;
      const main = sum.window ? `${sum.window.from}–${sum.window.to}` : sum.state === 'maybe' ? '!' : sum.state === 'no' ? '✕' : '';
      const sub = sum.state !== 'no' && sum.topAgl >= 150 ? `<i>${m50(sum.top)}</i>` : '';
      return `<a class="mcell st-${sum.state}" href="${hrefFor(s, i)}" title="${esc(tip)}" aria-label="${esc(tip)}">${main}${sub}</a>`;
    }).join('');
    return `<div class="mrow" role="row"><a class="mname" href="${hrefFor(s)}">${rose(s.dirs)}<span><b>${esc(s.name)}</b><small>${Math.round(s.elev)} m · ${dirsText(s.dirs)}</small></span></a>${cells}</div>`;
  };
  const groups = [];
  const favs = sites.filter((s) => S.favs.includes(s.id));
  if (favs.length) groups.push(['fav', favs]);
  const school = sites.filter((s) => s.school && !S.favs.includes(s.id));
  if (school.length) groups.push(['school', school]);
  for (const r of [...REGIONS, 'custom']) {
    const list = sites.filter((s) => s.region === r && !s.school && !S.favs.includes(s.id));
    if (list.length) groups.push([r, list]);
  }
  const body = groups.map(([g, list]) => `<div class="mgroup">${t().regions[g]}</div>${list.map(row).join('')}`).join('');
  const legend = ['go', 'maybe', 'no'].map((k) => `<span><i class="dot st-${k}"></i>${t().state[k]}</span>`).join('');
  return `<section><div class="matrix" role="table">${head}${body}</div></section>
    <div class="legend">${legend}<span class="num">11–15 = ${S.lang === 'hr' ? 'siguran prozor (sati)' : 'safe window (hours)'}</span><span class="num">1650 = ${S.lang === 'hr' ? 'vrh termike, m n.v.' : 'thermal top, m ASL'}</span></div>`;
}

function help() {
  const p = M.PROFILES;
  const lim = Object.keys(p).map((k) => `<b>${t().levels[k]}:</b> ${t().levelLimits(p[k], F)}, ${S.lang === 'hr' ? 'udari najviše' : 'gusts at most'} ${F.w(p[k].spread)} ${S.lang === 'hr' ? 'jači od srednjeg vjetra' : 'above the mean wind'}.`).join(' ');
  return `<details class="help"><summary>${t().helpTitle}</summary>${t().help.map((x) => `<p>${x}</p>`).join('')}<p>${lim}</p></details>`;
}

function overview() {
  return installBanner() + bestBets() + matrix() + help();
}

// ---------- map view ----------
// kk7 thermal layer. All-year data: the seasonal layers are nearly empty over Croatia outside
// summer (few flights), so the time of day is the only filter used.
function kk7Layer(date, hour, sunrise) {
  if (hour === 'day') return 'thermals_all_all';
  const after = hour - (sunrise ? +sunrise.slice(11, 13) + +sunrise.slice(14, 16) / 60 : 7);
  return `thermals_all_${after < 5 ? '04' : after < 8 ? '07' : '10'}`;
}

// Days for the map. Without a forecast (e.g. the daily request limit) the map still works:
// the next 7 dates, sites without a rating, streamlines and stations as usual.
function mapDays() {
  const first = S.ov ? Object.values(S.ov.days)[0] || [] : [];
  if (first.length) return first;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + i * 864e5);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return { date, sunrise: null, hours: Array.from({ length: 12 }, (_, k) => ({ hour: 7 + k, daylight: true })) };
  });
}

function mapView() {
  const first = mapDays();
  const di = Math.min(S.mapDay, first.length - 1);
  const day = first[di];
  const chips = first.map((d, i) => { const p = dayParts(d.date); return `<button type="button" class="chip${p.weekend ? ' wknd' : ''}" data-mapday="${i}" aria-pressed="${i === di}">${i === 0 ? t().today : p.wd} <b>${p.dd}</b></button>`; }).join('');
  const hours = day ? day.hours.filter((h) => h.daylight).map((h) => h.hour) : [];
  const hourSel = `<label class="sel-wrap"><span class="sr">${S.lang === 'hr' ? 'Sat' : 'Hour'}</span><select id="map-hour" class="input">
      <option value="day"${S.mapHour === 'day' ? ' selected' : ''}>${t().mapAllDay}</option>
      ${hours.map((h) => `<option value="${h}"${S.mapHour === h ? ' selected' : ''}>${pad2(h)}:00</option>`).join('')}
    </select></label>`;
  const o = S.mapOpts;
  const toggles = `<div class="toggles">
      <button type="button" class="tog" data-maplayer="thermals" aria-pressed="${o.thermals}">${t().mapThermals}</button>
      <button type="button" class="tog" data-maplayer="stations" aria-pressed="${o.stations}">${t().mapStations}</button>
      <button type="button" class="tog" data-maplayer="wind" aria-pressed="${o.wind}">${t().mapWind}</button>
      ${o.wind ? `<button type="button" class="tog" data-act="wind-anim" aria-pressed="${windAnimOn()}">${t().mapWindAnim}</button>` : ''}
      <button type="button" class="tog" data-maplayer="airspace" aria-pressed="${o.airspace}">${t().mapAir}</button>
      ${o.airspace ? `<button type="button" class="tog" data-act="air-all" aria-pressed="${!!o.airAll}">${t().airAll}</button>` : ''}
      ${o.wind ? `<label class="sel-wrap"><span class="sr">${t().mapWindLevel}</span><select id="map-wlevel" class="input">${M.WIND_LEVELS.map((l) => `<option value="${l}"${o.windLevel === l ? ' selected' : ''}>${t().windLevels[l]}</option>`).join('')}</select></label>` : ''}
      <div class="seg" role="group"><button type="button" data-mapbase="topo" aria-pressed="${o.base === 'topo'}">${t().mapTerrain}</button><button type="button" data-mapbase="osm" aria-pressed="${o.base === 'osm'}">${t().mapStreet}</button></div>
    </div>`;
  const legend = ['go', 'maybe', 'no'].map((k) => `<span><i class="dot st-${k}"></i>${t().state[k]}</span>`).join('');
  return `<section class="mapbar"><div class="chips" role="group">${chips}</div><div class="mapbar-row">${hourSel}${toggles}</div></section>
    <div id="map-slot" class="map-slot"></div>
    <div class="legend">${legend}<span>${S.mapHour === 'day' ? t().mapHint : `${t().mapPinWind} ${t().mapHint}`}</span></div>
    ${o.thermals ? `<p class="hint">${t().mapThermalNote}</p>` : ''}
    ${o.stations ? obsLateNote() : ''}
    ${o.wind ? windLegend() : ''}
    ${o.airspace ? airLegend() : ''}`;
}

// ---------- wind streamlines ----------
// Animated by default. Phones with "reduce motion" or a battery saver that removes animations
// get still arrows until the pilot turns animation on; the choice is remembered.
function windAnimOn() {
  if (typeof S.mapOpts.windAnim === 'boolean') return S.mapOpts.windAnim;
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// GitHub prepares the wind field a few times a day (tools/wind.py: ICON 0.25° for the whole
// area; tools/aladin_si.py: ALADIN-SI ~9 km over the north) as static files, so streamlines
// cost no forecast requests. Only when those files are missing or older than 8 hours does
// the browser download a coarser field from Open-Meteo itself.
const WIND_FRESH = 8 * 3600e3;
function windModel() { const m = M.MODELS[S.model]; return m.local || m.fine ? 'icon_seamless' : S.model; }
function windKey() { return `static|${S.mapOpts.windLevel}`; }
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
// Decode one prepared file: signed bytes in base64, [hour][point], in steps of `unit` km/h.
function unpackWind(doc) {
  const raw = Uint8Array.from(atob(doc.u), (c) => c.charCodeAt(0)), rawV = Uint8Array.from(atob(doc.v), (c) => c.charCodeAt(0));
  return { ...doc, u: new Int8Array(raw.buffer), v: new Int8Array(rawV.buffer) };
}
async function loadWind() {
  const key = windKey(), level = S.mapOpts.windLevel;
  if (S.wind && (S.wind.key === key || S.wind.loading === key)) return;
  S.wind = { key: null, loading: key };
  let icon = null, aladin = null;
  try {
    icon = unpackWind(await getJson(`data/wind/icon-${level}.json`));
    if (Date.now() - Date.parse(icon.generated) > WIND_FRESH) icon = null;
  } catch (e) { icon = null; }
  try {
    aladin = unpackWind(await getJson(`data/wind/aladin-${level}.json`));
    if (Date.now() - Date.parse(aladin.run) > 30 * 3600e3) aladin = null;
  } catch (e) { aladin = null; }
  if (icon) {
    S.wind = { key, kind: 'static', icon, aladin, fields: {} };
  } else {
    // Fallback: the browser fetches a coarse ICON field (one request, kept 3 hours).
    const fkey = `direct|${windModel()}|${M.WIND_GRID.step}`;
    const cached = store.get('wind', null);
    try {
      let data;
      if (cached && cached.key === fkey && Date.now() - cached.t < 3 * 3600e3) data = cached.data;
      else { data = await M.fetchWindGrid(windModel()); store.set('wind', { key: fkey, t: Date.now(), data }); }
      S.wind = { key, kind: 'direct', direct: data, aladin, fields: {} };
    } catch (e) {
      if (cached && cached.key === fkey) S.wind = { key, kind: 'direct', direct: cached.data, aladin, fields: {} };
      else if (aladin) S.wind = { key, kind: 'aladin', aladin, fields: {} };
      else S.wind = { key: null, error: key, reason: e.status === 429 ? t().limitHit : t().mapWindFail };
      if (e.status === 429) S.limitHit = true;
    }
  }
  if (route().view === 'map') render();
}
function gridAt(doc, time) {
  const idx = doc.times.indexOf(time);
  if (idx < 0) return null;
  const n = doc.grid.nLat * doc.grid.nLon, u = new Float32Array(n), v = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = doc.u[idx * n + k], b = doc.v[idx * n + k];
    if (a === -128 || b === -128) { u[k] = NaN; v[k] = NaN; } else { u[k] = a * doc.unit; v[k] = b * doc.unit; }
  }
  return { ...doc.grid, u, v };
}
// The same object for the same hour and height, so re-renders don't restart the animation.
function windField(date, hour) {
  if (!S.mapOpts.wind) return null;
  const key = windKey();
  if (!S.wind || (S.wind.key !== key && S.wind.loading !== key && S.wind.error !== key)) { loadWind(); return null; }
  if (S.wind.key !== key) return null;
  const time = `${date}T${pad2(hour === 'day' ? 13 : hour)}:00`;
  if (S.wind.fields[time] !== undefined) return S.wind.fields[time];
  const grids = [];
  if (S.wind.aladin) { const g = gridAt(S.wind.aladin, time); if (g) grids.push(g); }
  if (S.wind.kind === 'static') { const g = gridAt(S.wind.icon, time); if (g) grids.push(g); }
  if (S.wind.kind === 'direct') {
    const idx = S.wind.direct.times.indexOf(time);
    if (idx >= 0) grids.push(M.windAtHour(S.wind.direct, S.mapOpts.windLevel, idx));
  }
  S.wind.fields[time] = grids.length ? { grids } : null;
  return S.wind.fields[time];
}
function windSource() {
  const w = S.wind;
  if (!w || !w.key) return '';
  const parts = [];
  if (w.kind === 'static') parts.push(t().windSrcIcon);
  if (w.kind === 'direct') parts.push(t().windSrcDirect);
  if (w.aladin) parts.push(t().windSrcAladin);
  return parts.join(' · ');
}
function windLegend() {
  let lo = 0;
  const parts = WIND_COLORS.map(([lim, col]) => {
    const label = lim === Infinity ? `> ${wNum(lo)}` : `${wNum(lo)}–${wNum(lim)}`;
    lo = lim;
    return `<span><i class="wind-sw" style="background:${col}"></i>${label}</span>`;
  }).join('');
  const state = S.wind && S.wind.error ? `<span class="v-warn">${S.wind.reason}</span>` : !S.wind || !S.wind.key ? `<span>${t().loading}</span>` : '';
  const src = windSource();
  return `<div class="legend wind-legend"><span><b>${t().mapWind}</b> (${unitLabel()}, ${t().windLevels[S.mapOpts.windLevel]}${S.mapHour === 'day' ? ', 13:00' : ''})</span>${parts}${state}</div>
    <p class="hint">${t().mapWindNote}${src ? ` ${t().windSrc}: ${src}.` : ''}</p>`;
}

function freshStations() {
  if (!S.obs) return [];
  const now = Date.now();
  return S.obs.stations
    .map((s) => ({ ...s, age: (now - Date.parse(s.time)) / 60000 }))
    .filter((s) => s.ws != null && s.age < 360 && Number.isFinite(s.lat));
}
// Station data older than 2 hours is still shown, but marked as late.
const OBS_LATE = 120;
function obsLateNote() {
  if (!S.obs || !S.obs.stations.length) return '';
  const newest = Math.max(...S.obs.stations.map((s) => Date.parse(s.time)));
  return (Date.now() - newest) / 60000 > OBS_LATE ? `<p class="hint v-warn">${t().obsOld(timeStr(newest))}</p>` : '';
}

// OpenWindMap asks for a visible credit with a link wherever its data is shown.
function srcLabel(s) {
  return s.src === 'OpenWindMap' ? '<a href="https://www.openwindmap.org" target="_blank" rel="noopener">OpenWindMap</a>' : s.src;
}

function stationWind(s) {
  if (s.ws < 1) return `<span class="dim">${t().calm}</span>`;
  return `<span class="wind">${arrow(s.wd)}${wNum(s.ws)} ${unitLabel()}</span>${s.wg ? ` <span class="dim">${t().gustShort} ${wNum(s.wg)}</span>` : ''}`;
}

// Wind at the launch for the chosen hour, under its map pin: the site's own forecast at launch
// height, coloured like the hourly table (limits and direction against the launch).
function pinWind(h, site) {
  const p = prof();
  let c = h.ws > p.wind ? 'v-bad' : h.ws > p.wind * 0.8 ? 'v-warn' : 'v-ok';
  if (h.ws >= 5 && site.dirs?.length) { const off = M.offAngle(h.wd, site.dirs); if (off > 45) c = 'v-bad'; else if (off > 22.5 && c === 'v-ok') c = 'v-warn'; }
  return `<span class="pin-wind ${c}">${h.ws >= 1 ? arrow(h.wd) : ''}${h.ws < 1 ? '0' : wNum(h.ws)}</span>`;
}

function mapData() {
  const first = mapDays();
  const di = Math.min(S.mapDay, first.length - 1);
  const hour = S.mapHour;
  const sites = allSites().map((s) => {
    const d = S.ov?.days[s.id]?.[di] || { hours: [], summary: { state: 'nodata', topAgl: 0, rating: 0 } };
    const h = hour === 'day' ? null : d.hours.find((x) => x.hour === hour);
    const state = hour === 'day' ? d.summary.state : h ? h.state : 'nodata';
    const sum = d.summary;
    const info = hour === 'day'
      ? `${windowText(sum.window)}${sum.topAgl >= 150 ? ` · ${t().thermalsTo(m50(sum.top))}` : ''}`
      : h && h.a ? `${degLabel(h.wd, S.lang)} ${F.w(h.ws)}${h.a.topAgl >= 150 ? ` · ${t().thermalsTo(m50(h.a.top))}` : ''}` : '';
    return {
      id: s.id, lat: s.lat, lon: s.lon, name: s.name,
      icon: `<div class="pin st-${state}">${rose(s.dirs)}${h && h.ws != null ? pinWind(h, s) : ''}</div>`,
      popup: `<div class="pop"><b>${esc(s.name)}</b><span class="dim">${Math.round(s.elev)} m · ${dirsText(s.dirs)}</span><span><span class="pill st-${state}">${t().state[state]}</span> ${stars(hour === 'day' ? sum.rating : 0)}</span>${info ? `<span>${info}</span>` : ''}<a href="${hrefFor(s, di)}">${t().mapOpen} →</a></div>`,
    };
  });
  const stations = S.mapOpts.stations ? freshStations().map((s) => ({
    lat: s.lat, lon: s.lon, name: s.name,
    icon: `<div class="stn${s.age > OBS_LATE ? ' old' : ''}">${s.ws >= 1 ? arrow(s.wd) : ''}<b>${s.ws < 1 ? '0' : wNum(s.ws)}</b></div>`,
    popup: `<div class="pop"><b>${esc(s.name)}</b><span class="dim">${srcLabel(s)}${s.elev ? ` · ${Math.round(s.elev)} m` : ''} · ${t().ago(Math.round(s.age))}</span><span>${stationWind(s)}${s.t != null ? ` · ${Math.round(s.t)} °C` : ''}</span></div>`,
  })) : [];
  const ref = first[di];
  return {
    sites, stations, base: S.mapOpts.base,
    focus: mapFocus(route()),
    kk7: S.mapOpts.thermals && ref ? kk7Layer(ref.date, hour, ref.sunrise) : null,
    airspace: S.mapOpts.airspace ? airData() : null,
    wind: ref ? windField(ref.date, hour) : null,
    windAnim: windAnimOn(),
    failText: t().mapFail,
    zoomHint: t().mapZoomHint, zoomBtn: t().mapZoomBtn,
    onAction: handleClick, // Leaflet stops clicks inside popups from reaching the document
    pointPopup: (lat, lon) => `<div class="pop"><b>${t().mapPoint}</b><span class="dim num">${lat.toFixed(3)}, ${lon.toFixed(3)}</span><a href="#point=${lat.toFixed(4)},${lon.toFixed(4)}&day=${di}">${t().mapOpen} →</a><button type="button" class="btn small" data-act="add-site-at" data-lat="${lat.toFixed(4)}" data-lon="${lon.toFixed(4)}">${t().pointSave}</button>${S.mapOpts.airspace ? airList(lat, lon, true) : ''}</div>`,
  };
}

// ---------- site view ----------
function pickHour(hours, sum) {
  const day = hours.filter((h) => h.daylight);
  if (S.hour != null && hours.some((h) => h.hour === S.hour)) return S.hour;
  if (sum.window) return Math.floor((sum.window.from + sum.window.to - 1) / 2);
  return (day.find((h) => h.hour === 13) || day[Math.floor(day.length / 2)] || hours[12] || {}).hour ?? 12;
}

// Map link from a site page: opens the map on that site, on the same day.
function mapHrefFor(site, day = 0) {
  const f = site.point ? `${site.lat.toFixed(4)},${site.lon.toFixed(4)}` : encodeURIComponent(site.id);
  return `#view=map&day=${day}&focus=${f}`;
}
function mapFocus(r) {
  if (!r.focus) return null;
  const pt = r.focus.split(',').map(Number);
  if (pt.length === 2 && pt.every(Number.isFinite)) return { key: r.focus, lat: pt[0], lon: pt[1] };
  const s = findSite(r.focus);
  return s ? { key: r.focus, id: s.id, lat: s.lat, lon: s.lon } : null;
}

function siteHead(site, di = 0) {
  const fav = S.favs.includes(site.id);
  const actions = [
    `<a class="btn small map-btn" href="${mapHrefFor(site, di)}">${IC.pin}${t().showOnMap}</a>`,
    `<button type="button" class="icon-btn" data-act="share-site" aria-label="${t().shareForecast}" title="${t().shareForecast}">${IC.share}</button>`,
    site.point ? `<button type="button" class="btn small" data-act="add-site-at" data-lat="${site.lat.toFixed(4)}" data-lon="${site.lon.toFixed(4)}" data-elev="${site.elev}">${t().pointSave}</button>` : '',
    !site.point ? `<button type="button" class="icon-btn" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? t().favRemove : t().favAdd}" title="${fav ? t().favRemove : t().favAdd}">${IC.star}</button>` : '',
    site.custom ? `<button type="button" class="icon-btn" data-act="edit-site" data-id="${esc(site.id)}" aria-label="${t().edit}" title="${t().edit}">${IC.edit}</button>` : '',
  ].join('');
  return `<section class="site-head">
    ${rose(site.dirs, 'rose-big', true)}
    <div>
      <h1>${esc(site.name)}</h1>
      <p>${site.point ? t().ground(Math.round(site.elev)) : t().launch(Math.round(site.elev))}${site.dirs.length ? ` · ${t().faces}: <b>${dirsText(site.dirs)}</b>` : ''}</p>
      ${site.point ? `<p class="warn">${t().pointNote}</p>` : ''}
      ${site.check ? `<p class="warn">${t().check}</p>` : ''}
      ${site.note ? `<p>${esc(tr(site.note))}</p>` : ''}
      ${site.src ? `<p>${t().source}: ${esc(tr(site.src))}</p>` : ''}
    </div>
    <div class="site-actions">${actions}</div>
  </section>`;
}

function pointPending(r) {
  const st = S.points[r.point.key];
  return `<p class="boot">${st === 'error' ? t().pointFail : t().pointLoading}</p>`;
}

function agreement(date) {
  if (!S.dt) return null;
  let go = 0, n = 0;
  for (const m of Object.keys(S.dt.days)) {
    const d = S.dt.days[m].find((x) => x.date === date);
    if (!d || d.summary.state === 'nodata') continue;
    n++;
    if (d.summary.state === 'go') go++;
  }
  return n ? { go, n } : null;
}

function ensSummary(site, day) {
  const e = ensFor(site);
  if (!e) return null;
  const at = (h) => e.prob[`${day.date}T${pad2(h)}:00`];
  const w = day.summary.window;
  if (w) {
    const v = [];
    for (let h = w.from; h < w.to; h++) if (at(h) != null) v.push(at(h));
    if (v.length) return { p: v.reduce((a, b) => a + b, 0) / v.length, text: t().ensWin(windowText(w)) };
  }
  let best = null;
  for (const h of day.hours.filter((x) => x.daylight)) { const p = at(h.hour); if (p != null && (!best || p > best.p)) best = { p, hour: h.hour }; }
  return best ? { p: best.p, text: t().ensMax(pad2(best.hour)) } : null;
}

function liveSection(site) {
  const st = freshStations().map((s) => ({ ...s, d: distKm(site, s) })).filter((s) => s.d <= 70).sort((a, b) => a.d - b.d);
  let list = st.slice(0, 4);
  const mountain = st.find((s) => (s.elev || 0) >= 500);
  if (mountain && !list.includes(mountain)) list = [...list.slice(0, 3), mountain];
  if (!S.obs) return '';
  const rows = list.map((s) => `<li>
      <span class="live-name"><b>${esc(s.name)}</b><small>${s.elev ? `${Math.round(s.elev)} m · ` : ''}${Math.round(s.d)} km · ${srcLabel(s)}</small></span>
      <span class="live-wind">${stationWind(s)}</span>
      <span class="dim num">${s.t != null ? `${Math.round(s.t)} °C` : ''}</span>
      <span class="${s.age > OBS_LATE ? 'v-warn' : 'dim'}">${t().ago(Math.round(s.age))}</span>
    </li>`).join('');
  return `<section class="card"><h2>${t().live}</h2><p class="hint">${t().liveHint}</p>${obsLateNote()}${rows ? `<ul class="live">${rows}</ul>` : `<p class="hint" style="margin:0">${t().liveNone}</p>`}</section>`;
}

function detailView(site, di) {
  const days = siteDays(site);
  const head = siteHead(site, di);
  if (!days || !days[di]) {
    const msg = S.dtStatus === 'error' && (S.ovStatus === 'error' || site.point) ? t().error(esc(S.ovError || '')) : t().loading;
    return head + `<p class="boot">${msg}</p>`;
  }
  const dm = S.dmodel && S.dt?.siteId === site.id && S.dt.days[S.dmodel] ? S.dmodel : S.model;
  const mdays = dm === S.model ? days : S.dt.days[dm];
  const baseDay = days[di];
  const tabs = `<nav class="daytabs" role="tablist">${days.map((d, i) => { const p = dayParts(d.date); const st = (mdays.find((x) => x.date === d.date) || {}).summary?.state || 'nodata'; return `<a role="tab" class="daytab st-${st}" aria-selected="${i === di}" href="${hrefFor(site, i)}">${i === 0 ? t().today.slice(0, 5) : p.wd}<b>${p.dd}</b></a>`; }).join('')}</nav>`;
  const modelBar = `<div class="model-bar" id="model-bar"><span>${t().shown}: <b>${M.MODELS[dm].label}</b> <span class="dim">(${modelLong(dm)})</span></span>${dm !== S.model ? `<button type="button" class="btn small" data-model="">${t().backToMain(M.MODELS[S.model].label)}</button>` : ''}</div>`;
  const rise = baseDay.sunrise ? +baseDay.sunrise.slice(11, 13) : 7;
  const set = baseDay.sunset ? +baseDay.sunset.slice(11, 13) + 1 : 18;
  const cols = baseDay.hours.filter((h) => h.hour >= rise && h.hour <= set);
  const live = di === 0 ? liveSection(site) : '';
  const day = mdays.find((d) => d.date === baseDay.date);
  if (!day || day.summary.state === 'nodata') {
    return head + tabs + modelBar + `<section class="card"><p class="hint" style="margin:0">${t().modelNoDay(M.MODELS[dm].label)}</p></section>` + live + compare(site, baseDay.date, cols, dm) + airspaceCard(site) + links(site);
  }
  const sum = day.summary;
  const ag = agreement(day.date);
  const en = ensSummary(site, day);
  const agCls = ag ? (ag.go / ag.n >= 0.7 ? 'v-ok' : ag.go / ag.n >= 0.4 ? 'v-warn' : 'v-bad') : '';
  const enCls = en ? (en.p >= 0.7 ? 'v-ok' : en.p >= 0.4 ? 'v-warn' : 'v-bad') : '';
  // Each label opens a short explanation of that figure under the grid.
  const kt = (k, label) => `<button type="button" class="kpi-q" data-act="kpi-help" data-k="${k}" aria-expanded="${S.kpiHelp === k}" aria-controls="kpi-help">${label}</button>`;
  const kpis = `<dl class="kpis">
    <div><dt>${kt('window', t().window)}</dt><dd class="num">${sum.window ? windowText(sum.window) : t().noWindow}${sum.rating ? `<small>${stars(sum.rating)}</small>` : ''}</dd></div>
    <div><dt>${kt('ttop', t().ttop)}</dt><dd class="num">${sum.topAgl >= 150 ? `${m50(sum.top)} m<small>${t().aboveLaunch(m50(sum.topAgl))}</small>` : `–<small>${t().noThermals}</small>`}</dd></div>
    <div><dt>${kt('cbase', t().cbase)}</dt><dd class="num">${sum.base ? `${m50(sum.base)} m` : `–<small>${sum.topAgl >= 150 ? t().blue : t().noCu}</small>`}</dd></div>
    <div><dt>${kt('wstar', t().wstar)}</dt><dd class="num">${sum.wstar > 0.2 ? `${dec1(sum.wstar)} m/s` : '–'}<small>${t().est}</small></dd></div>
    ${ag ? `<div><dt>${kt('agree', t().agree)}</dt><dd class="num ${agCls}">${ag.go}/${ag.n}<small>${t().agreeText(ag.go, ag.n)}</small></dd></div>` : ''}
    ${en ? `<div><dt>${kt('ens', t().ens)}</dt><dd class="num ${enCls}">${Math.round(en.p * 100)} %<small>${en.text} · ${t().ensSrc}</small></dd></div>` : ''}
  </dl>${S.kpiHelp && t().kpiHelp[S.kpiHelp] ? `<p class="kpi-help" id="kpi-help">${t().kpiHelp[S.kpiHelp]}</p>` : ''}`;
  const reasonLine = sum.state === 'no' && sum.mainReason ? `<span>${t().mainReason}: ${t().short[sum.mainReason]}</span>` : '';
  const sun = baseDay.sunrise && baseDay.sunset ? `<span class="dim">${t().sun} ${baseDay.sunrise.slice(11, 16)}–${baseDay.sunset.slice(11, 16)}</span>` : '';
  const summary = `<section class="summary st-${sum.state}"><div class="verdict"><span class="pill">${t().state[sum.state]}</span><span>${dayParts(day.date).full}</span>${reasonLine}${sun}</div>${kpis}</section>`;
  const hours = day.hours.filter((h) => h.hour >= rise && h.hour <= set);
  const sel = pickHour(hours, sum);
  return head + tabs + modelBar + summary + live + hourlyTable(site, hours, sel) + altitudeGrid(site, hours, sel) + hourDetail(site, hours.find((h) => h.hour === sel)) + compare(site, baseDay.date, cols, dm) + airspaceCard(site) + links(site);
}

function hourlyTable(site, hours, sel) {
  const p = prof();
  const cls = (h) => (h.hour === sel ? ' class="sel"' : '');
  const windCls = (h) => {
    let c = h.ws > p.wind ? 'v-bad' : h.ws > p.wind * 0.8 ? 'v-warn' : 'v-ok';
    if (h.ws >= 5 && site.dirs?.length) { const off = M.offAngle(h.wd, site.dirs); if (off > 45) c = 'v-bad'; else if (off > 22.5 && c === 'v-ok') c = 'v-warn'; }
    return c;
  };
  const w = (ws, wd, c) => (ws == null ? '<span class="dim">–</span>' : `<span class="wind ${c}">${arrow(wd)}${wNum(ws)}</span>`);
  const lim = (v, l) => (v > l ? 'v-bad' : v > l * 0.8 ? 'v-warn' : 'v-ok');
  const sym = { go: '✓', maybe: '!', no: '✕', night: '·', nodata: '?' };
  const e = ensFor(site);
  const rows = [
    ['state', (h) => `<span class="sq st-${h.state}" title="${t().state[h.state]}">${sym[h.state]}</span>`],
    e ? ['ens', (h) => { const v = e.prob[h.time]; return v == null ? '<span class="dim">–</span>' : `<span class="${v >= 0.7 ? 'v-ok' : v >= 0.4 ? 'v-warn' : 'v-bad'}">${Math.round(v * 100)}</span>`; }] : null,
    ['wind', (h) => w(h.ws, h.wd, windCls(h))],
    ['gust', (h) => (h.gust == null ? '–' : `<span class="${h.gust > p.gust || h.gust - h.ws > p.spread ? 'v-bad' : h.gust > p.gust * 0.8 || h.gust - h.ws > p.spread * 0.7 ? 'v-warn' : 'v-ok'}">${wNum(h.gust)}</span>`)],
    ['air', (h) => (h.a ? w(h.a.airMax.ws, h.a.airMax.wd, lim(h.a.airMax.ws, p.air)) : '–')],
    ['l850', (h) => (h.a?.l850 ? w(h.a.l850.ws, h.a.l850.wd, 'dim') : '–')],
    ['l700', (h) => (h.a?.l700 ? w(h.a.l700.ws, h.a.l700.wd, 'dim') : '–')],
    ['top', (h) => (h.a && h.a.topAgl >= 150 ? m50(h.a.top) : '<span class="dim">–</span>'), 'sep'],
    // Cumulus base; "blue" only when there are thermals without cumulus, "no Cu" under an overcast sky.
    ['base', (h) => (!h.a ? '–' : h.a.cu ? m50(h.a.base) : h.a.topAgl < 150 ? '<span class="dim">–</span>'
      : `<span class="dim" title="${esc(t().blueTip)}">${(h.cc ?? 0) >= 80 ? t().noCuShort : t().blueShort}</span>`)],
    ['wstar', (h) => (h.a && h.a.wstar > 0.2 ? dec1(h.a.wstar) : '<span class="dim">–</span>')],
    ['cloud', (h) => (h.cc == null ? '–' : `${h.cc}<span class="dim"> (${h.ccl ?? '–'})</span>`), 'sep'],
    ['rain', (h) => (h.pr > 0 ? `<span class="${h.pr >= 0.5 ? 'v-bad' : 'v-warn'}">${F.mm(h.pr)}</span>` : '<span class="dim">–</span>')],
    ['cape', (h) => (h.cape >= 50 ? `<span class="${h.cape >= 1500 ? 'v-bad' : h.cape >= 500 ? 'v-warn' : ''}">${Math.round(h.cape)}</span>` : '<span class="dim">–</span>')],
    ['temp', (h) => (h.T == null ? '–' : Math.round(h.T))],
  ].filter(Boolean);
  const unitFor = (k) => (['wind', 'gust', 'air', 'l850', 'l700'].includes(k) ? ` <span class="dim">${unitLabel()}</span>` : k === 'top' || k === 'base' ? ' <span class="dim">m</span>' : '');
  const body = rows.map(([k, f, sep]) => `<tr${sep === 'sep' ? ' class="sep"' : ''}><th scope="row">${t().rows[k]}${unitFor(k)}</th>${hours.map((h) => `<td${cls(h)}>${f(h)}</td>`).join('')}</tr>`).join('');
  return `<section class="card"><div class="card-head"><h2>${t().hourly}</h2>${unitSeg()}</div><div class="table-scroll" id="hscroll"><table class="htable">
    <thead><tr><th scope="row"></th>${hours.map((h) => `<th${cls(h)}><button type="button" data-hour="${h.hour}" aria-pressed="${h.hour === sel}">${pad2(h.hour)}</button></th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div></section>`;
}

function altitudeGrid(site, hours, sel) {
  const p = prof();
  const zs = M.altitudeLevels(hours, site);
  const cls = (h, extra = '') => { const c = [extra, h.hour === sel ? 'sel' : ''].filter(Boolean).join(' '); return c ? ` class="${c}"` : ''; };
  const rows = zs.map((z) => {
    const launch = z === site.elev;
    const cells = hours.map((h) => {
      const c = M.conditionsAt(h, z, site);
      if (!c || c.ws == null) return `<td${cls(h)}><span class="dim">–</span></td>`;
      const limit = launch ? p.wind : p.air;
      const v = c.ws > limit ? 'v-bad' : c.ws > limit * 0.8 ? 'v-warn' : 'v-ok';
      const lay = c.cloud ? 'lay-cu' : c.thermal ? 'lay-th' : '';
      const tip = `${launch ? t().altLaunch : z + ' m'} · ${pad2(h.hour)}:00 · ${degLabel(c.wd, S.lang)} ${F.w(c.ws)}${c.T != null ? ` · ${Math.round(c.T)} °C` : ''}${c.cloud ? ' · ' + t().altCloud : c.thermal ? ' · ' + t().altThermal : ''}`;
      return `<td${cls(h, lay)} title="${esc(tip)}"><span class="wind ${v}">${arrow(c.wd)}${wNum(c.ws)}</span></td>`;
    }).join('');
    const label = launch ? `${t().altLaunch} <span class="dim">${Math.round(site.elev)} m</span>` : `${z} m`;
    return `<tr${launch ? ' class="launch-row"' : ''}><th scope="row">${label}</th>${cells}</tr>`;
  }).join('');
  const head = `<thead><tr><th scope="row"><span class="dim">${unitLabel()}</span></th>${hours.map((h) => `<th${cls(h)}><button type="button" data-hour="${h.hour}" aria-pressed="${h.hour === sel}">${pad2(h.hour)}</button></th>`).join('')}</tr></thead>`;
  return `<section class="card"><div class="card-head"><h2>${t().alt}</h2>${unitSeg()}</div><p class="hint">${t().altHint}</p>
    <div class="table-scroll" id="ascroll"><table class="htable agrid">${head}<tbody>${rows}</tbody></table></div>
    <div class="legend alt-legend"><span><i class="sw lay-th"></i>${t().altThermal}</span><span><i class="sw lay-cu"></i>${t().altCloud}</span><span><b class="v-ok">●</b><b class="v-warn">●</b><b class="v-bad">●</b> ${t().altColors}</span></div>
  </section>`;
}

function hourDetail(site, h) {
  if (!h) return '';
  const rs = h.reasons || [];
  const list = rs.length
    ? rs.map((r) => `<li><span class="dot st-${r.sev === 2 ? 'no' : 'maybe'}"></span><span>${t().reasons[r.key](r.val, F)}</span></li>`).join('')
    : `<li class="ok"><span class="dot st-${h.state}"></span><span>${h.state === 'night' ? t().state.night : t().noIssues}</span></li>`;
  const a = h.a;
  const st = a ? M.stability(h, site) : null;
  const inv = st && st.inv
    ? `${st.surfaceInv ? t().invSurface + ': ' : ''}${t().invText(m50(st.inv.base), m50(st.inv.top), dec1(st.inv.dT))}`
    : t().invNone;
  const facts = a ? `<dl class="facts">
    <dt>${t().rows.wind}</dt><dd>${degLabel(h.wd, S.lang)} ${F.w(h.ws)}${h.gust != null ? `, ${t().rows.gust.toLowerCase()} ${F.w(h.gust)}` : ''}</dd>
    <dt>${S.lang === 'hr' ? '400 m iznad starta' : '400 m above launch'}</dt><dd>${a.lee ? `${degLabel(a.lee.wd, S.lang)} ${F.w(a.lee.ws)}` : '–'}</dd>
    <dt>${t().ttop}</dt><dd>${a.topAgl >= 150 ? `${m50(a.top)} m (${t().aboveLaunch(m50(a.topAgl))})` : t().noThermals}</dd>
    <dt>${t().cbase}</dt><dd>${a.cu ? `${m50(a.base)} m${a.cloudTop ? ` → ${S.lang === 'hr' ? 'vrh oblaka' : 'cloud top'} ${a.open ? '>' : ''}${m50(a.cloudTop)} m` : ''}` : a.topAgl >= 150 ? t().blue : t().noCu}</dd>
    <dt>${t().stab}</dt><dd>${st && st.lapse != null ? `${t().lapse(dec1(st.lapse))}: ${t().stabCls[st.cls]}` : '–'}</dd>
    <dt>${t().inv}</dt><dd>${inv}</dd>
    <dt>${t().zero}</dt><dd>${!st || st.zero == null ? '–' : st.zero <= site.elev + 1 ? t().zeroBelow : `${m50(st.zero)} m`}</dd>
    <dt>${t().rows.temp}</dt><dd>${Math.round(h.T)} °C / ${S.lang === 'hr' ? 'rosište' : 'dew point'} ${h.Td == null ? '–' : Math.round(h.Td)} °C</dd>
  </dl>` : '';
  return `<section class="card"><div class="hour-grid">
    <div class="why"><h2>${t().why} · ${t().hourTitle(pad2(h.hour))}</h2><ul>${list}</ul>${facts}</div>
    <figure class="sounding" style="margin:0"><h2>${t().sounding} · ${t().hourTitle(pad2(h.hour))}</h2>${soundingSvg(site, h, st)}
      <figcaption class="s-legend"><span><i style="border-color:var(--temp)"></i>${t().sLegend.T}</span><span><i style="border-color:var(--sky)"></i>${t().sLegend.Td}</span><span><i style="border-color:var(--accent);border-top-style:dashed"></i>${t().sLegend.parcel}</span>${st && st.inv ? `<span><i class="inv-sw"></i>${t().sLegend.inv}</span>` : ''}</figcaption>
    </figure>
  </div></section>`;
}

function soundingSvg(site, h, st) {
  const a = h.a;
  if (!a || !a.levels.length) return '';
  const W = 380, H = 330, L = 40, R = 66, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const lv = a.levels;
  const zLo = Math.max(0, Math.floor((site.elev - 300) / 500) * 500);
  const upper = a.cu ? (a.cloudTop || a.base) + 600 : a.top + 1200;
  const zHi = Math.min(Math.ceil(Math.max(site.elev + 1800, upper) / 500) * 500, Math.floor(lv[lv.length - 1].z / 500) * 500);
  const env = [...lv.filter((l) => l.z < site.elev - 5), { z: site.elev, T: h.T, Td: h.Td }, ...lv.filter((l) => l.z > site.elev + 10)];
  const inR = env.filter((p) => p.z >= zLo - 400 && p.z <= zHi + 1200);
  const path = a.path.filter((p) => p.z <= zHi);
  const temps = [...inR.map((p) => p.T), ...inR.map((p) => p.Td).filter((v) => v != null), ...path.map((p) => p.T)];
  const tMin = Math.floor((Math.min(...temps) - 2) / 5) * 5;
  const tMax = Math.ceil((Math.max(...temps) + 2) / 5) * 5;
  const x = (v) => L + ((v - tMin) / (tMax - tMin)) * pw;
  const y = (z) => T + ph - ((z - zLo) / (zHi - zLo)) * ph;
  const f1 = (v) => v.toFixed(1);
  let g = '';
  for (let z = zLo; z <= zHi; z += 500) g += `<line x1="${L}" x2="${L + pw}" y1="${f1(y(z))}" y2="${f1(y(z))}" stroke="var(--line)"/><text x="${L - 4}" y="${f1(y(z) + 3)}" text-anchor="end">${z}</text>`;
  for (let v = tMin; v <= tMax; v += 5) g += `<line x1="${f1(x(v))}" x2="${f1(x(v))}" y1="${T}" y2="${T + ph}" stroke="var(--line)"${v === 0 ? ' stroke-width="2"' : ''}/><text x="${f1(x(v))}" y="${H - 8}" text-anchor="middle"${v === 0 ? ' class="lbl"' : ''}>${v}°</text>`;
  let adi = '';
  for (let v = tMin; v <= tMax + 60; v += 10) adi += `<line x1="${f1(x(v))}" y1="${f1(y(zLo))}" x2="${f1(x(v - 9.8 * (zHi - zLo) / 1000))}" y2="${f1(y(zHi))}" stroke="var(--muted)" stroke-opacity="0.25" stroke-dasharray="2 3"/>`;
  const line = (pts, key) => pts.filter((p) => p[key] != null).map((p) => `${f1(x(p[key]))},${f1(y(p.z))}`).join(' ');
  const ground = `<rect x="${L}" y="${f1(y(site.elev))}" width="${pw}" height="${f1(T + ph - y(site.elev))}" fill="var(--ground)" opacity="0.7"/><text x="${L + 4}" y="${f1(y(site.elev) + 12)}" class="lbl">${t().sLegend.launch} ${Math.round(site.elev)} m</text>`;
  let marks = '';
  if (st && st.inv && st.inv.top > zLo && st.inv.base < zHi) {
    const b = Math.max(st.inv.base, zLo), tp = Math.min(st.inv.top, zHi);
    marks += `<rect x="${L}" y="${f1(y(tp))}" width="${pw}" height="${f1(Math.max(2, y(b) - y(tp)))}" fill="var(--temp)" opacity="0.12"/><text x="${L + pw - 4}" y="${f1(y(tp) + 11)}" text-anchor="end">${t().sLegend.inv}</text>`;
  }
  if (a.cu) {
    const ct = Math.min(a.cloudTop || a.base + 300, zHi);
    marks += `<rect x="${L}" y="${f1(y(ct))}" width="${pw}" height="${f1(Math.max(2, y(a.base) - y(ct)))}" fill="var(--cloud)" opacity="0.35"/>`;
    marks += `<line x1="${L}" x2="${L + pw}" y1="${f1(y(a.base))}" y2="${f1(y(a.base))}" stroke="var(--ink)" stroke-dasharray="5 3"/><text x="${L + 4}" y="${f1(y(a.base) - 4)}" class="lbl">${t().sLegend.base} ${m50(a.base)} m</text>`;
  } else if (a.topAgl >= 150) {
    marks += `<line x1="${L}" x2="${L + pw}" y1="${f1(y(a.top))}" y2="${f1(y(a.top))}" stroke="var(--ink)" stroke-dasharray="5 3"/><text x="${L + 4}" y="${f1(y(a.top) - 4)}" class="lbl">${t().sLegend.top} ${m50(a.top)} m</text>`;
  }
  const winds = lv.filter((l) => l.z >= zLo && l.z <= zHi && l.ws != null).map((l) => {
    const yy = y(l.z), xx = L + pw + 16;
    return `<g transform="translate(${xx} ${f1(yy)})"><g transform="rotate(${Math.round(l.wd + 180)})"><path d="M0-7L5 5 0 2.4-5 5z" fill="var(--ink)"/></g></g><text x="${xx + 10}" y="${f1(yy + 3.5)}">${wNum(l.ws)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t().sounding}">
    <defs><clipPath id="plot"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath></defs>
    ${g}
    <g clip-path="url(#plot)">${adi}${marks}${ground}
      <polyline points="${line(inR, 'Td')}" fill="none" stroke="var(--sky)" stroke-width="2.2" stroke-linejoin="round"/>
      <polyline points="${line(inR, 'T')}" fill="none" stroke="var(--temp)" stroke-width="2.4" stroke-linejoin="round"/>
      <polyline points="${line(path, 'T')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 4"/>
    </g>
    <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="var(--line)"/>
    <text x="${L + pw + 8}" y="${T + 8}">${unitLabel()}</text>
    ${winds}
  </svg>`;
}

// Last forecast hour a model has for the open site, e.g. "pet 21 h".
function lastData(m) {
  const hs = S.dt?.parsed[m]?.hours || [];
  for (let i = hs.length - 1; i >= 0; i--) {
    const h = hs[i];
    if (h.T != null && h.ws != null) return `${dayParts(h.time.slice(0, 10)).wd} ${+h.time.slice(11, 13)} h`;
  }
  return '–';
}

function compare(site, date, hours, shown) {
  if (!S.dt || S.dt.siteId !== site.id) {
    return `<section class="card"><h2>${t().compare}</h2><p class="hint">${S.dtStatus === 'error' ? t().compareFail : t().loading}</p></section>`;
  }
  const hrs = hours.map((h) => h.hour);
  const rows = Object.entries(M.MODELS).map(([m, info]) => {
    if (!S.dt.days[m]) return '';
    const day = S.dt.days[m].find((d) => d.date === date);
    const cells = hrs.map((hr) => { const h = day?.hours.find((x) => x.hour === hr); const st = h ? h.state : 'nodata'; return `<span class="st-${st}" title="${pad2(hr)}h ${t().state[st]}"></span>`; }).join('');
    const text = !day || day.summary.state === 'nodata' ? t().until(lastData(m)) : day.summary.window ? windowText(day.summary.window) : t().state[day.summary.state];
    // A seamless model past its fine part: say which model the day really comes from.
    const later = info.fine && day && S.dt.days[m].indexOf(day) >= info.fine ? ` · ${info.then.split(' ')[0]}` : '';
    return `<button type="button" class="cmp-row${m === shown ? ' on' : ''}" data-model="${m}" aria-pressed="${m === shown}"><b>${info.label}</b><span class="cmp-cells">${cells}</span><small class="num">${text}${later}</small></button>`;
  }).join('');
  const scale = `<div class="cmp-row"><span></span><div class="cmp-hours">${hrs.map((h) => `<span>${h % 2 ? '' : pad2(h)}</span>`).join('')}</div><small></small></div>`;
  let al = '';
  if (S.dt.days.aladin_si && S.al) {
    const run = Date.parse(S.al.run);
    al = `<p class="hint" style="margin:10px 0 0">${t().alRun(timeStr(run))}${Date.now() - run > 12 * 3600e3 ? ` · <span class="v-warn">${t().alOld}</span>` : ''}</p>`;
  }
  return `<section class="card"><h2>${t().compare}</h2><p class="hint">${t().compareHint} ${t().compareClick}</p><div class="cmp">${rows}${scale}</div>${al}</section>`;
}

// DHMZ publishes ALADIN only as maps; pick the regional wind map closest to the site.
function aladinMap(site) {
  if (site.lat < 44.6) return 'web_uv10_SPLI_';
  if (site.lon < 15.0 && site.lat < 45.6) return 'web_uv10_SENJ_';
  return 'web_uv10_HRv8_';
}

function links(site) {
  const lat = site.lat.toFixed(4), lon = site.lon.toFixed(4);
  const mb = `${Math.abs(site.lat).toFixed(3)}${site.lat >= 0 ? 'N' : 'S'}${Math.abs(site.lon).toFixed(3)}${site.lon >= 0 ? 'E' : 'W'}`;
  const a = (href, label) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  return `<nav class="links"><span class="links-lab">${t().linksForecast}</span>
      ${a(`https://www.windy.com/?${lat},${lon},11`, 'Windy')}
      ${a(`https://www.meteoblue.com/${S.lang === 'hr' ? 'hr' : 'en'}/weather/forecast/multimodel/${mb}`, 'meteoblue')}
      ${a(`https://meteo.hr/prognoze.php?section=prognoze_model&amp;param=ala_k&amp;el=${aladinMap(site)}`, 'ALADIN (DHMZ)')}
    </nav>
    <nav class="links"><span class="links-lab">${t().linksNow}</span>
      ${a('https://meteo.hr/naslovnica_radarska-slika.php?tab=radari', t().lRadar)}
      ${a('https://meteo.hr/podaci.php?section=podaci_mjerenja&amp;param=satelit', t().lSat)}
      ${a(`https://map.blitzortung.org/#9/${lat}/${lon}`, t().lLightning)}
      ${a('https://www.openaip.net/map', t().lAirspace)}
      ${a('http://amc.crocontrol.hr/', t().lAmc)}
      ${a(`https://thermal.kk7.ch/#${lat},${lon},13`, t().lThermals)}
      ${a(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`, t().map)}
    </nav>`;
}

// ---------- settings dialog ----------
let form = null; // site being edited in the dialog

function settingsHtml() {
  const seg = (name, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-set="${name}" data-val="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  const levels = Object.keys(M.PROFILES).map((k) => `<label><input type="radio" name="level" value="${k}" ${S.profile === k ? 'checked' : ''}><span><b>${t().levels[k]}</b><small>${t().levelLimits(M.PROFILES[k], F)}</small></span></label>`).join('');
  const c = M.PROFILES.custom;
  const limits = `<div class="limits"${S.profile === 'custom' ? '' : ' hidden'}>
      <p class="hint" style="margin:0">${t().limHint(unitLabel())}</p>
      <div class="row2">${['wind', 'gust', 'spread', 'air'].map((k) => {
        const ms = S.units === 'ms';
        const val = ms ? toUnit(c[k]).toFixed(1) : Math.round(toUnit(c[k]));
        return `<div class="field"><label for="lim-${k}">${t().lim[k]} (${unitLabel()})</label><input class="input" id="lim-${k}" type="number" inputmode="decimal" min="${ms ? 0.5 : 1}" max="${Math.ceil(toUnit(80))}" step="${ms ? 0.5 : 1}" value="${val}"></div>`;
      }).join('')}</div>
    </div>`;
  const models = Object.entries(M.MODELS).filter(([k]) => !M.MODELS[k].local).map(([k, m]) => `<label><input type="radio" name="model" value="${k}" ${S.model === k ? 'checked' : ''}><span><b>${m.label}</b><small>${modelLong(k)}</small></span></label>`).join('');
  const mine = S.custom.length
    ? `<ul class="site-list">${S.custom.map((s) => `<li><span><b>${esc(s.name)}</b> <small>${Math.round(s.elev)} m · ${dirsText(s.dirs)}</small></span><button type="button" class="btn small" data-act="edit-site" data-id="${esc(s.id)}">${t().edit}</button></li>`).join('')}</ul>`
    : `<p class="hint" style="margin:0">${t().noCustom}</p>`;
  return `<div class="dlg">
    <div class="dlg-head"><h2 id="dlg-title">${t().settingsTitle}</h2><button type="button" class="icon-btn" data-act="close" aria-label="${t().close}">${IC.close}</button></div>
    <div class="field"><span class="lab">${t().lang}</span>${seg('lang', S.lang, [['hr', 'Hrvatski'], ['en', 'English']])}</div>
    <div class="field"><span class="lab">${t().theme}</span>${seg('theme', S.theme, [['auto', t().themes.auto], ['light', t().themes.light], ['dark', t().themes.dark]])}</div>
    <div class="field"><span class="lab">${t().units}</span>${seg('units', S.units, [['kmh', 'km/h'], ['ms', 'm/s'], ['kt', 'kt']])}</div>
    <div class="field"><span class="lab">${t().level}</span><div class="choice">${levels}</div>${limits}</div>
    <div class="field"><span class="lab">${t().modelPick}</span><div class="choice">${models}</div></div>
    <div class="field"><span class="lab">${t().mySites}</span>${mine}<div class="btns"><button type="button" class="btn" data-act="add-site">+ ${t().addSite}</button></div></div>
  </div>`;
}

function siteFormHtml(msg = '', ok = false) {
  const f = form;
  const ring = Object.keys(M.DIR_DEG).map((d) => {
    const deg = M.DIR_DEG[d], rr = d.length === 3 ? 29 : 44;
    const left = 50 + rr * Math.sin((deg * Math.PI) / 180), top = 50 - rr * Math.cos((deg * Math.PI) / 180);
    return `<button type="button" data-dir="${d}" aria-pressed="${f.dirs.includes(d)}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%">${dirLabel(d, S.lang)}</button>`;
  }).join('');
  return `<form class="dlg" id="site-form" novalidate>
    <div class="dlg-head"><h2 id="dlg-title">${f.id ? t().editSite : t().addSite}</h2><button type="button" class="icon-btn" data-act="close" aria-label="${t().close}">${IC.close}</button></div>
    <div class="field"><label for="f-name">${t().fName}</label><input class="input" id="f-name" value="${esc(f.name)}" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label for="f-lat">${t().fLat}</label><input class="input" id="f-lat" inputmode="decimal" value="${f.lat ?? ''}"></div>
      <div class="field"><label for="f-lon">${t().fLon}</label><input class="input" id="f-lon" inputmode="decimal" value="${f.lon ?? ''}"></div>
    </div>
    <div class="btns"><button type="button" class="btn small" data-act="geo">${t().myLoc}</button><button type="button" class="btn small" data-act="elev">${t().getElev}</button></div>
    <div class="field"><label for="f-elev">${t().fElev}</label><input class="input" id="f-elev" inputmode="numeric" value="${f.elev ?? ''}"></div>
    <div class="field"><span class="lab">${t().fDirs}</span><div class="compass">${ring}<span class="c-mid"></span></div></div>
    <div class="field"><label for="f-note">${t().fNote}</label><input class="input" id="f-note" value="${esc(f.note || '')}" autocomplete="off"></div>
    ${msg ? `<p class="${ok ? 'ok-msg' : 'err-msg'}" role="status">${msg}</p>` : ''}
    <div class="btns">
      <button type="submit" class="btn primary">${t().save}</button>
      <button type="button" class="btn" data-act="settings">${t().cancel}</button>
      ${f.id ? `<button type="button" class="btn danger" data-act="del-site">${t().del}</button>` : ''}
    </div>
  </form>`;
}

function readForm() {
  const num = (id) => parseFloat(String($('#' + id).value).replace(',', '.'));
  form.name = $('#f-name').value.trim();
  form.lat = num('f-lat'); form.lon = num('f-lon'); form.elev = num('f-elev');
  form.note = $('#f-note').value.trim();
}

function openSettings() {
  form = null;
  const d = $('#dlg');
  d.innerHTML = settingsHtml();
  if (!d.open) d.showModal();
}
function openForm(site) {
  form = site ? { ...site, dirs: [...(site.dirs || [])] } : { id: null, name: '', lat: null, lon: null, elev: null, dirs: [], note: '' };
  const d = $('#dlg');
  d.innerHTML = siteFormHtml();
  if (!d.open) d.showModal();
}
function rerenderForm(msg, ok) {
  readForm();
  $('#dlg').innerHTML = siteFormHtml(msg, ok);
}
async function lookupElev() {
  if (!isFinite(form.lat) || !isFinite(form.lon)) return rerenderForm(t().vCoord);
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${form.lat}&longitude=${form.lon}`);
    const j = await r.json();
    form.elev = Math.round(j.elevation[0]);
    if (form) $('#dlg').innerHTML = siteFormHtml();
  } catch (err) { rerenderForm(t().elevFail); }
}

// ---------- events ----------
function reanalyze() {
  analyzeOv();
  analyzeDt(currentSite());
  ensMemo = null;
}

function setPref(k, v) {
  S[k] = v; store.set(k, v);
  if (k === 'profile') reanalyze();
  if (k === 'model') loadOverview();
  render();
  if ($('#dlg').open && !form && !S.shareOpen) $('#dlg').innerHTML = settingsHtml();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button, [data-act]');
  if (b) handleClick(b);
});

async function handleClick(b) {
  if (b.dataset.lang) return setPref('lang', b.dataset.lang);
  if (b.dataset.set) return setPref(b.dataset.set, b.dataset.val);
  if (b.dataset.hour) { S.hour = +b.dataset.hour; return render(); }
  if (b.dataset.bestday) { S.bestDay = +b.dataset.bestday; return render(); }
  if (b.dataset.mapday) { S.mapDay = +b.dataset.mapday; S.mapHour = 'day'; return render(); }
  if (b.dataset.maplayer) { S.mapOpts[b.dataset.maplayer] = !S.mapOpts[b.dataset.maplayer]; store.set('mapOpts', S.mapOpts); return render(); }
  if (b.dataset.mapbase) { S.mapOpts.base = b.dataset.mapbase; store.set('mapOpts', S.mapOpts); return render(); }
  if (b.dataset.model !== undefined) {
    S.dmodel = b.dataset.model || null;
    S.hour = null;
    render();
    $('#model-bar')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (b.dataset.dir) {
    const d = b.dataset.dir;
    form.dirs = form.dirs.includes(d) ? form.dirs.filter((x) => x !== d) : [...form.dirs, d];
    b.setAttribute('aria-pressed', form.dirs.includes(d));
    return;
  }
  const act = b.dataset.act;
  if (!act) return;
  S.shareOpen = act.startsWith('share');
  if (act === 'refresh') {
    S.wind = null;
    loadOverview(true);
    loadAladin();
    loadObs();
    const s = currentSite();
    if (s) { loadDetail(s, true); loadEnsemble(s, true); }
  } else if (act === 'settings') openSettings();
  else if (act === 'install' && installEvt) {
    const evt = installEvt;
    installEvt = null;
    evt.prompt();
    try { await evt.userChoice; } catch (err) { /* dismissed */ }
    render();
  } else if (act === 'kpi-help') { S.kpiHelp = S.kpiHelp === b.dataset.k ? null : b.dataset.k; render(); }
  else if (act === 'air-all') { S.mapOpts.airAll = !S.mapOpts.airAll; store.set('mapOpts', S.mapOpts); render(); }
  else if (act === 'wind-anim') { S.mapOpts.windAnim = !windAnimOn(); store.set('mapOpts', S.mapOpts); render(); }
  else if (act === 'limit-hide') { S.limitHidden = true; render(); }
  else if (act === 'install-how') openInstallHelp();
  else if (act === 'install-hide') { store.set('installHide', Date.now() + 30 * 24 * 3600e3); render(); }
  else if (act === 'share') openShare({ url: APP_URL, title: t().share, hint: t().shareText, text: t().shareMsg, qr: true });
  else if (act === 'share-site') {
    const s = currentSite(), r = route();
    if (s) openShare({ url: APP_URL + hrefFor(s, r.day), title: t().shareForecast, hint: t().shareForecastText, text: `${s.name} · Termika`, qr: false });
  } else if (act === 'share-send') {
    const c = S.shareCtx;
    try { await navigator.share({ title: 'Termika', text: c.text, url: c.url }); } catch (err) { /* closed */ }
  } else if (act === 'share-copy') {
    try { await navigator.clipboard.writeText(S.shareCtx.url); openShare(null, t().copied, true); }
    catch (err) {
      openShare(null, t().copyFail, false);
      const r = document.createRange(); r.selectNodeContents($('#share-url'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  } else if (act === 'close') { $('#dlg').close(); form = null; }
  else if (act === 'fav') {
    const id = route().site;
    if (!id) return;
    S.favs = S.favs.includes(id) ? S.favs.filter((x) => x !== id) : [...S.favs, id];
    store.set('favs', S.favs); render();
  } else if (act === 'add-site') openForm(null);
  else if (act === 'add-site-at') {
    const elev = b.dataset.elev != null ? +b.dataset.elev : null;
    openForm({ id: null, name: '', lat: +b.dataset.lat, lon: +b.dataset.lon, elev, dirs: [], note: '' });
    if (elev == null) lookupElev();
  } else if (act === 'edit-site') openForm(S.custom.find((s) => s.id === b.dataset.id));
  else if (act === 'del-site') {
    S.custom = S.custom.filter((s) => s.id !== form.id);
    S.favs = S.favs.filter((x) => x !== form.id);
    store.set('custom', S.custom); store.set('favs', S.favs);
    if (route().site === form.id) location.hash = '';
    openSettings(); loadOverview();
  } else if (act === 'geo') {
    readForm();
    if (!navigator.geolocation) return rerenderForm(t().locFail);
    navigator.geolocation.getCurrentPosition(
      (pos) => { $('#f-lat').value = pos.coords.latitude.toFixed(4); $('#f-lon').value = pos.coords.longitude.toFixed(4); rerenderForm(''); },
      () => rerenderForm(t().locFail),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  } else if (act === 'elev') {
    readForm();
    lookupElev();
  }
}

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'level') {
    setPref('profile', el.value);
    const box = $('.limits');
    if (box) box.hidden = el.value !== 'custom';
  }
  if (el.name === 'model') setPref('model', el.value);
  if (el.id === 'map-hour') { S.mapHour = el.value === 'day' ? 'day' : +el.value; render(); }
  if (el.id === 'map-wlevel') { S.mapOpts.windLevel = el.value; store.set('mapOpts', S.mapOpts); render(); }
  if (el.id && el.id.startsWith('lim-')) {
    // Inputs are in the chosen unit; limits are kept in km/h. Only the edited field is
    // converted back, so the others don't drift through rounding.
    const k = el.id.slice(4);
    const kmh = fromUnit(parseFloat(String(el.value).replace(',', '.')));
    const v = { ...M.PROFILES.custom };
    if (Number.isFinite(kmh) && kmh >= 1 && kmh <= 80) v[k] = Math.round(kmh * 10) / 10;
    S.limits = v; store.set('limits', v);
    M.PROFILES.custom = v;
    const sm = $('input[name=level][value=custom]')?.closest('label')?.querySelector('small');
    if (sm) sm.textContent = t().levelLimits(v, F);
    reanalyze();
    render();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'site-form') return;
  e.preventDefault();
  readForm();
  const f = form;
  if (!f.name) return rerenderForm(t().vName);
  if (!isFinite(f.lat) || !isFinite(f.lon) || Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) return rerenderForm(t().vCoord);
  if (!isFinite(f.elev) || f.elev < -50 || f.elev > 6000) return rerenderForm(t().vElev);
  if (!f.dirs.length) return rerenderForm(t().vDirs);
  const site = { id: f.id || 'c-' + Date.now().toString(36), name: f.name, lat: f.lat, lon: f.lon, elev: Math.round(f.elev), dirs: f.dirs, note: f.note };
  S.custom = f.id ? S.custom.map((s) => (s.id === f.id ? site : s)) : [...S.custom, site];
  store.set('custom', S.custom);
  openSettings();
  loadOverview();
});

$('#dlg').addEventListener('close', () => { form = null; S.shareOpen = false; });

// ---------- render ----------
function applyTheme() {
  const root = document.documentElement;
  if (S.theme === 'light' || S.theme === 'dark') root.dataset.theme = S.theme;
  else delete root.dataset.theme;
}

function render() {
  document.documentElement.lang = S.lang;
  applyTheme();
  const r = route();
  const keep = {};
  for (const id of ['hscroll', 'ascroll']) { const el = $('#' + id); if (el) keep[id] = el.scrollLeft; }
  let body, title = 'Termika';
  if (r.view === 'map') { body = mapView(); title = `${t().viewMap} · Termika`; }
  else if (r.view === 'site') {
    const site = currentSite(r);
    body = site ? detailView(site, r.day) : pointPending(r);
    if (site) title = `${site.name} · Termika`;
  } else body = overview();
  $('#app').innerHTML = header(r) + body + footer();
  document.title = title;
  for (const id of ['hscroll', 'ascroll']) {
    const sc = $('#' + id);
    if (!sc) continue;
    if (keep[id] != null && S.keepScroll) sc.scrollLeft = keep[id];
    else { const cell = sc.querySelector('th.sel'); if (cell) sc.scrollLeft = Math.max(0, cell.offsetLeft - sc.clientWidth / 2); }
  }
  S.keepScroll = true;
  if (r.view === 'map') { const slot = $('#map-slot'); if (slot) showMap(slot, mapData()); }
}

function onRoute() {
  S.hour = null; S.keepScroll = false;
  const r = route();
  const sid = r.point ? 'pt:' + r.point.key : r.site || null;
  if (sid !== S.lastSite) { S.dmodel = null; S.lastSite = sid; }
  if (r.view === 'map') S.mapDay = r.day || S.mapDay;
  if (r.view === 'site') {
    window.scrollTo(0, 0);
    if (r.point && typeof S.points[r.point.key] !== 'number') {
      render();
      if (S.points[r.point.key] !== 'error') ensurePoint(r.point);
      return;
    }
  }
  render();
  const site = r.view === 'site' && currentSite(r);
  if (site) { loadDetail(site); loadEnsemble(site); }
}

window.addEventListener('hashchange', onRoute);
onRoute();
loadOverview();
loadAladin();
loadObs();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (S.ov && Date.now() - S.ov.t > TTL) loadOverview();
  if (!S.obsAt || Date.now() - S.obsAt > 10 * 60 * 1000) loadObs();
}, 60 * 1000);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; render(); });
window.addEventListener('appinstalled', () => { installEvt = null; render(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
