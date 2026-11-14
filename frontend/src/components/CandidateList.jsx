import { fmt, parentName } from '../format.js';
import { friendlyMessage } from '../api/errors.js';
import { isMountainous, rainUncertain } from '../analogFacts.js';

const METRIC_LABEL = { slope: 'Slope mix', relief: 'Relief', variation: 'Roughness' };
const METRIC_HELP = {
  slope: 'share of flat, gentle and steep ground',
  relief: 'height range across the 20 km window',
  variation: 'local up-and-down roughness',
};

export function ScopeLine({ scope, parentsCount = 3, mode }) {
  if (!scope) return null;
  if (mode === 'global') {
    return (
      <p className="scope" data-testid="scope">
        Searched {scope.valid_windows?.toLocaleString()} valid 20 km windows over {scope.coverage}, 1000 m analysis
        grid, results at least {scope.min_center_distance_km} km apart
        {scope.known_analogs_skipped ? `, ${scope.known_analogs_skipped} windows inside well-known analog sites skipped` : ''}.
        Not the whole planet: polar and high-latitude land is not covered.
      </p>
    );
  }
  return (
    <p className="scope" data-testid="scope">
      Searched {parentsCount} Earth parent regions: {scope.valid_windows} valid of {scope.planned_windows} planned
      20 km windows, 1000 m analysis grid, results at least {scope.min_center_distance_km} km apart.
      This is a limited corpus, not the whole Earth.
    </p>
  );
}

/** Server reason codes ("closest_metric:relief" or "closest_on_relief") -> metric key. */
export function reasonMetric(codes = [], kind) {
  const re = kind === 'closest' ? /closest[a-z_]*?[:_](slope|relief|variation)$/ : /largest_gap[a-z_]*?[:_](slope|relief|variation)$/;
  for (const c of codes) { const m = re.exec(c); if (m) return m[1]; }
  return null;
}

function ScoreRing({ score }) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 24; const c = 2 * Math.PI * r;
  return (
    <span className="score-ring" aria-hidden="true">
      <svg viewBox="0 0 60 60" width="60" height="60">
        <circle cx="30" cy="30" r={r} className="ring-track" />
        <circle cx="30" cy="30" r={r} className="ring-value" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 30 30)" />
      </svg>
      <span className="ring-num">{fmt(v, 2)}</span>
    </span>
  );
}

function place(it, ranking, parents) {
  if (ranking.mode === 'global' && it.center) {
    return `Earth window ${fmt(Math.abs(it.center.lat), 2)}°${it.center.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(it.center.lon), 2)}°${it.center.lon >= 0 ? 'E' : 'W'}`;
  }
  return parentName(parents, it.parent_id);
}

// Climate chip (NASA POWER, context only - never part of the index).
function ClimateChip({ climate, mountainous: steep }) {
  if (!climate) return null;
  if (climate.pending) return <span className="chip clim">climate...</span>;
  if (climate.error) return <span className="chip clim">climate unavailable</span>;
  const c = climate.item;
  const k = c?.aridity?.key;
  const mountainous = rainUncertain(steep, c?.precipitation_mm_per_year);
  const icon = mountainous ? '⛰️' : k === 'arid' ? '🏜️' : k === 'semi_arid' ? '🌾' : k === 'wet' ? '🌧️' : '❔';
  const word = mountainous ? 'Rain uncertain (mountains)'
    : k === 'arid' ? 'Arid' : k === 'semi_arid' ? 'Semi-arid' : k === 'wet' ? 'Wet ⚠' : 'Unknown';
  return (
    <span className={`chip clim ${mountainous ? '' : k || ''}`}
      title={`NASA POWER climatology (~50 km)${c?.is_demo ? ' (DEMO)' : ''}: ${c?.aridity?.label}${mountainous ? '; low confidence in steep mountains' : ''}`}>
      {icon} {word} · {fmt(c?.precipitation_mm_per_year, 0)} mm/yr · {fmt(c?.temperature_mean_c, 0)} °C
    </span>
  );
}

export default function CandidateList({ ranking, pending, error, parents, selectedId, notice, onSelect, onBack, onNext, experiment, climateById = {}, detailsById = {} }) {
  const items = ranking?.items || [];
  return (
    <div className="panel-section">
      <p className="kicker">Scene 3 · Back on Earth</p>
      <h2>Candidate Earth windows</h2>
      {experiment && <p className="small muted">For your <b>{experiment.title.toLowerCase()}</b>: {experiment.profile === 'slope_focus'
        ? 'slope mix counts 70%, relief and roughness 15% each.' : 'slope mix 40%, relief 30%, roughness 30%.'}</p>}
      {pending && <p className="pending" role="status"><span className="spinner" aria-hidden="true" /> Searching the corpus...</p>}
      {error && <p className="error" role="alert">{friendlyMessage(error)}</p>}
      {notice && <p className="notice" role="alert">{notice}</p>}
      {ranking && <ScopeLine scope={ranking.scope} parentsCount={parents.length || 3} mode={ranking.mode} />}
      {ranking?.warnings?.filter((w) => !w.startsWith('DEMO')).map((w) => <p key={w} className="notice small">{w}</p>)}

      {items.length > 0 && (
        <details className="why-high small" data-testid="why-high">
          <summary>Why are scores so high?</summary>
          <p>The index is <b>100 × (1 − D)</b>, where D is a fixed distance between two 10-number terrain fingerprints
            (8 slope-class shares, relief, local roughness), each part between 0 (identical) and 1. Nothing is rounded or
            capped in the calculation; the cards just show two decimals.</p>
          <p>Scores sit in the 90s because we search {ranking?.mode === 'global'
            ? `${(ranking.scope?.valid_windows || 0).toLocaleString()} Earth windows` : 'every valid window of the curated regions'}:
            with that many candidates, a few are almost always close on just ten numbers. Smooth, flat sites match most easily,
            because flat plains are common on Earth, so they can reach 99+.</p>
          <p>So a high index means "terrain shape is close at 1 km", not "this place is the same". It is not a percentage
            or a probability. Compare the per-metric bars, the biggest gap and the climate chip, and use the tradeoff view to
            see why one window ranks above another.</p>
        </details>
      )}

      {ranking && items.length === 0 && (
        <p className="notice">No valid candidate window could be scored for this reference.</p>
      )}

      <ol className="cards">
        {items.map((it, i) => {
          const selected = it.candidate_id === selectedId;
          const best = reasonMetric(it.reason_codes, 'closest');
          const gap = reasonMetric(it.reason_codes, 'gap');
          return (
            <li key={it.candidate_id} style={{ animationDelay: `${i * 90}ms` }}>
              <button
                className={`card ${selected ? 'selected' : ''} rank-${i + 1}`}
                onClick={() => onSelect(it.candidate_id)}
                aria-pressed={selected}
                data-candidate-id={it.candidate_id}
                data-sound="pin"
              >
                <span className="card-head">
                  <span className={`medal m${Math.min(i + 1, 4)}`} aria-hidden="true">{i + 1}</span>
                  <span className="card-head-text">
                    <span className="card-rank">#{i + 1}{selected ? ' - selected' : ''}{selected && <span className="astro-tag"> · 🧑‍🚀 astronaut here</span>}</span>
                    <span className="card-title">{place(it, ranking, parents)}</span>
                    {ranking.mode === 'global' && (
                      <span className={`small analog-label ${it.known_analog ? 'known' : 'new'}`}>{it.known_analog
                        ? `Inside a well-known analog area: ${it.known_analog.name}`
                        : 'Not in our list of well-known analog sites (not a first-discovery claim)'}</span>
                    )}
                  </span>
                  <ScoreRing score={it.score} />
                </span>

                {it.distances && (
                  <span className="metric-bars">
                    {['slope', 'relief', 'variation'].map((k) => {
                      const close = Math.max(0, Math.min(1, 1 - (it.distances[k] ?? 1)));
                      return (
                        <span key={k} className="mbar" title={`${METRIC_LABEL[k]}: ${METRIC_HELP[k]}. Distance ${fmt(it.distances[k], 3)} (0 = identical).`}>
                          <span className="mbar-label">{METRIC_LABEL[k]}</span>
                          <span className="bar-track"><span className={`bar ${k}`} style={{ width: `${close * 100}%` }} /></span>
                          <span className="mbar-val">{fmt(close * 100, 1)}</span>
                        </span>
                      );
                    })}
                  </span>
                )}
                <span className="chips">
                  {best && <span className="chip good">Closest on {METRIC_LABEL[best].toLowerCase()}</span>}
                  {gap && <span className="chip gap">Biggest gap: {METRIC_LABEL[gap].toLowerCase()}</span>}
                  <ClimateChip climate={climateById[it.candidate_id]} mountainous={isMountainous(detailsById[it.candidate_id]?.item?.metrics)} />
                </span>
                <span className="card-id">{it.candidate_id}</span>
                <span className="card-score">
                  Terrain similarity index <b>{fmt(it.score, 2)}</b> <span className="muted">/ 100</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {items.length > 0 && (
        <p className="small muted">
          Bars show per-metric closeness (100 × (1 − distance), 0-100, higher is closer) from the server's distances.
          The index is a heuristic terrain similarity within this corpus, not a percentage of the reference
          reproduced and not a probability. The closest available window is not necessarily a suitable analog.
        </p>
      )}

      <div className="row">
        <button className="btn ghost" onClick={onBack} data-sound="back">Back to mission</button>
        <button className="btn primary" onClick={onNext} disabled={!selectedId}>
          {selectedId ? 'Compare tradeoffs' : 'Select a window to continue'}
        </button>
      </div>
    </div>
  );
}
