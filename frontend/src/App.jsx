import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, USE_FIXTURES } from './api/client.js';
import { isAbort } from './api/errors.js';
import { contextKey, initialState, reducer } from './state.js';
import Hub from './components/Hub.jsx';
import ExperimentPicker from './components/ExperimentPicker.jsx';
import TravelOverlay from './components/TravelOverlay.jsx';
import SoundToggle from './components/SoundToggle.jsx';
import { sound, useUiSounds } from './sound.js';
import MissionControls from './components/MissionControls.jsx';
import EarthGlobe from './components/EarthGlobe.jsx';
import PlanetGlobe from './components/PlanetGlobe.jsx';
import { PLACES } from './places.js';
import { SEARCH_MODES } from './state.js';
import CandidateList from './components/CandidateList.jsx';
import SiteDossier from './components/SiteDossier.jsx';
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
  // presentation-only state (never sent to the API): experiment framing, travel cut-scene, hub entry
  const [experiment, setExperiment] = useState(null);
  const [travel, setTravel] = useState(false);
  const [hubStart, setHubStart] = useState('title');
  const autoSelectRef = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  useUiSounds();

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

  const isGlobal = state.mode === 'global';
  const discoveryOpts = (s) => (s.mode === 'global'
    ? { mode: 'global', top_k: SEARCH_MODES.global.topK, min_center_distance_km: 100, exclude_known: s.excludeKnown }
    : {});

  // ---- rankings: re-query on reference/profile/weight/mode change; ignore stale responses
  useEffect(() => {
    if (!searching) return undefined;
    const ctrl = new AbortController();
    const seq = nextSeq();
    dispatch({ type: 'RANKING_REQUEST', seq });
    const q = { reference_id: state.referenceId, profile: state.profile, slope_weight: state.slopeWeight };
    const call = state.mode === 'global'
      ? api.getDiscover({ ...q, top_k: SEARCH_MODES.global.topK, min_center_distance_km: 100, exclude_known: state.excludeKnown }, { signal: ctrl.signal })
      : api.getRankings({ ...q, top_k: 3 }, { signal: ctrl.signal });
    call
      .then((ranking) => dispatch({ type: 'RANKING_SUCCESS', seq, ranking }))
      .catch((error) => { if (!isAbort(error)) dispatch({ type: 'RANKING_FAILURE', seq, error }); });
    return () => ctrl.abort();
  }, [searching, state.referenceId, state.profile, state.slopeWeight, state.mode, state.excludeKnown]);

  // ---- pin a Moon/Mars location: measured server-side before any Earth search
  const placePin = useCallback((lat, lon) => {
    const s = stateRef.current;
    const seq = nextSeq();
    dispatch({ type: 'PIN_REQUEST', seq });
    api.createPin({ body: s.body, lat, lon })
      .then((r) => dispatch({ type: 'PIN_SUCCESS', seq, pin: r.item }))
      .catch((error) => dispatch({ type: 'PIN_FAILURE', seq, error }));
  }, []);

  // ---- candidate details (geometry, metrics, sources) for displayed results
  const itemIds = useMemo(() => (state.ranking?.items || []).map((i) => i.candidate_id), [state.ranking]);
  useEffect(() => {
    const missing = itemIds.filter((id) => !stateRef.current.candidateDetailsById[id]);
    if (!missing.length) return undefined;
    const ctrl = new AbortController();
    const fetchOne = stateRef.current.mode === 'global' ? api.getGlobalCandidate : api.getCandidate;
    missing.forEach((id) => {
      fetchOne(id, { signal: ctrl.signal })
        .then((details) => dispatch({ type: 'CANDIDATE_DETAILS', id, details }))
        .catch((error) => { if (!isAbort(error)) dispatch({ type: 'CANDIDATE_DETAILS', id, details: { error } }); });
    });
    return () => ctrl.abort();
  }, [itemIds]);

  // ---- Earth climate context per displayed window (NASA POWER via backend). Context only, never scored.
  // Requests are keyed by window id and never cancelled mid-flight (a result for an id stays valid).
  const [climateById, setClimateById] = useState({});
  const climateAsked = useRef(new Set());
  useEffect(() => {
    const items = state.ranking?.items || [];
    items.forEach((it) => {
      const id = it.candidate_id;
      const c = it.center || state.candidateDetailsById[id]?.item?.center;
      if (!c || climateAsked.current.has(id)) return;
      climateAsked.current.add(id);
      setClimateById((m) => ({ ...m, [id]: { pending: true } }));
      api.getClimate({ lat: c.lat, lon: c.lon })
        .then((r) => setClimateById((m) => ({ ...m, [id]: { item: r.item } })))
        .catch((error) => {
          climateAsked.current.delete(id);                 // allow a retry on the next result update
          setClimateById((m) => ({ ...m, [id]: { error } }));
        });
    });
  }, [state.ranking, state.candidateDetailsById]);

  const reference = state.pin && state.pin.id === state.referenceId
    ? state.pin
    : references.find((r) => r.id === state.referenceId) || null;

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
      ...discoveryOpts(s),
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
      ...discoveryOpts(s),
    })
      .then((reply) => dispatch({ type: 'CHAT_SUCCESS', seq, key, reply }))
      .catch((error) => dispatch({ type: 'CHAT_FAILURE', seq, error }));
  }, []);

  const go = (step) => dispatch({ type: 'GO_TO_STEP', step });
  const select = useCallback((id) => dispatch({ type: 'SELECT_CANDIDATE', id }), []);

  // The astronaut lands on the best match: pre-select #1 once per search (the user can pick another).
  useEffect(() => {
    const items = state.ranking?.items || [];
    if (state.step !== 'candidates' || !autoSelectRef.current || state.rankingPending || !items.length) return;
    autoSelectRef.current = false;
    if (!state.selectedCandidateId) select(items[0].candidate_id);
  }, [state.step, state.ranking, state.rankingPending, state.selectedCandidateId, select]);

  // Site dossier (wide tabbed view over the globe). Opened by the user, never automatically,
  // so the astronaut landing on #1 stays visible first.
  const [dossierOpen, setDossierOpen] = useState(false);
  const openDossier = useCallback((id) => { if (id) select(id); setDossierOpen(true); }, [select]);
  const closeDossier = useCallback(() => setDossierOpen(false), []);
  const selectAndOpen = useCallback((id) => { select(id); setDossierOpen(true); }, [select]);
  useEffect(() => { if (!['candidates', 'tradeoffs'].includes(state.step)) setDossierOpen(false); }, [state.step]);

  const startSearch = () => {
    autoSelectRef.current = true;
    setTravel(true);
    go('candidates');
  };
  const skipIntro = () => { autoSelectRef.current = true; go('candidates'); };
  const newMission = () => {
    sound.play('back');
    setExperiment(null);
    setTravel(false);
    setChatOpen(false);
    setHubStart('choose');
    autoSelectRef.current = true;
    dispatch({ type: 'NEW_MISSION' });
  };
  const pickExperiment = (e) => {
    setExperiment(e);
    dispatch({ type: 'SET_PROFILE', profile: e.profile });
  };

  // sound cues tied to real events (no sound ever changes data)
  const prevRef = useRef({});
  useEffect(() => {
    const p = prevRef.current;
    if (state.pinPending && !p.pinPending) sound.play('scan');
    if (state.pin && state.pin !== p.pin) sound.play('confirm');
    if (state.pinError && state.pinError !== p.pinError) sound.play('error');
    if (state.decisionSnapshot && state.decisionSnapshot !== p.decisionSnapshot) sound.play('success');
    if (state.error && state.error !== p.error) sound.play('error');
    prevRef.current = { pinPending: state.pinPending, pin: state.pin, pinError: state.pinError, decisionSnapshot: state.decisionSnapshot, error: state.error };
  }, [state.pinPending, state.pin, state.pinError, state.decisionSnapshot, state.error]);

  const chatAvailable = health ? health.chat_available !== false : false;
  const selectedDetails = state.selectedCandidateId ? state.candidateDetailsById[state.selectedCandidateId] : null;
  const selectedItem = (state.ranking?.items || []).find((i) => i.candidate_id === state.selectedCandidateId) || null;

  return (
    <div className="app">
      {state.demoMode && (
        <div className="demo-banner" role="status">
          <strong>DEMO DATA</strong> Synthetic fixture values for interface testing. Not scientific results.
        </div>
      )}

      <header className="topbar">
        <span className="brand" title="Exploring other worlds starts with understanding our own.">
          <span className="brand-mark" aria-hidden="true">◉</span> ELSEWHERE
          {state.step !== 'intro' && <span className="brand-tagline">Exploring other worlds starts with understanding our own.</span>}
        </span>
        {state.step !== 'intro' && <ProgressSteps step={state.step} onGo={go} canGo={{
          candidates: true,
          tradeoffs: !!state.selectedCandidateId,
          decision: !!state.selectedCandidateId,
        }} />}
        <span className="topbar-right">
          {state.step !== 'intro' && (
            <button className="btn small ghost" onClick={newMission} data-silent>🚀 New mission</button>
          )}
          <SoundToggle />
        </span>
      </header>

      {state.step === 'intro' && (
        <Hub
          key={hubStart}
          startAt={hubStart}
          onSkip={skipIntro}
          onPick={(body) => { dispatch({ type: 'SET_BODY', body }); go('mission'); }}
        />
      )}

      {state.step !== 'intro' && (
      <main className="layout">
        {state.step === 'mission' ? (
          <section className="globe-area" aria-label={`${state.body} globe`}>
            <PlanetGlobe
              key={state.body}
              body={state.body}
              pin={state.pin || (reference?.body === state.body ? reference : null)}
              markers={PLACES[state.body]}
              onPick={placePin}
              disabled={state.pinPending}
              scanning={state.pinPending}
            />
          </section>
        ) : (
          <section className="globe-area" aria-label="Earth globe">
            <EarthGlobe
              parents={isGlobal ? [] : parents}
              items={searching ? state.ranking?.items || [] : []}
              detailsById={state.candidateDetailsById}
              selectedId={state.selectedCandidateId}
              alternativeId={state.alternativeCandidateId}
              onSelect={select}
              landOn={travel ? null : state.selectedCandidateId}
              onLanded={() => sound.play('land')}
            />
            {dossierOpen && selectedItem && ['candidates', 'tradeoffs'].includes(state.step) && (
              <SiteDossier
                reference={reference}
                details={selectedDetails}
                rankItem={selectedItem}
                rank={(state.ranking?.items || []).findIndex((i) => i.candidate_id === state.selectedCandidateId) + 1}
                ranking={state.ranking}
                parents={parents}
                climate={climateById[state.selectedCandidateId]}
                experiment={experiment}
                sources={sources}
                onExplain={() => setChatOpen(true)}
                chatAvailable={chatAvailable}
                onClose={closeDossier}
              />
            )}
          </section>
        )}

        {state.step !== 'intro' && (
          <aside className="side-panel" aria-live="polite">
            {bootError && <p className="error" role="alert">Could not load the mission registry: {bootError.message}</p>}

            {state.step === 'mission' && (
              <MissionControls
                body={state.body}
                profile={state.profile}
                mode={state.mode}
                excludeKnown={state.excludeKnown}
                reference={reference}
                pin={state.pin}
                pinPending={state.pinPending}
                pinError={state.pinError}
                sources={sources}
                onBody={(body) => dispatch({ type: 'SET_BODY', body })}
                onProfile={(profile) => dispatch({ type: 'SET_PROFILE', profile })}
                onMode={(mode) => dispatch({ type: 'SET_MODE', mode })}
                onExcludeKnown={(value) => dispatch({ type: 'SET_EXCLUDE_KNOWN', value })}
                onPlace={placePin}
                onUseCurated={() => dispatch({ type: 'USE_CURATED_REFERENCE' })}
                onSearch={startSearch}
                experiment={experiment}
                onChangeExperiment={() => setExperiment(null)}
              />
            )}

            {state.step === 'candidates' && (
              <>
                <CandidateList
                  experiment={experiment}
                  climateById={climateById}
                  detailsById={state.candidateDetailsById}
                  ranking={state.ranking}
                  pending={state.rankingPending}
                  error={state.error}
                  parents={parents}
                  selectedId={state.selectedCandidateId}
                  notice={state.selectionNotice}
                  onSelect={selectAndOpen}
                  onOpenDossier={openDossier}
                  onBack={() => go('mission')}
                  onNext={() => go('tradeoffs')}
                />
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
                {state.selectedCandidateId && (
                  <button className="btn small primary open-dossier" onClick={() => openDossier(state.selectedCandidateId)} data-sound="open">
                    📂 Open the selected site's dossier
                  </button>
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
                experiment={experiment}
                onNewMission={newMission}
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
      )}

      {state.step === 'mission' && !experiment && (
        <ExperimentPicker body={state.body} onChoose={pickExperiment} />
      )}
      {travel && state.step === 'candidates' && (
        <TravelOverlay from={state.body} onDone={() => setTravel(false)} />
      )}
    </div>
  );
}
