#!/usr/bin/env python3
"""Airspace over Croatia for Termika's map -> data/airspace.json (GeoJSON).

Source: openAIP (https://www.openaip.net), data licence CC BY-NC 4.0; Termika is free and
non-commercial. The Core API needs a free API key, read from the OPENAIP_API_KEY environment
variable (a GitHub Actions secret). Without a key, or if the request fails, the previous file
is kept.

Only airspace that matters below about 4500 m is kept (CTR, TMA, restricted, danger,
prohibited, TMZ/RMZ, TRA/TSA, ATZ, gliding and sporting areas...), with coordinates rounded to
4 decimals to keep the file small.

Usage: OPENAIP_API_KEY=... python3 tools/airspace.py [--max-age-hours 20] [--out data/airspace.json]
"""
import argparse, datetime as dt, json, os, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = 'https://api.core.openaip.net/api/airspaces'
UA = 'termika-airspace/1.0 (+https://termika-hr.github.io/)'
BBOX = (12.8, 42.0, 19.8, 47.0)   # lon/lat around Croatia, with the borders of its neighbours
# openAIP type codes worth showing to paragliders, with a short label.
TYPES = {1: 'R', 2: 'D', 3: 'P', 4: 'CTR', 5: 'TMZ', 6: 'RMZ', 7: 'TMA', 8: 'TRA', 9: 'TSA', 13: 'ATZ',
         14: 'MATZ', 17: 'Alert', 18: 'Warning', 21: 'Gliding', 26: 'CTA', 28: 'Sport', 29: 'LOR', 36: 'MCTR'}
CLASSES = {0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G'}
MAX_LOWER_M = 4500

def limit(l):
    """openAIP limit -> (label, metres above sea level or None for GND-based)."""
    if not l: return '?', None
    v, unit, ref = l.get('value', 0), l.get('unit'), l.get('referenceDatum')
    if ref == 0 and v == 0: return 'GND', 0
    if unit == 6 or ref == 2: return f'FL {int(v):03d}', v * 100 * 0.3048
    ft = v if unit == 1 else v / 0.3048 if unit == 0 else v
    label = f"{int(round(ft))} ft {'AGL' if ref == 0 else 'MSL'}"
    return label, ft * 0.3048

def points(coords):
    if isinstance(coords[0], (int, float)): yield coords; return
    for c in coords: yield from points(c)

def in_area(coords):
    xs, ys = zip(*((p[0], p[1]) for p in points(coords)))
    return min(xs) <= BBOX[2] and max(xs) >= BBOX[0] and min(ys) <= BBOX[3] and max(ys) >= BBOX[1]

def rnd(coords):
    if isinstance(coords[0], (int, float)): return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]

def fetch_all(key, params):
    items, page = [], 1
    while True:
        q = urllib.parse.urlencode({**params, 'page': page})
        req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA, 'x-openaip-api-key': key, 'Accept': 'application/json'})
        data = json.loads(urllib.request.urlopen(req, timeout=120).read())
        items += data.get('items', [])
        if page >= data.get('totalPages', 1) or page >= 50: return items
        page += 1

def fetch(key):
    # Area around Croatia first; if the API rejects that query, Croatia plus its neighbours by country.
    bbox = ','.join(map(str, BBOX))
    for params in ({'bbox': bbox, 'limit': 1000}, {'bbox': bbox, 'limit': 100}):
        try:
            return fetch_all(key, params)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): raise SystemExit(f'openAIP refused the API key (HTTP {e.code})')
            print(f'openAIP {params}: HTTP {e.code}', file=sys.stderr)
    seen, items = set(), []
    for c in ('HR', 'SI', 'HU', 'BA', 'RS', 'ME', 'IT'):
        for it in fetch_all(key, {'country': c, 'limit': 100}):
            if it.get('_id') not in seen: seen.add(it.get('_id')); items.append(it)
    return items

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'data' / 'airspace.json'))
    ap.add_argument('--max-age-hours', type=float, default=20)
    args = ap.parse_args()
    key = os.environ.get('OPENAIP_API_KEY', '').strip()
    if not key:
        print('OPENAIP_API_KEY not set; keeping the previous airspace file', file=sys.stderr)
        return
    out = Path(args.out)
    if out.exists():
        try:
            gen = dt.datetime.strptime(json.loads(out.read_text())['generated'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=dt.timezone.utc)
            if (dt.datetime.now(dt.timezone.utc) - gen).total_seconds() < args.max_age_hours * 3600:
                print('airspace file is recent; skipping', file=sys.stderr)
                return
        except (ValueError, KeyError):
            pass
    feats = []
    for it in fetch(key):
        t = it.get('type')
        g = it.get('geometry')
        if t not in TYPES or not g or g.get('type') not in ('Polygon', 'MultiPolygon') or not in_area(g['coordinates']): continue
        lo, lo_m = limit(it.get('lowerLimit'))
        hi, _ = limit(it.get('upperLimit'))
        if lo_m is not None and lo_m > MAX_LOWER_M: continue
        feats.append({'type': 'Feature', 'geometry': {'type': g['type'], 'coordinates': rnd(g['coordinates'])},
                      'properties': {'name': it.get('name', ''), 'type': TYPES[t], 'cls': CLASSES.get(it.get('icaoClass')),
                                     'lower': lo, 'upper': hi, 'lowerM': None if lo_m is None else round(lo_m),
                                     'country': it.get('country')}})
    feats.sort(key=lambda f: (f['properties']['lowerM'] or 0), reverse=True)  # high first, so low zones draw on top
    doc = {'type': 'FeatureCollection', 'source': 'openAIP (CC BY-NC 4.0)',
           'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'features': feats}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'airspace: {len(feats)} areas -> {out}', file=sys.stderr)

if __name__ == '__main__':
    main()
