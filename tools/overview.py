#!/usr/bin/env python3
"""Forecast for all built-in launches, prepared once for everyone -> data/ov/<model>.json.

Every phone used to download the forecast for all sites from Open-Meteo itself: about 200 of
the 10,000 free requests a day per internet connection, on every model switch and hourly
refresh, and on mobile networks hundreds of phones share one address. Here GitHub Actions
fetches it every couple of hours (models update every 3-6 hours anyway) and publishes it with
the site, so the list and the map cost no requests for the prepared models.

The request is exactly the app's (js/meteo.js forecastUrl: same variables, levels, elevation,
7 days, local time, km/h), so the app parses the file as if it came from Open-Meteo. The
variable lists are read from js/meteo.js and the sites from js/sites.js, so nothing drifts.

Usage: python3 tools/overview.py [--models chmi_aladin_seamless,icon_seamless] [--max-age-hours 1.5]
"""
import argparse, datetime as dt, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = 'termika-overview/1.0 (+https://termika-hr.github.io/)'

def js_list(src, name):
    m = re.search(r'(?:const|let) ' + name + r' = \[(.*?)\];', src, re.S)
    if not m: raise SystemExit(f'{name} not found in js/meteo.js')
    return re.findall(r"'([^']+)'|(\d+)", m.group(1))

def hourly_vars():
    src = (ROOT / 'js' / 'meteo.js').read_text(encoding='utf-8')
    surface = [a for a, _ in js_list(src, 'SURFACE_VARS')]
    levels = [b for _, b in js_list(src, 'LEVELS')]
    level_vars = [a for a, _ in js_list(src, 'LEVEL_VARS')]
    return surface + [f'{k}_{l}hPa' for l in levels for k in level_vars]

def read_sites():
    js = (ROOT / 'js' / 'sites.js').read_text(encoding='utf-8')
    out = []
    for block in re.findall(r'\{\s*\n\s*id:.*?\n\s*\},', js, re.S):
        i = re.search(r"id: '([^']+)'", block)
        g = re.search(r'lat: ([\d.]+), lon: ([\d.]+), elev: (\d+)', block)
        if i and g: out.append(dict(id=i.group(1), lat=float(g.group(1)), lon=float(g.group(2)), elev=int(g.group(3))))
    return out

def key(s):
    """What makes two forecasts the same request: the place and height (as the app formats them)."""
    return f"{s['lat']:.4f},{s['lon']:.4f},{s['elev']}"

def fetch(sites, model, hourly):
    q = urllib.parse.urlencode({
        'latitude': ','.join(f"{s['lat']:.4f}" for s in sites), 'longitude': ','.join(f"{s['lon']:.4f}" for s in sites),
        'elevation': ','.join(str(s['elev']) for s in sites), 'hourly': ','.join(hourly), 'daily': 'sunrise,sunset',
        'models': model, 'forecast_days': 7, 'timezone': 'auto', 'wind_speed_unit': 'kmh',
    })
    req = urllib.request.Request('https://api.open-meteo.com/v1/forecast?' + q, headers={'User-Agent': UA})
    data = json.loads(urllib.request.urlopen(req, timeout=180).read())
    return data if isinstance(data, list) else [data]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', default='chmi_aladin_seamless,icon_seamless')
    ap.add_argument('--out-dir', default=str(ROOT / 'data' / 'ov'))
    ap.add_argument('--max-age-hours', type=float, default=1.5)
    args = ap.parse_args()
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    sites, hourly = read_sites(), hourly_vars()
    keys = [key(s) for s in sites]
    now = dt.datetime.now(dt.timezone.utc)
    for model in args.models.split(','):
        path = out_dir / f'{model}.json'
        if path.exists():
            try:
                old = json.loads(path.read_text(encoding='utf-8'))
                age = (now - dt.datetime.strptime(old['generated'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=dt.timezone.utc)).total_seconds()
                if age < args.max_age_hours * 3600 and old.get('keys') == keys and old.get('hourly') == len(hourly):
                    print(f'{model}: recent and the same sites; skipping', file=sys.stderr)
                    continue
            except (ValueError, KeyError):
                pass
        try:
            raw = fetch(sites, model, hourly)
        except Exception as e:  # keep the previous file
            print(f'{model} failed: {e}', file=sys.stderr)
            continue
        if len(raw) != len(sites):
            print(f'{model}: {len(raw)} locations for {len(sites)} sites; keeping the previous file', file=sys.stderr)
            continue
        doc = {'model': model, 'generated': now.strftime('%Y-%m-%dT%H:%MZ'), 'hourly': len(hourly),
               'ids': [s['id'] for s in sites], 'keys': keys, 'raw': raw}
        path.write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')
        print(f'{model}: {len(sites)} sites -> {path} ({path.stat().st_size // 1024} kB)', file=sys.stderr)

if __name__ == '__main__':
    main()
