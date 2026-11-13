import { describe, it, expect } from 'vitest';
import { reducer, initialState, contextKey } from '../../frontend/src/state.js';

const item = (id) => ({ candidate_id: id, parent_id: 'earth-khaybar', score: 80, distances: { slope: 0.1, relief: 0.2, variation: 0.3 } });
const ranking = (ids, slope = 0.4, ref = 'mars-jezero') => ({
  reference_id: ref, profile: 'terrain_general', weights: { slope, relief: (1 - slope) / 2, variation: (1 - slope) / 2 },
  items: ids.map(item), scope: {},
});
const run = (s, ...actions) => actions.reduce(reducer, s);

describe('stale-response protection', () => {
  it('ignores an older ranking response that arrives after a newer request', () => {
    let s = run(initialState, { type: 'RANKING_REQUEST', seq: 1 }, { type: 'RANKING_REQUEST', seq: 2 });
    s = reducer(s, { type: 'RANKING_SUCCESS', seq: 1, ranking: ranking(['earth-old-r00-c00']) });
    expect(s.ranking).toBeNull();
    s = reducer(s, { type: 'RANKING_SUCCESS', seq: 2, ranking: ranking(['earth-new-r00-c00']) });
    expect(s.ranking.items[0].candidate_id).toBe('earth-new-r00-c00');
  });

  it('drops a decision response whose settings no longer match', () => {
    let s = run(initialState,
      { type: 'RANKING_REQUEST', seq: 1 },
      { type: 'RANKING_SUCCESS', seq: 1, ranking: ranking(['earth-a-r00-c00', 'earth-b-r00-c00']) },
      { type: 'SELECT_CANDIDATE', id: 'earth-a-r00-c00' });
    const key = contextKey(s);
    s = reducer(s, { type: 'DECISION_REQUEST', seq: 7 });
    s = reducer(s, { type: 'SET_SLOPE_WEIGHT', slopeWeight: 0.9 });
    s = reducer(s, { type: 'DECISION_SUCCESS', seq: 7, key, decision: { decision_id: 'x' } });
    expect(s.decisionSnapshot).toBeNull();
  });
});

describe('invalidation', () => {
  const base = () => run(initialState,
    { type: 'RANKING_REQUEST', seq: 1 },
    { type: 'RANKING_SUCCESS', seq: 1, ranking: ranking(['earth-a-r00-c00', 'earth-b-r00-c00']) },
    { type: 'SELECT_CANDIDATE', id: 'earth-a-r00-c00' });

  it('selecting sets the next distinct result as default alternative', () => {
    expect(base().alternativeCandidateId).toBe('earth-b-r00-c00');
  });

  it('switching Mars -> Moon clears ranking, selection, decision and chat', () => {
    let s = { ...base(), decisionSnapshot: { decision_id: 'mars' }, chatMessages: [{ role: 'assistant', content: 'mars' }] };
    s = reducer(s, { type: 'SET_BODY', body: 'moon' });
    expect(s.referenceId).toBe('moon-south-pole-sector');
    expect(s.ranking).toBeNull();
    expect(s.selectedCandidateId).toBeNull();
    expect(s.decisionSnapshot).toBeNull();
    expect(s.chatMessages).toEqual([]);
  });

  it('clears the selection (and asks again) if it disappears after a weight change', () => {
    let s = reducer(base(), { type: 'SET_SLOPE_WEIGHT', slopeWeight: 1 });
    s = run(s, { type: 'RANKING_REQUEST', seq: 2 },
      { type: 'RANKING_SUCCESS', seq: 2, ranking: ranking(['earth-c-r00-c00'], 1) });
    expect(s.selectedCandidateId).toBeNull();
    expect(s.selectionNotice).toMatch(/choose again/);
  });

  it('reports an unchanged winner honestly', () => {
    let s = reducer(base(), { type: 'SET_SLOPE_WEIGHT', slopeWeight: 0 });
    s = run(s, { type: 'RANKING_REQUEST', seq: 2 },
      { type: 'RANKING_SUCCESS', seq: 2, ranking: ranking(['earth-a-r00-c00', 'earth-b-r00-c00'], 0) });
    expect(s.rankingChange).toMatchObject({ changed: false, newSlopeWeight: 0, previousSlopeWeight: 0.4 });
    expect(s.selectedCandidateId).toBe('earth-a-r00-c00');
  });

  it('slope weight 0 is kept as 0 (not treated as default)', () => {
    const s = reducer(base(), { type: 'SET_SLOPE_WEIGHT', slopeWeight: 0 });
    expect(s.slopeWeight).toBe(0);
  });
});
