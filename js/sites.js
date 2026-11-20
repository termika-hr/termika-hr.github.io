// Built-in launch sites.
// Coordinates and heights: HR XC liga waypoint file (airtribune.com, hr-xc-liga-2020.SeeYou.cup)
// and the HR XC liga 2018–2020 site list. Wind directions: the same site list, istra.hr and visitsinj.hr.
// Since 2026-11-20, launches with a club station in the flumen.club network (PJK Flumen; used with
// the clubs' permission) take the clubs' own "good" directions (green); their "marginal" ones
// (yellow) fall within Termika's 45° caution band anyway. Sites added from that network take its
// coordinates and station heights, cross-checked with the slope direction of the terrain.
// `check: true` marks a direction that no source states outright; confirm it with the local club.

export const REGIONS = ['north', 'istria', 'lika', 'dalmatia'];
const CLUB = (who) => ({ hr: `klupska mreža flumen.club (${who})`, en: `club network flumen.club (${who})` });
const WITH_CLUB = (base, who) => ({ hr: `${base.hr ?? base}; smjerovi: klupska mreža flumen.club (${who})`, en: `${base.en ?? base}; directions: club network flumen.club (${who})` });

// Nubigena school sites (`school: true`): coordinates from the school's list of flying sites.
// Heights and slope directions there come from the Copernicus 90 m terrain model (Open-Meteo elevation API);
// Hruševec and Kupljenovo istok: direction from the site name, confirmed by the terrain.
// Kupljenovo sjever, Gornja Pušća, Radoboj: directions given by the user (Nubigena student), 2026-11-18.
// Kupljenovo istok and Borje: directions from the club stations there (flumen.club), 2026-11-20.
const NUBI = { hr: 'Nubigena (koordinate); visina i smjer iz modela terena', en: 'Nubigena (coordinates); height and direction from a terrain model' };
const NUBI_DIRS = { hr: 'Nubigena (koordinate i smjerovi); visina iz modela terena', en: 'Nubigena (coordinates and directions); height from a terrain model' };

export const SITES = [
  {
    id: 'kupljenovo-istok', name: 'Kupljenovo istok', region: 'north', school: true,
    lat: 45.9386, lon: 15.8065, elev: 159, dirs: ['ENE', 'E', 'ESE'], src: WITH_CLUB({ hr: 'Nubigena (koordinate)', en: 'Nubigena (coordinates)' }, 'Nubigena i Parafreek'),
  },
  {
    id: 'kupljenovo-sjever', name: 'Kupljenovo sjever', region: 'north', school: true,
    lat: 45.9523, lon: 15.7922, elev: 202, dirs: ['SE', 'S', 'SW'], src: NUBI_DIRS,
  },
  {
    id: 'hrusevec-jug', name: 'Hruševec jug', region: 'north', school: true,
    lat: 45.9306, lon: 15.7763, elev: 201, dirs: ['S', 'SSW'], src: NUBI,
  },
  {
    id: 'hrusevec-sjever', name: 'Hruševec sjever', region: 'north', school: true,
    lat: 45.9386, lon: 15.7916, elev: 197, dirs: ['N', 'NW'], src: NUBI_DIRS,
  },
  {
    id: 'gornja-pusca', name: 'Gornja Pušća', region: 'north', school: true,
    lat: 45.9236, lon: 15.7687, elev: 212, dirs: ['NE', 'E', 'SE', 'S'], src: NUBI_DIRS,
  },
  {
    id: 'radoboj', name: 'Radoboj', region: 'north', school: true,
    lat: 46.1665, lon: 15.9186, elev: 245, dirs: ['S', 'SW', 'W'], src: NUBI_DIRS,
  },
  {
    id: 'borje', name: 'Borje (Kalnik)', region: 'north', school: true,
    lat: 46.1270, lon: 16.4363, elev: 442, dirs: ['SE', 'SSE', 'S', 'SSW', 'SW'], src: WITH_CLUB({ hr: 'Nubigena (koordinate)', en: 'Nubigena (coordinates)' }, 'PK Feniks'),
  },
  {
    id: 'ivanscica', name: 'Ivanščica', region: 'north',
    lat: 46.1818, lon: 16.1268, elev: 1050, dirs: ['NNE', 'NE', 'ENE', 'E', 'ESE'],
    src: WITH_CLUB('HR XC liga', 'KPJ Let Ivanec'),
  },
  {
    id: 'ravna-gora-jug', name: 'Ravna gora – jug', region: 'north',
    lat: 46.2710, lon: 15.9842, elev: 660, dirs: ['S', 'SSW', 'SW'],
    src: WITH_CLUB('HR XC liga, lepoglava-info.hr', 'KPJ Let Ivanec'),
    note: { hr: 'Južni start, prema Trakošćanu. Klub „Let” Ivanec.', en: 'South launch, facing Trakošćan. Club “Let”, Ivanec.' },
  },
  {
    id: 'ravna-gora-sjever', name: 'Ravna gora – sjever', region: 'north',
    lat: 46.2830, lon: 16.0094, elev: 620, dirs: ['N', 'NNW', 'NW'],
    src: WITH_CLUB('HR XC liga, lepoglava-info.hr', 'KPJ Let Ivanec'),
    note: { hr: 'Sjeverni start, prema Višnjici. KSL „Kolibri”.', en: 'North launch, facing Višnjica. Club “Kolibri”.' },
  },
  {
    id: 'strahinjcica', name: 'Strahinjčica', region: 'north',
    lat: 46.1853, lon: 15.8958, elev: 720, dirs: ['SE', 'SSE', 'S', 'SSW', 'SW'],
    src: WITH_CLUB('HR XC liga', 'KPJ Jastreb'),
  },
  {
    id: 'strahinjcica-sjever', name: 'Strahinjčica – sjever', region: 'north',
    lat: 46.1867, lon: 15.8851, elev: 640, dirs: ['N'],
    src: 'HR XC liga',
  },
  {
    id: 'kalnik', name: 'Kalnik – zapadni start', region: 'north',
    lat: 46.1310, lon: 16.4529, elev: 580, dirs: ['S', 'SSW'],
    src: WITH_CLUB('HR XC liga, visitkrizevci.hr', 'PK Feniks'),
    note: { hr: 'Kalnik ima dva starta (zapadni i „Rampa”). PK Fenix.', en: 'Kalnik has two launches (west and “Rampa”). Club Fenix.' },
  },
  {
    id: 'japetic', name: 'Japetić', region: 'north', school: true,
    lat: 45.7410, lon: 15.6036, elev: 805, dirs: ['S'],
    src: WITH_CLUB('HR XC liga', 'LK Parafreek'),
  },
  {
    id: 'tribalj', name: 'Tribalj', region: 'istria', school: true,
    lat: 45.2397, lon: 14.6831, elev: 773, dirs: ['S', 'SSW', 'SW'],
    src: WITH_CLUB('HR XC liga', 'PJK Flumen'),
  },
  {
    id: 'zavoj', name: 'Buzet – Zavoj', region: 'istria',
    lat: 45.4446, lon: 13.9650, elev: 510, dirs: ['SW', 'WSW', 'W'],
    src: WITH_CLUB('istra.hr, HR XC liga', 'donacija istarskih parajedriličara'),
    note: { hr: 'Nije za južne vjetrove zbog rotora. Plaća se startnina.', en: 'Not for southerly winds because of rotor. Daily launch fee.' },
  },
  {
    id: 'raspadalica', name: 'Raspadalica', region: 'istria',
    lat: 45.4238, lon: 13.9982, elev: 546, dirs: ['S', 'SW'],
    src: 'istra.hr',
    note: { hr: 'Zatvoreno za individualno letenje (istra.hr).', en: 'Closed to individual flying (istra.hr).' },
  },
  {
    id: 'zbevnica', name: 'Žbevnica', region: 'istria',
    lat: 45.4567, lon: 14.0239, elev: 902, dirs: ['N', 'NE'],
    src: 'istra.hr',
    note: { hr: 'Sletište kod sela Dane. Start nije obilježen.', en: 'Landing near the village of Dane. Launch is unmarked.' },
  },
  {
    id: 'brgud', name: 'Učka – Brgud', region: 'istria',
    lat: 45.2403, lon: 14.1945, elev: 810, dirs: ['SW', 'WSW', 'W'],
    src: WITH_CLUB('HR XC liga, pp-ucka.hr', 'Šušnjevica: istarski parajedriličari i PJK Flumen'),
    note: { hr: 'U Parku prirode Učka.', en: 'Inside Učka Nature Park.' },
  },
  {
    id: 'plesivica', name: 'Plešivica', region: 'north',
    lat: 45.7372, lon: 15.6681, elev: 779, dirs: ['SSE', 'S'],
    src: CLUB('PJK Zagreb'),
  },
  {
    id: 'jugovec', name: 'Jugovec', region: 'north',
    lat: 46.1979, lon: 16.3520, elev: 314, dirs: ['S', 'SSW', 'SW'],
    src: CLUB('ZK Perun'),
  },
  {
    id: 'korija', name: 'Korija (Virovitica)', region: 'north',
    lat: 45.8463, lon: 17.3284, elev: 133, dirs: ['N', 'NNE', 'S', 'SSW'],
    src: CLUB('Aeroklub Virovitica'),
    note: { hr: 'Aerodrom: smjerovi su smjerovi uzletne staze.', en: 'Airfield: the directions are those of the runway.' },
  },
  {
    id: 'zbelac', name: 'Grobnik – Žbelac', region: 'istria',
    lat: 45.3983, lon: 14.5459, elev: 860, dirs: ['WSW', 'W'],
    src: CLUB('PJK Flumen'),
  },
  {
    id: 'duplja', name: 'Duplja (Novi Vinodolski)', region: 'istria',
    lat: 45.1469, lon: 14.8049, elev: 301, dirs: ['S', 'SSW', 'SW', 'WSW'],
    src: CLUB('KTD Ivanj'),
  },
  {
    id: 'gasparac', name: 'Gašparac', region: 'lika',
    lat: 44.8164, lon: 15.2911, elev: 690, dirs: ['NNE', 'NE'],
    src: CLUB('PK Leteći medvjedići'),
  },
  {
    id: 'bjelopolje', name: 'Bjelopolje', region: 'lika',
    lat: 44.7047, lon: 15.8197, elev: 1156, dirs: ['SW', 'WSW'],
    src: CLUB('PK Leteći medvjedići'),
  },
  {
    id: 'libinje', name: 'Libinje', region: 'lika',
    lat: 44.2897, lon: 15.5703, elev: 944, dirs: ['S', 'SSW', 'SW'],
    src: CLUB('KSL Fobos i prijatelji s Libinja'),
  },
  {
    id: 'postak', name: 'Poštak', region: 'lika',
    lat: 44.2530, lon: 16.1058, elev: 1243, dirs: ['SSW', 'SW', 'WSW'],
    src: CLUB('KSL Fobos i prijatelji s Libinja'),
  },
  {
    id: 'visocica', name: 'Visočica (Velebit)', region: 'lika',
    lat: 44.4322, lon: 15.3608, elev: 1430, dirs: ['NNW', 'N', 'NNE'], check: true,
    src: { hr: 'klupska mreža flumen.club (koordinate i visina); smjer iz modela terena', en: 'club network flumen.club (coordinates and height); direction from a terrain model' },
  },
  {
    id: 'promina', name: 'Promina', region: 'dalmatia',
    lat: 43.9258, lon: 16.1654, elev: 1066, dirs: ['S', 'SW', 'W', 'WNW', 'NW'],
    src: 'HR XC liga',
  },
  {
    id: 'greda', name: 'Greda (Hrvace, Sinj)', region: 'dalmatia',
    lat: 43.8297, lon: 16.6425, elev: 861, dirs: ['SE', 'S', 'SW'],
    src: 'HR XC liga, visitsinj.hr',
    note: { hr: 'Termika često već ujutro. KSL Pegaz.', en: 'Thermals often start early. Club Pegaz.' },
  },
];
