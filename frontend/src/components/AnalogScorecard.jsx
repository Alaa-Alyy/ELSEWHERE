import { fmt } from '../format.js';
import { BODY_FACTS, ENVIRONMENT_ROWS, FACT_SOURCE, NOT_ASSESSED, closenessBand } from '../analogFacts.js';

const BODY_NAME = { mars: 'Mars', moon: 'Moon' };

// shares of the 8 slope classes: flat = 0-3°, steep = over 10° (display summary of measured values)
const flat = (h) => (h ? h[0] + h[1] : null);
const steep = (h) => (h ? h[4] + h[5] + h[6] + h[7] : null);
const pct = (v) => `${fmt(v * 100, 0)}%`;

function Verdict({ band }) {
  return <span className={`verdict ${band.key}`}>{band.label}</span>;
}

/**
 * "What is similar, how similar, what is different" for one Earth window vs the Moon/Mars reference.
 * Terrain rows: measured values (same pipeline) + the SERVER's per-metric distances.
 * Environment rows: body-wide NASA fact-sheet values. Unmeasured dimensions are listed, never guessed.
 */
export default function AnalogScorecard({ reference, candidate, rankItem, mode }) {
  const body = reference?.body;
  const t = reference?.metrics;
  const m = candidate?.metrics;
  const d = rankItem?.distances;
  if (!body || !BODY_FACTS[body] || !t || !m) return null;
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
  const terrainBands = terrain.map((r) => closenessBand(r.dist));
  const terrainSimilar = terrainBands.filter((b) => b.key === 'very' || b.key === 'similar').length;
  const env = ENVIRONMENT_ROWS.map((r) => ({ ...r, v: r.verdict(body) }));
  const envSimilar = env.filter((r) => r.v === 'similar').map((r) => r.label.toLowerCase());
  const envDifferent = env.filter((r) => r.v === 'different').map((r) => r.label.toLowerCase());

  return (
    <section className="scorecard" aria-labelledby="scorecard-title" data-testid="analog-scorecard">
      <h3 id="scorecard-title">Is this a good analog? What is similar, how similar, what is different</h3>
      <p className="scorecard-summary">
        <b>Similar:</b> {terrainSimilar} of 3 terrain metrics{envSimilar.length ? `, ${envSimilar.join(', ')}` : ''}.{' '}
        <b>Different:</b> {envDifferent.join(', ')}.{' '}
        <span className="muted">An analog does not have to match everything; this one is a terrain analog.</span>
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
