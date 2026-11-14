import { assetUrl } from '../api/client.js';
import { friendlyMessage } from '../api/errors.js';
import { PROFILES, SEARCH_MODES } from '../state.js';
import { fmt, SLOPE_BIN_LABELS } from '../format.js';
import { PLACES } from '../places.js';

const BODIES = [
  { key: 'mars', label: 'Mars' },
  { key: 'moon', label: 'Moon' },
];

const PROFILE_HELP = {
  terrain_general: 'Balanced: slope distribution 40%, relief 30%, local height variation 30%.',
  slope_focus: 'Slope-led: slope distribution 70%, relief 15%, local height variation 15%.',
};

/** Measured terrain fingerprint of the chosen Moon/Mars window, shown BEFORE searching Earth. */
export function Fingerprint({ reference }) {
  const m = reference?.metrics;
  const a = reference?.analysis;
  if (!reference) return null;
  if (a?.status !== 'valid' || !m?.slope_histogram) {
    return <p className="notice">This window could not be measured: {(a?.reasons || []).join('; ') || 'no valid data'}.</p>;
  }
  return (
    <div className="fingerprint" data-testid="fingerprint">
      <p className="small"><b>Measured terrain of this 20 km window</b> (1000 m grid)</p>
      <dl className="kv">
        <dt>Relief (P95-P5)</dt><dd>{fmt(m.relief_p95_p05_m, 0)} m</dd>
        <dt>Local height variation</dt><dd>{fmt(m.local_variation_m, 1)} m</dd>
        <dt>Valid data</dt><dd>{fmt((a.valid_fraction ?? 0) * 100, 0)}%</dd>
      </dl>
      <div className="histo" role="img" aria-label="Slope distribution of the pinned window">
        {SLOPE_BIN_LABELS.map((lab, i) => (
          <div key={lab} className="histo-row two">
            <span className="histo-label">{lab}</span>
            <span className="bar-track"><span className="bar ref" style={{ width: `${m.slope_histogram[i] * 100}%` }} /></span>
            <span className="histo-val">{fmt(m.slope_histogram[i] * 100, 0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MissionControls({
  body, profile, mode, excludeKnown, reference, pin, pinPending, pinError, sources,
  onBody, onProfile, onMode, onExcludeKnown, onPlace, onUseCurated, onSearch,
}) {
  const preview = assetUrl(reference?.preview_url);
  const refSources = (reference?.source_ids || []).map((id) => sources.find((s) => s.id === id)).filter(Boolean);
  const canSearch = reference && reference.analysis?.status === 'valid' && !pinPending
    && !(mode === 'curated' && pin);

  return (
    <div className="panel-section">
      <h2>Mission</h2>
      <p className="muted">Pick a place on the {body === 'mars' ? 'Mars' : 'Moon'} globe, check its measured terrain,
        then search Earth for the closest terrain windows.</p>

      <fieldset className="choice-group row-choices">
        <legend>Destination</legend>
        {BODIES.map((b) => (
          <label key={b.key} className={`choice ${body === b.key ? 'checked' : ''}`}>
            <input type="radio" name="body" value={b.key} checked={body === b.key} onChange={() => onBody(b.key)} />
            <span className="choice-title">{b.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="reference-card">
        <p className="small"><b>Where on {body === 'mars' ? 'Mars' : 'the Moon'}?</b> Click the globe, or a named place:</p>
        <div className="row wrap">
          {PLACES[body].map((p) => (
            <button key={p.name} className="btn small" onClick={() => onPlace(p.lat, p.lon)} disabled={pinPending}>{p.name}</button>
          ))}
        </div>
        {pin && <button className="btn small ghost" onClick={onUseCurated}>Use the vetted reference instead</button>}
        {pinPending && <p className="pending" role="status">Measuring the pinned window from NASA elevation data...</p>}
        {pinError && <p className="error" role="alert">Could not measure this pin: {friendlyMessage(pinError)}</p>}

        {reference ? (
          <>
            <h3>{reference.name}</h3>
            <dl className="kv">
              <dt>Center</dt><dd>{fmt(reference.center?.lat, 2)}°, {fmt(reference.center?.lon, 2)}° (planetocentric, east +)</dd>
              <dt>Window</dt><dd>{reference.analysis?.window_size_km} km square, {reference.analysis?.resolution_m} m grid</dd>
              {reference.analysis?.is_demo && <><dt>Data</dt><dd>demo values</dd></>}
            </dl>
            {preview && <div className="preview-box"><img src={preview} alt={`2D elevation preview of ${reference.name}`} /></div>}
            <Fingerprint reference={reference} />
            {refSources.length > 0 && (
              <p className="small">Elevation source: {refSources.map((s) => (
                <a key={s.id} href={s.landing_url} target="_blank" rel="noopener noreferrer">{s.product}</a>
              ))}</p>
            )}
          </>
        ) : !pinPending && <p className="muted">Reference unavailable.</p>}
      </div>

      <fieldset className="choice-group">
        <legend>Search where on Earth?</legend>
        {Object.entries(SEARCH_MODES).map(([key, m]) => (
          <label key={key} className={`choice ${mode === key ? 'checked' : ''}`}>
            <input type="radio" name="mode" value={key} checked={mode === key} onChange={() => onMode(key)} />
            <span className="choice-title">{m.label}</span>
            <span className="choice-hint">{key === 'global'
              ? 'All Earth land 56°S-60°N with NASA SRTMGL30 (~1 km), results at least 100 km apart.'
              : 'Khaybar, Pinacate and Death Valley with NASA SRTMGL1 (30 m). Vetted references only.'}</span>
          </label>
        ))}
        {mode === 'global' && (
          <label className="small">
            <input type="checkbox" checked={excludeKnown} onChange={(e) => onExcludeKnown(e.target.checked)} />
            {' '}Hide results inside well-known analog sites (Atacama, Death Valley, Iceland, ...)
          </label>
        )}
        {mode === 'curated' && pin && <p className="notice small">Curated mode uses the vetted references only; your pin needs “Whole Earth”.</p>}
      </fieldset>

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
        <summary>How does the search work without a trained model?</summary>
        <p>Every 20 km window gets a terrain fingerprint: 8 slope-class shares, relief and local height variation,
          all on the same 1000 m grid. The pinned window's fingerprint is compared with every Earth window using one
          fixed, explainable distance (nearest-neighbour similarity search). No labelled analog examples exist to train
          on, so nothing is learned; every result can be explained metric by metric.</p>
      </details>

      <button className="btn primary block" onClick={onSearch} disabled={!canSearch}>
        {mode === 'global' ? 'Search all Earth land' : 'Search the 3 curated regions'}
      </button>
    </div>
  );
}
