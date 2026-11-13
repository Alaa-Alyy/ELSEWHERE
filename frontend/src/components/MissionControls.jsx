import { assetUrl } from '../api/client.js';
import { PROFILES } from '../state.js';
import { fmt } from '../format.js';

const BODIES = [
  { key: 'mars', label: 'Mars', hint: 'Jezero regional terrain window' },
  { key: 'moon', label: 'Moon', hint: 'Lunar south polar terrain sector' },
];

const PROFILE_HELP = {
  terrain_general: 'Balanced: slope distribution 40%, relief 30%, local height variation 30%.',
  slope_focus: 'Slope-led: slope distribution 70%, relief 15%, local height variation 15%.',
};

export default function MissionControls({ body, profile, reference, sources, onBody, onProfile, onSearch }) {
  const preview = assetUrl(reference?.preview_url);
  const refSources = (reference?.source_ids || []).map((id) => sources.find((s) => s.id === id)).filter(Boolean);
  const m = reference?.metrics;

  return (
    <div className="panel-section">
      <h2>Mission</h2>
      <p className="muted">Choose the world you are preparing for, then what matters most.</p>

      <fieldset className="choice-group">
        <legend>Destination reference</legend>
        {BODIES.map((b) => (
          <label key={b.key} className={`choice ${body === b.key ? 'checked' : ''}`}>
            <input type="radio" name="body" value={b.key} checked={body === b.key} onChange={() => onBody(b.key)} />
            <span className="choice-title">{b.label}</span>
            <span className="choice-hint">{b.hint}</span>
          </label>
        ))}
      </fieldset>

      <div className="reference-card">
        {reference ? (
          <>
            <h3>{reference.name}</h3>
            <div className="preview-box">
              {preview
                ? <img src={preview} alt={`2D elevation preview of ${reference.name}`} />
                : <span className="muted">No preview image available yet</span>}
            </div>
            <dl className="kv">
              <dt>Analysis footprint</dt><dd>{reference.analysis?.window_size_km} km square at {reference.analysis?.resolution_m} m grid</dd>
              <dt>Center (provisional)</dt><dd>{fmt(reference.center?.lat, 2)}°, {fmt(reference.center?.lon, 2)}° ({reference.coordinate_convention})</dd>
              <dt>Status</dt><dd>{reference.analysis?.status}{reference.analysis?.is_demo ? ' (demo values)' : ''}</dd>
            </dl>
            {m && (
              <details>
                <summary>Reference terrain metrics</summary>
                <dl className="kv">
                  <dt>Relief (P95-P5)</dt><dd>{fmt(m.relief_p95_p05_m, 0)} m</dd>
                  <dt>Local height variation</dt><dd>{fmt(m.local_variation_m, 1)} m</dd>
                </dl>
              </details>
            )}
            {refSources.length > 0 && (
              <p className="small">Source: {refSources.map((s) => (
                <a key={s.id} href={s.landing_url} target="_blank" rel="noopener noreferrer">{s.product}</a>
              ))}</p>
            )}
            <p className="small muted">Shown in 2D only. Planetary coordinates are never drawn on the Earth globe.</p>
          </>
        ) : (
          <p className="muted">Reference unavailable.</p>
        )}
      </div>

      <fieldset className="choice-group">
        <legend>Mission priority</legend>
        {Object.entries(PROFILES).map(([key, p]) => (
          <label key={key} className={`choice ${profile === key ? 'checked' : ''}`}>
            <input type="radio" name="profile" value={key} checked={profile === key} onChange={() => onProfile(key)} />
            <span className="choice-title">{p.label}</span>
            <span className="choice-hint">{PROFILE_HELP[key]}</span>
          </label>
        ))}
      </fieldset>

      <details className="small">
        <summary>What do these terrain measures mean?</summary>
        <ul>
          <li><b>Slope distribution</b>: share of the 1 km cells in each slope class (0-1°, 1-3°, ... 45-90°).</li>
          <li><b>Relief</b>: height range between the 5th and 95th percentile, in metres.</li>
          <li><b>Local height variation</b>: median difference between a cell and its 3x3 neighbourhood average, in metres. Not rock or grain roughness.</li>
        </ul>
      </details>

      <button className="btn primary block" onClick={onSearch} disabled={!reference}>Search Earth windows</button>
    </div>
  );
}
