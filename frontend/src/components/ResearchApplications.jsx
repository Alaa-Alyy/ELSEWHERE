import { fmt } from '../format.js';

// "Potential research applications": rule-based, from MEASURED terrain + NASA POWER climate only.
// Every line cites the number it rests on. Suitability is split into four levels and only the first two
// can be judged from our data.
const sum = (h, idx) => idx.reduce((a, i) => a + (h?.[i] || 0), 0);
const pct = (v) => `${fmt(v * 100, 0)}%`;

export function applicationsFor({ metrics: m, climate, body }) {
  const h = m?.slope_histogram;
  if (!h) return [];
  const gentle = sum(h, [0, 1, 2]);           // 0-5°
  const walk = sum(h, [0, 1, 2, 3]);          // 0-10°
  const moderate = sum(h, [3, 4]);            // 5-20°
  const steep = sum(h, [5, 6, 7]);            // over 20°
  const relief = Number(m.relief_p95_p05_m);
  const rough = Number(m.local_variation_m);
  const c = climate?.item;
  const arid = c?.aridity?.key === 'arid' || c?.aridity?.key === 'semi_arid';
  const out = [];

  if (gentle >= 0.5) {
    out.push({ key: 'rover', icon: '🚙', title: 'Rover mobility and long traverses',
      why: `${pct(gentle)} of the window is under 5°, enough open ground for driving and odometry tests.` });
  }
  if (steep >= 0.05 || moderate >= 0.35) {
    out.push({ key: 'slopes', icon: '⛰️', title: 'Slope climbing and hazard avoidance',
      why: `${pct(moderate)} of the ground is 5-20° and ${pct(steep)} is steeper than 20°: tests for traction, tilt limits and path planning.` });
  }
  if (rough >= 8 || relief >= 600) {
    out.push({ key: 'nav', icon: '🧭', title: 'Autonomous navigation and terrain mapping',
      why: `Relief ${fmt(relief, 0)} m and local roughness ${fmt(rough, 1)} m give landmarks for localisation, 3D mapping and hazard detection.` });
  }
  if (walk >= 0.6) {
    out.push({ key: 'eva', icon: '🧑‍🚀', title: body === 'moon' ? 'Moonwalk (EVA) traverse rehearsal' : 'Crew EVA traverse rehearsal',
      why: `${pct(walk)} of the ground is under 10°, walkable for suited crews planning ${body === 'moon' ? 'lunar' : 'Martian'}-like routes.` });
  }
  if (gentle >= 0.6 && rough < 8) {
    out.push({ key: 'landing', icon: '🛬', title: 'Landing-site selection training',
      why: `Mostly gentle (${pct(gentle)} under 5°) and fairly smooth (${fmt(rough, 1)} m): practise reading safe vs unsafe ground from orbit-like data.` });
  }
  out.push({ key: 'rs', icon: '🛰️', title: 'Remote-sensing validation',
    why: 'Compare these orbital 1 km terrain metrics with field or drone surveys: the same check a Mars or Moon team needs before trusting orbital maps.' });
  if (c && arid && Number(c.solar_kwh_m2_day) >= 5) {
    out.push({ key: 'solar', icon: '☀️', title: 'Solar-powered operations in a dry climate',
      why: `${fmt(c.solar_kwh_m2_day, 2)} kWh/m²/day of sunlight and ${fmt(c.precipitation_mm_per_year, 0)} mm/yr of rain (NASA POWER).` });
  }
  return out;
}

function Level({ label, status, children }) {
  return (
    <div className={`suit-level ${status}`}>
      <span className="suit-label">{label}</span>
      <span className="suit-status">{status === 'ok' ? 'Supported by our data' : status === 'warn' ? 'Mixed' : 'Not assessed'}</span>
      <span className="suit-text">{children}</span>
    </div>
  );
}

export default function ResearchApplications({ candidate, climate, body, experiment, terrainSimilar }) {
  const m = candidate?.metrics;
  if (!m) return null;
  const apps = applicationsFor({ metrics: m, climate, body });
  const wantKeys = { rover: ['rover', 'slopes'], landing: ['landing', 'eva'], habitat: ['landing', 'solar', 'eva'], geology: ['nav', 'rs'] }[experiment?.key] || [];
  const c = climate?.item;
  const dryKey = c?.aridity?.key;

  return (
    <section className="research" aria-labelledby="research-title" data-testid="research-apps">
      <h3 id="research-title">Potential research applications</h3>
      <p className="small muted">Suggestions from this window's measured terrain{c ? ' and NASA POWER climate' : ''}. Each one names the number it rests on.</p>
      <ul className="apps">
        {apps.map((a) => (
          <li key={a.key} className={wantKeys.includes(a.key) ? 'match' : ''}>
            <span className="app-icon" aria-hidden="true">{a.icon}</span>
            <span>
              <b>{a.title}</b>{wantKeys.includes(a.key) && <span className="chip good">fits your {experiment.title.toLowerCase()}</span>}
              <span className="app-why">{a.why}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="suit">
        <Level label="Terrain similarity" status={terrainSimilar >= 2 ? 'ok' : 'warn'}>
          {terrainSimilar} of 3 terrain metrics similar or very similar (see the table above).
        </Level>
        <Level label="Environmental suitability" status={!c ? 'na' : dryKey === 'arid' ? 'ok' : 'warn'}>
          {!c ? 'Climate not loaded.' : `${c.aridity?.label}; mean ${fmt(c.temperature_mean_c, 1)} °C. Earth cannot reproduce gravity, atmosphere or radiation.`}
        </Level>
        <Level label="Operational accessibility" status="na">
          Roads, land use, permits, safety and ownership are not in our data. Check imagery and local authorities.
        </Level>
        <Level label="Scientific validation" status="na">
          Not field-validated. A site visit or drone survey must confirm the terrain before any test is planned.
        </Level>
      </div>
    </section>
  );
}
