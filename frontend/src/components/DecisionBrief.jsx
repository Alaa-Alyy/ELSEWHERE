import { useEffect, useRef } from 'react';
import { fmt, SLOPE_BIN_LABELS } from '../format.js';
import { friendlyMessage } from '../api/errors.js';
import { PROFILES } from '../state.js';
import SourceList from './SourceList.jsx';

function value(v, units) {
  if (Array.isArray(v)) return v.map((p, i) => `${SLOPE_BIN_LABELS[i] ?? i}: ${fmt(p * 100, 0)}%`).join(', ');
  return `${fmt(v, units === 'm' ? 1 : 3)}${units === 'm' ? ' m' : ''}`;
}

function ProposedTest({ test }) {
  if (!test) return <p className="muted">No proposed test template for this profile.</p>;
  if (typeof test === 'string') return <p>{test}</p>;
  return (
    <div>
      {test.title && <p><b>{test.title}</b></p>}
      {test.summary && <p>{test.summary}</p>}
      {Array.isArray(test.steps) && <ol>{test.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
      {test.requires_field_validation && <p className="small">Requires field validation before any real test.</p>}
    </div>
  );
}

export default function DecisionBrief({ state, reference, sources, onConfirm, onBack }) {
  const { selectedCandidateId, alternativeCandidateId, decisionSnapshot: d, decisionPending, decisionError } = state;
  const w = state.ranking?.weights;
  const recordRef = useRef(null);
  // Keep keyboard focus: the confirm button disappears once the record arrives.
  useEffect(() => { if (d) recordRef.current?.focus(); }, [d]);

  return (
    <div className="panel-section brief">
      <h2>Mission Decision Brief</h2>

      {!selectedCandidateId && <p className="notice">Select a candidate window before confirming a decision.</p>}

      {selectedCandidateId && !d && (
        <>
          <dl className="kv">
            <dt>Reference</dt><dd>{reference?.name ?? state.referenceId}</dd>
            <dt>Selected window</dt><dd>{selectedCandidateId}</dd>
            <dt>Alternative</dt><dd>{alternativeCandidateId ?? 'none (single result)'}</dd>
            <dt>Profile</dt><dd>{PROFILES[state.profile].label}</dd>
            <dt>Weights</dt><dd>slope {fmt(w?.slope, 2)}, relief {fmt(w?.relief, 2)}, variation {fmt(w?.variation, 2)}</dd>
          </dl>
          <button className="btn primary block" onClick={onConfirm} disabled={decisionPending || state.rankingPending}>
            {decisionPending ? 'Generating brief...' : 'Confirm my choice'}
          </button>
          <p className="small muted">The server recomputes the comparison from IDs and settings; no scores are sent from the browser.</p>
        </>
      )}

      {decisionError && <p className="error" role="alert">Decision unavailable: {friendlyMessage(decisionError)}</p>}

      {d && (
        <article data-testid="decision-record" ref={recordRef} tabIndex={-1} aria-label="Mission Decision Brief record">
          <dl className="kv">
            <dt>Decision ID</dt><dd className="mono">{d.decision_id}</dd>
            <dt>Generated (UTC)</dt><dd>{d.generated_at_utc}</dd>
            <dt>Reference</dt><dd>{d.reference_id}</dd>
            <dt>Selected window</dt><dd>{d.selected_candidate_id}</dd>
            <dt>Alternative</dt><dd>{d.alternative_candidate_id ?? 'none (single result)'}</dd>
            <dt>Profile / weights</dt><dd>{d.profile}: slope {fmt(d.weights?.slope, 2)}, relief {fmt(d.weights?.relief, 2)}, variation {fmt(d.weights?.variation, 2)}</dd>
            <dt>Versions</dt><dd>pipeline {d.pipeline_version}, score {d.score_version}, corpus <span className="mono">{d.corpus_version}</span></dd>
            {d.mode === 'global' ? (
              <>
                <dt>Search scope</dt><dd>{d.search_scope?.valid_windows?.toLocaleString()} valid windows, {d.search_scope?.coverage}; results ≥{d.search_scope?.min_center_distance_km} km apart</dd>
                <dt>Reference</dt><dd>{d.reference?.name} ({d.reference?.body}, {fmt(d.reference?.center?.lat, 2)}°, {fmt(d.reference?.center?.lon, 2)}°)</dd>
                <dt>Selected location</dt><dd>{fmt(d.selected_center?.lat, 4)}°, {fmt(d.selected_center?.lon, 4)}° (WGS84)</dd>
                <dt>Known analog site?</dt><dd>{d.selected_known_analog ? `Yes: ${d.selected_known_analog.name}` : 'Not in our short list of well-known analog sites (not a first-discovery claim)'}</dd>
              </>
            ) : (
              <><dt>Search scope</dt><dd>{d.search_scope?.parents} parent regions, {d.search_scope?.valid_windows} valid of {d.search_scope?.planned_windows} planned windows</dd></>
            )}
          </dl>

          <h3>Measured evidence</h3>
          <table className="metrics">
            <thead><tr><th scope="col">Metric</th><th scope="col">Reference</th><th scope="col">Selected</th><th scope="col">Distance</th></tr></thead>
            <tbody>
              {(d.evidence || []).map((e) => (
                <tr key={e.metric}>
                  <th scope="row">{e.metric}</th>
                  <td>{value(e.target_value, e.units)}</td>
                  <td>{value(e.selected_value, e.units)}</td>
                  <td>{fmt(e.distance, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {d.tradeoffs?.length > 0 ? (
            <>
              <h3>Tradeoffs vs alternative (weighted contribution, lower is closer)</h3>
              <table className="metrics">
                <thead><tr><th scope="col">Metric</th><th scope="col">Weight</th><th scope="col">Selected</th><th scope="col">Alternative</th></tr></thead>
                <tbody>
                  {d.tradeoffs.map((t) => (
                    <tr key={t.metric}>
                      <th scope="row">{t.metric}</th>
                      <td>{fmt(t.weight, 2)}</td>
                      <td>{fmt(t.selected_contribution, 3)} <span className="muted">(d {fmt(t.selected_distance, 3)})</span></td>
                      <td>{fmt(t.alternative_contribution, 3)} <span className="muted">(d {fmt(t.alternative_distance, 3)})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="muted">No alternative compared.</p>}

          <h3>Proposed test (not executed)</h3>
          <ProposedTest test={d.proposed_test} />

          <h3>Limitations and missing dimensions</h3>
          <ul>{(d.limitations || []).map((l) => <li key={l}>{l}</li>)}</ul>

          <SourceList ids={d.source_ids} sources={sources} title="Sources" />

          <div className="row">
            <button className="btn ghost" onClick={() => window.print()}>Print brief</button>
          </div>
        </article>
      )}

      <div className="row">
        <button className="btn ghost" onClick={onBack}>Back to tradeoffs</button>
      </div>
    </div>
  );
}
