# Termika

Prognoza za paragliding u Hrvatskoj · Paragliding forecast for Croatia (HR / EN). Free, no account, no ads.

**App:** https://termika-hr.github.io/ (on a phone: browser menu → “Add to Home screen”)

## What it does

- **List:** a 7-day go / caution / no-go grid for every launch, plus "where you can fly" for any day, with a 1–5 star day rating.
- **Map:**
  - launches coloured for the chosen day or hour
  - kk7 thermal hotspots for the season and time of day
  - live wind stations
  - tap anywhere for a forecast at that point, or save it as your own site
- **Site page:**
  - **Day summary:** safe window, thermal top and cumulus base, thermal strength (w*), daylight hours.
  - **Reliability:**
    - model agreement (how many of 8 models say flyable)
    - ECMWF ensemble probability (51 members) for each hour
  - **Live conditions:** the nearest DHMZ stations and airport METARs.
  - **Hourly table:** launch wind, gusts, the strongest wind aloft, 850/700 hPa winds, cloud, rain, CAPE.
  - **Conditions by altitude:** wind at each height through the day, with the thermal layer and cloud marked.
  - **Sounding and stability:** a sounding chart plus stability, inversions and freezing level.
  - **Model comparison:** 8 models (ICON-2I, ALADIN-SI, ICON, HARMONIE-AROME, ARPEGE, UKMO, ECMWF, GFS); click one to see all its data.
  - **Links:** radar, satellite, lightning, airspace, AMC airspace bookings, kk7.
- **Limits:** student, licensed pilot, or your own limits.

## How it runs

It is a static web app (PWA), with no build step and no server.
- **Open-Meteo models and the ensemble** are fetched by the browser directly.
- **Data browsers can't fetch themselves:** a GitHub Actions workflow (`.github/workflows/pages.yml`) runs every 30 minutes and redeploys the site. It runs:
  - `tools/obs.py`: live stations from DHMZ and METAR → `data/obs.json`
  - `tools/aladin_si.py`: ARSO ALADIN-SI GRIB, launch sites only, fetched only when a new run is out → `data/aladin-si.json`
- **DHMZ's ALADIN** has no open data, so each site page links to its maps on meteo.hr.

## Run locally

```
python3 tools/aladin_si.py        # optional: latest ALADIN-SI run (32 MB download)
python3 tools/obs.py              # optional: live stations
python3 -m http.server 8765
```
Open http://localhost:8765.

## Files

- `js/meteo.js`: Open-Meteo requests, sounding physics, flyability rules (limits in `PROFILES`), day rating, stability, ensemble probability
- `js/sites.js`: built-in launches with sources; `check: true` = direction not confirmed by a source
- `js/app.js`: interface (list, map, site page, settings, sharing)
- `js/map.js`: Leaflet map, loaded on first use
- `js/i18n.js`: Croatian and English text
- `tools/`: data scripts for GitHub Actions (Python standard library only)
- `sw.js`, `manifest.webmanifest`: offline support and home-screen install
- `fonts/`: Barlow and Barlow Condensed (SIL Open Font License, see `fonts/OFL.txt`)

## Data and sources

- **Weather:** [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). The free Open-Meteo API is for non-commercial use.
  - Forecast models: ItaliaMeteo ICON-2I, DWD ICON, KNMI HARMONIE-AROME, Météo-France ARPEGE, UK Met Office, ECMWF IFS 0.25°, NOAA GFS.
  - Ensemble: ECMWF ENS.
- **ALADIN-SI:** vir: ARSO (Agencija Republike Slovenije za okolje), [meteo.arso.gov.si](https://meteo.arso.gov.si/).
- **Live stations:** izvor: DHMZ ([meteo.hr](https://meteo.hr/)); METAR via NOAA Aviation Weather Center.
- **Thermal maps:** [thermal.kk7.ch](https://thermal.kk7.ch/) (CC BY-NC-SA 4.0, non-commercial use).
- **Base maps:** OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors.
- **Launches:**
  - Coordinates: HR XC liga waypoints (airtribune.com) and the Nubigena school's list of flying sites.
  - Directions: HR XC liga, istra.hr, visitsinj.hr, lepoglava-info.hr, visitkrizevci.hr, Nubigena.
  - Heights of the school sites: Copernicus 90 m terrain model.

Termika helps with planning. The decision to fly is made at launch.
