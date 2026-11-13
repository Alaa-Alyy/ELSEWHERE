import { assetUrl } from '../api/client.js';
import { fmt, SLOPE_BIN_LABELS } from '../format.js';
import { friendlyMessage } from '../api/errors.js';
import SourceList from './SourceList.jsx';

// Target (reference) vs selected candidate measured values, side by side on shared scales.
export default function EvidencePanel({ reference, details, sources, onExplain, chatAvailable }) {
  if (details?.error) return <p className="error" role="alert">Candidate details unavailable: {friendlyMessage(details.error)}</p>;
  const c = details?.item;
  if (!c) return <p className="pending">Loading candidate evidence...</p>;
  const t = reference?.metrics;
  const m = c.metrics;
  const preview = assetUrl(c.preview_url);
  const refPreview = assetUrl(reference?.preview_url);
  const ring = c.footprint?.coordinates?.[0] || [];
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);

  return (
    <div className="panel-section evidence" aria-labelledby="evidence-title">
      <div className="row space">
        <h3 id="evidence-title">Evidence: {c.id}</h3>
        <button className="btn small" onClick={onExplain} disabled={!chatAvailable}
          title={chatAvailable ? '' : 'Assistant unavailable'}>
          Explain this choice
        </button>
      </div>

      <dl className="kv">
        <dt>Center (WGS84)</dt><dd>{fmt(c.center?.lat, 4)}°, {fmt(c.center?.lon, 4)}°</dd>
        <dt>Footprint</dt>
        <dd>{c.analysis?.window_size_km} km square, {ring.length ? `lon ${fmt(Math.min(...lons), 3)} to ${fmt(Math.max(...lons), 3)}, lat ${fmt(Math.min(...lats), 3)} to ${fmt(Math.max(...lats), 3)}` : 'n/a'}</dd>
        <dt>Valid data fraction</dt><dd>{fmt(c.analysis?.valid_fraction, 3)}</dd>
      </dl>

      <div className="previews">
        <figure>
          <div className="preview-box">{refPreview ? <img src={refPreview} alt="Reference elevation preview" /> : <span className="muted">No reference preview</span>}</div>
          <figcaption>Reference</figcaption>
        </figure>
        <figure>
          <div className="preview-box">{preview ? <img src={preview} alt={`Elevation preview of ${c.id}`} /> : <span className="muted">No candidate preview</span>}</div>
          <figcaption>Candidate</figcaption>
        </figure>
      </div>

      {t && m && (
        <>
          <table className="metrics">
            <caption>Measured values (reference vs candidate)</caption>
            <thead><tr><th scope="col">Metric</th><th scope="col">Reference</th><th scope="col">Candidate</th></tr></thead>
            <tbody>
              <tr><th scope="row">Relief P95-P5</th><td>{fmt(t.relief_p95_p05_m, 0)} m</td><td>{fmt(m.relief_p95_p05_m, 0)} m</td></tr>
              <tr><th scope="row">Local height variation</th><td>{fmt(t.local_variation_m, 1)} m</td><td>{fmt(m.local_variation_m, 1)} m</td></tr>
            </tbody>
          </table>
          {t.slope_histogram && m.slope_histogram && (
            <div className="histo" role="img" aria-label="Slope distribution comparison, reference and candidate, shared 0 to 100 percent scale">
              <p className="small">Slope distribution (share of cells, shared 0-100% scale)</p>
              {SLOPE_BIN_LABELS.map((lab, i) => (
                <div key={lab} className="histo-row">
                  <span className="histo-label">{lab}</span>
                  <span className="bar-track">
                    <span className="bar ref" style={{ width: `${t.slope_histogram[i] * 100}%` }} />
                  </span>
                  <span className="histo-val">R {fmt(t.slope_histogram[i] * 100, 0)}%</span>
                  <span className="bar-track">
                    <span className="bar cand" style={{ width: `${m.slope_histogram[i] * 100}%` }} />
                  </span>
                  <span className="histo-val">C {fmt(m.slope_histogram[i] * 100, 0)}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {c.limitations?.length > 0 && (
        <details>
          <summary>Limitations ({c.limitations.length})</summary>
          <ul>{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}
      <SourceList ids={c.source_ids} sources={details.sources?.length ? details.sources : sources} title="Candidate sources" />
    </div>
  );
}
