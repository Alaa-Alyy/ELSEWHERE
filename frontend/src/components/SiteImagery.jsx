import { useState } from 'react';
import { PLANETS } from '../planetImagery.js';

// Real orbital imagery of BOTH windows at the same ground scale (60 km view, 20 km analysis box).
// Earth: NASA GIBS WMS, Landsat WELD annual composite (2000), fallback Blue Marble. Mars/Moon: NASA Trek tiles.
// Display only; nothing here is used by the search.
const VIEW_KM = 60;
const BODY_KM_PER_DEG = { mars: (2 * Math.PI * 3396.19) / 360, moon: (2 * Math.PI * 1737.4) / 360 };
const EARTH_LAYERS = [
  { layer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual', time: '2000-12-01',
    label: 'Landsat WELD true-colour annual composite (2000), NASA GIBS' },
  { layer: 'BlueMarble_NextGeneration', time: null, label: 'Blue Marble Next Generation (~500 m), NASA GIBS' },
];

function earthUrl(lat, lon, layer, time) {
  const dLat = VIEW_KM / 2 / 110.57;
  const dLon = VIEW_KM / 2 / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(5)).join(',');
  return 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1'
    + `&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg${time ? `&TIME=${time}` : ''}`;
}

function EarthView({ center }) {
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState(false);
  const L = EARTH_LAYERS[i];
  if (failed) return <div className="imagery-na">Earth imagery unavailable (NASA GIBS did not respond).</div>;
  return (
    <>
      <img src={earthUrl(center.lat, center.lon, L.layer, L.time)} alt={`Satellite image around ${center.lat.toFixed(2)}, ${center.lon.toFixed(2)}`}
        onError={() => (i + 1 < EARTH_LAYERS.length ? setI(i + 1) : setFailed(true))} />
      <span className="imagery-credit">{L.label}</span>
    </>
  );
}

// Equirectangular Trek tiles (2x1 at level 0, 256 px), placed with CSS so the view is VIEW_KM on a side.
// The global equirectangular mosaics are smeared close to the poles: show an honest notice instead.
export const POLAR_LIMIT_DEG = 80;

function PlanetView({ body, center }) {
  const [errors, setErrors] = useState(0);
  const cfg = PLANETS[body];
  if (Math.abs(center.lat) > POLAR_LIMIT_DEG) {
    return (
      <div className="imagery-na">
        Within {90 - POLAR_LIMIT_DEG}° of the pole the global {body === 'moon' ? 'Moon' : 'Mars'} mosaic is stretched and
        smeared, so we do not show it here. The terrain was measured from {body === 'moon' ? 'LOLA' : 'MOLA'} elevation,
        which is reliable at the pole.
      </div>
    );
  }
  const kmDeg = BODY_KM_PER_DEG[body];
  const cosLat = Math.max(0.05, Math.cos((center.lat * Math.PI) / 180));
  const latSpan = VIEW_KM / kmDeg;
  const lonSpan = Math.min(360, latSpan / cosLat);
  // Zoom from the north-south span (sharp detail); near the poles the view is wide in longitude, so it
  // needs more tiles across - cap the count by lowering the zoom only as much as necessary.
  let z = Math.max(0, Math.min(cfg.maxLevel, Math.floor(Math.log2(180 / latSpan))));
  const count = (zz) => { const s = 180 / 2 ** zz; return (Math.ceil(lonSpan / s) + 1) * (Math.ceil(latSpan / s) + 1); };
  while (z > 0 && count(z) > 24) z -= 1;
  const size = 180 / 2 ** z;                       // degrees per tile
  const nx = 2 ** (z + 1); const ny = 2 ** z;
  const lon0 = center.lon - lonSpan / 2; const lat1 = center.lat + latSpan / 2;
  const x0 = Math.floor((lon0 + 180) / size); const x1 = Math.floor((center.lon + lonSpan / 2 + 180) / size);
  const y0 = Math.max(0, Math.floor((90 - lat1) / size)); const y1 = Math.min(ny - 1, Math.floor((90 - (center.lat - latSpan / 2)) / size));
  const tiles = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const xw = ((x % nx) + nx) % nx;
      tiles.push({ key: `${y}-${x}`, url: cfg.url.replace('{z}', z).replace('{y}', y).replace('{x}', xw),
        // percent offsets of the tile's NW corner inside the view (lon grows right, lat grows up)
        left: ((x * size - 180 - lon0) / lonSpan) * 100, top: ((lat1 - (90 - y * size)) / latSpan) * 100,
        w: (size / lonSpan) * 100, h: (size / latSpan) * 100 });
    }
  }
  if (tiles.length > 0 && errors >= tiles.length) return <div className="imagery-na">{body === 'mars' ? 'Mars' : 'Moon'} imagery unavailable (NASA Trek did not respond).</div>;
  return (
    <>
      <div className="tile-stage" aria-label={`${body} orbital image around ${center.lat.toFixed(2)}, ${center.lon.toFixed(2)}`} role="img">
        {tiles.map((t) => (
          <img key={t.key} src={t.url} alt="" onError={() => setErrors((e) => e + 1)}
            style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.w}%`, height: `${t.h}%` }} />
        ))}
      </div>
      <span className="imagery-credit">{cfg.credit.replace('Imagery: ', '')}{Math.abs(center.lat) > 65 ? ' · high latitude: projection stretches east-west' : ''}</span>
    </>
  );
}

export default function SiteImagery({ reference, candidate }) {
  const body = reference?.body;
  const rc = reference?.center; const cc = candidate?.center;
  if (!rc || !cc || !PLANETS[body]) return null;
  return (
    <section className="imagery" aria-labelledby="imagery-title" data-testid="site-imagery">
      <h3 id="imagery-title">See both places</h3>
      <div className="imagery-pair">
        <figure>
          <div className="imagery-frame">
            <PlanetView body={body} center={rc} />
            <span className="imagery-box" aria-hidden="true" />
          </div>
          <figcaption><b>{body === 'mars' ? 'Mars' : 'Moon'}</b> · {rc.lat.toFixed(2)}°, {rc.lon.toFixed(2)}°</figcaption>
        </figure>
        <figure>
          <div className="imagery-frame">
            <EarthView center={cc} />
            <span className="imagery-box" aria-hidden="true" />
          </div>
          <figcaption><b>Earth</b> · {cc.lat.toFixed(2)}°, {cc.lon.toFixed(2)}°</figcaption>
        </figure>
      </div>
      <p className="small muted">Real orbital images, both {VIEW_KM} km across; the box is the 20 km window that was compared.
        Imagery is for looking only: the match uses elevation, not colours. Earth composite dates from 2000, so recent
        changes (roads, towns, fields) may be missing.</p>
    </section>
  );
}
