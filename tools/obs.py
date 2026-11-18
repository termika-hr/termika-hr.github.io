#!/usr/bin/env python3
"""Current weather-station observations for Termika -> data/obs.json.

Sources (both free to reuse with attribution):
- DHMZ, Croatian Meteorological and Hydrological Service: https://vrijeme.hr/hrvatska_n.xml
  (about 60 stations, hourly; wind in m/s, direction as an 8-point compass). Izvor: DHMZ.
- METAR airport reports via NOAA's Aviation Weather Center API (public domain), with gusts.

Browsers can't read either source directly (no CORS), so a GitHub Actions job runs this script
every 30 minutes and publishes the result with the site. Standard library only.
"""
import argparse, datetime as dt, json, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
UA = 'termika-obs/1.0 (+https://pboric.github.io/termika/)'
DHMZ_URL = 'https://vrijeme.hr/hrvatska_n.xml'
METAR_URL = 'https://aviationweather.gov/api/data/metar?ids={}&format=json&hours=3'
# Airports in and around Croatia; ids without reports are simply skipped by the API.
ICAO = ['LDZA', 'LDVA', 'LDRI', 'LDPL', 'LDLO', 'LDZD', 'LDSP', 'LDSB', 'LDDU', 'LDOS',
        'LJLJ', 'LJMB', 'LJPZ', 'LJCE', 'LQBK', 'LQSA', 'LQMO', 'LHPP']
# Heights of DHMZ mountain stations (m). The feed has none; only well-known ones are listed.
DHMZ_ELEV = {'RC Puntijarka': 988, 'Zavižan': 1594, 'Parg-Čabar': 863, 'Crni Lug - NP Risnjak': 726,
             'Gospić': 564, 'NP Plitvička jezera': 579, 'Ogulin': 328}
COMPASS = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}
TZ = ZoneInfo('Europe/Zagreb')

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()

def num(s):
    try: return float(str(s).strip())
    except (TypeError, ValueError): return None

def dhmz():
    root = ET.fromstring(get(DHMZ_URL))
    d = root.find('DatumTermin')
    day = dt.datetime.strptime(d.findtext('Datum').strip(), '%d.%m.%Y')
    when = day.replace(hour=int(d.findtext('Termin').strip()), tzinfo=TZ).astimezone(dt.timezone.utc)
    out = []
    for g in root.findall('Grad'):
        p = g.find('Podatci')
        name = g.findtext('GradIme').strip()
        ws = num(p.findtext('VjetarBrzina'))
        wd = COMPASS.get((p.findtext('VjetarSmjer') or '').strip())
        out.append({
            'id': 'dhmz:' + name, 'name': name.removeprefix('RC ').strip(), 'src': 'DHMZ',
            'lat': num(g.findtext('Lat')), 'lon': num(g.findtext('Lon')), 'elev': DHMZ_ELEV.get(name),
            'time': when.strftime('%Y-%m-%dT%H:%MZ'),
            'ws': None if ws is None else round(ws * 3.6, 1), 'wd': wd, 'wg': None,
            't': num(p.findtext('Temp')),
        })
    return [s for s in out if s['lat'] is not None and s['lon'] is not None]

def metar():
    data = json.loads(get(METAR_URL.format(','.join(ICAO))))
    latest = {}
    for m in data:  # keep the newest report per airport
        if m.get('icaoId') and (m['icaoId'] not in latest or m.get('obsTime', 0) > latest[m['icaoId']].get('obsTime', 0)):
            latest[m['icaoId']] = m
    out = []
    for icao, m in sorted(latest.items()):
        kt = lambda v: None if v is None else round(float(v) * 1.852, 1)
        wd = m.get('wdir')
        out.append({
            'id': 'metar:' + icao, 'name': (m.get('name') or icao).split(',')[0], 'icao': icao, 'src': 'METAR',
            'lat': m.get('lat'), 'lon': m.get('lon'), 'elev': m.get('elev'),
            'time': dt.datetime.fromtimestamp(m['obsTime'], dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
            'ws': kt(m.get('wspd')), 'wd': wd if isinstance(wd, (int, float)) else None, 'wg': kt(m.get('wgst')),
            't': m.get('temp'), 'raw': m.get('rawOb'),
        })
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'data' / 'obs.json'))
    args = ap.parse_args()
    stations, errors = [], []
    for name, fn in (('DHMZ', dhmz), ('METAR', metar)):
        try:
            got = fn(); stations += got
            print(f'{name}: {len(got)} stations', file=sys.stderr)
        except Exception as e:  # keep the other source if one fails
            errors.append(f'{name}: {e}')
            print(f'{name} failed: {e}', file=sys.stderr)
    if not stations:
        sys.exit('no observations; keeping the previous file')
    out = {'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'errors': errors, 'stations': stations}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(stations)} stations -> {args.out}', file=sys.stderr)

if __name__ == '__main__':
    main()
