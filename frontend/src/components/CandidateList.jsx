import { fmt, parentName } from '../format.js';
import { friendlyMessage } from '../api/errors.js';

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

export default function CandidateList({ ranking, pending, error, parents, selectedId, notice, onSelect, onBack, onNext }) {
  const items = ranking?.items || [];
  return (
    <div className="panel-section">
      <h2>Candidate Earth windows</h2>
      {pending && <p className="pending" role="status">Searching the corpus...</p>}
      {error && <p className="error" role="alert">{friendlyMessage(error)}</p>}
      {notice && <p className="notice" role="alert">{notice}</p>}
      {ranking && <ScopeLine scope={ranking.scope} parentsCount={parents.length || 3} mode={ranking.mode} />}
      {ranking?.warnings?.filter((w) => !w.startsWith('DEMO')).map((w) => <p key={w} className="notice small">{w}</p>)}

      {ranking && items.length === 0 && (
        <p className="notice">No valid candidate window could be scored for this reference.</p>
      )}

      <ol className="cards">
        {items.map((it, i) => {
          const selected = it.candidate_id === selectedId;
          return (
            <li key={it.candidate_id}>
              <button
                className={`card ${selected ? 'selected' : ''}`}
                onClick={() => onSelect(it.candidate_id)}
                aria-pressed={selected}
                data-candidate-id={it.candidate_id}
              >
                <span className="card-rank">#{i + 1}{selected ? ' - selected' : ''}</span>
                <span className="card-title">
                  {ranking.mode === 'global' && it.center
                    ? `Earth window ${fmt(Math.abs(it.center.lat), 2)}°${it.center.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(it.center.lon), 2)}°${it.center.lon >= 0 ? 'E' : 'W'}`
                    : parentName(parents, it.parent_id)}
                </span>
                {ranking.mode === 'global' && (
                  <span className="small">{it.known_analog
                    ? `Inside a well-known analog area: ${it.known_analog.name}`
                    : 'Not in our list of well-known analog sites (not a first-discovery claim)'}</span>
                )}
                <span className="card-id">{it.candidate_id}</span>
                <span className="card-score">
                  Terrain similarity index <b>{fmt(it.score, 1)}</b> <span className="muted">/ 100</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {items.length > 0 && (
        <p className="small muted">
          The index is a heuristic terrain similarity within this corpus, not a percentage of the reference
          reproduced and not a probability. The closest available window is not necessarily a suitable analog.
        </p>
      )}

      <div className="row">
        <button className="btn ghost" onClick={onBack}>Back to mission</button>
        <button className="btn primary" onClick={onNext} disabled={!selectedId}>
          {selectedId ? 'Compare tradeoffs' : 'Select a window to continue'}
        </button>
      </div>
    </div>
  );
}
