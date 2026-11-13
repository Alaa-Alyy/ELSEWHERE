// Links only to records present in the verified source registry; unknown IDs are shown as text.
export default function SourceList({ ids = [], sources = [], title = 'Sources' }) {
  if (!ids.length) return null;
  return (
    <div className="sources">
      <p className="small"><b>{title}</b></p>
      <ul className="small">
        {ids.map((id) => {
          const s = sources.find((x) => x.id === id);
          const safe = s?.landing_url && /^https:\/\//.test(s.landing_url);
          return (
            <li key={id}>
              {safe
                ? <a href={s.landing_url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                : <span>{id} (not in source registry)</span>}
              {s && <span className="muted"> - {s.agency}, {s.product} v{s.version}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
