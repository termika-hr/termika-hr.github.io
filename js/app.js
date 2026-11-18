// Termika — user interface.
import { SITES, REGIONS } from './sites.js';
import * as M from './meteo.js';
import { STR, dirLabel, degLabel } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TTL = 30 * 60 * 1000;

const store = {
  get(k, d) { try { const v = localStorage.getItem('termika:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('termika:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

const S = {
  lang: store.get('lang', 'hr'),
  units: store.get('units', 'kmh'),
  profile: store.get('profile', 'student'),
  model: store.get('model', 'icon_seamless'),
  custom: store.get('custom', []),
  favs: store.get('favs', []),
  ov: null, ovStatus: 'idle', ovError: null,
  dt: null, dtStatus: 'idle',
  al: null,       // ALADIN-SI extract (data/aladin-si.json)
  dmodel: null,   // model shown on the site page; null = main model
  hour: null,
};
if (!M.MODELS[S.model]) S.model = 'icon_seamless';
if (!M.PROFILES[S.profile]) S.profile = 'student';

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
  if (S.units === 'ms') { const v = kmh / 3.6; return v < 10 ? v.toFixed(1) : Math.round(v); }
  if (S.units === 'kt') return Math.round(kmh / 1.852);
  return Math.round(kmh);
}
const F = {
  w: (kmh) => `${wNum(kmh)} ${unitLabel()}`,
  mm: (v) => (v < 1 ? v.toFixed(1) : Math.round(v)),
};
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

// ---------- icons ----------
const IC = {
  logo: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="var(--ink)"/><path d="M13 22a6 6 0 0 1 6-6 8 8 0 0 1 15 2.5A5 5 0 0 1 34 28H15a5 5 0 0 1-2-6z" fill="var(--bg)"/><path d="M24 42c-4-2-4-5 0-7s4-5 0-7" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
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
// "DWD ICON · 2–7 km" plus the range when a model stops before day 7.
function modelLong(k) {
  const m = M.MODELS[k];
  const res = S.lang === 'hr' ? m.res.replace('.', ',') : m.res;
  return `${m.org} · ${res}${m.days < 7 ? ` · ${m.days} ${t().days}` : ''}`;
}
const dirsText = (dirs) => (dirs || []).map((d) => dirLabel(d, S.lang)).join(', ');

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
    S.ovStatus = 'ok'; S.ovError = null;
  } catch (e) {
    S.ovStatus = 'error'; S.ovError = e.message || String(e);
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
  const cached = store.get('dt', null);
  if (cached && cached.key === key && (!S.dt || S.dt.t !== cached.t)) applyDt(cached, site);
  if (!force && cached && cached.key === key && Date.now() - cached.t < TTL) { S.dtStatus = 'ok'; render(); return; }
  if (S.dt && S.dt.key !== key) S.dt = null;
  S.dtStatus = 'loading'; render();
  try {
    const raw = await M.fetchForecast([site], M.OM_MODELS());
    const c = { key, t: Date.now(), raw: raw[0] };
    store.set('dt', c);
    applyDt(c, site);
    S.dtStatus = 'ok';
  } catch (e) {
    S.dtStatus = 'error';
  }
  render();
}
function applyDt(c, site) {
  const parsed = {};
  for (const m of M.OM_MODELS()) parsed[m] = M.parseLocation(c.raw, m);
  const al = S.al?.sites?.[site.id];
  if (al && !site.custom) parsed.aladin_si = M.parseLocation(al, 'aladin_si');
  S.dt = { key: c.key, t: c.t, siteId: site.id, parsed, days: {} };
  analyzeDt(site);
}
function analyzeDt(site) {
  if (!S.dt) return;
  for (const m of Object.keys(S.dt.parsed)) S.dt.days[m] = M.analyzeSite(S.dt.parsed[m], site, S.profile);
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
  const s = route().site && findSite(route().site);
  const loc = s && !s.custom && S.al.sites?.[s.id];
  if (loc && S.dt && S.dt.siteId === s.id) {
    S.dt.parsed.aladin_si = M.parseLocation(loc, 'aladin_si');
    S.dt.days.aladin_si = M.analyzeSite(S.dt.parsed.aladin_si, s, S.profile);
    render();
  }
}
function siteDays(site) {
  if (S.dt && S.dt.siteId === site.id && S.dt.days[S.model]) return S.dt.days[S.model];
  return S.ov && S.ov.model === S.model ? S.ov.days[site.id] : null;
}

// ---------- routing ----------
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { site: p.get('site'), day: Math.max(0, Math.min(6, +(p.get('day') || 0) || 0)) };
}
const siteHref = (id, day = 0) => `#site=${encodeURIComponent(id)}&day=${day}`;

// ---------- views ----------
function header() {
  const busy = S.ovStatus === 'loading' || S.dtStatus === 'loading';
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
  <div class="status">
    ${S.ov ? `<span>${t().updated} <b>${timeStr(S.ov.t)}</b></span>` : ''}
    <span>${t().model} <b>${M.MODELS[S.model].label}</b> <span class="dim">(${modelLong(S.model)})</span></span>
    <span><b>${t().levels[S.profile]}</b></span>
    ${S.ovStatus === 'loading' ? `<span>${t().loading}</span>` : ''}
  </div>
  ${S.ovStatus === 'error' ? `<div class="banner ${S.ov ? '' : 'err'}" role="status">${S.ov ? t().stale(timeStr(S.ov.t)) : t().error(esc(S.ovError))}</div>` : ''}`;
}

function bestBets() {
  if (!S.ov) return '';
  const sites = allSites();
  const col = (di) => {
    const day = Object.values(S.ov.days)[0]?.[di];
    if (!day) return '';
    const p = dayParts(day.date);
    const list = sites
      .map((s) => ({ s, sum: S.ov.days[s.id]?.[di]?.summary }))
      .filter((x) => x.sum && x.sum.state === 'go')
      .sort((a, b) => (b.sum.window?.n || 0) - (a.sum.window?.n || 0) || b.sum.topAgl - a.sum.topAgl)
      .slice(0, 4);
    const items = list.map(({ s, sum }) => `<li><a href="${siteHref(s.id, di)}"><span class="dot st-go"></span><b>${esc(s.name)}</b><span class="meta num">${windowText(sum.window)}${sum.topAgl >= 150 ? ` · ${t().thermalsTo(m50(sum.top))}` : ''}</span></a></li>`).join('');
    return `<div class="best-day"><h3>${di === 0 ? t().today : t().tomorrow} <span>${p.full}</span></h3>${items ? `<ol>${items}</ol>` : `<p class="none">${t().noneGo}</p>`}</div>`;
  };
  return `<section class="best"><h2>${t().best}</h2><div class="best-grid">${col(0)}${col(1)}</div></section>`;
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
      const tip = `${s.name} · ${dayParts(d.date).full}: ${t().state[sum.state]}${sum.window ? ' ' + windowText(sum.window) : ''}${sum.mainReason && sum.state === 'no' ? ' · ' + t().short[sum.mainReason] : ''}`;
      const main = sum.window ? `${sum.window.from}–${sum.window.to}` : sum.state === 'maybe' ? '!' : sum.state === 'no' ? '✕' : '';
      const sub = sum.state !== 'no' && sum.topAgl >= 150 ? `<i>${m50(sum.top)}</i>` : '';
      return `<a class="mcell st-${sum.state}" href="${siteHref(s.id, i)}" title="${esc(tip)}" aria-label="${esc(tip)}">${main}${sub}</a>`;
    }).join('');
    return `<div class="mrow" role="row"><a class="mname" href="${siteHref(s.id)}">${rose(s.dirs)}<span><b>${esc(s.name)}</b><small>${Math.round(s.elev)} m · ${dirsText(s.dirs)}</small></span></a>${cells}</div>`;
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

function overview() {
  return bestBets() + matrix() + help();
}

function pickHour(hours, sum) {
  const day = hours.filter((h) => h.daylight);
  if (S.hour != null && hours.some((h) => h.hour === S.hour)) return S.hour;
  if (sum.window) return Math.floor((sum.window.from + sum.window.to - 1) / 2);
  return (day.find((h) => h.hour === 13) || day[Math.floor(day.length / 2)] || hours[12] || {}).hour ?? 12;
}

function detailView(site, di) {
  const days = siteDays(site);
  const fav = S.favs.includes(site.id);
  const headHtml = `<nav class="crumbs"><a href="#">← ${t().allSites}</a></nav>
  <section class="site-head">
    ${rose(site.dirs, 'rose-big', true)}
    <div>
      <h1>${esc(site.name)}</h1>
      <p>${t().launch(Math.round(site.elev))} · ${t().faces}: <b>${dirsText(site.dirs)}</b></p>
      ${site.check ? `<p class="warn">${t().check}</p>` : ''}
      ${site.note ? `<p>${esc(tr(site.note))}</p>` : ''}
      ${site.src ? `<p>${t().source}: ${esc(tr(site.src))}</p>` : ''}
    </div>
    <div class="site-actions">
      <button type="button" class="icon-btn" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? t().favRemove : t().favAdd}" title="${fav ? t().favRemove : t().favAdd}">${IC.star}</button>
      ${site.custom ? `<button type="button" class="icon-btn" data-act="edit-site" data-id="${esc(site.id)}" aria-label="${t().edit}" title="${t().edit}">${IC.edit}</button>` : ''}
    </div>
  </section>`;
  if (!days || !days[di]) {
    const msg = S.dtStatus === 'error' && S.ovStatus === 'error' ? t().error(esc(S.ovError || '')) : t().loading;
    return headHtml + `<p class="boot">${msg}</p>`;
  }
  const dm = S.dmodel && S.dt?.siteId === site.id && S.dt.days[S.dmodel] ? S.dmodel : S.model;
  const mdays = dm === S.model ? days : S.dt.days[dm];
  const baseDay = days[di];
  const tabs = `<nav class="daytabs" role="tablist">${days.map((d, i) => { const p = dayParts(d.date); const st = (mdays.find((x) => x.date === d.date) || {}).summary?.state || 'nodata'; return `<a role="tab" class="daytab st-${st}" aria-selected="${i === di}" href="${siteHref(site.id, i)}">${i === 0 ? t().today.slice(0, 5) : p.wd}<b>${p.dd}</b></a>`; }).join('')}</nav>`;
  const modelBar = `<div class="model-bar" id="model-bar"><span>${t().shown}: <b>${M.MODELS[dm].label}</b> <span class="dim">(${modelLong(dm)})</span></span>${dm !== S.model ? `<button type="button" class="btn small" data-model="">${t().backToMain(M.MODELS[S.model].label)}</button>` : ''}</div>`;
  const rise = baseDay.sunrise ? +baseDay.sunrise.slice(11, 13) : 7;
  const set = baseDay.sunset ? +baseDay.sunset.slice(11, 13) + 1 : 18;
  const cols = baseDay.hours.filter((h) => h.hour >= rise && h.hour <= set);
  const day = mdays.find((d) => d.date === baseDay.date);
  if (!day || day.summary.state === 'nodata') {
    return headHtml + tabs + modelBar + `<section class="card"><p class="hint" style="margin:0">${t().modelNoDay(M.MODELS[dm].label)}</p></section>` + compare(site, baseDay.date, cols, dm) + links(site);
  }
  const sum = day.summary;

  const cu = sum.cu;
  const kpis = `<dl class="kpis">
    <div><dt>${t().window}</dt><dd class="num">${sum.window ? windowText(sum.window) : t().noWindow}</dd></div>
    <div><dt>${t().ttop}</dt><dd class="num">${sum.topAgl >= 150 ? `${m50(sum.top)} m<small>${t().aboveLaunch(m50(sum.topAgl))}</small>` : `–<small>${t().noThermals}</small>`}</dd></div>
    <div><dt>${t().cbase}</dt><dd class="num">${cu ? `${m50(sum.top)} m` : `–<small>${t().blue}</small>`}</dd></div>
    <div><dt>${t().wstar}</dt><dd class="num">${sum.wstar > 0.2 ? `${sum.wstar.toFixed(1)} m/s` : '–'}<small>${t().est}</small></dd></div>
  </dl>`;
  const reasonLine = sum.state === 'no' && sum.mainReason ? `<span>${t().mainReason}: ${t().short[sum.mainReason]}</span>` : '';
  const summary = `<section class="summary st-${sum.state}"><div class="verdict"><span class="pill">${t().state[sum.state]}</span><span>${dayParts(day.date).full}</span>${reasonLine}</div>${kpis}</section>`;

  const hours = day.hours.filter((h) => h.hour >= rise && h.hour <= set);
  const sel = pickHour(hours, sum);
  return headHtml + tabs + modelBar + summary + hourlyTable(site, hours, sel) + altitudeGrid(site, hours, sel) + hourDetail(site, hours.find((h) => h.hour === sel)) + compare(site, baseDay.date, cols, dm) + links(site);
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
  const rows = [
    ['state', (h) => `<span class="sq st-${h.state}" title="${t().state[h.state]}">${sym[h.state]}</span>`],
    ['wind', (h) => w(h.ws, h.wd, windCls(h)), true],
    ['gust', (h) => (h.gust == null ? '–' : `<span class="${h.gust > p.gust || h.gust - h.ws > p.spread ? 'v-bad' : h.gust > p.gust * 0.8 || h.gust - h.ws > p.spread * 0.7 ? 'v-warn' : 'v-ok'}">${wNum(h.gust)}</span>`)],
    ['air', (h) => (h.a ? w(h.a.airMax.ws, h.a.airMax.wd, lim(h.a.airMax.ws, p.air)) : '–')],
    ['l850', (h) => (h.a?.l850 ? w(h.a.l850.ws, h.a.l850.wd, 'dim') : '–')],
    ['l700', (h) => (h.a?.l700 ? w(h.a.l700.ws, h.a.l700.wd, 'dim') : '–')],
    ['top', (h) => (h.a && h.a.topAgl >= 150 ? m50(h.a.top) : '<span class="dim">–</span>'), 'sep'],
    ['base', (h) => (h.a ? (h.a.cu ? m50(h.a.base) : `<span class="dim">${t().blueShort}</span>`) : '–')],
    ['wstar', (h) => (h.a && h.a.wstar > 0.2 ? h.a.wstar.toFixed(1) : '<span class="dim">–</span>')],
    ['cloud', (h) => (h.cc == null ? '–' : `${h.cc}<span class="dim"> (${h.ccl ?? '–'})</span>`), 'sep'],
    ['rain', (h) => (h.pr > 0 ? `<span class="${h.pr >= 0.5 ? 'v-bad' : 'v-warn'}">${F.mm(h.pr)}</span>` : '<span class="dim">–</span>')],
    ['cape', (h) => (h.cape >= 50 ? `<span class="${h.cape >= 1500 ? 'v-bad' : h.cape >= 500 ? 'v-warn' : ''}">${Math.round(h.cape)}</span>` : '<span class="dim">–</span>')],
    ['temp', (h) => (h.T == null ? '–' : Math.round(h.T))],
  ];
  const body = rows.map(([k, f, sep]) => `<tr${sep === 'sep' ? ' class="sep"' : ''}><th scope="row">${t().rows[k]}${k === 'wind' || k === 'gust' || k === 'air' || k === 'l850' || k === 'l700' ? ` <span class="dim">${unitLabel()}</span>` : k === 'top' || k === 'base' ? ' <span class="dim">m</span>' : ''}</th>${hours.map((h) => `<td${cls(h)}>${f(h)}</td>`).join('')}</tr>`).join('');
  return `<section class="card"><div class="table-scroll" id="hscroll"><table class="htable">
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
  return `<section class="card"><h2>${t().alt}</h2><p class="hint">${t().altHint}</p>
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
  const facts = a ? `<dl class="facts">
    <dt>${t().rows.wind}</dt><dd>${degLabel(h.wd, S.lang)} ${F.w(h.ws)}, ${t().rows.gust.toLowerCase()} ${F.w(h.gust)}</dd>
    <dt>${S.lang === 'hr' ? '400 m iznad starta' : '400 m above launch'}</dt><dd>${a.lee ? `${degLabel(a.lee.wd, S.lang)} ${F.w(a.lee.ws)}` : '–'}</dd>
    <dt>${t().ttop}</dt><dd>${a.topAgl >= 150 ? `${m50(a.top)} m (${t().aboveLaunch(m50(a.topAgl))})` : t().noThermals}</dd>
    <dt>${t().cbase}</dt><dd>${a.cu ? `${m50(a.base)} m${a.cloudTop ? ` → ${S.lang === 'hr' ? 'vrh oblaka' : 'cloud top'} ${a.open ? '>' : ''}${m50(a.cloudTop)} m` : ''}` : t().blue}</dd>
    <dt>${t().rows.temp}</dt><dd>${Math.round(h.T)} °C / ${S.lang === 'hr' ? 'rosište' : 'dew point'} ${h.Td == null ? '–' : Math.round(h.Td)} °C</dd>
  </dl>` : '';
  return `<section class="card"><div class="hour-grid">
    <div class="why"><h2>${t().why} · ${t().hourTitle(pad2(h.hour))}</h2><ul>${list}</ul>${facts}</div>
    <figure class="sounding" style="margin:0"><h2>${t().sounding} · ${t().hourTitle(pad2(h.hour))}</h2>${soundingSvg(site, h)}
      <figcaption class="s-legend"><span><i style="border-color:var(--temp)"></i>${t().sLegend.T}</span><span><i style="border-color:var(--sky)"></i>${t().sLegend.Td}</span><span><i style="border-color:var(--accent);border-top-style:dashed"></i>${t().sLegend.parcel}</span></figcaption>
    </figure>
  </div></section>`;
}

function soundingSvg(site, h) {
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
  for (let v = tMin; v <= tMax; v += 5) g += `<line x1="${f1(x(v))}" x2="${f1(x(v))}" y1="${T}" y2="${T + ph}" stroke="var(--line)"/><text x="${f1(x(v))}" y="${H - 8}" text-anchor="middle">${v}°</text>`;
  let adi = '';
  for (let v = tMin; v <= tMax + 60; v += 10) adi += `<line x1="${f1(x(v))}" y1="${f1(y(zLo))}" x2="${f1(x(v - 9.8 * (zHi - zLo) / 1000))}" y2="${f1(y(zHi))}" stroke="var(--muted)" stroke-opacity="0.25" stroke-dasharray="2 3"/>`;
  const line = (pts, key) => pts.filter((p) => p[key] != null).map((p) => `${f1(x(p[key]))},${f1(y(p.z))}`).join(' ');
  const ground = `<rect x="${L}" y="${f1(y(site.elev))}" width="${pw}" height="${f1(T + ph - y(site.elev))}" fill="var(--ground)" opacity="0.7"/><text x="${L + 4}" y="${f1(y(site.elev) + 12)}" class="lbl">${t().sLegend.launch} ${Math.round(site.elev)} m</text>`;
  let marks = '';
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
    return `<button type="button" class="cmp-row${m === shown ? ' on' : ''}" data-model="${m}" aria-pressed="${m === shown}"><b>${info.label}</b><span class="cmp-cells">${cells}</span><small class="num">${text}</small></button>`;
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
  return `<nav class="links">${t().links}
    <a href="https://www.windy.com/?${lat},${lon},11" target="_blank" rel="noopener">Windy</a>
    <a href="https://www.meteoblue.com/${S.lang === 'hr' ? 'hr' : 'en'}/weather/forecast/multimodel/${mb}" target="_blank" rel="noopener">meteoblue</a>
    <a href="https://meteo.hr/prognoze.php?section=prognoze_model&amp;param=ala_k&amp;el=${aladinMap(site)}" target="_blank" rel="noopener">ALADIN (DHMZ)</a>
    <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}" target="_blank" rel="noopener">${t().map}</a>
  </nav>`;
}

function help() {
  const p = M.PROFILES;
  const lim = Object.keys(p).map((k) => `<b>${t().levels[k]}:</b> ${t().levelLimits(p[k], F)}, ${S.lang === 'hr' ? 'udari najviše' : 'gusts at most'} ${F.w(p[k].spread)} ${S.lang === 'hr' ? 'jači od srednjeg vjetra' : 'above the mean wind'}.`).join(' ');
  return `<details class="help"><summary>${t().helpTitle}</summary>${t().help.map((x) => `<p>${x}</p>`).join('')}<p>${lim}</p></details>`;
}

function footer() {
  return `<footer class="foot"><p class="disc">${t().disclaimer}</p><p>${t().attribution}</p><p>${t().install}</p></footer>`;
}

// ---------- settings dialog ----------
let form = null; // site being edited in the dialog

function settingsHtml() {
  const seg = (name, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-set="${name}" data-val="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  const levels = Object.keys(M.PROFILES).map((k) => `<label><input type="radio" name="level" value="${k}" ${S.profile === k ? 'checked' : ''}><span><b>${t().levels[k]}</b><small>${t().levelLimits(M.PROFILES[k], F)}</small></span></label>`).join('');
  const models = Object.entries(M.MODELS).filter(([k]) => !M.MODELS[k].local).map(([k, m]) => `<label><input type="radio" name="model" value="${k}" ${S.model === k ? 'checked' : ''}><span><b>${m.label}</b><small>${modelLong(k)}</small></span></label>`).join('');
  const mine = S.custom.length
    ? `<ul class="site-list">${S.custom.map((s) => `<li><span><b>${esc(s.name)}</b> <small>${Math.round(s.elev)} m · ${dirsText(s.dirs)}</small></span><button type="button" class="btn small" data-act="edit-site" data-id="${esc(s.id)}">${t().edit}</button></li>`).join('')}</ul>`
    : `<p class="hint" style="margin:0">${t().noCustom}</p>`;
  return `<div class="dlg">
    <div class="dlg-head"><h2 id="dlg-title">${t().settingsTitle}</h2><button type="button" class="icon-btn" data-act="close" aria-label="${t().close}">${IC.close}</button></div>
    <div class="field"><span class="lab">${t().lang}</span>${seg('lang', S.lang, [['hr', 'Hrvatski'], ['en', 'English']])}</div>
    <div class="field"><span class="lab">${t().units}</span>${seg('units', S.units, [['kmh', 'km/h'], ['ms', 'm/s'], ['kt', 'kt']])}</div>
    <div class="field"><span class="lab">${t().level}</span><div class="choice">${levels}</div></div>
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

// ---------- events ----------
function setPref(k, v) {
  S[k] = v; store.set(k, v);
  if (k === 'profile') { analyzeOv(); const r = route(); const s = r.site && findSite(r.site); if (s) analyzeDt(s); }
  if (k === 'model') loadOverview();
  render();
  if ($('#dlg').open && !form) $('#dlg').innerHTML = settingsHtml();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-act]');
  if (!b) return;
  if (b.dataset.lang) return setPref('lang', b.dataset.lang);
  if (b.dataset.set) return setPref(b.dataset.set, b.dataset.val);
  if (b.dataset.hour) {
    S.hour = +b.dataset.hour;
    return render();
  }
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
  if (act === 'refresh') {
    loadOverview(true);
    loadAladin();
    const r = route(); const s = r.site && findSite(r.site);
    if (s) loadDetail(s, true);
  } else if (act === 'settings') openSettings();
  else if (act === 'close') { $('#dlg').close(); form = null; }
  else if (act === 'fav') {
    const id = route().site;
    S.favs = S.favs.includes(id) ? S.favs.filter((x) => x !== id) : [...S.favs, id];
    store.set('favs', S.favs); render();
  } else if (act === 'add-site') openForm(null);
  else if (act === 'edit-site') openForm(S.custom.find((s) => s.id === b.dataset.id));
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
    if (!isFinite(form.lat) || !isFinite(form.lon)) return rerenderForm(t().vCoord);
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${form.lat}&longitude=${form.lon}`);
      const j = await r.json();
      form.elev = Math.round(j.elevation[0]);
      $('#dlg').innerHTML = siteFormHtml();
    } catch (err) { rerenderForm(t().elevFail); }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'level') setPref('profile', e.target.value);
  if (e.target.name === 'model') setPref('model', e.target.value);
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

$('#dlg').addEventListener('close', () => { form = null; });

// ---------- render ----------
function render() {
  document.documentElement.lang = S.lang;
  const r = route();
  const site = r.site && findSite(r.site);
  const keep = {};
  for (const id of ['hscroll', 'ascroll']) { const el = $('#' + id); if (el) keep[id] = el.scrollLeft; }
  $('#app').innerHTML = header() + (site ? detailView(site, r.day) : overview()) + footer();
  document.title = site ? `${site.name} · Termika` : 'Termika';
  for (const id of ['hscroll', 'ascroll']) {
    const sc = $('#' + id);
    if (!sc) continue;
    if (keep[id] != null && S.keepScroll) sc.scrollLeft = keep[id];
    else { const cell = sc.querySelector('th.sel'); if (cell) sc.scrollLeft = Math.max(0, cell.offsetLeft - sc.clientWidth / 2); }
  }
  S.keepScroll = true;
}

function onRoute() {
  S.hour = null; S.keepScroll = false;
  const r = route();
  if (r.site !== S.lastSite) { S.dmodel = null; S.lastSite = r.site; }
  const site = r.site && findSite(r.site);
  render();
  if (site) { loadDetail(site); window.scrollTo(0, 0); }
}

window.addEventListener('hashchange', onRoute);
onRoute();
loadOverview();
loadAladin();
setInterval(() => { if (document.visibilityState === 'visible' && S.ov && Date.now() - S.ov.t > TTL) loadOverview(); }, 60 * 1000);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
