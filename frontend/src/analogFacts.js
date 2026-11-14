// Body-wide physical facts used ONLY for the "what is different" rows of the analog scorecard.
// Source: NASA GSFC Planetary Fact Sheets (https://nssdc.gsfc.nasa.gov/planetary/factsheet/).
// These are planet-wide values, not measurements of the selected site.
export const FACT_SOURCE = {
  label: 'NASA GSFC Planetary Fact Sheets (body-wide values)',
  url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
};

export const BODY_FACTS = {
  earth: {
    gravity: '9.8 m/s² (1 g)',
    pressure: '1014 mbar (N₂/O₂ air)',
    radiation: 'Global magnetic field + thick atmosphere shield the surface',
    day: '24.0 h solar day',
  },
  mars: {
    gravity: '3.7 m/s² (0.38 g)',
    pressure: '~6.4 mbar (95% CO₂), under 1% of Earth',
    radiation: 'No global magnetic field, thin atmosphere: high surface radiation',
    day: '24.7 h solar day (sol)',
  },
  moon: {
    gravity: '1.62 m/s² (0.17 g)',
    pressure: 'Near vacuum (no atmosphere)',
    radiation: 'No magnetic field, no atmosphere: unshielded surface',
    day: '708.7 h solar day (~29.5 Earth days)',
  },
};

// verdict for each row: 'similar' | 'different'
export const ENVIRONMENT_ROWS = [
  { key: 'gravity', label: 'Gravity', verdict: () => 'different', note: 'Earth cannot reproduce reduced gravity outdoors.' },
  { key: 'pressure', label: 'Atmosphere', verdict: () => 'different', note: 'Thin CO₂ air (Mars) or vacuum (Moon) cannot be reproduced in the field.' },
  { key: 'radiation', label: 'Radiation', verdict: () => 'different', note: 'Earth sites are shielded; radiation tests need other facilities.' },
  { key: 'day', label: 'Day length', verdict: (body) => (body === 'mars' ? 'similar' : 'different'),
    note: 'Relevant for power, thermal cycles and operations timelines.' },
];

// Body-wide climate facts (NASA fact sheets) for the climate rows; the Earth side is measured per window.
export const BODY_CLIMATE = {
  mars: {
    temperature: 'about −65 °C average (210 K)',
    dryness: 'No rain; hyper-arid surface',
    sunlight: '586 W/m² at the top of the atmosphere (43% of Earth)',
    wind: 'Dust storms, but thin air pushes weakly',
  },
  moon: {
    temperature: '−173 °C night to 127 °C day (equator)',
    dryness: 'No atmosphere, no rain',
    sunlight: '1361 W/m², unfiltered (no atmosphere)',
    wind: 'No wind (no atmosphere)',
  },
};

// POWER precipitation is a ~50 km grid. Across steep mountains rain changes over a few km, so the cell
// can mix a dry plateau with wet slopes (seen in the Argentine Puna: grid 749 mm/yr). Above this measured
// window relief we flag the precipitation as low confidence. A documented heuristic, not a model.
// Only the middle of the range is ambiguous: mixing a dry plateau with wet slopes yields moderate grid
// values (Puna: 562-749 mm/yr), but a ~50 km cell cannot reach >= 1500 mm/yr unless the area is wet.
export const MOUNTAIN_RELIEF_M = 1000;
export const AMBIGUOUS_MM = [250, 1500];
export const isMountainous = (metrics) => Number(metrics?.relief_p95_p05_m) > MOUNTAIN_RELIEF_M;
export const rainUncertain = (mountainous, precip) =>
  !!mountainous && Number.isFinite(Number(precip)) && precip >= AMBIGUOUS_MM[0] && precip < AMBIGUOUS_MM[1];

export function drynessVerdict(aridityKey, mountainous = false, precip = null) {
  if (aridityKey && aridityKey !== 'unknown' && rainUncertain(mountainous, precip)) return { key: 'na', label: 'Uncertain (mountains)' };
  if (aridityKey === 'arid') return { key: 'similar', label: 'Similar (dry)' };
  if (aridityKey === 'semi_arid') return { key: 'partly', label: 'Partly similar' };
  if (aridityKey === 'wet') return { key: 'different', label: 'Different (wet)' };
  return { key: 'na', label: 'No data' };
}

// Analog dimensions this version does not measure (stated honestly, never guessed).
export const NOT_ASSESSED = [
  'Geology, mineralogy and surface materials (rock and soil type)',
  'Ice, permafrost and subsurface water',
  'Dust and erosion processes (wind speed is shown only as context)',
  'Biology and habitability (precipitation is only a proxy for vegetation)',
  'Caves, lava tubes and the subsurface',
  'Land use and access (cities, farms, protected areas, permits) - check every result on imagery',
];

// Display bands for a server distance (0 = identical, 1 = maximally different).
// A presentation convention to read the numbers, not a statistical test.
export function closenessBand(d) {
  if (d === null || d === undefined || !Number.isFinite(Number(d))) return { key: 'na', label: 'No data' };
  if (d <= 0.05) return { key: 'very', label: 'Very similar' };
  if (d <= 0.15) return { key: 'similar', label: 'Similar' };
  if (d <= 0.3) return { key: 'partly', label: 'Partly similar' };
  return { key: 'different', label: 'Different' };
}
