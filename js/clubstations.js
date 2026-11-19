// Club wind stations on launches: the ELMAS / MMS network hosted by PJK Flumen at flumen.club,
// used with the clubs' permission. Each station belongs to the club named in `org`. Only stations
// in and around Croatia that are switched on; test stations left out. The latest reading of all of
// them comes from one request (CLUB_NOW_URL) straight from the browser, so it is live.
export const CLUB_NOW_URL = 'https://flumen.club/wp/data/rest.php/Now?filter=Station,in,';
export const CLUB_SITE = 'https://flumen.club/';

// [id, name, lat, lon, height m, owner, page]
const LIST = [
  [1, 'Tribalj', 45.2394, 14.6831, 743, 'PJK Flumen'],
  [2, 'Kalnik – zapad', 46.131, 16.4531, 614, 'Paragliding klub Feniks'],
  [3, 'Grobnik – Žbelac', 45.398312, 14.545887, 860, 'PJK Flumen'],
  [4, 'Japetić', 45.740802, 15.603483, 835, 'LK Parafreek'],
  [5, 'Plešivica', 45.737187, 15.668079, 779, 'PJK Zagreb'],
  [6, 'Strahinjčica', 46.185383, 15.896104, 720, 'KPJ Jastreb'],
  [7, 'Ivanščica', 46.18168, 16.1234674, 1062, 'KPJ Let Ivanec'],
  [9, 'Bjelopolje', 44.7047, 15.8197, 1156, 'PK Leteći medvjedići'],
  [10, 'Ravna gora', 46.271436, 15.983996, 680, 'KPJ Let Ivanec i donatori'],
  [11, 'Jugovec', 46.19786, 16.352028, 314, 'ZK Perun'],
  [12, 'Kalnik – Borje', 46.1271, 16.4357, 356, ''],
  [17, 'Gašparac', 44.8164, 15.2911, 690, 'PK Leteći medvjedići'],
  [19, 'Zavoj', 45.444583, 13.965234, 495, 'donacija istarskih parajedriličara'],
  [20, 'Oštro – Lipica', 45.265516, 14.562741, 6, 'Grad Kraljevica'],
  [22, 'Duplja (Novi Vinodolski)', 45.146934, 14.804948, 301, 'KTD Ivanj'],
  [28, 'Šušnjevica', 45.240584, 14.196813, 780, 'istarski parajedriličari i PJK Flumen'],
  [29, 'Drvar – Kruškovac', 44.379397, 16.396804, 740, 'Paraglajding klub Drvar'],
  [32, 'Dizdarica', 42.48702, 18.56845, 900, 'PK Adriafly i ACV CG'],
  [34, 'Libinje', 44.2897, 15.5703, 944, 'KSL Fobos i prijatelji s Libinja'],
  [36, 'Kupljenovo', 45.9384, 15.8049, 300, 'Nubigena i Parafreek', 'https://flumen.club/kupljenovo/'],
  [37, 'Brajići', 42.302262, 18.890961, 731, 'ACV Crne Gore'],
  [38, 'Dečić', 42.351453, 19.356399, 390, 'ACV Crne Gore'],
  [39, 'Poštak', 44.253029, 16.105779, 1243, 'KSL Fobos i prijatelji s Libinja'],
  [40, 'Aerodrom Grobnik', 45.379116, 14.514798, 318, 'ZD Krila Kvarnera'],
  [41, 'Korija', 45.846344, 17.328433, 133, 'Aeroklub Virovitica'],
  [42, 'Gomila (Cazin)', 44.922601, 16.052539, 797, 'Aero klub Kumulus Cazin'],
  [45, 'Visočica', 44.43216, 15.360839, 1430, 'donacija hrvatskih parajedriličara'],
  [122, 'Kalnik – Borje', 46.131024, 16.452994, 614, 'Paragliding klub Feniks'],
];

export const CLUB_STATIONS = LIST.map(([id, name, lat, lon, elev, org, url]) => ({ id, name, lat, lon, elev, org, url: url || CLUB_SITE }));

// "2026-11-20 00:22:12" in Croatian local time -> ISO time in UTC ("2026-11-19T23:22Z").
function localToUtc(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zagreb', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (shown - guess)).toISOString().slice(0, 16) + 'Z';
}

const num = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);

// Latest reading of every club station, in Termika's station format (wind in km/h).
export async function fetchClubStations(signal) {
  const res = await fetch(CLUB_NOW_URL + CLUB_STATIONS.map((s) => s.id).join(','), { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const now = (await res.json()).Now;
  const col = Object.fromEntries(now.columns.map((c, i) => [c, i]));
  const byId = new Map(CLUB_STATIONS.map((s) => [String(s.id), s]));
  const out = [];
  for (const r of now.records) {
    const s = byId.get(String(r[col.Station]));
    const time = localToUtc(r[col.SEND_TIME]);
    const ws = num(r[col.WIND_SP]);
    if (!s || !time || ws == null) continue;
    const wg = num(r[col.WIND_MAX]), wd = num(r[col.WIND_ANG]);
    let t = num(r[col.TEMPERATURE]);
    if (t != null && (t < -60 || t > 60)) t = null; // -273 means no thermometer
    if (ws === 0 && !wg && !wd && t === 0) continue; // all zeros: a station sending nothing real
    out.push({
      id: 'club:' + s.id, name: s.name, src: 'club', org: s.org, url: s.url,
      lat: s.lat, lon: s.lon, elev: s.elev, time,
      ws: Math.round(ws * 36) / 10, wd, wg: wg == null ? null : Math.round(wg * 36) / 10, t,
    });
  }
  return out;
}
