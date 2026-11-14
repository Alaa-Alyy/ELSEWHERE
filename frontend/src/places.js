// Named Moon/Mars places for quick pins (planetocentric lat, east-positive lon, approximate centres).
// Selecting one just places a pin there; its terrain is still measured by the backend pipeline.
export const PLACES = {
  mars: [
    { name: 'Jezero crater', lat: 18.44, lon: 77.45 },
    { name: 'Gale crater', lat: -5.4, lon: 137.8 },
    { name: 'Meridiani Planum', lat: -1.95, lon: -5.53 },
    { name: 'Utopia Planitia', lat: 46.7, lon: 117.5 },
    { name: 'Valles Marineris', lat: -13.9, lon: -59.2 },
    { name: 'Olympus Mons', lat: 18.65, lon: -133.8 },
    { name: 'Hellas Planitia', lat: -42.4, lon: 70.5 },
    { name: 'Arsia Mons caves area', lat: -8.3, lon: -120.1 },
  ],
  moon: [
    { name: 'South pole sector', lat: -85.0, lon: 0.0 },
    { name: 'Shackleton region', lat: -86.8, lon: 0.0 },
    { name: 'Apollo 11 (Tranquillitatis)', lat: 0.67, lon: 23.47 },
    { name: 'Apollo 15 (Hadley Rille)', lat: 26.13, lon: 3.63 },
    { name: 'Marius Hills', lat: 14.0, lon: -56.0 },
    { name: 'Aristarchus plateau', lat: 24.5, lon: -49.0 },
    { name: 'Tycho crater', lat: -43.3, lon: -11.2 },
  ],
};
