// DEMO FIXTURES - synthetic, labeled is_demo=true. Shapes follow the shared v2.0 contract.
// These numbers are NOT measurements. They exist only so the UI can be built before
// the real corpus (Person 1) and API (Person 2) are ready. Never present them as science.

export const SCHEMA_VERSION = '2.0';
export const PIPELINE_VERSION = '2.0';
export const SCORE_VERSION = '2.0';
export const SLOPE_BINS = [0, 1, 3, 5, 10, 20, 30, 45, 90];
export const DEMO_CORPUS_VERSION = 'demo-fixture-corpus-v2.0';

const DEMO_LIMITATIONS = [
  'DEMO FIXTURE: synthetic values for interface development, not measurements.',
];

// Deterministic PRNG so fixtures are stable across reloads.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function histogram(rand, shape) {
  const raw = shape.map((s) => s * (0.6 + 0.8 * rand()));
  const total = raw.reduce((a, b) => a + b, 0);
  const p = raw.map((v) => Math.round((v / total) * 1e6) / 1e6);
  p[p.length - 1] = Math.round((1 - p.slice(0, -1).reduce((a, b) => a + b, 0)) * 1e6) / 1e6;
  return p;
}

function squareFootprint(lat, lon, halfKm) {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return {
    type: 'Polygon',
    coordinates: [[
      [r(lon - dLon), r(lat + dLat)],
      [r(lon + dLon), r(lat + dLat)],
      [r(lon + dLon), r(lat - dLat)],
      [r(lon - dLon), r(lat - dLat)],
      [r(lon - dLon), r(lat + dLat)],
    ]],
  };
}

function tileId(lat, lon) {
  const a = Math.floor(lat);
  const b = Math.floor(lon);
  const ns = a >= 0 ? 'n' : 's';
  const ew = b >= 0 ? 'e' : 'w';
  return `earth-srtmgl1-${ns}${String(Math.abs(a)).padStart(2, '0')}${ew}${String(Math.abs(b)).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- references
export const REFERENCES = [
  {
    schema_version: SCHEMA_VERSION,
    id: 'mars-jezero',
    body: 'mars',
    kind: 'reference',
    name: 'Jezero regional terrain window',
    center: { lat: 18.44, lon: 77.45 },
    footprint: { type: 'Polygon', coordinates: [[[77.345, 18.545], [77.555, 18.545], [77.555, 18.335], [77.345, 18.335], [77.345, 18.545]]] },
    coordinate_convention: 'mars-planetocentric-east-180 (never drawn on Earth)',
    source_ids: ['mars-mola-mgs-dem-463m'],
    preview_url: null,
    limitations: [...DEMO_LIMITATIONS, 'Regional ~1 km terrain reference; not a landing-safety or rover-navigation product.'],
    analysis: { pipeline_version: PIPELINE_VERSION, resolution_m: 1000, window_size_km: 20, valid_fraction: 1.0, status: 'valid', is_demo: true },
    metrics: {
      slope_histogram: [0.31, 0.29, 0.17, 0.14, 0.07, 0.015, 0.004, 0.001],
      relief_p95_p05_m: 412,
      local_variation_m: 9.6,
    },
  },
  {
    schema_version: SCHEMA_VERSION,
    id: 'moon-south-pole-sector',
    body: 'moon',
    kind: 'reference',
    name: 'Lunar south polar terrain sector',
    center: { lat: -85.0, lon: 0.0 },
    footprint: { type: 'Polygon', coordinates: [[[-6.6, -84.82], [6.6, -84.82], [6.6, -85.18], [-6.6, -85.18], [-6.6, -84.82]]] },
    coordinate_convention: 'moon-planetocentric-east-180 (never drawn on Earth)',
    source_ids: ['moon-lola-ldem-80s-80mpp-adj'],
    preview_url: null,
    limitations: [...DEMO_LIMITATIONS, 'Prototype comparison sector, not an officially selected lunar-base location.'],
    analysis: { pipeline_version: PIPELINE_VERSION, resolution_m: 1000, window_size_km: 20, valid_fraction: 1.0, status: 'valid', is_demo: true },
    metrics: {
      slope_histogram: [0.04, 0.09, 0.12, 0.25, 0.3, 0.15, 0.04, 0.01],
      relief_p95_p05_m: 1610,
      local_variation_m: 31.5,
    },
  },
];

// ---------------------------------------------------------------- parents
const PARENT_SEEDS = [
  { id: 'earth-khaybar', name: 'Harrat Khaybar', lat: 25.7, lon: 39.9,
    shape: [0.28, 0.3, 0.17, 0.15, 0.07, 0.02, 0.008, 0.002], relief: [90, 420], variation: [3, 14] },
  { id: 'earth-pinacate', name: 'El Pinacate', lat: 31.77, lon: -113.5,
    shape: [0.35, 0.27, 0.14, 0.13, 0.08, 0.025, 0.004, 0.001], relief: [60, 380], variation: [2, 12] },
  { id: 'earth-death-valley', name: 'Death Valley', lat: 36.24, lon: -116.82,
    shape: [0.12, 0.13, 0.11, 0.19, 0.22, 0.14, 0.07, 0.02], relief: [250, 1700], variation: [8, 40] },
];

export const PARENTS = PARENT_SEEDS.map((p) => ({
  schema_version: SCHEMA_VERSION,
  id: p.id,
  body: 'earth',
  kind: 'parent',
  name: p.name,
  center: { lat: p.lat, lon: p.lon },
  footprint: squareFootprint(p.lat, p.lon, 50),
  coordinate_convention: 'WGS84 [longitude, latitude]',
  source_ids: [tileId(p.lat, p.lon)],
  preview_url: null,
  limitations: [...DEMO_LIMITATIONS, 'Parent coverage area only; searchable units are its 20 km candidate windows.'],
  analysis: { pipeline_version: PIPELINE_VERSION, resolution_m: 1000, window_size_km: 100, valid_fraction: null, status: 'valid', is_demo: true },
  metrics: null,
}));

// ---------------------------------------------------------------- candidates (9x9 per parent)
const INVALID_DEMO = {
  'earth-pinacate': [[7, 0], [8, 0], [8, 1]],
  'earth-death-valley': [[0, 8]],
};

function buildCandidates() {
  const out = [];
  for (const p of PARENT_SEEDS) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const id = `${p.id}-r${String(r).padStart(2, '0')}-c${String(c).padStart(2, '0')}`;
        const north = 40 - 10 * r;
        const east = -40 + 10 * c;
        const lat = p.lat + north / 110.574;
        const lon = p.lon + east / (111.32 * Math.cos((p.lat * Math.PI) / 180));
        const rand = seeded(id);
        const invalid = (INVALID_DEMO[p.id] || []).some(([rr, cc]) => rr === r && cc === c);
        const vf = invalid ? Math.round((0.6 + 0.3 * rand()) * 1000) / 1000 : Math.round((0.97 + 0.03 * rand()) * 1000) / 1000;
        out.push({
          schema_version: SCHEMA_VERSION,
          id,
          body: 'earth',
          kind: 'candidate',
          parent_id: p.id,
          name: `${p.name} window r${r} c${c}`,
          center: { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 },
          footprint: squareFootprint(lat, lon, 10),
          coordinate_convention: 'WGS84 [longitude, latitude]',
          source_ids: [tileId(lat, lon)],
          preview_url: null,
          limitations: invalid
            ? [...DEMO_LIMITATIONS, `Invalid: valid fraction ${vf} is below 0.95 (demo).`]
            : [...DEMO_LIMITATIONS],
          analysis: { pipeline_version: PIPELINE_VERSION, resolution_m: 1000, window_size_km: 20, valid_fraction: vf, status: invalid ? 'invalid' : 'valid', is_demo: true },
          metrics: invalid
            ? { slope_histogram: null, relief_p95_p05_m: null, local_variation_m: null }
            : {
                slope_histogram: histogram(rand, p.shape),
                relief_p95_p05_m: Math.round(p.relief[0] + (p.relief[1] - p.relief[0]) * rand()),
                local_variation_m: Math.round((p.variation[0] + (p.variation[1] - p.variation[0]) * rand()) * 10) / 10,
              },
        });
      }
    }
  }
  return out;
}

export const CANDIDATES = buildCandidates();

// ---------------------------------------------------------------- sources
// Real registry metadata (ids/urls match data/sources/*.json); only listed here for demo mode.
const SRTM_TILE_IDS = [...new Set(CANDIDATES.map((c) => c.source_ids[0]))];

export const SOURCES = [
  {
    id: 'mars-mola-mgs-dem-463m',
    title: 'Mars MGS MOLA DEM 463m (global mosaic) - crop around Jezero',
    agency: 'NASA / USGS Astrogeology',
    product: 'Mars_MGS_MOLA_DEM_mosaic_global_463m',
    version: 'unknown',
    landing_url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m',
    download_url: 'https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif',
    downloaded_at_utc: 'unknown',
    filename: 'data/raw/mars/mars-jezero_mola463m_crop40km.tif',
    sha256: 'unknown',
    units: 'meters',
    native_resolution: '~463 m',
    native_crs_wkt: 'Equirectangular Mars, sphere 3396190 m',
    citation: 'Smith, D.E., et al. (2001), JGR 106(E10), 23689-23722.',
    license_or_usage_notes: 'NASA/USGS public planetary data.',
  },
  {
    id: 'moon-lola-ldem-80s-80mpp-adj',
    title: 'LOLA south pole DEM LDEM_80S_80MPP_ADJ',
    agency: 'NASA GSFC PGDA',
    product: 'LDEM_80S_80MPP_ADJ.TIF',
    version: 'ADJ',
    landing_url: 'https://pgda.gsfc.nasa.gov/products/90',
    download_url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF',
    downloaded_at_utc: 'unknown',
    filename: 'data/raw/moon/moon-south-pole-sector_lola80m_crop40km.tif',
    sha256: 'unknown',
    units: 'meters',
    native_resolution: '80 m',
    native_crs_wkt: 'South polar stereographic, Moon 2015 sphere 1737400 m',
    citation: 'Barker, M.K., et al. (2023), PSJ, DOI 10.3847/PSJ/acf3e1; dataset DOI 10.60903/gsfcpgda-lola-spole.',
    license_or_usage_notes: 'NASA public data; cite paper and dataset DOI.',
  },
  ...SRTM_TILE_IDS.map((id) => {
    const tile = id.replace('earth-srtmgl1-', '').toUpperCase();
    return {
      id,
      title: `SRTMGL1 v003 tile ${tile}`,
      agency: 'NASA / USGS LP DAAC',
      product: 'SRTMGL1',
      version: '003',
      landing_url: 'https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003',
      download_url: `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL1.003/${tile}.SRTMGL1.hgt/${tile}.SRTMGL1.hgt.zip`,
      downloaded_at_utc: 'unknown',
      filename: `${tile}.SRTMGL1.hgt.zip`,
      sha256: 'unknown',
      units: 'meters',
      native_resolution: '1 arc-second (~30 m)',
      native_crs_wkt: 'WGS 84 (EPSG:4326)',
      citation: 'NASA JPL (2013). SRTM Global 1 arc second. https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003',
      license_or_usage_notes: 'NASA public data; cite the DOI.',
    };
  }),
];
