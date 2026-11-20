// Termika live stations on Cloudflare Workers.
//
// Every 10 minutes (Cron Trigger) this gathers the stations Termika can't read straight from the
// browser (DHMZ and METAR send no CORS headers) plus ARSO and OpenWindMap, and keeps the result in
// KV. GET /obs.json returns it with CORS, in the same format as tools/obs.py's data/obs.json, which
// stays as the fallback. Club stations (flumen.club) are read by the app itself.
//
// Sources: DHMZ (Izvor: DHMZ, Open Licence RH), METAR via NOAA AWC (public domain), ARSO (Vir:
// ARSO), OpenWindMap (Community License: credit the OpenWindMap contributors with a link).

const UA = 'termika-obs/1.0 (+https://termika-hr.github.io/)';
const DHMZ_URL = 'https://vrijeme.hr/hrvatska_n.xml';
const ICAO = ['LDZA', 'LDVA', 'LDRI', 'LDPL', 'LDLO', 'LDZD', 'LDSP', 'LDSB', 'LDDU', 'LDOS',
  'LJLJ', 'LJMB', 'LJPZ', 'LJCE', 'LQBK', 'LQSA', 'LQMO', 'LHPP'];
const METAR_URL = `https://aviationweather.gov/api/data/metar?ids=${ICAO.join(',')}&format=json&hours=3`;
const OWM_URL = 'https://api.pioupiou.fr/v1/live/all';
const OWM_AREA = [42.3, 13.2, 46.7, 19.5]; // lat/lon box: Croatia and nearby
const OWM_MAX_AGE_H = 3;
// ARSO automatic stations with wind within about 45 km of a Termika launch, one small file each.
const ARSO_IDS = ['SLAVNIK_', 'CERKLJE_LETAL-SCE_', 'PTUJ_', 'ROGAS-SLA_', 'KOPER_KAPET-IJA_', 'KOPER_LUKA_',
  'KOPER_MARKOVEC_', 'SKOCJAN_', 'PORTOROZ_SECOVLJE_', 'SVISCAKI_', 'MARIBOR_SLIVNICA_', 'NOVO-MES_', 'NANOS_',
  'GODNJE_', 'ISKRBA_', 'POSTOJNA_', 'PODNANOS_', 'CRNOMELJ_', 'LISCA_', 'MARIBOR_VRBAN-PLA_', 'MURSK-SOB_', 'KOCEVJE_'];
const ARSO_URL = (id) => `https://meteo.arso.gov.si/uploads/probase/www/observ/surface/text/sl/observationAms_${id}latest.xml`;
// Heights of DHMZ mountain stations (m); the feed has none.
const DHMZ_ELEV = { 'RC Puntijarka': 988, 'Zavižan': 1594, 'Parg-Čabar': 863, 'Crni Lug - NP Risnjak': 726,
  'Gospić': 564, 'NP Plitvička jezera': 579, 'Ogulin': 328 };
const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

const get = (url) => fetch(url, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 0 } });
const num = (s) => { const v = parseFloat(String(s ?? '').trim()); return Number.isFinite(v) ? v : null; };
const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? unesc(m[1].trim()) : ''; };

// Wall-clock time in Croatia -> milliseconds UTC.
function zagreb(y, mo, d, h, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zagreb', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return guess - (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - guess);
}

async function dhmz() {
  const xml = await (await get(DHMZ_URL)).text();
  const [d, m, y] = tag(xml, 'Datum').split('.').map(Number);
  const when = iso(zagreb(y, m, d, Number(tag(xml, 'Termin'))));
  const out = [];
  for (const g of xml.split(/<Grad[\s>]/).slice(1)) {
    const name = tag(g, 'GradIme'), lat = num(tag(g, 'Lat')), lon = num(tag(g, 'Lon'));
    if (!name || lat == null || lon == null) continue;
    const ws = num(tag(g, 'VjetarBrzina'));
    out.push({
      id: 'dhmz:' + name, name: name.replace(/^RC /, '').trim(), src: 'DHMZ', lat, lon, elev: DHMZ_ELEV[name] ?? null,
      time: when, ws: ws == null ? null : Math.round(ws * 36) / 10, wd: COMPASS[tag(g, 'VjetarSmjer')] ?? null, wg: null,
      t: num(tag(g, 'Temp')),
    });
  }
  return out;
}

async function metar() {
  const data = await (await get(METAR_URL)).json();
  const latest = {};
  for (const m of data) if (m.icaoId && (!latest[m.icaoId] || (m.obsTime || 0) > (latest[m.icaoId].obsTime || 0))) latest[m.icaoId] = m;
  const kt = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 18.52) / 10);
  return Object.values(latest).map((m) => ({
    id: 'metar:' + m.icaoId, name: (m.name || m.icaoId).split(',')[0], icao: m.icaoId, src: 'METAR',
    lat: m.lat, lon: m.lon, elev: m.elev ?? null, time: iso(m.obsTime * 1000),
    ws: kt(m.wspd), wd: typeof m.wdir === 'number' ? m.wdir : null, wg: kt(m.wgst), t: m.temp ?? null, raw: m.rawOb,
  }));
}

async function arso() {
  const res = await Promise.allSettled(ARSO_IDS.map(async (id) => (await get(ARSO_URL(id))).text()));
  const out = [];
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    const x = r.value, ws = num(tag(x, 'ffavg_val_kmh')), lat = num(tag(x, 'domain_lat')), lon = num(tag(x, 'domain_lon'));
    const when = Date.parse(tag(x, 'tsValid_issued_RFC822'));
    if (ws == null || lat == null || lon == null || !Number.isFinite(when)) continue;
    const elev = num(tag(x, 'domain_altitude'));
    out.push({
      id: 'arso:' + (tag(x, 'domain_meteosiId') || tag(x, 'domain_title')), name: tag(x, 'domain_longTitle') || tag(x, 'domain_title'),
      src: 'ARSO', lat, lon, elev: elev == null ? null : Math.round(elev), time: iso(when),
      ws, wd: num(tag(x, 'ddavg_val')), wg: num(tag(x, 'ffmax_val_kmh')), t: num(tag(x, 't')),
    });
  }
  return out;
}

async function owm() {
  const data = (await (await get(OWM_URL)).json()).data || [];
  const now = Date.now(), out = [];
  for (const s of data) {
    const loc = s.location || {}, m = s.measurements || {};
    const lat = loc.latitude, lon = loc.longitude;
    if (lat == null || lon == null || lat < OWM_AREA[0] || lat > OWM_AREA[2] || lon < OWM_AREA[1] || lon > OWM_AREA[3]) continue;
    if ((s.status || {}).state !== 'on' || !m.date || m.wind_speed_avg == null) continue;
    const when = Date.parse(m.date);
    if (!(now - when <= OWM_MAX_AGE_H * 3600e3)) continue;
    const name = ((s.meta || {}).name || `OpenWindMap ${s.id}`).trim();
    const h = name.match(/(\d{3,4})\s*m\b/);
    out.push({
      id: `owm:${s.id}`, name: name.replace(/\s*[-–]?\s*\d{3,4}\s*m\s*$/, '') || name, src: 'OpenWindMap',
      lat, lon, elev: h ? +h[1] : null, time: iso(when), ws: m.wind_speed_avg, wd: m.wind_heading ?? null, wg: m.wind_speed_max ?? null, t: null,
    });
  }
  return out;
}

async function build() {
  const sources = { DHMZ: dhmz, METAR: metar, ARSO: arso, OpenWindMap: owm };
  const names = Object.keys(sources);
  const res = await Promise.allSettled(names.map((n) => sources[n]()));
  const stations = [], errors = [];
  res.forEach((r, i) => (r.status === 'fulfilled' ? stations.push(...r.value) : errors.push(`${names[i]}: ${r.reason}`)));
  return { generated: iso(Date.now()), errors, stations };
}

async function refresh(env) {
  const doc = await build();
  if (doc.stations.length) await env.OBS.put('obs', JSON.stringify(doc));
  return doc;
}

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=120' };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/obs.json') return new Response('Termika stations: /obs.json\n', { status: 404 });
    let body = await env.OBS.get('obs');
    if (!body) body = JSON.stringify(await refresh(env));
    return new Response(body, { headers: HEADERS });
  },
};

