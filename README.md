# Termika

Prognoza za paragliding u Hrvatskoj · Paragliding forecast for Croatia (HR / EN).

**App:** https://pboric.github.io/termika/ (on a phone: browser menu → “Add to Home screen”)

For each launch, Termika shows a 7-day go/caution/no-go grid. Each day opens to an hourly briefing with:
- launch wind and gusts, the strongest wind aloft, and winds at 850 and 700 hPa
- a lee-side (rotor) check from the wind 400 m above launch
- cumulus base (125 m × spread), the thermal top from a parcel lifted on the model sounding, and a w* thermal-strength estimate
- thunderstorm and overdevelopment risk (CAPE, cloud depth)
- conditions by altitude (wind per height through the day, thermal layer and cloud marked)
- a sounding chart for the selected hour
- eight models side by side; click one to see its hourly data

The limits come in two levels: student and licensed pilot. You can also add your own sites; they are stored in your browser.

## How it runs

It is a static web app (PWA), with no build step and no server.
- **Open-Meteo models** are fetched by the browser directly: ICON-2I, ICON, HARMONIE-AROME, ARPEGE, UKMO, ECMWF and GFS.
- **ALADIN-SI** comes from the Slovenian Environment Agency (ARSO). It is published only as 32 MB GRIB files that a browser can't load. A GitHub Actions workflow (`.github/workflows/pages.yml`) therefore runs `tools/aladin_si.py` every 6 hours. The script extracts the launch sites into `data/aladin-si.json` (about 200 KB) and redeploys the site. ALADIN-SI covers northern Croatia, Istria and Kvarner, but not Dalmatia. Its data has no gusts or CAPE, and radiation is estimated from cloud cover.
- DHMZ's ALADIN has no open data, so each site page links to its maps on meteo.hr.

## Run locally

```
python3 tools/aladin_si.py        # optional: fetch the latest ALADIN-SI run (32 MB download)
python3 -m http.server 8765
```
Open http://localhost:8765.

## Files

- `js/meteo.js`: Open-Meteo requests, sounding physics, flyability rules (limits in `PROFILES`)
- `js/sites.js`: built-in launches with sources; `check: true` = direction not confirmed by a source
- `js/i18n.js`: Croatian and English text
- `js/app.js`: interface, settings, user-added sites
- `tools/aladin_si.py`: ARSO GRIB1 reader and site extractor (Python standard library only)
- `sw.js`, `manifest.webmanifest`: offline support and home-screen install
- `fonts/`: Barlow and Barlow Condensed (SIL Open Font License, see `fonts/OFL.txt`)

## Data and sources

- Weather: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Models: ItaliaMeteo ICON-2I, DWD ICON, KNMI HARMONIE-AROME, Météo-France ARPEGE, UK Met Office, ECMWF IFS 0.25°, NOAA GFS. The free Open-Meteo API is for non-commercial use.
- ALADIN-SI — vir: ARSO (Agencija Republike Slovenije za okolje), [meteo.arso.gov.si](https://meteo.arso.gov.si/). Reused under ARSO's terms, which require naming the source.
- Launch coordinates: HR XC liga waypoints (airtribune.com) and the Nubigena school's list of flying sites. Directions: HR XC liga, istra.hr, visitsinj.hr, lepoglava-info.hr, visitkrizevci.hr, Nubigena. Heights for the school sites come from the Copernicus 90 m terrain model.

Termika helps with planning. The decision to fly is made at launch.
