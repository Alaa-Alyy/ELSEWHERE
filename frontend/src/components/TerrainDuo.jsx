import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { friendlyMessage } from '../api/errors.js';
import { fmt } from '../format.js';
import TerrainScene, { PALETTES, sharedExaggeration } from './TerrainScene.jsx';

const cache = new Map();   // "body|lat|lon" -> Promise of the grid item
function loadGrid(body, center) {
  const key = `${body}|${center.lat}|${center.lon}`;
  if (!cache.has(key)) {
    const p = api.getTerrainGrid({ body, lat: center.lat, lon: center.lon }).then((r) => r.item);
    p.catch(() => cache.delete(key));                       // allow a retry later
    cache.set(key, p);
  }
  return cache.get(key);
}

function useGrid(body, center) {
  const [s, setS] = useState({ pending: true });
  const lat = center?.lat; const lon = center?.lon;
  useEffect(() => {
    if (!body || lat === undefined) return undefined;
    let live = true;
    setS({ pending: true });
    loadGrid(body, { lat, lon }).then((item) => live && setS({ item }), (error) => live && setS({ error }));
    return () => { live = false; };
  }, [body, lat, lon]);
  return s;
}

const NAME = { mars: 'Mars', moon: 'Moon', earth: 'Earth' };

/** Scene: both 20 km windows as cartoon 3D blocks built from their real elevation, astronaut on each. */
export default function TerrainDuo({ reference, candidate, climate }) {
  const body = reference?.body;
  const a = useGrid(body, reference?.center);
  const b = useGrid('earth', candidate?.center);
  if (!body || !candidate?.center) return null;
  const earthPal = PALETTES[climate?.item?.aridity?.key] || PALETTES.earth;
  const range = (g) => (g ? `${fmt(g.max_m - g.min_m, 0)} m` : '...');
  const demo = a.item?.is_demo || b.item?.is_demo;

  return (
    <section className="terrain-duo" aria-labelledby="duo-title" data-testid="terrain-duo">
      <h3 id="duo-title">The two windows in 3D</h3>
      {(a.pending || b.pending) && (
        <p className="pending small" role="status"><span className="spinner" aria-hidden="true" />
          {' '}Reading NASA elevation{body === 'mars' && a.pending ? ' (Mars MOLA can take ~30 s the first time)' : ''}...</p>
      )}
      {(a.error || b.error) && (
        <p className="notice small">3D view unavailable: {friendlyMessage(a.error || b.error)}. The measured values above are unaffected.</p>
      )}
      {a.item && b.item && (
        <>
          <div className="duo-stage">
            <TerrainScene left={a.item} right={b.item} leftPalette={PALETTES[body]} rightPalette={earthPal} />
            <span className="duo-label left">{NAME[body]} · height range {range(a.item)}</span>
            <span className="duo-label right">Earth · height range {range(b.item)}</span>
          </div>
          <p className="small muted">
            Each block is a real 20 × 20 km window: {a.item.size} × {a.item.size} cells of {a.item.cell_m} m from the same
            grid we measured ({a.item.source?.id} / {b.item.source?.id}). Same vertical exaggeration ×{sharedExaggeration(a.item, b.item)} for
            both; north is at the back. Colours and the astronaut are cartoon illustration, not to scale.
            {demo && <b> DEMO terrain (not real elevation).</b>} Drag sideways to turn the blocks.
          </p>
        </>
      )}
    </section>
  );
}
