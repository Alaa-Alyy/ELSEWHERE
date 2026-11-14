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

// Analog dimensions this version does not measure (stated honestly, never guessed).
export const NOT_ASSESSED = [
  'Geology, mineralogy and surface materials (rock and soil type)',
  'Water, ice and permafrost',
  'Dust, wind and erosion processes',
  'Biology and habitability',
  'Caves, lava tubes and the subsurface',
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
