import { fmt } from '../format.js';
import {
  BODY_CLIMATE, BODY_FACTS, ENVIRONMENT_ROWS, FACT_SOURCE, NOT_ASSESSED, closenessBand, drynessVerdict,
  isMountainous, MOUNTAIN_RELIEF_M,
} from '../analogFacts.js';
import { friendlyMessage } from '../api/errors.js';

const BODY_NAME = { mars: 'Mars', moon: 'Moon' };

// shares of the 8 slope classes: flat = 0-3°, steep = over 10° (display summary of measured values)
const flat = (h) => (h ? h[0] + h[1] : null);
const steep = (h) => (h ? h[4] + h[5] + h[6] + h[7] : null);
const pct = (v) => `${fmt(v * 100, 0)}%`;

function Verdict({ band }) {
  return <span className={`verdict ${band.key}`}>{band.label}</span>;
}

/** Shared verdict summary (used by the table and the dossier overview). Null when data is missing. */
export function scorecardSummary({ reference, candidate, rankItem, climate }) {
  const body = reference?.body;
  const m = candidate?.metrics;
  if (!body || !BODY_FACTS[body] || !reference?.metrics || !m) return null;
  const d = rankItem?.distances;
  const terrainBands = ['slope', 'relief', 'variation'].map((k) => closenessBand(d?.[k]));
  const terrainSimilar = terrainBands.filter((b) => b.key === 'very' || b.key === 'similar').length;
  const env = ENVIRONMENT_ROWS.map((r) => ({ ...r, v: r.verdict(body) }));
  const envSimilar = env.filter((r) => r.v === 'similar').map((r) => r.label.toLowerCase());
  const envDifferent = env.filter((r) => r.v === 'different').map((r) => r.label.toLowerCase());
  const cl = climate?.item;
  const mountains = isMountainous(m);
  const dry = cl ? drynessVerdict(cl.aridity?.key, mountains, cl.precipitation_mm_per_year) : null;
  if (dry?.key === 'similar') envSimilar.push('dryness');
  if (dry?.key === 'different') envDifferent.push(`dryness (wet, ${fmt(cl.precipitation_mm_per_year, 0)} mm/yr)`);
  if (cl) envDifferent.push('temperature');
  return { body, terrainBands, terrainSimilar, env, envSimilar, envDifferent, cl, mountains, dry };
}

/**
 * "What is similar, how similar, what is different" for one Earth window vs the Moon/Mars reference.
 * Terrain rows: measured values (same pipeline) + the SERVER's per-metric distances.
 * Environment rows: body-wide NASA fact-sheet values. Unmeasured dimensions are listed, never guessed.
 */
export default function AnalogScorecard({ reference, candidate, rankItem, mode, climate }) {
  const S = scorecardSummary({ reference, candidate, rankItem, climate });
  if (!S) return null;
  const { body, terrainBands, terrainSimilar, env, envSimilar, envDifferent, cl, mountains, dry } = S;
  const t = reference.metrics;
  const m = candidate.metrics;
  const d = rankItem?.distances;
  const where = BODY_NAME[body];

  const terrain = [
    {
      key: 'slope', label: 'Slope mix',
      ref: `${pct(flat(t.slope_histogram))} flat (<3°), ${pct(steep(t.slope_histogram))} steep (>10°)`,
      cand: `${pct(flat(m.slope_histogram))} flat, ${pct(steep(m.slope_histogram))} steep`,
      dist: d?.slope,
    },
    {
      key: 'relief', label: 'Relief',
      ref: `${fmt(t.relief_p95_p05_m, 0)} m`, cand: `${fmt(m.relief_p95_p05_m, 0)} m`, dist: d?.relief,
    },
    {
      key: 'variation', label: 'Roughness',
      ref: `${fmt(t.local_variation_m, 1)} m`, cand: `${fmt(m.local_variation_m, 1)} m`, dist: d?.variation,
      note: mode === 'global' ? 'Earth value from ~1 km SRTMGL30 reads ~20% low vs 30 m data.' : null,
    },
  ];
  const bc = BODY_CLIMATE[body];

  return (
    <section className="scorecard" aria-labelledby="scorecard-title" data-testid="analog-scorecard">
      <h3 id="scorecard-title">Is this a good analog? What is similar, how similar, what is different</h3>
      <p className="scorecard-summary">
        <b>Similar:</b> {terrainSimilar} of 3 terrain metrics{envSimilar.length ? `, ${envSimilar.join(', ')}` : ''}.{' '}
        <b>Different:</b> {envDifferent.join(', ')}.{' '}
        <span className="muted">An analog does not have to match everything; {dry?.key === 'similar'
          ? 'this one is a terrain and dryness analog.' : 'this one is a terrain analog.'}</span>
      </p>

      <div className="table-scroll">
        <table className="metrics scorecard-table">
          <thead>
            <tr><th scope="col">Dimension</th><th scope="col">{where} (your site)</th><th scope="col">Earth window</th><th scope="col">How similar</th></tr>
          </thead>
          <tbody>
            <tr className="group"><th colSpan={4} scope="colgroup">Terrain - measured, same pipeline, 1000 m grid</th></tr>
            {terrain.map((r, i) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.ref}</td>
                <td>{r.cand}{r.note && <span className="cell-note">{r.note}</span>}</td>
                <td>
                  <Verdict band={terrainBands[i]} />
                  {Number.isFinite(Number(r.dist)) && <span className="cell-note">distance {fmt(r.dist, 3)}</span>}
                </td>
              </tr>
            ))}
            <tr className="group"><th colSpan={4} scope="colgroup">
              Climate - Earth side measured for this window (NASA POWER){cl?.is_demo ? ' - DEMO values' : ''}; {where} side planet-wide
            </th></tr>
            {climate?.pending && <tr><td colSpan={4} className="pending">Loading NASA POWER climate...</td></tr>}
            {climate?.error && <tr><td colSpan={4} className="notice small">Climate unavailable: {friendlyMessage(climate.error)}. Terrain results are unaffected.</td></tr>}
            {!climate && <tr><td colSpan={4} className="muted small">No climate requested for this window.</td></tr>}
            {cl && (
              <>
                <tr>
                  <th scope="row">Temperature</th>
                  <td>{bc.temperature}</td>
                  <td>{fmt(cl.temperature_mean_c, 1)} °C mean<span className="cell-note">extremes {fmt(cl.temperature_min_c, 0)} to {fmt(cl.temperature_max_c, 0)} °C</span></td>
                  <td><Verdict band={{ key: 'different', label: 'Different' }} /><span className="cell-note">{body === 'moon'
                    ? 'No Earth site has a ~300 °C day-night swing.'
                    : 'No Earth site in this search is as cold on average.'}</span></td>
                </tr>
                <tr>
                  <th scope="row">Dryness</th>
                  <td>{bc.dryness}</td>
                  <td>{fmt(cl.precipitation_mm_per_year, 0)} mm/yr<span className="cell-note">{cl.aridity?.label}</span></td>
                  <td><Verdict band={dry} />
                    {dry.key === 'different' && <span className="cell-note">Likely vegetated: a terrain analog only.</span>}
                    {dry.key === 'na' && mountains && <span className="cell-note">⚠ Low confidence: window relief {fmt(m.relief_p95_p05_m, 0)} m &gt; {MOUNTAIN_RELIEF_M} m;
                      a ~50 km climate grid can mix dry plateaus with wet slopes, giving mid-range values like this.</span>}
                    {dry.key !== 'na' && mountains && <span className="cell-note">Mountainous window: value is a ~50 km average.</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Sunlight</th>
                  <td>{bc.sunlight}</td>
                  <td>{fmt(cl.solar_kwh_m2_day, 2)} kWh/m²/day at the surface</td>
                  <td><Verdict band={{ key: 'na', label: 'Context' }} /><span className="cell-note">Relevant for solar power tests.</span></td>
                </tr>
                <tr>
                  <th scope="row">Wind</th>
                  <td>{bc.wind}</td>
                  <td>{fmt(cl.wind_speed_10m_m_s, 1)} m/s mean at 10 m</td>
                  <td><Verdict band={{ key: 'na', label: 'Context' }} /><span className="cell-note">Dust and erosion tests.</span></td>
                </tr>
                <tr className="source-row"><td colSpan={4} className="cell-note">
                  Earth climate: {cl.source?.name}{cl.source?.api_version ? ` ${cl.source.api_version}` : ''} ({(cl.source?.datasets || []).join(', ')}),
                  {' '}{cl.source?.period}; {cl.source?.resolution}; {cl.source?.kind}. Context only - never part of the similarity index.
                </td></tr>
              </>
            )}
            <tr className="group"><th colSpan={4} scope="colgroup">Environment - planet-wide facts (not site measurements)</th></tr>
            {env.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{BODY_FACTS[body][r.key]}</td>
                <td>{BODY_FACTS.earth[r.key]}</td>
                <td><Verdict band={r.v === 'similar' ? { key: 'similar', label: 'Similar' } : { key: 'different', label: 'Different' }} />
                  <span className="cell-note">{r.note}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="small">
        <summary>Not assessed in this version ({NOT_ASSESSED.length})</summary>
        <ul>{NOT_ASSESSED.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="muted">These need their own datasets and field checks; a terrain match says nothing about them.</p>
      </details>
      <p className="small muted">
        "How similar" bands read the server's per-metric distance (0 = identical): ≤0.05 very similar, ≤0.15 similar,
        ≤0.30 partly similar, above that different. A display convention, not a statistical test.
        Environment values: <a href={FACT_SOURCE.url} target="_blank" rel="noopener noreferrer">{FACT_SOURCE.label}</a>.
      </p>
    </section>
  );
}
