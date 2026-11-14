import { useEffect, useRef, useState } from 'react';
import { fmt } from '../format.js';
import { isMountainous } from '../analogFacts.js';
import AnalogScorecard, { scorecardSummary } from './AnalogScorecard.jsx';
import ResearchApplications, { applicationsFor, bestApplication, EXPERIMENT_APPS } from './ResearchApplications.jsx';
import SiteImagery from './SiteImagery.jsx';
import TerrainDuo from './TerrainDuo.jsx';
import EvidencePanel from './EvidencePanel.jsx';
import { ClimateChip, ScoreRing, place } from './CandidateList.jsx';

export const DOSSIER_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'similar', label: 'Similar / Different' },
  { key: 'research', label: 'Research' },
  { key: 'evidence', label: 'Measurements & sources' },
];

function Overview({ reference, candidate, rankItem, climate, experiment, onTab }) {
  const S = scorecardSummary({ reference, candidate, rankItem, climate });
  const apps = applicationsFor({ metrics: candidate?.metrics, climate, body: reference?.body });
  const best = bestApplication(apps, experiment);
  const fits = best && (EXPERIMENT_APPS[experiment?.key] || []).includes(best.key);
  return (
    <div className="dossier-overview">
      <div className="dossier-visuals">
        <SiteImagery reference={reference} candidate={candidate} />
        <TerrainDuo reference={reference} candidate={candidate} climate={climate} />
      </div>
      {S && (
        <div className="dossier-summary">
          <div className="sum-item good">
            <span className="sum-label">Similar</span>
            <span>{S.terrainSimilar} of 3 terrain metrics{S.envSimilar.length ? `, ${S.envSimilar.join(', ')}` : ''}</span>
            <button className="link-btn" onClick={() => onTab('similar')}>See the table</button>
          </div>
          <div className="sum-item bad">
            <span className="sum-label">Different</span>
            <span>{S.envDifferent.join(', ')}</span>
          </div>
          {best && (
            <div className="sum-item use">
              <span className="sum-label">Best use</span>
              <span>{best.icon} {best.title}{experiment ? (fits
                ? ` - fits your ${experiment.title.toLowerCase()}`
                : ` (no strong fit for your ${experiment.title.toLowerCase()} here)`) : ''}</span>
              <button className="link-btn" onClick={() => onTab('research')}>All applications</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Site dossier: everything about the selected Earth window in one wide, tabbed view over the globe.
 * Pure presentation of data already loaded (ranking item, candidate details, climate); no new requests
 * except the imagery and terrain-grid views it contains.
 */
export default function SiteDossier({
  reference, details, rankItem, rank, ranking, parents, climate, experiment, sources, onExplain, chatAvailable, onClose,
}) {
  const [tab, setTab] = useState('overview');
  const closeRef = useRef(null);
  const tabRefs = useRef({});
  const id = rankItem?.candidate_id;
  useEffect(() => { setTab('overview'); }, [id]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const c = details?.item;
  const onTabKey = (e) => {
    const i = DOSSIER_TABS.findIndex((t) => t.key === tab);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n === null) return;
    const next = DOSSIER_TABS[(n + DOSSIER_TABS.length) % DOSSIER_TABS.length].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section className="dossier" role="dialog" aria-modal="false" aria-labelledby="dossier-title" data-testid="site-dossier">
      <header className="dossier-head">
        <span className={`medal m${Math.min(rank, 4)}`} aria-hidden="true">{rank}</span>
        <div className="dossier-title">
          <p className="kicker">Site dossier · result #{rank}</p>
          <h2 id="dossier-title">{rankItem && ranking ? place(rankItem, ranking, parents) : id}</h2>
          <div className="chips">
            {ranking?.mode === 'global' && (
              <span className={`chip ${rankItem?.known_analog ? 'good' : 'clim'}`}>{rankItem?.known_analog
                ? `Known analog area: ${rankItem.known_analog.name}` : 'Not in our list of well-known analog sites'}</span>
            )}
            <ClimateChip climate={climate} mountainous={isMountainous(c?.metrics)} />
            <span className="chip clim mono">{id}</span>
          </div>
        </div>
        <div className="dossier-score" title="Terrain similarity index (heuristic, not a probability)">
          <ScoreRing score={rankItem?.score} />
          <span className="small muted">index / 100</span>
        </div>
        <button ref={closeRef} className="btn small ghost dossier-close" onClick={onClose} data-sound="back">✕ View on globe</button>
      </header>

      <div className="dossier-tabs" role="tablist" aria-label="Site dossier sections" onKeyDown={onTabKey}>
        {DOSSIER_TABS.map((t) => (
          <button key={t.key} ref={(n) => { tabRefs.current[t.key] = n; }} role="tab" id={`tab-${t.key}`}
            aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} tabIndex={tab === t.key ? 0 : -1}
            className={`dossier-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="dossier-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!c && !details?.error && <p className="pending"><span className="spinner" aria-hidden="true" /> Loading window details...</p>}
        {details?.error && <EvidencePanel details={details} />}
        {c && tab === 'overview' && (
          <Overview reference={reference} candidate={c} rankItem={rankItem} climate={climate} experiment={experiment} onTab={setTab} />
        )}
        {c && tab === 'similar' && (
          <AnalogScorecard reference={reference} candidate={c} rankItem={rankItem} mode={ranking?.mode} climate={climate} />
        )}
        {c && tab === 'research' && (
          <ResearchApplications candidate={c} climate={climate} body={reference?.body} experiment={experiment}
            terrainSimilar={scorecardSummary({ reference, candidate: c, rankItem, climate })?.terrainSimilar ?? 0} />
        )}
        {c && tab === 'evidence' && (
          <EvidencePanel reference={reference} details={details} sources={sources} onExplain={onExplain} chatAvailable={chatAvailable} />
        )}
        {c && (
          <p className="dossier-foot small muted">
            Terrain index {fmt(rankItem?.score, 2)} / 100 from the server (100 × (1 − D)); climate and imagery are context only.
          </p>
        )}
      </div>
    </section>
  );
}
