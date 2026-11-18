#!/usr/bin/env python3
"""Extract ARSO ALADIN-SI forecasts for Termika's launch sites.

ARSO (Slovenian Environment Agency) publishes the ALADIN-SI model as zipped GRIB1 files:
https://meteo.arso.gov.si/uploads/probase/www/model/data/nwp_YYYYMMDD-HHMM.zip
(4.4 km lat/lon grid 44.6–47.4 N, 11.6–17.9 E, hourly steps to +72 h, a new run every 6 h).
See https://meteo.arso.gov.si/uploads/meteo/help/sl/NumericniRezultatiGRIB.html

This script downloads the latest run, reads only the grid points around each site and writes
data/aladin-si.json in the same shape as an Open-Meteo response, so the app can treat it as one
more model. Standard library only, so it also runs on a bare CI machine.

Not in the files: gusts, CAPE, solar radiation. Radiation is estimated from cloud cover and sun
height (Haurwitz clear sky × Kasten–Czeplak cloud factor).

Usage: python3 tools/aladin_si.py [--zip local.zip] [--out data/aladin-si.json]
"""
import argparse, datetime as dt, io, json, math, re, sys, urllib.request, zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = 'https://meteo.arso.gov.si/uploads/probase/www/model/data/'
UA = 'termika-aladin/1.0'
TZ = ZoneInfo('Europe/Zagreb')
ROOT = Path(__file__).resolve().parent.parent
LEVELS = [925, 850, 700, 500]
G0 = 9.80665

# ---------- GRIB1 ----------
def _u(b): return int.from_bytes(b, 'big')
def _s(b):
    v = int.from_bytes(b, 'big'); top = 1 << (8 * len(b) - 1)
    return -(v & (top - 1)) if v & top else v
def _ibm(b):
    v = _u(b); m = v & 0xffffff
    if not m: return 0.0
    return (-1 if v >> 31 else 1) * m * 16.0 ** (((v >> 24) & 0x7f) - 64) / 16777216.0

def grib_messages(data):
    i = 0
    while True:
        i = data.find(b'GRIB', i)
        if i < 0: return
        total = _u(data[i + 4:i + 7])
        if data[i + 7] != 1: raise ValueError('not GRIB edition 1')
        p = i + 8
        L = _u(data[p:p + 3]); pds = data[p:p + L]; p += L
        m = dict(param=pds[8], ltype=pds[9], level=_u(pds[10:12]), p1=pds[18], p2=pds[19], D=_s(pds[26:28]))
        if pds[7] & 0x80:
            L = _u(data[p:p + 3]); gds = data[p:p + L]; p += L
            if gds[5] != 0: raise ValueError('expected a regular lat/lon grid')
            m.update(Ni=_u(gds[6:8]), Nj=_u(gds[8:10]), La1=_s(gds[10:13]) / 1000, Lo1=_s(gds[13:16]) / 1000,
                     La2=_s(gds[17:20]) / 1000, Lo2=_s(gds[20:23]) / 1000, scan=gds[27])
        if pds[7] & 0x40: raise ValueError('bitmaps not supported')
        L = _u(data[p:p + 3]); bds = data[p:p + L]
        m.update(E=_s(bds[4:6]), R=_ibm(bds[6:10]), nbits=bds[10], bits=bds[11:])
        yield m
        i += total

def grib_value(m, k):
    """Value of grid point k (simple packing), without unpacking the whole field."""
    nb = m['nbits']
    if nb == 0: return m['R'] / 10 ** m['D']
    bit = k * nb; byte = bit >> 3; shift = bit & 7
    chunk = int.from_bytes(m['bits'][byte:byte + (shift + nb + 7) // 8], 'big')
    width = ((shift + nb + 7) // 8) * 8
    x = (chunk >> (width - shift - nb)) & ((1 << nb) - 1)
    return (m['R'] + x * 2.0 ** m['E']) / 10 ** m['D']

# ---------- helpers ----------
def latest_run():
    html = urllib.request.urlopen(urllib.request.Request(BASE, headers={'User-Agent': UA}), timeout=60).read().decode('utf-8', 'replace')
    runs = sorted(set(re.findall(r'nwp_(\d{8}-\d{4})\.zip', html)))
    if not runs: raise RuntimeError('no ALADIN runs listed at ' + BASE)
    return runs[-1]

def read_sites():
    js = (ROOT / 'js' / 'sites.js').read_text(encoding='utf-8')
    out = []
    for block in re.findall(r'\{\s*\n\s*id:.*?\n\s*\},', js, re.S):
        i = re.search(r"id: '([^']+)'", block)
        g = re.search(r'lat: ([\d.]+), lon: ([\d.]+), elev: (\d+)', block)
        if i and g: out.append(dict(id=i.group(1), lat=float(g.group(1)), lon=float(g.group(2)), elev=float(g.group(3))))
    return out

def dewpoint(tc, rh):
    rh = min(100.0, max(1.0, rh)); a, b = 17.62, 243.12
    g = math.log(rh / 100) + a * tc / (b + tc)
    return b * g / (a - g)

def wind(u, v):
    return math.hypot(u, v) * 3.6, (math.degrees(math.atan2(-u, -v)) + 360) % 360

def sun(lat, lon, when):
    """cos(zenith), declination, equation of time (min) — NOAA approximation; `when` in UTC."""
    doy = when.timetuple().tm_yday; hr = when.hour + when.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hr - 12) / 24)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    ha = math.radians((hr * 60 + eqt + 4 * lon) / 4 - 180)
    la = math.radians(lat)
    return math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha), decl, eqt

def sunrise_sunset(lat, lon, date):
    noon = dt.datetime(date.year, date.month, date.day, 12, tzinfo=dt.timezone.utc)
    _, decl, eqt = sun(lat, lon, noon)
    la = math.radians(lat)
    x = math.cos(math.radians(90.833)) / (math.cos(la) * math.cos(decl)) - math.tan(la) * math.tan(decl)
    ha = math.degrees(math.acos(max(-1.0, min(1.0, x))))
    def at(minutes):
        t = noon.replace(hour=0) + dt.timedelta(minutes=minutes)
        return t.astimezone(TZ).strftime('%Y-%m-%dT%H:%M')
    return at(720 - 4 * (lon + ha) - eqt), at(720 - 4 * (lon - ha) - eqt)

def radiation(lat, lon, when, cloud):
    """Mean shortwave of the hour ending at `when` (W/m²), estimated from cloud fraction 0..1."""
    cz, _, _ = sun(lat, lon, when - dt.timedelta(minutes=30))
    if cz <= 0.01: return 0.0
    clear = 1098 * cz * math.exp(-0.057 / cz)
    return clear * (1 - 0.75 * cloud ** 3.4)

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', help='use a downloaded nwp_*.zip instead of fetching the latest run')
    ap.add_argument('--out', default=str(ROOT / 'data' / 'aladin-si.json'))
    args = ap.parse_args()

    if args.zip:
        blob = Path(args.zip).read_bytes()
    else:
        url = f'{BASE}nwp_{latest_run()}.zip'
        print('downloading', url, file=sys.stderr)
        blob = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=300).read()
    z = zipfile.ZipFile(io.BytesIO(blob))
    files = sorted(n for n in z.namelist() if n.endswith('.grb'))
    # Inner names look like nwp_2026111806_0012.grb: run date+hour, then the forecast step.
    run = re.search(r'nwp_(\d{10})_', files[0]).group(1)
    base = dt.datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)

    sites = read_sites()
    grid = None
    rows = {}  # site id -> list of per-step dicts
    for name in files:
        msgs = list(grib_messages(z.read(name)))
        g = msgs[0]
        if grid is None:
            grid = g
            if g['scan'] != 64: raise ValueError('unexpected scan mode %d' % g['scan'])
            di = (g['Lo2'] - g['Lo1']) / (g['Ni'] - 1); dj = (g['La2'] - g['La1']) / (g['Nj'] - 1)
            inside = []
            for s in sites:
                fi = (s['lon'] - g['Lo1']) / di; fj = (s['lat'] - g['La1']) / dj
                if 0 <= fi < g['Ni'] - 1 and 0 <= fj < g['Nj'] - 1:
                    i0, j0 = int(fi), int(fj); wx, wy = fi - i0, fj - j0
                    s['pts'] = [(j0 * g['Ni'] + i0, (1 - wx) * (1 - wy)), (j0 * g['Ni'] + i0 + 1, wx * (1 - wy)),
                                ((j0 + 1) * g['Ni'] + i0, (1 - wx) * wy), ((j0 + 1) * g['Ni'] + i0 + 1, wx * wy)]
                    inside.append(s)
            sites = inside
            rows = {s['id']: [] for s in sites}
        step = max(m['p1'] if m['ltype'] != 1 or m['param'] != 61 else m['p2'] for m in msgs)
        for s in sites:
            val = {}
            for m in msgs:
                key = (m['param'], m['ltype'], m['level'])
                val[key] = sum(grib_value(m, k) * w for k, w in s['pts'])
            rows[s['id']].append((step, val))

    out = {
        'model': 'ALADIN-SI', 'source': 'ARSO, meteo.arso.gov.si', 'run': base.strftime('%Y-%m-%dT%H:%MZ'),
        'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'sites': {},
    }
    r1 = lambda x: None if x is None else round(x, 1)
    for s in sites:
        H = {k: [] for k in ['time', 'temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m',
                             'cloud_cover', 'precipitation', 'shortwave_radiation']}
        for L in LEVELS:
            for k in ['temperature', 'relative_humidity', 'wind_speed', 'wind_direction', 'geopotential_height']:
                H[f'{k}_{L}hPa'] = []
        prev_acc = None
        for step, v in sorted(rows[s['id']], key=lambda x: x[0]):
            when = base + dt.timedelta(hours=step)
            t2 = v[(11, 105, 2)] - 273.15
            rh2 = v[(52, 105, 2)] * 100  # ARSO stores humidity and cloud cover as 0..1
            td2 = dewpoint(t2, rh2)
            psfc = v[(1, 1, 0)] / 100
            # Model ground height from surface pressure and the lowest level above ground.
            zs = None
            for L in LEVELS:
                if L < psfc:
                    zl = v[(6, 100, L)] / G0; tl = v[(11, 100, L)]
                    tv = (tl + v[(11, 105, 2)]) / 2
                    zs = zl - 287.05 * tv / G0 * math.log(psfc / L)
                    break
            dz = s['elev'] - (zs if zs is not None else s['elev'])
            t_site = t2 - 0.0065 * dz
            td_site = min(t_site, td2 - 0.0018 * dz)
            ws, wd = wind(v[(33, 105, 10)], v[(34, 105, 10)])
            cc = v[(71, 1, 0)] * 100
            acc = v.get((61, 1, 0), 0.0)
            pr = 0.0 if prev_acc is None else max(0.0, acc - prev_acc)
            prev_acc = acc
            H['time'].append(when.astimezone(TZ).strftime('%Y-%m-%dT%H:00'))
            H['temperature_2m'].append(r1(t_site)); H['dew_point_2m'].append(r1(td_site))
            H['wind_speed_10m'].append(r1(ws)); H['wind_direction_10m'].append(round(wd))
            H['cloud_cover'].append(round(min(100, max(0, cc))))
            H['precipitation'].append(r1(pr) if step else None)
            H['shortwave_radiation'].append(round(radiation(s['lat'], s['lon'], when, min(1, max(0, cc / 100)))))
            for L in LEVELS:
                ws, wd = wind(v[(33, 100, L)], v[(34, 100, L)])
                H[f'temperature_{L}hPa'].append(r1(v[(11, 100, L)] - 273.15))
                H[f'relative_humidity_{L}hPa'].append(round(min(100, max(0, v[(52, 100, L)] * 100))))
                H[f'wind_speed_{L}hPa'].append(r1(ws)); H[f'wind_direction_{L}hPa'].append(round(wd))
                H[f'geopotential_height_{L}hPa'].append(round(v[(6, 100, L)] / G0))
        dates = sorted({t[:10] for t in H['time']})
        rs = [sunrise_sunset(s['lat'], s['lon'], dt.date.fromisoformat(d)) for d in dates]
        out['sites'][s['id']] = {
            'elevation': s['elev'], 'hourly': H,
            'daily': {'time': dates, 'sunrise': [a for a, _ in rs], 'sunset': [b for _, b in rs]},
        }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(f"run {out['run']}: {len(sites)} sites, {len(files)} steps -> {args.out}", file=sys.stderr)

if __name__ == '__main__':
    main()
