import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, USE_FIXTURES } from './api/client.js';
import { isAbort } from './api/errors.js';
import { contextKey, initialState, reducer } from './state.js';
import Intro from './components/Intro.jsx';
import MissionControls from './components/MissionControls.jsx';
import EarthGlobe from './components/EarthGlobe.jsx';
import CandidateList from './components/CandidateList.jsx';
import EvidencePanel from './components/EvidencePanel.jsx';
import TradeoffPanel from './components/TradeoffPanel.jsx';
import DecisionBrief from './components/DecisionBrief.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ProgressSteps from './components/ProgressSteps.jsx';

let seqCounter = 1000;
const nextSeq = () => ++seqCounter;

export default function App() {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    demoMode: USE_FIXTURES,
    // "#explore" deep link = the skip-intro path (useful for demos).
    step: typeof window !== 'undefined' && window.location.hash === '#explore' ? 'candidates' : 'intro',
  });
  const [references, setReferences] = useState([]);
  const [parents, setParents] = useState([]);
  const [sources, setSources] = useState([]);
  const [health, setHealth] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- one-time load of small registries
  useEffect(() => {
    const ctrl = new AbortController();
    const o = { signal: ctrl.signal };
    Promise.all([api.getHealth(o), api.getReferences(o), api.getParents(o), api.getSources(o)])
      .then(([h, r, p, s]) => {
        setHealth(h);
        setReferences(r.items || []);
        setParents(p.items || []);
        setSources(s.items || []);
        const demo = USE_FIXTURES || (r.items || []).some((x) => x.analysis?.is_demo);
        dispatch({ type: 'SET_DEMO_MODE', demoMode: demo });
      })
      .catch((err) => { if (!isAbort(err)) setBootError(err); });
    return () => ctrl.abort();
  }, []);

  const searching = ['candidates', 'tradeoffs', 'decision'].includes(state.step);

  // ---- rankings: re-query on reference/profile/weight change; ignore stale responses
  useEffect(() => {
    if (!searching) return undefined;
    const ctrl = new AbortController();
    const seq = nextSeq();
    dispatch({ type: 'RANKING_REQUEST', seq });
    api.getRankings(
      { reference_id: state.referenceId, profile: state.profile, slope_weight: state.slopeWeight, top_k: 3 },
      { signal: ctrl.signal },
    )
      .then((ranking) => dispatch({ type: 'RANKING_SUCCESS', seq, ranking }))
      .catch((error) => { if (!isAbort(error)) dispatch({ type: 'RANKING_FAILURE', seq, error }); });
    return () => ctrl.abort();
  }, [searching, state.referenceId, state.profile, state.slopeWeight]);

  // ---- candidate details (geometry, metrics, sources) for displayed results
  const itemIds = useMemo(() => (state.ranking?.items || []).map((i) => i.candidate_id), [state.ranking]);
  useEffect(() => {
    const missing = itemIds.filter((id) => !stateRef.current.candidateDetailsById[id]);
    if (!missing.length) return undefined;
    const ctrl = new AbortController();
    missing.forEach((id) => {
      api.getCandidate(id, { signal: ctrl.signal })
        .then((details) => dispatch({ type: 'CANDIDATE_DETAILS', id, details }))
        .catch((error) => { if (!isAbort(error)) dispatch({ type: 'CANDIDATE_DETAILS', id, details: { error } }); });
    });
    return () => ctrl.abort();
  }, [itemIds]);

  const reference = references.find((r) => r.id === state.referenceId) || null;

  const confirmDecision = useCallback(() => {
    const s = stateRef.current;
    if (!s.selectedCandidateId) return;
    const seq = nextSeq();
    const key = contextKey(s);
    dispatch({ type: 'DECISION_REQUEST', seq });
    api.postDecision({
      reference_id: s.referenceId,
      profile: s.profile,
      slope_weight: s.slopeWeight,
      selected_candidate_id: s.selectedCandidateId,
      alternative_candidate_id: s.alternativeCandidateId,
    })
      .then((decision) => dispatch({ type: 'DECISION_SUCCESS', seq, key, decision }))
      .catch((error) => dispatch({ type: 'DECISION_FAILURE', seq, error }));
  }, []);

  const sendChat = useCallback((message) => {
    const s = stateRef.current;
    const seq = nextSeq();
    const key = contextKey(s);
    const history = s.chatMessages.slice(-6).map(({ role, content }) => ({ role, content }));
    dispatch({ type: 'CHAT_REQUEST', seq, message });
    api.postChat({
      message,
      reference_id: s.referenceId,
      profile: s.profile,
      slope_weight: s.slopeWeight,
      selected_candidate_id: s.selectedCandidateId,
      alternative_candidate_id: s.alternativeCandidateId,
      history,
    })
      .then((reply) => dispatch({ type: 'CHAT_SUCCESS', seq, key, reply }))
      .catch((error) => dispatch({ type: 'CHAT_FAILURE', seq, error }));
  }, []);

  const go = (step) => dispatch({ type: 'GO_TO_STEP', step });
  const select = useCallback((id) => dispatch({ type: 'SELECT_CANDIDATE', id }), []);

  const chatAvailable = health ? health.chat_available !== false : false;
  const selectedDetails = state.selectedCandidateId ? state.candidateDetailsById[state.selectedCandidateId] : null;

  return (
    <div className="app">
      {state.demoMode && (
        <div className="demo-banner" role="status">
          <strong>DEMO DATA</strong> Synthetic fixture values for interface testing. Not scientific results.
        </div>
      )}

      <header className="topbar">
        <span className="brand">MissionMatch</span>
        {state.step !== 'intro' && <ProgressSteps step={state.step} onGo={go} canGo={{
          candidates: true,
          tradeoffs: !!state.selectedCandidateId,
          decision: !!state.selectedCandidateId,
        }} />}
      </header>

      <main className={`layout ${state.step === 'intro' ? 'no-panel' : ''}`}>
        <section className="globe-area" aria-label="Earth globe">
          <EarthGlobe
            parents={parents}
            items={searching ? state.ranking?.items || [] : []}
            detailsById={state.candidateDetailsById}
            selectedId={state.selectedCandidateId}
            alternativeId={state.alternativeCandidateId}
            onSelect={select}
          />
        </section>

        {state.step !== 'intro' && (
          <aside className="side-panel" aria-live="polite">
            {bootError && <p className="error" role="alert">Could not load the mission registry: {bootError.message}</p>}

            {state.step === 'mission' && (
              <MissionControls
                body={state.body}
                profile={state.profile}
                reference={reference}
                sources={sources}
                onBody={(body) => dispatch({ type: 'SET_BODY', body })}
                onProfile={(profile) => dispatch({ type: 'SET_PROFILE', profile })}
                onSearch={() => go('candidates')}
              />
            )}

            {state.step === 'candidates' && (
              <>
                <CandidateList
                  ranking={state.ranking}
                  pending={state.rankingPending}
                  error={state.error}
                  parents={parents}
                  selectedId={state.selectedCandidateId}
                  notice={state.selectionNotice}
                  onSelect={select}
                  onBack={() => go('mission')}
                  onNext={() => go('tradeoffs')}
                />
                {selectedDetails && (
                  <EvidencePanel reference={reference} details={selectedDetails} sources={sources}
                    onExplain={() => setChatOpen(true)} chatAvailable={chatAvailable} />
                )}
              </>
            )}

            {state.step === 'tradeoffs' && (
              <>
                <TradeoffPanel
                  ranking={state.ranking}
                  pending={state.rankingPending}
                  error={state.error}
                  profile={state.profile}
                  slopeWeight={state.slopeWeight}
                  selectedId={state.selectedCandidateId}
                  alternativeId={state.alternativeCandidateId}
                  rankingChange={state.rankingChange}
                  notice={state.selectionNotice}
                  onSlopeWeight={(w) => dispatch({ type: 'SET_SLOPE_WEIGHT', slopeWeight: w })}
                  onAlternative={(id) => dispatch({ type: 'SET_ALTERNATIVE', id })}
                  onSelect={select}
                  onBack={() => go('candidates')}
                  onNext={() => go('decision')}
                />
                {selectedDetails && (
                  <EvidencePanel reference={reference} details={selectedDetails} sources={sources}
                    onExplain={() => setChatOpen(true)} chatAvailable={chatAvailable} />
                )}
              </>
            )}

            {state.step === 'decision' && (
              <DecisionBrief
                state={state}
                reference={reference}
                sources={sources}
                onConfirm={confirmDecision}
                onBack={() => go('tradeoffs')}
              />
            )}

            {chatOpen && state.step !== 'mission' && (
              <ChatPanel
                available={chatAvailable}
                messages={state.chatMessages}
                pending={state.chatPending}
                error={state.chatError}
                sources={sources}
                context={{
                  referenceId: state.referenceId,
                  profile: state.profile,
                  weights: state.ranking?.weights,
                  selectedId: state.selectedCandidateId,
                  alternativeId: state.alternativeCandidateId,
                }}
                onSend={sendChat}
                onClose={() => setChatOpen(false)}
              />
            )}
          </aside>
        )}
      </main>

      {state.step === 'intro' && (
        <Intro onStart={() => go('mission')} onSkip={() => go('candidates')} />
      )}
    </div>
  );
}
