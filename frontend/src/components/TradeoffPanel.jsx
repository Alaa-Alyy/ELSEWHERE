import { useEffect, useRef, useState } from 'react';
import { fmt, METRICS } from '../format.js';
import { friendlyMessage } from '../api/errors.js';
import { PROFILES } from '../state.js';

const DEBOUNCE_MS = 300;
const PRECISION = 3;

// contribution = weight * distance, both taken from the server response (display only).
function contributions(item, weights) {
  return Object.fromEntries(METRICS.map(({ key }) => [key, weights[key] * item.distances[key]]));
}

function explain(sel, alt, cSel, cAlt) {
  if (!alt) return null;
  const parts = METRICS.map(({ key, label }) => {
    const a = Number(cSel[key].toFixed(PRECISION));
    const b = Number(cAlt[key].toFixed(PRECISION));
    if (a === b) return `${label}: tie at ${fmt(a, PRECISION)}`;
    return a < b
      ? `${label}: selected is closer (${fmt(a, PRECISION)} vs ${fmt(b, PRECISION)})`
      : `${label}: alternative is closer (${fmt(b, PRECISION)} vs ${fmt(a, PRECISION)})`;
  });
  // Overall comparison uses the server-provided index only.
  const sSel = Number(sel.score.toFixed(1));
  const sAlt = Number(alt.score.toFixed(1));
  const overall = sSel === sAlt
    ? `Overall the terrain similarity index is a tie at ${fmt(sSel, 1)}.`
    : sSel > sAlt
      ? `Overall, the selected window is closer to the reference (index ${fmt(sSel, 1)} vs ${fmt(sAlt, 1)}).`
      : `Overall, the alternative is closer (index ${fmt(sAlt, 1)} vs ${fmt(sSel, 1)}); you may still keep your choice for your own reasons.`;
  return { parts, overall };
}

function Bar({ value, kind, label }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="bar-cell">
      <span className="bar-track" aria-hidden="true"><span className={`bar ${kind}`} style={{ width: `${pct}%` }} /></span>
      <span className="bar-num">{label}: {fmt(value, PRECISION)}</span>
    </span>
  );
}

export default function TradeoffPanel({
  ranking, pending, error, profile, slopeWeight, selectedId, alternativeId, rankingChange, notice,
  onSlopeWeight, onAlternative, onSelect, onBack, onNext,
}) {
  const effective = ranking?.weights?.slope ?? PROFILES[profile].defaultSlope;
  const [draft, setDraft] = useState(slopeWeight ?? effective);
  const timer = useRef(null);

  useEffect(() => { if (slopeWeight === null) setDraft(effective); }, [slopeWeight, effective]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSlider = (e) => {
    const v = Math.round(Number(e.target.value) * 100) / 100;
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSlopeWeight(v), DEBOUNCE_MS);
  };

  const items = ranking?.items || [];
  const sel = items.find((i) => i.candidate_id === selectedId) || null;
  const alt = items.find((i) => i.candidate_id === alternativeId) || null;
  const weights = ranking?.weights;
  const cSel = sel && weights ? contributions(sel, weights) : null;
  const cAlt = alt && weights ? contributions(alt, weights) : null;
  const text = sel && cSel ? explain(sel, alt, cSel, cAlt) : null;
  const waiting = pending || draft !== (slopeWeight ?? effective);

  return (
    <div className="panel-section">
      <p className="kicker">Scene 4 · Tradeoffs</p>
      <h2>Why this location? Why not the alternative?</h2>
      {error && <p className="error" role="alert">{friendlyMessage(error)}</p>}
      {notice && <p className="notice" role="alert">{notice}</p>}

      <div className="slider-box">
        <label htmlFor="slope-weight">Slope priority: <b>{fmt(draft, 2)}</b></label>
        <input id="slope-weight" type="range" min="0" max="1" step="0.05" value={draft} onChange={onSlider}
          aria-describedby="weights-now" />
        <p id="weights-now" className="small">
          Effective weights from the server: slope {fmt(weights?.slope, 2)}, relief {fmt(weights?.relief, 2)},
          variation {fmt(weights?.variation, 2)}
          {waiting && <span className="pending"> (recomputing...)</span>}
        </p>
        {slopeWeight !== null && (
          <button className="btn small ghost" onClick={() => { setDraft(PROFILES[profile].defaultSlope); onSlopeWeight(null); }}>
            Reset to profile default ({PROFILES[profile].defaultSlope})
          </button>
        )}
      </div>

      {rankingChange && !pending && (
        <p className="notice" role="status" data-testid="ranking-change">
          {rankingChange.changed
            ? `With slope priority ${fmt(rankingChange.newSlopeWeight, 2)} (was ${fmt(rankingChange.previousSlopeWeight, 2)}), the top distinct result changed from ${rankingChange.previousTopId ?? 'none'} to ${rankingChange.newTopId ?? 'none'}.`
            : `With slope priority ${fmt(rankingChange.newSlopeWeight, 2)} (was ${fmt(rankingChange.previousSlopeWeight, 2)}), the top distinct result stayed ${rankingChange.newTopId}. A stable result is an honest outcome.`}
        </p>
      )}

      {!sel && (
        <div>
          <p className="notice">Choose a window to compare:</p>
          <div className="row wrap">
            {items.map((i) => <button key={i.candidate_id} className="btn small" onClick={() => onSelect(i.candidate_id)}>{i.candidate_id}</button>)}
          </div>
        </div>
      )}

      {sel && (
        <>
          <div className="row wrap">
            <span className="tag sel">Selected: {sel.candidate_id}</span>
            <label className="small">
              Alternative:{' '}
              <select value={alternativeId ?? ''} onChange={(e) => onAlternative(e.target.value || null)}>
                {items.filter((i) => i.candidate_id !== selectedId).map((i) => (
                  <option key={i.candidate_id} value={i.candidate_id}>{i.candidate_id}</option>
                ))}
                {items.length < 2 && <option value="">none available</option>}
              </select>
            </label>
          </div>

          {!alt && (
            <p className="notice" data-testid="no-alternative">
              Only one distinct result is available, so there is no alternative to compare. This is an honest single-result state.
            </p>
          )}

          <table className="tradeoffs">
            <caption>Distance (0 = identical to reference, 1 = maximally different) and weighted contribution. Lower is closer. Shared 0-1 scale.</caption>
            <thead>
              <tr><th scope="col">Metric</th><th scope="col">Weight</th><th scope="col">Selected</th>{alt && <th scope="col">Alternative</th>}</tr>
            </thead>
            <tbody>
              {METRICS.map(({ key, label }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{fmt(weights?.[key], 2)}</td>
                  <td>
                    <Bar value={sel.distances[key]} kind="cand" label="distance" />
                    <Bar value={cSel[key]} kind="cand contrib" label="contribution" />
                  </td>
                  {alt && (
                    <td>
                      <Bar value={alt.distances[key]} kind="alt" label="distance" />
                      <Bar value={cAlt[key]} kind="alt contrib" label="contribution" />
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <th scope="row">Terrain similarity index</th><td />
                <td>{fmt(sel.score, 1)}</td>
                {alt && <td>{fmt(alt.score, 1)}</td>}
              </tr>
            </tbody>
          </table>

          {text && (
            <div className="explain" data-testid="explanation">
              <ul>{text.parts.map((p) => <li key={p}>{p}</li>)}</ul>
              <p><b>{text.overall}</b></p>
            </div>
          )}
        </>
      )}

      <div className="row">
        <button className="btn ghost" onClick={onBack}>Back to candidates</button>
        <button className="btn primary" onClick={onNext} disabled={!sel || pending}>Go to decision</button>
      </div>
    </div>
  );
}
