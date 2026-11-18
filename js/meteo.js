// Termika — fetching Open-Meteo data, sounding physics and flyability rules.

export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];
const LEVEL_VARS = ['temperature', 'relative_humidity', 'wind_speed', 'wind_direction', 'geopotential_height'];
const SURFACE_VARS = [
  'temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'cape', 'lifted_index', 'shortwave_radiation', 'cloud_cover', 'cloud_cover_low',
  'precipitation', 'precipitation_probability', 'weather_code', 'visibility',
];

// Ordered from finest to coarsest grid. `days` = how far ahead the model reaches.
// DHMZ ALADIN has no open data feed, so it is only linked (see app.js). HARMONIE-AROME and ARPEGE
// come from the same code family (ACCORD / Météo-France) as ALADIN.
export const MODELS = {
  italia_meteo_arpae_icon_2i: { label: 'ICON-2I', org: 'ItaliaMeteo', res: '2.2 km', days: 3 },
  // Not on Open-Meteo: read from data/aladin-si.json, made by tools/aladin_si.py from ARSO's GRIB files.
  aladin_si: { label: 'ALADIN-SI', org: 'ARSO', res: '4.4 km', days: 3, local: true },
  icon_seamless: { label: 'ICON', org: 'DWD', res: '2–7 km', days: 7 },
  knmi_harmonie_arome_europe: { label: 'HARMONIE', org: 'KNMI HARMONIE-AROME', res: '5.5 km', days: 3 },
  meteofrance_arpege_europe: { label: 'ARPEGE', org: 'Météo-France', res: '11 km', days: 4 },
  ukmo_seamless: { label: 'UKMO', org: 'UK Met Office', res: '10 km', days: 7 },
  ecmwf_ifs025: { label: 'ECMWF', org: 'ECMWF IFS', res: '25 km', days: 7 },
  gfs_seamless: { label: 'GFS', org: 'NOAA', res: '13–25 km', days: 7 },
};

// Limits per pilot level. Wind in km/h. `custom` is replaced by the user's own limits (Settings).
export const PROFILES = {
  student: { wind: 15, gust: 25, spread: 15, air: 25 },
  pilot: { wind: 22, gust: 32, spread: 18, air: 35 },
  custom: { wind: 18, gust: 28, spread: 15, air: 30 },
};

// Models fetched from Open-Meteo (all except locally prepared ones).
export const OM_MODELS = () => Object.keys(MODELS).filter((k) => !MODELS[k].local);

export const DIR_DEG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function hourlyVars() {
  const v = [...SURFACE_VARS];
  for (const l of LEVELS) for (const k of LEVEL_VARS) v.push(`${k}_${l}hPa`);
  return v;
}

export function forecastUrl(sites, models) {
  const p = new URLSearchParams({
    latitude: sites.map((s) => s.lat.toFixed(4)).join(','),
    longitude: sites.map((s) => s.lon.toFixed(4)).join(','),
    elevation: sites.map((s) => Math.round(s.elev)).join(','),
    hourly: hourlyVars().join(','),
    daily: 'sunrise,sunset',
    models: models.join(','),
    forecast_days: '7',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
}

export async function fetchForecast(sites, models, signal) {
  const res = await fetch(forecastUrl(sites, models), { signal });
  if (!res.ok) {
    let reason = res.status + '';
    try { reason = (await res.json()).reason || reason; } catch (e) { /* keep status */ }
    throw new Error(reason);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

// ---------- physics helpers ----------

const G = 9.81, CP = 1005, RD = 287, LV = 2.5e6, EPS = 0.622;

function satVap(tc) { return 6.112 * Math.exp((17.67 * tc) / (tc + 243.5)); } // hPa

export function dewPoint(tc, rh) {
  if (tc == null || rh == null) return null;
  const r = Math.min(100, Math.max(1, rh));
  const a = 17.62, b = 243.12;
  const g = Math.log(r / 100) + (a * tc) / (b + tc);
  return (b * g) / (a - g);
}

function moistLapse(tc, p) { // K per metre
  const t = tc + 273.15;
  const e = satVap(tc);
  const rs = (EPS * e) / Math.max(1, p - e);
  return (G * (1 + (LV * rs) / (RD * t))) / (CP + (LV * LV * rs * EPS) / (RD * t * t));
}

function toUV(ws, wd) {
  const r = (wd * Math.PI) / 180;
  return [-ws * Math.sin(r), -ws * Math.cos(r)];
}
function fromUV(u, v) {
  return { ws: Math.hypot(u, v), wd: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 };
}

export function angDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Degrees between the wind direction and the nearest direction the launch accepts.
export function offAngle(wd, dirs) {
  if (!dirs || !dirs.length) return 0;
  let best = 360;
  for (const d of dirs) {
    const deg = DIR_DEG[d];
    if (deg != null) best = Math.min(best, angDiff(wd, deg));
  }
  return best;
}

function interp(points, key, z) {
  if (!points.length) return null;
  if (z <= points[0].z) return points[0][key];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (z <= b.z) {
      if (a[key] == null || b[key] == null) return a[key] ?? b[key];
      const t = (z - a.z) / (b.z - a.z || 1);
      return a[key] + t * (b[key] - a[key]);
    }
  }
  return null; // above the top of the profile
}

function windAt(levels, z) {
  const L = levels.filter((l) => l.ws != null && l.wd != null);
  if (!L.length) return null;
  if (z <= L[0].z) return { ws: L[0].ws, wd: L[0].wd };
  const last = L[L.length - 1];
  if (z >= last.z) return { ws: last.ws, wd: last.wd };
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z || 1);
      const [ua, va] = toUV(a.ws, a.wd), [ub, vb] = toUV(b.ws, b.wd);
      return fromUV(ua + t * (ub - ua), va + t * (vb - va));
    }
  }
  return null;
}

function pressureAt(levels, z) {
  const L = levels.filter((l) => l.z != null);
  if (L.length < 2) return 1013 * Math.exp(-z / 8400);
  let a = L[0], b = L[1];
  for (let i = 1; i < L.length; i++) {
    a = L[i - 1]; b = L[i];
    if (z <= b.z) break;
  }
  const t = (z - a.z) / (b.z - a.z || 1);
  return Math.exp(Math.log(a.p) + t * (Math.log(b.p) - Math.log(a.p)));
}

// ---------- parsing ----------

// Turns one location of an Open-Meteo response into per-hour records for one model.
export function parseLocation(loc, model) {
  const h = loc.hourly;
  // With several models in one request, every column name ends in _<model>.
  const suf = 'temperature_2m' in h ? '' : '_' + model;
  const col = (k) => h[k + suf] || [];
  const cols = {};
  for (const k of SURFACE_VARS) cols[k] = col(k);
  const lv = {};
  for (const l of LEVELS) for (const k of LEVEL_VARS) lv[`${k}_${l}`] = col(`${k}_${l}hPa`);

  const hours = h.time.map((time, i) => {
    const levels = [];
    for (const l of LEVELS) {
      const z = lv[`geopotential_height_${l}`][i], t = lv[`temperature_${l}`][i];
      if (z == null || t == null) continue;
      levels.push({
        p: l, z, T: t,
        Td: dewPoint(t, lv[`relative_humidity_${l}`][i]),
        ws: lv[`wind_speed_${l}`][i], wd: lv[`wind_direction_${l}`][i],
      });
    }
    levels.sort((a, b) => a.z - b.z);
    return {
      time,
      T: cols.temperature_2m[i], Td: cols.dew_point_2m[i],
      ws: cols.wind_speed_10m[i], wd: cols.wind_direction_10m[i], gust: cols.wind_gusts_10m[i],
      cape: cols.cape[i], li: cols.lifted_index[i], sw: cols.shortwave_radiation[i],
      cc: cols.cloud_cover[i], ccl: cols.cloud_cover_low[i],
      pr: cols.precipitation[i], pp: cols.precipitation_probability[i],
      code: cols.weather_code[i], vis: cols.visibility[i],
      levels,
    };
  });
  const d = loc.daily || {};
  return {
    hours,
    days: (d.time || []).map((date, i) => ({
      date,
      sunrise: (d['sunrise' + suf] || d.sunrise || [])[i],
      sunset: (d['sunset' + suf] || d.sunset || [])[i],
    })),
  };
}

// ---------- analysis ----------

// Builds the sounding above the launch and lifts a surface parcel through it.
export function analyzeHour(h, site) {
  if (h.T == null || h.ws == null) return null;
  const elev = site.elev;
  const above = h.levels.filter((l) => l.z > elev + 10);
  const prof = [{ z: elev, T: h.T, Td: h.Td }, ...above];
  const topZ = prof[prof.length - 1].z;
  const spread = h.Td == null ? 99 : Math.max(0, h.T - h.Td);
  const base = elev + 125 * spread; // cumulus base, metres above sea level

  const dz = 20;
  let z = elev, tp = h.T, dryTop = null, cloudTop = null, open = false;
  const path = [{ z, T: tp }];
  for (;;) {
    if (z + dz > topZ) { open = true; break; }
    const zn = z + dz;
    if (zn <= base) tp -= 0.0098 * dz;
    else tp -= moistLapse(tp, pressureAt(h.levels, zn)) * dz;
    z = zn;
    const te = interp(prof, 'T', z);
    if (te == null) { open = true; break; }
    path.push({ z, T: tp });
    if (tp < te) {
      if (z <= base) dryTop = z; else cloudTop = z;
      break;
    }
  }
  let cu = false;
  if (dryTop == null) {
    if (base < z) { cu = true; if (cloudTop == null) cloudTop = z; }
    else dryTop = z;
  }
  const top = cu ? base : dryTop; // highest height a pilot can use
  const topAgl = Math.max(0, top - elev);

  // Thermal strength: Deardorff velocity w*, heat flux estimated as 30 % of solar input.
  const tk = h.T + 273.15;
  const pS = pressureAt(h.levels, elev);
  const rho = (pS * 100) / (RD * tk);
  const heat = 0.3 * Math.max(0, h.sw || 0);
  const wstar = topAgl < 100 || heat <= 0 ? 0 : Math.min(5, Math.cbrt((G / tk) * (heat / (rho * CP)) * topAgl));

  // Wind in the layer the pilot flies in: launch wind at the bottom, model levels above it.
  const windProf = [{ z: elev, ws: h.ws, wd: h.wd }, ...above];
  const layerTop = Math.min(topZ, Math.max(top, elev + 800));
  let airMax = { ws: 0, wd: h.wd };
  for (let zz = elev + 100; zz <= layerTop; zz += 100) {
    const w = windAt(windProf, zz);
    if (w && w.ws > airMax.ws) airMax = w;
  }
  const lee = windAt(windProf, elev + 400);
  const at = (p) => h.levels.find((l) => l.p === p) || null;

  return {
    base, cu, cloudTop, open, dryTop, top, topAgl, wstar,
    airMax, lee, l850: at(850), l700: at(700),
    path, prof, windProf, levels: h.levels,
  };
}

// Heights (m above sea level) for the altitude grid of one day, highest first; the last row is the launch.
export function altitudeLevels(hours, site) {
  let hi = site.elev + 1500;
  for (const h of hours) {
    const a = h.a;
    if (!a || !h.daylight) continue;
    const top = a.cu ? Math.min(a.cloudTop ?? a.base, a.base + 1500) : a.top;
    hi = Math.max(hi, top + 400);
  }
  hi = Math.min(hi, 4000);
  const steps = [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500, 4000];
  return [...steps.filter((z) => z > site.elev + 100 && z <= hi).reverse(), site.elev];
}

// Wind, temperature and layer (thermal / cloud) at height z for one hour.
export function conditionsAt(h, z, site) {
  const a = h.a;
  if (!a) return null;
  const launch = z === site.elev;
  const w = launch ? { ws: h.ws, wd: h.wd } : windAt(a.windProf, z);
  const T = launch ? h.T : interp(a.prof, 'T', z);
  // Each row stands for a band of about ±125 m around its height.
  const cloud = !launch && a.cu && z + 125 > a.base && z - 125 < (a.cloudTop ?? a.base);
  const thermal = !cloud && a.topAgl >= 150 && (launch || z - 125 < a.top);
  return { ws: w ? w.ws : null, wd: w ? w.wd : null, T, cloud, thermal, launch };
}

export function scoreHour(h, a, site, prof, daylight) {
  if (!a) return { state: 'nodata', reasons: [] };
  if (!daylight) return { state: 'night', reasons: [] };
  const r = [];
  const add = (sev, key, val) => r.push({ sev, key, val });

  if (h.code >= 95) add(2, 'thunder');
  if ([71, 73, 75, 77, 85, 86].includes(h.code)) add(2, 'snow');
  if (h.pr >= 0.5) add(2, 'rain', h.pr);
  else if (h.pr >= 0.1 || (h.pp ?? 0) >= 60) add(1, 'showers', h.pp);

  if (h.ws > prof.wind) add(2, 'wind', h.ws);
  else if (h.ws > prof.wind * 0.8) add(1, 'windHigh', h.ws);
  if (h.gust != null) {
    if (h.gust > prof.gust) add(2, 'gust', h.gust);
    const sp = h.gust - h.ws;
    if (sp > prof.spread) add(2, 'gusty', sp);
    else if (sp > prof.spread * 0.7) add(1, 'gustyish', sp);
  }
  if (h.ws >= 5 && site.dirs && site.dirs.length) {
    const off = offAngle(h.wd, site.dirs);
    if (off > 112.5) add(2, 'tail');
    else if (off > 45) add(2, 'cross');
    else if (off > 22.5) add(1, 'crossEdge');
  }
  if (a.lee && site.dirs && site.dirs.length) {
    const off = offAngle(a.lee.wd, site.dirs);
    if (off > 112.5 && a.lee.ws >= 15) add(2, 'lee', a.lee.ws);
    else if (off >= 90 && a.lee.ws >= 10) add(1, 'leeRisk', a.lee.ws);
  }
  if (a.airMax.ws > prof.air) add(2, 'air', a.airMax.ws);
  else if (a.airMax.ws > prof.air * 0.8) add(1, 'airHigh', a.airMax.ws);
  if (a.base - site.elev < 100 && (h.ccl ?? 0) >= 60) add(2, 'cloudLaunch');
  if (h.vis != null && h.vis < 2000) add(2, 'vis', h.vis);
  if ((a.cu && a.cloudTop >= 5000) || (h.cape ?? 0) >= 1500) add(2, 'storm', h.cape);
  else if ((h.cape ?? 0) >= 500 || (a.cu && a.cloudTop - a.base >= 2500)) add(1, 'overdev', h.cape);

  r.sort((x, y) => y.sev - x.sev);
  const worst = r.length ? r[0].sev : 0;
  return { state: worst === 2 ? 'no' : worst === 1 ? 'maybe' : 'go', reasons: r };
}

function minutes(iso) { // "2026-11-18T07:05" -> minutes after midnight
  const t = iso.slice(11, 16).split(':');
  return +t[0] * 60 + +t[1];
}

// Full analysis of one location for one model: days with scored hours.
export function analyzeSite(parsed, site, profKey) {
  const prof = PROFILES[profKey] || PROFILES.student;
  return parsed.days.map((day) => {
    const rise = day.sunrise ? minutes(day.sunrise) + 30 : 7 * 60;
    const set = day.sunset ? minutes(day.sunset) - 15 : 18 * 60;
    const hours = parsed.hours
      .filter((h) => h.time.startsWith(day.date))
      .map((h) => {
        const m = minutes(h.time);
        const daylight = m >= rise && m <= set;
        const a = analyzeHour(h, site);
        const s = scoreHour(h, a, site, prof, daylight);
        return { ...h, hour: m / 60, a, ...s, daylight };
      });
    return { ...day, hours, summary: summarizeDay(hours, prof) };
  });
}

export function summarizeDay(hours, prof) {
  const day = hours.filter((h) => h.daylight && h.state !== 'nodata');
  if (!day.length) return { state: 'nodata', goHours: 0 };
  let best = null, run = null;
  for (const h of day) {
    if (h.state === 'go') {
      if (!run) run = { from: h.hour, to: h.hour + 1, n: 0 };
      run.to = h.hour + 1; run.n++;
      if (!best || run.n > best.n) best = { ...run };
    } else run = null;
  }
  const goHours = day.filter((h) => h.state === 'go').length;
  const maybeHours = day.filter((h) => h.state === 'maybe').length;
  const usable = day.filter((h) => h.state !== 'no');
  const pick = (f) => usable.reduce((m, h) => Math.max(m, f(h) || 0), 0);
  const state = best && best.n >= 2 ? 'go' : goHours || maybeHours >= 2 ? 'maybe' : 'no';
  // Most common reason among the no-go hours explains a red day.
  const counts = {};
  for (const h of day) if (h.state === 'no') for (const r of h.reasons.filter((x) => x.sev === 2)) counts[r.key] = (counts[r.key] || 0) + 1;
  const mainReason = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  return {
    state, window: best, goHours, maybeHours,
    topAgl: pick((h) => h.a && h.a.topAgl),
    top: pick((h) => h.a && h.a.top),
    base: pick((h) => h.a && h.a.cu && h.a.base),
    wstar: pick((h) => h.a && h.a.wstar),
    cu: usable.some((h) => h.a && h.a.cu),
    rating: rateDay(day, best, prof),
    mainReason,
  };
}

// Day rating 0–5 stars, from the longest safe window: 1 star for a safe window of 2 h or more,
// up to +2 for thermal height above launch, +1 for thermal strength, +1 for 5 or more hours
// with usable thermals in the window, −0.5 when the wind aloft is near the limit.
export function rateDay(day, best, prof) {
  if (!best || best.n < 2) return 0;
  const win = day.filter((h) => h.hour >= best.from && h.hour < best.to && h.a);
  const max = (f) => win.reduce((m, h) => Math.max(m, f(h) || 0), 0);
  const top = max((h) => h.a.topAgl), w = max((h) => h.a.wstar), air = max((h) => h.a.airMax.ws);
  let r = 1;
  r += top >= 1200 ? 2 : top >= 700 ? 1.5 : top >= 350 ? 1 : top >= 150 ? 0.5 : 0;
  r += w >= 2 ? 1 : w >= 1.3 ? 0.5 : 0;
  const soar = win.filter((h) => h.a.topAgl >= 150).length;
  r += soar >= 5 ? 1 : soar >= 3 ? 0.5 : 0;
  if (prof && air > prof.air * 0.8) r -= 0.5;
  return Math.max(1, Math.min(5, Math.round(r)));
}

// Stability of the air above the launch: temperature gradient over the first 1500 m,
// the first inversion (temperature rising with height) and the freezing level.
export function stability(h, site) {
  const a = h.a;
  if (!a) return null;
  const pts = a.prof.filter((p) => p.T != null);
  const top = pts[pts.length - 1].z;
  const span = Math.min(1500, top - site.elev);
  const lapse = span >= 500 ? ((interp(pts, 'T', site.elev) - interp(pts, 'T', site.elev + span)) / span) * 1000 : null;
  let inv = null;
  for (let i = 1; i < pts.length && pts[i - 1].z < site.elev + 3500; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    if (p1.T - p0.T > 0.3) {
      if (!inv) inv = { base: p0.z, top: p1.z, dT: p1.T - p0.T };
      else if (Math.abs(inv.top - p0.z) < 1) { inv.top = p1.z; inv.dT += p1.T - p0.T; }
      else break;
    } else if (inv) break;
  }
  let zero = null;
  if (pts[0].T <= 0) zero = pts[0].z;
  else for (let i = 1; i < pts.length; i++) {
    if (pts[i].T <= 0) { const p0 = pts[i - 1], p1 = pts[i]; zero = p0.z + ((p1.z - p0.z) * p0.T) / (p0.T - p1.T); break; }
  }
  const cls = lapse == null ? null : lapse >= 8.5 ? 'unstable' : lapse >= 6.5 ? 'conditional' : lapse >= 4 ? 'stable' : 'veryStable';
  return { lapse, cls, inv, zero, surfaceInv: inv && inv.base <= site.elev + 1 };
}

// ---------- ensemble (ECMWF, 51 members) ----------
const ENS_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'wind_speed_850hPa'];
export const ENS_MODEL = 'ecmwf_ifs025';

export async function fetchEnsemble(site, signal) {
  const p = new URLSearchParams({
    latitude: site.lat.toFixed(4), longitude: site.lon.toFixed(4), elevation: String(Math.round(site.elev)),
    hourly: ENS_VARS.join(','), models: ENS_MODEL, forecast_days: '7', timezone: 'auto', wind_speed_unit: 'kmh',
  });
  const res = await fetch('https://ensemble-api.open-meteo.com/v1/ensemble?' + p.toString(), { signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// Share of ensemble members that meet the basic limits (launch wind and direction, gusts, rain,
// wind at 850 hPa) for every hour: { 'YYYY-MM-DDTHH:00': 0..1 }.
export function ensembleProb(json, site, prof) {
  const h = json.hourly || {};
  const members = Object.keys(h).filter((k) => k === 'wind_speed_10m' || k.startsWith('wind_speed_10m_member')).map((k) => k.slice('wind_speed_10m'.length));
  const col = (v, m) => h[v + m] || [];
  const out = {};
  (h.time || []).forEach((time, i) => {
    let n = 0, ok = 0;
    for (const m of members) {
      const ws = col('wind_speed_10m', m)[i];
      if (ws == null) continue;
      n++;
      const wd = col('wind_direction_10m', m)[i], g = col('wind_gusts_10m', m)[i];
      const pr = col('precipitation', m)[i], w850 = col('wind_speed_850hPa', m)[i];
      let pass = ws <= prof.wind;
      if (pass && g != null) pass = g <= prof.gust && g - ws <= prof.spread;
      if (pass && pr != null) pass = pr < 0.5;
      // 850 hPa (about 1500 m) is in the flying layer only when the launch is high enough.
      if (pass && w850 != null && site.elev >= 400) pass = w850 <= prof.air;
      if (pass && ws >= 5 && wd != null && site.dirs && site.dirs.length) pass = offAngle(wd, site.dirs) <= 45;
      if (pass) ok++;
    }
    out[time] = n ? ok / n : null;
  });
  return { prob: out, members: members.length };
}
