const LABELS = [
  ['mission', 'Mission'],
  ['candidates', 'Candidates'],
  ['tradeoffs', 'Tradeoffs'],
  ['decision', 'Decision'],
];

export default function ProgressSteps({ step, onGo, canGo }) {
  const current = LABELS.findIndex(([k]) => k === step);
  return (
    <nav aria-label="Journey progress">
      <ol className="progress">
        {LABELS.map(([key, label], i) => {
          const enabled = key === 'mission' || canGo[key];
          return (
            <li key={key} className={i === current ? 'current' : i < current ? 'done' : ''}>
              <button
                className="progress-btn"
                onClick={() => onGo(key)}
                disabled={!enabled}
                aria-current={i === current ? 'step' : undefined}
              >
                <span className="progress-num">{i + 1}</span> {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
