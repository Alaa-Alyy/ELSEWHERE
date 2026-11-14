// ============================================================================
// DEMO MOCK SERVER - stands in for Person 2's backend until it is reachable.
// Loaded ONLY when VITE_USE_FIXTURES=true (see client.js); excluded from real builds.
//
// It mimics the server side of the v2 contract (including the declared distance
// formula and 20 km diversity rule) so the UI can be exercised. The UI itself never
// scores anything: it only renders what this "server" or the real API returns.
// Every record it returns carries is_demo=true.
// ============================================================================
import { ApiError } from './errors.js';
import {
  CANDIDATES, PARENTS, REFERENCES, SOURCES, SCHEMA_VERSION, PIPELINE_VERSION,
  SCORE_VERSION, DEMO_CORPUS_VERSION,
} from './fixtures.js';

const PROFILE_DEFAULTS = { terrain_general: 0.4, slope_focus: 0.7 };
const MIN_CENTER_KM = 20;
const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 250;

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const REF = byId(REFERENCES);
const CAND = byId(CANDIDATES);
const SRC = byId(SOURCES);

function wait(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, LATENCY_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const notFound = (what) => new ApiError({ status: 404, code: 'not_found', message: what, retryable: false });
const invalid = (what) => new ApiError({ status: 422, code: 'invalid_input', message: what, retryable: false });

function effectiveWeight(profile, slopeWeight) {
  if (!(profile in PROFILE_DEFAULTS)) throw invalid(`Unknown profile "${profile}"`);
  if (slopeWeight === null || slopeWeight === undefined || slopeWeight === '') return PROFILE_DEFAULTS[profile];
  const w = Number(slopeWeight);
  if (!Number.isFinite(w) || w < 0 || w > 1) throw invalid('slope_weight must be a finite number in [0,1]');
  return w;
}

// Contract distance (server-side in the real system; Person 1's analysis.search).
function distances(e, t) {
  const dSlope = 0.5 * e.slope_histogram.reduce((s, p, i) => s + Math.abs(p - t.slope_histogram[i]), 0);
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1.0);
  return {
    slope: dSlope,
    relief: rel(e.relief_p95_p05_m, t.relief_p95_p05_m),
    variation: rel(e.local_variation_m, t.local_variation_m),
  };
}

function haversineKm(a, b) {
  const R = 6371.0088;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function reasonCodes(d, weights) {
  const contrib = Object.fromEntries(Object.keys(d).map((k) => [k, weights[k] * d[k]]));
  const sorted = Object.entries(contrib).sort((a, b) => a[1] - b[1]);
  return [`closest_on_${sorted[0][0]}`, `largest_gap_on_${sorted[sorted.length - 1][0]}`];
}

// Demo pins: synthetic, deterministic per rounded coordinate (is_demo=true).
const PINS = {};
function demoPin(body, lat, lon) {
  if (!['mars', 'moon'].includes(body)) throw invalid('body must be mars or moon');
  if (Math.abs(lat) > (body === 'mars' ? 85 : 87)) throw invalid('latitude too close to the pole');
  const la = Math.round(lat * 100) / 100;
  const lo = Math.round(((((lon + 180) % 360) + 360) % 360 - 180) * 100) / 100;
  const f = (v, p, n) => `${Math.abs(v).toFixed(2)}${v >= 0 ? p : n}`.replace('.', 'p');
  const id = `pin-${body}-${f(la, 'n', 's')}-${f(lo, 'e', 'w')}`;
  const base = REF[body === 'mars' ? 'mars-jezero' : 'moon-south-pole-sector'];
  const s = Math.abs(Math.sin(la * 12.9898 + lo * 78.233));
  const hist = base.metrics.slope_histogram.map((p, i) => p * (0.6 + 0.8 * ((s * (i + 3)) % 1)));
  const tot = hist.reduce((a, b) => a + b, 0);
  PINS[id] = {
    ...clone(base), id, name: `[DEMO] Pinned ${body} window ${la}, ${lo}`, center: { lat: la, lon: lo },
    metrics: { slope_histogram: hist.map((p) => p / tot), relief_p95_p05_m: base.metrics.relief_p95_p05_m * (0.4 + 1.2 * s),
      local_variation_m: base.metrics.local_variation_m * (0.5 + s) },
  };
  return PINS[id];
}

function rank(referenceId, profile, slopeWeight, topK, maxK = 3) {
  const ref = REF[referenceId] || PINS[referenceId];
  if (!ref) throw notFound(`Unknown reference "${referenceId}"`);
  const k = Number(topK ?? 3);
  if (!Number.isInteger(k) || k < 1 || k > maxK) throw invalid(`top_k must be an integer in 1..${maxK}`);
  const w = effectiveWeight(profile, slopeWeight);
  const weights = { slope: w, relief: (1 - w) / 2, variation: (1 - w) / 2 };

  const excluded = [];
  const scored = [];
  for (const c of CANDIDATES) {
    if (c.analysis.status !== 'valid') {
      excluded.push({ candidate_id: c.id, reason: c.limitations[c.limitations.length - 1] });
      continue;
    }
    const d = distances(c.metrics, ref.metrics);
    const D = weights.slope * d.slope + weights.relief * d.relief + weights.variation * d.variation;
    scored.push({ c, d, D });
  }
  scored.sort((a, b) => a.D - b.D || (a.c.id < b.c.id ? -1 : 1));

  const picked = [];
  for (const s of scored) {
    if (picked.length >= k) break;
    if (picked.every((p) => haversineKm(p.c.center, s.c.center) >= MIN_CENTER_KM)) picked.push(s);
  }
  const warnings = ['DEMO FIXTURE response: synthetic values, not a scientific result.'];
  if (picked.length < k) warnings.push(`Only ${picked.length} distinct result(s) satisfy the ${MIN_CENTER_KM} km separation rule.`);

  return {
    schema_version: SCHEMA_VERSION,
    reference_id: referenceId,
    profile,
    score_version: SCORE_VERSION,
    corpus_version: DEMO_CORPUS_VERSION,
    weights,
    scope: {
      planned_windows: CANDIDATES.length,
      valid_windows: scored.length,
      returned_windows: picked.length,
      min_center_distance_km: MIN_CENTER_KM,
    },
    items: picked.map(({ c, d, D }) => ({
      candidate_id: c.id,
      parent_id: c.parent_id,
      score: 100 * (1 - D),
      distances: d,
      source_ids: c.source_ids,
      reason_codes: reasonCodes(d, weights),
      limitations: c.limitations,
    })),
    excluded,
    warnings,
    _all: scored, // internal (stripped before returning)
  };
}

function publicRanking(r) {
  const { _all, ...rest } = r;
  return clone(rest);
}

function fnvHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ str.charCodeAt(str.length - 1 - i), 2246822519);
  }
  return `demo-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}

const METRIC_INFO = {
  slope: { metric: 'slope_histogram', units: 'probability per slope bin (deg edges 0,1,3,5,10,20,30,45,90)' },
  relief: { metric: 'relief_p95_p05_m', units: 'm' },
  variation: { metric: 'local_variation_m', units: 'm' },
};

const PROPOSED_TESTS = {
  terrain_general: {
    title: 'Regional terrain-planning diversity comparison',
    summary: 'Proposed (not executed): compare route-planning and traverse-scheduling exercises across the selected window and the alternative, using the same kilometre-scale slope/relief statistics as the reference.',
    requires_field_validation: true,
  },
  slope_focus: {
    title: 'Regional slope-handling comparison',
    summary: 'Proposed (not executed): compare slope-handling needs for mobility tests in the selected window against the reference slope distribution; confirm on-site slopes at metre scale before any test.',
    requires_field_validation: true,
  },
};

const MISSING_DIMENSIONS = [
  'Not established by terrain data: soil/regolith properties, temperature, illumination, ice, biology, gravity, radiation, atmosphere, site access and permits.',
  'Kilometre-scale (1000 m) statistics only; small obstacles and rocks are not represented.',
  'Closest available within this limited corpus (3 Earth parent regions), not a global best analog.',
];

function locateItem(r, id) {
  return r.items.find((i) => i.candidate_id === id) || null;
}

export const mockApi = {
  isMock: true,

  async getHealth({ signal } = {}) {
    await wait(signal);
    return { status: 'ok', schema_version: SCHEMA_VERSION, data_ready: false, chat_available: true };
  },

  async getReferences({ signal } = {}) {
    await wait(signal);
    return { schema_version: SCHEMA_VERSION, items: clone(REFERENCES) };
  },

  async getParents({ signal } = {}) {
    await wait(signal);
    return { schema_version: SCHEMA_VERSION, items: clone(PARENTS) };
  },

  async getSources({ signal } = {}) {
    await wait(signal);
    return { schema_version: SCHEMA_VERSION, items: clone(SOURCES) };
  },

  async getCandidate(id, { signal } = {}) {
    await wait(signal);
    const c = CAND[id];
    if (!c) throw notFound(`Unknown candidate "${id}"`);
    return { schema_version: SCHEMA_VERSION, item: clone(c), sources: clone(c.source_ids.map((s) => SRC[s]).filter(Boolean)) };
  },

  async getRankings({ reference_id, profile, slope_weight = null, top_k = 3 }, { signal } = {}) {
    await wait(signal);
    return publicRanking(rank(reference_id, profile, slope_weight, top_k));
  },

  async createPin({ body, lat, lon }, { signal } = {}) {
    await wait(signal);
    return { schema_version: SCHEMA_VERSION, item: clone(demoPin(body, Number(lat), Number(lon))) };
  },

  async getDiscover({ reference_id, profile, slope_weight = null, top_k = 5 }, { signal } = {}) {
    await wait(signal);
    const r = publicRanking(rank(reference_id, profile, slope_weight, top_k, 10));
    r.mode = 'global';
    r.scope.coverage = 'DEMO: 3 fixture regions stand in for Earth land';
    r.items.forEach((it) => { it.known_analog = null; it.center = CAND[it.candidate_id].center; });
    return r;
  },

  async getGlobalCandidate(id, o = {}) {
    return mockApi.getCandidate(id, o);
  },

  // DEMO climate: synthetic, clearly flagged; real values come from NASA POWER via the backend.
  async getClimate({ lat, lon }, { signal } = {}) {
    await wait(signal);
    const desertBelt = Math.abs(lat) >= 15 && Math.abs(lat) <= 38;
    const precip = desertBelt ? 120 : 820;
    return {
      schema_version: SCHEMA_VERSION,
      item: {
        lat, lon, is_demo: true,
        temperature_mean_c: desertBelt ? 24.0 : 9.0, temperature_max_c: desertBelt ? 46.0 : 31.0,
        temperature_min_c: desertBelt ? 2.0 : -18.0, precipitation_mm_per_year: precip,
        wind_speed_10m_m_s: 4.0, solar_kwh_m2_day: desertBelt ? 6.2 : 3.9,
        aridity: desertBelt ? { key: 'arid', label: 'Arid (< 250 mm/yr)' } : { key: 'wet', label: 'Wet (>= 500 mm/yr): likely vegetated' },
        source: { name: 'DEMO climate (synthetic)', datasets: ['DEMO'], period: 'n/a', resolution: 'n/a',
          kind: 'synthetic demo values, not measurements', url: 'https://power.larc.nasa.gov/' },
      },
    };
  },

  async postDecision(body, { signal } = {}) {
    await wait(signal);
    const { reference_id, profile, slope_weight = null, selected_candidate_id, alternative_candidate_id = null } = body;
    if (!selected_candidate_id) throw invalid('selected_candidate_id is required');
    if (!CAND[selected_candidate_id]) throw notFound(`Unknown candidate "${selected_candidate_id}"`);
    if (alternative_candidate_id && !CAND[alternative_candidate_id]) throw notFound(`Unknown candidate "${alternative_candidate_id}"`);
    if (alternative_candidate_id === selected_candidate_id) throw invalid('alternative must differ from the selection');
    const r = rank(reference_id, profile, slope_weight, body.mode === 'global' ? (body.top_k || 5) : 3, 10);
    const sel = locateItem(r, selected_candidate_id);
    if (!sel) throw invalid('selected candidate is not among the current distinct results');
    const alt = alternative_candidate_id ? locateItem(r, alternative_candidate_id) : null;
    if (alternative_candidate_id && !alt) throw invalid('alternative candidate is not among the current distinct results');

    const ref = REF[reference_id] || PINS[reference_id];
    const selRec = CAND[selected_candidate_id];
    const metricValue = (rec, k) => rec.metrics[METRIC_INFO[k].metric];
    const evidence = Object.keys(METRIC_INFO).map((k) => ({
      metric: METRIC_INFO[k].metric,
      units: METRIC_INFO[k].units,
      target_value: metricValue(ref, k),
      selected_value: metricValue(selRec, k),
      distance: sel.distances[k],
    }));
    const tradeoffs = alt
      ? Object.keys(METRIC_INFO).map((k) => ({
          metric: METRIC_INFO[k].metric,
          weight: r.weights[k],
          selected_distance: sel.distances[k],
          alternative_distance: alt.distances[k],
          selected_contribution: r.weights[k] * sel.distances[k],
          alternative_contribution: r.weights[k] * alt.distances[k],
        }))
      : [];
    const snapshot = {
      schema_version: SCHEMA_VERSION,
      reference_id,
      profile,
      selected_candidate_id,
      alternative_candidate_id: alt ? alternative_candidate_id : null,
      weights: r.weights,
      pipeline_version: PIPELINE_VERSION,
      score_version: SCORE_VERSION,
      corpus_version: r.corpus_version,
      evidence,
      tradeoffs,
      limitations: ['DEMO FIXTURE decision: synthetic values, not a scientific result.', ...MISSING_DIMENSIONS],
      proposed_test: PROPOSED_TESTS[profile],
      source_ids: [...new Set([...ref.source_ids, ...selRec.source_ids, ...(alt ? CAND[alternative_candidate_id].source_ids : [])])],
      search_scope: { parents: PARENTS.length, planned_windows: r.scope.planned_windows, valid_windows: r.scope.valid_windows },
    };
    return clone({
      ...snapshot,
      decision_id: fnvHash(canonical(snapshot)),
      generated_at_utc: new Date().toISOString(),
    });
  },

  async postChat(body, { signal } = {}) {
    await wait(signal);
    const { message, reference_id, profile, slope_weight = null, selected_candidate_id = null, alternative_candidate_id = null } = body;
    if (typeof message !== 'string' || !message.trim()) throw invalid('message is required');
    if (message.length > 2000) throw invalid('message must be at most 2000 characters');
    const r = rank(reference_id, profile, slope_weight, body.mode === 'global' ? (body.top_k || 5) : 3, 10);
    const sel = selected_candidate_id ? locateItem(r, selected_candidate_id) : null;
    const alt = alternative_candidate_id ? locateItem(r, alternative_candidate_id) : null;
    const f = (x) => x.toFixed(3);
    let answer = 'Demo fixture reply (template, not AI-generated). ';
    if (!sel) {
      answer += 'Select a candidate window first so I can explain it against the reference.';
    } else {
      answer += `${sel.candidate_id} has weighted distances slope ${f(r.weights.slope * sel.distances.slope)}, relief ${f(r.weights.relief * sel.distances.relief)}, variation ${f(r.weights.variation * sel.distances.variation)} (lower is closer).`;
      if (alt) {
        answer += ` The alternative ${alt.candidate_id} has slope ${f(r.weights.slope * alt.distances.slope)}, relief ${f(r.weights.relief * alt.distances.relief)}, variation ${f(r.weights.variation * alt.distances.variation)}.`;
      }
      if (/soil|temperature|thermal|ice|gravity|radiation|Ø­Ø±Ø§Ø±|ØªØ±Ø¨Ø©/i.test(message)) {
        answer += ' Terrain elevation data cannot tell us about soil, temperature, ice, gravity or radiation, so I cannot answer that from this evidence.';
      }
    }
    const ref = REF[reference_id] || PINS[reference_id];
    return {
      answer,
      candidate_ids: [sel?.candidate_id, alt?.candidate_id].filter(Boolean),
      source_ids: [...new Set([...(ref?.source_ids || []), ...(sel?.source_ids || []), ...(alt?.source_ids || [])])],
      limitations: MISSING_DIMENSIONS.slice(0, 1),
    };
  },
};
