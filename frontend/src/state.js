// Central UI state. The UI never computes scores; it stores what the API returns
// and invalidates anything that no longer matches the current settings.

export const STEPS = ['intro', 'mission', 'candidates', 'tradeoffs', 'decision'];
export const REFERENCE_FOR_BODY = { mars: 'mars-jezero', moon: 'moon-south-pole-sector' };
export const PROFILES = {
  terrain_general: { label: 'General terrain', defaultSlope: 0.4 },
  slope_focus: { label: 'Slope focus', defaultSlope: 0.7 },
};

export const SEARCH_MODES = {
  global: { label: 'Whole Earth (discovery)', topK: 5 },
  curated: { label: '3 curated regions (30 m SRTM)', topK: 3 },
};

export const initialState = {
  step: 'intro',
  body: 'mars',
  referenceId: REFERENCE_FOR_BODY.mars,
  mode: 'global',             // 'global' = search all Earth land; 'curated' = the 3 SRTMGL1 parents
  excludeKnown: false,        // global mode: skip results inside well-known analog areas
  pin: null,                  // RegionRecord measured for a user pin (null = curated reference)
  pinPending: false,
  pinError: null,
  pinSequence: 0,
  profile: 'terrain_general',
  slopeWeight: null, // null -> profile default (server returns the effective weights)
  ranking: null,
  rankingPending: false,
  rankingChange: null,
  selectionNotice: null,
  selectedCandidateId: null,
  alternativeCandidateId: null,
  candidateDetailsById: {},
  chatMessages: [],
  chatPending: false,
  chatError: null,
  decisionSnapshot: null,
  decisionPending: false,
  decisionError: null,
  loading: false,
  error: null,
  demoMode: false,
  requestSequence: 0,
  decisionSequence: 0,
  chatSequence: 0,
};

// Settings that define a ranking/decision/chat context.
export function contextKey(s) {
  return [s.mode, s.excludeKnown ? 'xk' : 'all', s.referenceId, s.profile, s.slopeWeight ?? 'default',
    s.selectedCandidateId ?? '-', s.alternativeCandidateId ?? '-'].join('|');
}

function defaultAlternative(items, selectedId) {
  if (!selectedId || !items) return null;
  const other = items.find((i) => i.candidate_id !== selectedId);
  return other ? other.candidate_id : null;
}

// Clear everything derived from the old settings (decision + chat always; ranking optionally).
function invalidate(state, { keepRanking } = {}) {
  return {
    ...state,
    ranking: keepRanking ? state.ranking : null,
    rankingChange: keepRanking ? state.rankingChange : null,
    selectedCandidateId: keepRanking ? state.selectedCandidateId : null,
    alternativeCandidateId: keepRanking ? state.alternativeCandidateId : null,
    selectionNotice: null,
    decisionSnapshot: null,
    decisionError: null,
    decisionPending: false,
    chatMessages: [],
    chatError: null,
    chatPending: false,
    decisionSequence: state.decisionSequence + 1,
    chatSequence: state.chatSequence + 1,
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_DEMO_MODE':
      return { ...state, demoMode: action.demoMode };

    case 'GO_TO_STEP':
      return { ...state, step: action.step };

    case 'SET_BODY': {
      if (action.body === state.body) return state;
      return {
        ...invalidate(state),
        body: action.body,
        referenceId: REFERENCE_FOR_BODY[action.body],
        pin: null, pinError: null, pinPending: false, pinSequence: state.pinSequence + 1,
        slopeWeight: null,
        step: state.step === 'intro' ? 'intro' : 'mission',
      };
    }

    case 'SET_MODE': {
      if (action.mode === state.mode) return state;
      // curated mode only knows the two vetted references; a pin switches back to the body's reference
      const keepPin = action.mode === 'global';
      return {
        ...invalidate(state), mode: action.mode,
        pin: keepPin ? state.pin : null,
        referenceId: keepPin && state.pin ? state.pin.id : REFERENCE_FOR_BODY[state.body],
      };
    }

    case 'SET_EXCLUDE_KNOWN':
      if (action.value === state.excludeKnown) return state;
      return { ...invalidate(state), excludeKnown: action.value };

    case 'USE_CURATED_REFERENCE':
      return { ...invalidate(state), pin: null, pinError: null, referenceId: REFERENCE_FOR_BODY[state.body] };

    case 'PIN_REQUEST':
      return { ...state, pinPending: true, pinError: null, pinSequence: action.seq };

    case 'PIN_SUCCESS':
      if (action.seq !== state.pinSequence || action.pin.body !== state.body) return state;
      return { ...invalidate(state), pinPending: false, pin: action.pin, referenceId: action.pin.id, mode: 'global' };

    case 'PIN_FAILURE':
      if (action.seq !== state.pinSequence) return state;
      return { ...state, pinPending: false, pinError: action.error };

    case 'SET_PROFILE': {
      if (action.profile === state.profile) return state;
      return { ...invalidate(state), profile: action.profile, slopeWeight: null };
    }

    case 'SET_SLOPE_WEIGHT': {
      if (action.slopeWeight === state.slopeWeight) return state;
      // Keep showing the previous ranking (marked pending) so the change can be compared.
      return { ...invalidate(state, { keepRanking: true }), slopeWeight: action.slopeWeight };
    }

    case 'RANKING_REQUEST':
      return { ...state, requestSequence: action.seq, rankingPending: true, loading: true, error: null };

    case 'RANKING_SUCCESS': {
      if (action.seq !== state.requestSequence) return state; // stale response
      const r = action.ranking;
      const items = r.items || [];
      const ids = new Set(items.map((i) => i.candidate_id));
      const prev = state.ranking;
      let rankingChange = null;
      if (prev && prev.reference_id === r.reference_id && prev.profile === r.profile && prev.weights?.slope !== r.weights?.slope) {
        const before = prev.items?.[0]?.candidate_id ?? null;
        const after = items[0]?.candidate_id ?? null;
        rankingChange = {
          previousTopId: before,
          newTopId: after,
          previousSlopeWeight: prev.weights.slope,
          newSlopeWeight: r.weights.slope,
          changed: before !== after,
        };
      }
      let selected = state.selectedCandidateId;
      let alternative = state.alternativeCandidateId;
      let selectionNotice = null;
      if (selected && !ids.has(selected)) {
        selectionNotice = `Your previous choice ${selected} is no longer among the displayed distinct results. Please choose again.`;
        selected = null;
        alternative = null;
      } else if (selected && alternative && !ids.has(alternative)) {
        alternative = defaultAlternative(items, selected);
      }
      return {
        ...state,
        ranking: r,
        rankingPending: false,
        loading: false,
        error: null,
        rankingChange,
        selectedCandidateId: selected,
        alternativeCandidateId: alternative,
        selectionNotice,
      };
    }

    case 'RANKING_FAILURE':
      if (action.seq !== state.requestSequence) return state;
      return { ...state, rankingPending: false, loading: false, error: action.error, ranking: null };

    case 'SELECT_CANDIDATE': {
      if (action.id === state.selectedCandidateId) return state;
      const items = state.ranking?.items || [];
      if (!items.some((i) => i.candidate_id === action.id)) return state;
      return {
        ...invalidate(state, { keepRanking: true }),
        selectedCandidateId: action.id,
        alternativeCandidateId: defaultAlternative(items, action.id),
        rankingChange: state.rankingChange,
      };
    }

    case 'SET_ALTERNATIVE': {
      if (action.id === state.alternativeCandidateId || action.id === state.selectedCandidateId) return state;
      return { ...invalidate(state, { keepRanking: true }), alternativeCandidateId: action.id, rankingChange: state.rankingChange };
    }

    case 'CANDIDATE_DETAILS':
      return { ...state, candidateDetailsById: { ...state.candidateDetailsById, [action.id]: action.details } };

    case 'DECISION_REQUEST':
      return { ...state, decisionPending: true, decisionError: null, decisionSequence: action.seq };

    case 'DECISION_SUCCESS':
      if (action.seq !== state.decisionSequence || action.key !== contextKey(state)) return state;
      return { ...state, decisionPending: false, decisionSnapshot: action.decision };

    case 'DECISION_FAILURE':
      if (action.seq !== state.decisionSequence) return state;
      return { ...state, decisionPending: false, decisionError: action.error };

    case 'CHAT_REQUEST':
      return {
        ...state,
        chatPending: true,
        chatError: null,
        chatSequence: action.seq,
        chatMessages: [...state.chatMessages, { role: 'user', content: action.message }],
      };

    case 'CHAT_SUCCESS':
      if (action.seq !== state.chatSequence || action.key !== contextKey(state)) return state;
      return {
        ...state,
        chatPending: false,
        chatMessages: [...state.chatMessages, { role: 'assistant', content: action.reply.answer, reply: action.reply }],
      };

    case 'CHAT_FAILURE':
      if (action.seq !== state.chatSequence) return state;
      return { ...state, chatPending: false, chatError: action.error };

    default:
      return state;
  }
}
