#!/usr/bin/env python3
"""Wind field for Termika's map streamlines -> data/wind/icon-<level>.json.

The map used to fetch wind straight from Open-Meteo in every browser, and Open-Meteo's free
tier limits requests per internet connection (every grid point counts). Here GitHub Actions
fetches the field once every few hours and publishes it as static files, so any number of
users cost nothing extra.

Grid: 0.25° over Croatia (588 points), DWD ICON via Open-Meteo, levels 10 m / 925 / 850 /
700 hPa, 7 days, local hours 05–21. Winds are stored as u/v in units of 2 km/h, packed as
signed bytes in base64, layout [hour][point].

Usage: python3 tools/wind.py [--max-age-hours 3] [--out-dir data/wind]
"""
import argparse, array, base64, datetime as dt, json, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = 'termika-wind/1.0 (+https://termika-hr.github.io/)'
GRID = dict(lat0=42.0, lon0=13.0, dLat=0.25, dLon=0.25, nLat=21, nLon=28)
LEVELS = ['10m', '925', '850', '700']
HOURS = range(5, 22)          # local hours kept (the map only shows daylight)
UNIT = 2.0                    # km/h per stored step
CHUNK = 150                   # points per request, keeps URLs short

def level_vars(l):
    return ('wind_speed_10m', 'wind_direction_10m') if l == '10m' else (f'wind_speed_{l}hPa', f'wind_direction_{l}hPa')

def fetch(points):
    q = urllib.parse.urlencode({
        'latitude': ','.join(f'{p[0]:.2f}' for p in points), 'longitude': ','.join(f'{p[1]:.2f}' for p in points),
        'hourly': ','.join(v for l in LEVELS for v in level_vars(l)), 'models': 'icon_seamless',
        'forecast_days': 7, 'timezone': 'Europe/Zagreb', 'wind_speed_unit': 'kmh',
    })
    req = urllib.request.Request('https://api.open-meteo.com/v1/forecast?' + q, headers={'User-Agent': UA})
    data = json.loads(urllib.request.urlopen(req, timeout=120).read())
    return data if isinstance(data, list) else [data]

def pack(values):
    """Clamp to signed bytes and return base64."""
    a = array.array('b', (max(-127, min(127, round(v / UNIT))) if v is not None else -128 for v in values))
    return base64.b64encode(a.tobytes()).decode('ascii')

def uv(ws, wd):
    import math
    if ws is None or wd is None:
        return None, None
    r = math.radians(wd)  # direction the wind comes from
    return -ws * math.sin(r), -ws * math.cos(r)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', default=str(ROOT / 'data' / 'wind'))
    ap.add_argument('--max-age-hours', type=float, default=3.0, help='skip when the existing files are newer than this')
    args = ap.parse_args()
    out = Path(args.out_dir)
    probe = out / 'icon-850.json'
    if probe.exists():
        try:
            gen = dt.datetime.strptime(json.loads(probe.read_text())['generated'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=dt.timezone.utc)
            age = (dt.datetime.now(dt.timezone.utc) - gen).total_seconds() / 3600
            if age < args.max_age_hours:
                print(f'ICON wind is {age:.1f} h old; skipping', file=sys.stderr)
                return
        except (ValueError, KeyError):
            pass

    g = GRID
    points = [(g['lat0'] + j * g['dLat'], g['lon0'] + i * g['dLon']) for j in range(g['nLat']) for i in range(g['nLon'])]
    locs = []
    for s in range(0, len(points), CHUNK):
        locs += fetch(points[s:s + CHUNK])
    times_all = locs[0]['hourly']['time']
    keep = [t for t, ts in enumerate(times_all) if int(ts[11:13]) in HOURS]
    times = [times_all[t] for t in keep]
    out.mkdir(parents=True, exist_ok=True)
    generated = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    for l in LEVELS:
        vs, vd = level_vars(l)
        us, vv = [], []
        for t in keep:
            for loc in locs:
                u, v = uv(loc['hourly'][vs][t], loc['hourly'][vd][t])
                us.append(u); vv.append(v)
        doc = {'source': 'DWD ICON via Open-Meteo', 'generated': generated, 'level': l, 'unit': UNIT,
               'grid': g, 'times': times, 'u': pack(us), 'v': pack(vv)}
        (out / f'icon-{l}.json').write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')
    print(f'ICON wind: {len(points)} points, {len(times)} hours, {len(LEVELS)} levels -> {out}', file=sys.stderr)

if __name__ == '__main__':
    main()
