// NASA Solar System Treks WMTS layers (equirectangular, 2x1 tiles at level 0, no token).
// Spheres match the analysis data (MOLA 3396.19 km, LOLA 1737.4 km). Shared by the 3D globe and the image pair.
export const PLANETS = {
  mars: {
    radius: 3396190,
    url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxLevel: 7,
    credit: 'Imagery: NASA Mars Trek, Viking MDIM 2.1 colour mosaic (232 m)',
  },
  moon: {
    radius: 1737400,
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxLevel: 7,
    credit: 'Imagery: NASA Moon Trek, LRO WAC global mosaic',
  },
};
