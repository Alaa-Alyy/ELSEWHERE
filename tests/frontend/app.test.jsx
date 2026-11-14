import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Cesium needs WebGL; replace the globe with a probe that exposes the IDs it would draw.
vi.mock('../../frontend/src/components/EarthGlobe.jsx', () => ({
  default: ({ items, selectedId, onSelect }) => (
    <div data-testid="globe" data-ids={items.map((i) => i.candidate_id).join(',')} data-selected={selectedId || ''}>
      {items.map((i) => (
        <button key={i.candidate_id} data-testid={`marker-${i.candidate_id}`} onClick={() => onSelect(i.candidate_id)}>marker</button>
      ))}
    </div>
  ),
}));

vi.mock('../../frontend/src/components/PlanetGlobe.jsx', () => ({
  default: ({ body, onPick }) => (
    <div data-testid="planet-globe" data-body={body}>
      <button data-testid="planet-click" onClick={() => onPick(-4.6, 137.4)}>click planet</button>
    </div>
  ),
}));

// three.js scenes need WebGL too: the hub "jump" and the travel cut-scene finish immediately.
vi.mock('../../frontend/src/components/SpaceScene.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    default: ({ jumpTo, onJumpDone }) => {
      useEffect(() => { if (jumpTo) onJumpDone(jumpTo); }, [jumpTo]);
      return <div data-testid="space-scene" />;
    },
  };
});
vi.mock('../../frontend/src/components/TravelOverlay.jsx', async () => {
  const { useEffect } = await import('react');
  return { default: ({ onDone }) => { useEffect(() => { onDone(); }, []); return null; } };
});

vi.mock('../../frontend/src/components/TerrainScene.jsx', async () => {
  const actual = await vi.importActual('../../frontend/src/components/TerrainScene.jsx');
  return { ...actual, default: ({ left, right }) => (
    <div data-testid="terrain-scene" data-cells={`${left.size}x${right.size}`} data-bodies={`${left.body},${right.body}`} />
  ) };
});

import App from '../../frontend/src/App.jsx';
import { mockApi } from '../../frontend/src/api/mockClient.js';

const cardIds = () => [...document.querySelectorAll('[data-candidate-id]')].map((b) => b.dataset.candidateId);

// Hub -> destination -> experiment question -> mission screen (same actions as before, new presentation).
async function startMission(body = 'Mars', experiment = 'Field geology training') {
  await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
  await userEvent.click(screen.getByRole('button', { name: `Go to ${body}` }));
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(experiment) }));
}

// Results details live in the site dossier (tabs) over the globe.
async function openDossier(tab = 'Overview') {
  await userEvent.click(await screen.findByRole('button', { name: /Open site dossier/ }));
  const dossier = await screen.findByTestId('site-dossier');
  await userEvent.click(within(dossier).getByRole('tab', { name: tab }));
  return dossier;
}

describe('story entry', () => {
  it('shows the exact opening sentence, question and CTA on entry', () => {
    render(<App />);
    expect(screen.getByText('Exploring other worlds starts with understanding our own.')).toBeInTheDocument();
    expect(screen.getByText('Before we explore the Moon and Mars, where on Earth can we prepare?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find our next training ground' })).toBeInTheDocument();
  });

  it('skip path reaches functional candidate controls immediately', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
  });

  it('shows a visible demo-data banner in fixture mode', () => {
    render(<App />);
    expect(screen.getByText('DEMO DATA')).toBeInTheDocument();
  });
});

describe('fixture journey', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mission -> candidates -> tradeoffs -> decision with consistent IDs', async () => {
    const rankSpy = vi.spyOn(mockApi, 'getRankings');
    const decSpy = vi.spyOn(mockApi, 'postDecision');
    render(<App />);
    await startMission('Mars');
    await userEvent.click(screen.getByRole('radio', { name: /3 curated regions/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Search the 3 curated regions' }));

    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    expect(rankSpy.mock.calls.at(-1)[0]).toMatchObject({ reference_id: 'mars-jezero', profile: 'terrain_general', top_k: 3 });

    // cards and globe markers show the same IDs, at most 3
    const ids = cardIds();
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(screen.getByTestId('globe').dataset.ids).toBe(ids.join(','));
    expect(screen.getByTestId('scope')).toHaveTextContent(/not the whole Earth/);

    // selecting a marker selects the same card
    await userEvent.click(screen.getByTestId(`marker-${ids[1]}`));
    expect(document.querySelector(`[data-candidate-id="${ids[1]}"]`)).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Compare tradeoffs' }));
    expect(screen.getByText('Why this location? Why not the alternative?')).toBeInTheDocument();
    expect(screen.getByTestId('explanation')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Go to decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm my choice' }));
    const record = await screen.findByTestId('decision-record');
    expect(within(record).getByText(ids[1])).toBeInTheDocument(); // non-rank-one choice preserved

    // only IDs/settings are sent, never scores
    const body = decSpy.mock.calls.at(-1)[0];
    expect(Object.keys(body).sort()).toEqual(['alternative_candidate_id', 'profile', 'reference_id', 'selected_candidate_id', 'slope_weight']);
    expect(body.selected_candidate_id).toBe(ids[1]);
  });

  it('Moon requests the lunar reference', async () => {
    const rankSpy = vi.spyOn(mockApi, 'getRankings');
    render(<App />);
    await startMission('Moon');
    await userEvent.click(screen.getByRole('radio', { name: /3 curated regions/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Search the 3 curated regions' }));
    await waitFor(() => expect(rankSpy).toHaveBeenCalled());
    expect(rankSpy.mock.calls.at(-1)[0].reference_id).toBe('moon-south-pole-sector');
  });

  it('slope slider makes a real (debounced) request with the new weight', async () => {
    const rankSpy = vi.spyOn(mockApi, 'getDiscover');   // skip path = global discovery by default
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    await userEvent.click(document.querySelector('[data-candidate-id]'));
    await userEvent.click(screen.getByRole('button', { name: 'Compare tradeoffs' }));

    fireEvent.change(screen.getByLabelText(/Slope priority/), { target: { value: '0' } });
    await waitFor(() => expect(rankSpy.mock.calls.at(-1)[0].slope_weight).toBe(0), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText(/Effective weights from the server: slope 0.00/)).toBeInTheDocument());
    expect(screen.getByTestId('ranking-change')).toBeInTheDocument();
  });
});

describe('discovery: pin anywhere, search all Earth', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('a globe click measures the pin BEFORE searching, then searches globally with the pin', async () => {
    const pinSpy = vi.spyOn(mockApi, 'createPin');
    const discSpy = vi.spyOn(mockApi, 'getDiscover');
    const decSpy = vi.spyOn(mockApi, 'postDecision');
    render(<App />);
    await startMission('Mars');
    expect(screen.getByTestId('planet-globe').dataset.body).toBe('mars');
    await userEvent.click(screen.getByTestId('planet-click'));
    await waitFor(() => expect(pinSpy).toHaveBeenCalledWith({ body: 'mars', lat: -4.6, lon: 137.4 }));
    expect(await screen.findByTestId('fingerprint')).toHaveTextContent(/Relief/);
    expect(discSpy).not.toHaveBeenCalled();                     // nothing searched yet

    await userEvent.click(screen.getByRole('button', { name: 'Search all Earth land' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    const q = discSpy.mock.calls.at(-1)[0];
    expect(q.reference_id).toBe('pin-mars-4p60s-137p40e');
    expect(q).toMatchObject({ top_k: 5, min_center_distance_km: 100, exclude_known: false });
    expect(cardIds().length).toBeLessThanOrEqual(5);

    await userEvent.click(document.querySelector('[data-candidate-id]'));
    await userEvent.click(screen.getByRole('button', { name: 'Compare tradeoffs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go to decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm my choice' }));
    await screen.findByTestId('decision-record');
    expect(decSpy.mock.calls.at(-1)[0]).toMatchObject({ mode: 'global', reference_id: 'pin-mars-4p60s-137p40e', top_k: 5 });
  });

  it('a named place pins too, and switching body clears the pin', async () => {
    const pinSpy = vi.spyOn(mockApi, 'createPin');
    render(<App />);
    await startMission('Moon');
    await userEvent.click(screen.getByRole('button', { name: 'Tycho crater' }));
    await waitFor(() => expect(pinSpy).toHaveBeenCalledWith({ body: 'moon', lat: -43.3, lon: -11.2 }));
    expect(await screen.findByText(/Pinned moon window/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Mars/ }));
    expect(screen.queryByText(/Pinned moon window/)).toBeNull();
  });

  it('curated mode refuses a pin (only vetted references)', async () => {
    render(<App />);
    await startMission('Mars');
    await userEvent.click(screen.getByTestId('planet-click'));
    await screen.findByTestId('fingerprint');
    await userEvent.click(screen.getByRole('radio', { name: /3 curated regions/ }));
    expect(screen.getByRole('button', { name: 'Search the 3 curated regions' })).not.toBeDisabled();
    expect(screen.queryByText(/Pinned mars window/)).toBeNull();   // switched back to the vetted reference
  });
});

describe('cinematic journey (presentation only, same API calls)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('the experiment question only chooses an existing profile', async () => {
    const discSpy = vi.spyOn(mockApi, 'getDiscover');
    render(<App />);
    await startMission('Mars', 'Rover test drive');
    expect(screen.getByRole('radio', { name: /Slope focus/ })).toBeChecked();
    await userEvent.click(screen.getByTestId('planet-click'));
    await screen.findByTestId('fingerprint');
    await userEvent.click(screen.getByRole('button', { name: 'Search all Earth land' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    const q = discSpy.mock.calls.at(-1)[0];
    expect(q.profile).toBe('slope_focus');
    expect(Object.keys(q).sort()).toEqual(['exclude_known', 'min_center_distance_km', 'profile', 'reference_id', 'slope_weight', 'top_k']);
  });

  it('the astronaut lands on the best match: #1 is pre-selected, another can be chosen', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(1));
    const ids = cardIds();
    await waitFor(() => expect(screen.getByTestId('globe').dataset.selected).toBe(ids[0]));
    await userEvent.click(document.querySelector(`[data-candidate-id="${ids[1]}"]`));
    expect(screen.getByTestId('globe').dataset.selected).toBe(ids[1]);
  });

  it('"New mission" returns to the destination choice with a clean slate', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: /New mission/ }));
    expect(screen.getByText('Choose your destination')).toBeInTheDocument();
    expect(cardIds()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Go to Moon' }));
    expect(await screen.findByText(/What experiment will you run/)).toBeInTheDocument();
  });

  it('scorecard: what is similar (measured terrain + server distances) and what is different', async () => {
    const discSpy = vi.spyOn(mockApi, 'getDiscover');
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await openDossier('Similar / Different');
    const card = await screen.findByTestId('analog-scorecard');
    const item = (await discSpy.mock.results.at(-1).value).items[0];
    // terrain distances shown are exactly the server's
    expect(card).toHaveTextContent(`distance ${item.distances.relief.toFixed(3)}`);
    expect(card).toHaveTextContent(/Slope mix/);
    expect(card).toHaveTextContent(/0\.38 g/);                 // Mars gravity, body-wide fact
    expect(within(card).getByText('Day length').closest('tr')).toHaveTextContent('Similar');
    expect(within(card).getByText('Gravity').closest('tr')).toHaveTextContent('Different');
    expect(card).toHaveTextContent(/Not assessed in this version/);
  });

  it('climate: one NASA POWER request per result, shown on cards and in the scorecard, never sent back', async () => {
    const climSpy = vi.spyOn(mockApi, 'getClimate');
    const decSpy = vi.spyOn(mockApi, 'postDecision');
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    await waitFor(() => expect(climSpy).toHaveBeenCalledTimes(cardIds().length));
    expect(await screen.findAllByText(/mm\/yr/)).not.toHaveLength(0);
    await openDossier('Similar / Different');
    const card = await screen.findByTestId('analog-scorecard');
    await waitFor(() => expect(within(card).getByText('Dryness')).toBeInTheDocument());
    expect(card).toHaveTextContent(/DEMO values/);                 // fixture climate is labelled
    expect(within(card).getByText('Temperature').closest('tr')).toHaveTextContent('Different');
    // decision request is unchanged: no climate fields
    await userEvent.click(screen.getByRole('button', { name: 'Compare tradeoffs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go to decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm my choice' }));
    await screen.findByTestId('decision-record');
    expect(JSON.stringify(decSpy.mock.calls.at(-1)[0])).not.toMatch(/climate|precip|aridity/);
  });

  it('dryness verdict: arid/wet, and "uncertain" over steep mountains (coarse climate grid)', async () => {
    const { drynessVerdict, isMountainous } = await import('../../frontend/src/analogFacts.js');
    expect(drynessVerdict('arid').key).toBe('similar');
    expect(drynessVerdict('wet').key).toBe('different');
    expect(drynessVerdict('semi_arid').key).toBe('partly');
    expect(drynessVerdict('wet', true, 749).label).toBe('Uncertain (mountains)');   // Puna-like mixed cell
    expect(drynessVerdict('wet', true, 2560).key).toBe('different');               // too wet to be a mix-up
    expect(drynessVerdict('arid', true, 120).key).toBe('similar');
    expect(drynessVerdict(undefined).key).toBe('na');                 // missing data is not "dry"
    expect(isMountainous({ relief_p95_p05_m: 2349 })).toBe(true);
    expect(isMountainous({ relief_p95_p05_m: 674 })).toBe(false);
    expect(isMountainous(undefined)).toBe(false);
  });

  it('climate failure shows a notice and leaves results intact', async () => {
    vi.spyOn(mockApi, 'getClimate').mockRejectedValue(Object.assign(new Error('down'), { code: 'climate_unavailable', retryable: true }));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    await openDossier('Similar / Different');
    const card = await screen.findByTestId('analog-scorecard');
    await waitFor(() => expect(card).toHaveTextContent(/Climate unavailable/));
    expect(card).toHaveTextContent(/Very similar|Similar|Partly similar|Different/);
  });

  it('scores show two decimals and a "why so high" explanation, exactly the server value', async () => {
    const discSpy = vi.spyOn(mockApi, 'getDiscover');
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
    const item = (await discSpy.mock.results.at(-1).value).items[0];
    const first = document.querySelector(`[data-candidate-id="${item.candidate_id}"]`);
    expect(first).toHaveTextContent(`Terrain similarity index ${item.score.toFixed(2)} / 100`);
    expect(first.querySelector('.ring-num').textContent).toBe(item.score.toFixed(2));
    const why = screen.getByTestId('why-high');
    expect(why).toHaveTextContent(/100 × \(1 − D\)/);
    expect(why).toHaveTextContent(/not a percentage or a probability/);
  });

  it('research applications cite measured numbers and keep accessibility/validation "not assessed"', async () => {
    const { applicationsFor } = await import('../../frontend/src/components/ResearchApplications.jsx');
    const flat = { slope_histogram: [0.5, 0.3, 0.1, 0.1, 0, 0, 0, 0], relief_p95_p05_m: 120, local_variation_m: 2 };
    const steep = { slope_histogram: [0.02, 0.05, 0.08, 0.3, 0.35, 0.15, 0.05, 0], relief_p95_p05_m: 2200, local_variation_m: 25 };
    const keys = (m) => applicationsFor({ metrics: m, body: 'mars' }).map((a) => a.key);
    expect(keys(flat)).toEqual(expect.arrayContaining(['rover', 'eva', 'landing', 'rs']));
    expect(keys(flat)).not.toContain('slopes');
    expect(keys(steep)).toEqual(expect.arrayContaining(['slopes', 'nav', 'rs']));
    expect(keys(steep)).not.toContain('landing');
    expect(applicationsFor({ metrics: flat, body: 'mars' }).find((a) => a.key === 'rover').why).toMatch(/90% of the window is under 5°/);
    const { bestApplication } = await import('../../frontend/src/components/ResearchApplications.jsx');
    const appsFlat = applicationsFor({ metrics: flat, body: 'mars' });
    expect(bestApplication(appsFlat, { key: 'geology' }).key).toBe('rs');       // matches the experiment, not just #1
    expect(bestApplication(appsFlat, { key: 'rover' }).key).toBe('rover');
    expect(bestApplication(appsFlat, null).key).toBe(appsFlat[0].key);

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await openDossier('Research');
    const panel = await screen.findByTestId('research-apps');
    expect(panel).toHaveTextContent('Operational accessibility');
    expect(within(panel).getByText('Scientific validation').closest('.suit-level')).toHaveTextContent('Not assessed');
  });

  it('image pair: real NASA imagery for both windows at the same 60 km scale', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await openDossier('Overview');
    const pair = await screen.findByTestId('site-imagery');
    const earth = [...pair.querySelectorAll('img')].find((i) => i.src.includes('gibs.earthdata.nasa.gov'));
    expect(earth.src).toMatch(/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/);
    expect(earth.src).toMatch(/TIME=2000-12-01/);
    const mars = [...pair.querySelectorAll('img')].filter((i) => i.src.includes('trek.nasa.gov/tiles/Mars/'));
    expect(mars.length).toBeGreaterThan(0);
    expect(pair).toHaveTextContent(/60 km across/);
    expect(screen.queryByText('No candidate preview')).toBeNull();
  });

  it('3D terrain: one grid per window (reference body + Earth), built only when both arrive', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await openDossier('Overview');
    const duo = await screen.findByTestId('terrain-duo');
    await waitFor(() => expect(within(duo).getByTestId('terrain-scene')).toBeInTheDocument());
    const scene = within(duo).getByTestId('terrain-scene');
    expect(scene.dataset.bodies).toBe('mars,earth');                 // reference body left, Earth right
    expect(scene.dataset.cells).toBe('20x20');
    expect(duo).toHaveTextContent(/Same vertical exaggeration ×[\d.]+ for\s+both/);
    const { sharedExaggeration } = await import('../../frontend/src/components/TerrainScene.jsx');
    expect(sharedExaggeration({ min_m: 0, max_m: 300 }, { min_m: 0, max_m: 600 })).toBe(5);     // small relief: max ×5
    expect(sharedExaggeration({ min_m: 0, max_m: 2700 }, { min_m: 0, max_m: 900 })).toBeCloseTo(3.3, 1); // fits the taller
    expect(duo).toHaveTextContent(/DEMO terrain/);
  });

  it('scorecard for the Moon: day length is different, vacuum stated', async () => {
    render(<App />);
    await startMission('Moon');
    await userEvent.click(screen.getByRole('button', { name: 'Tycho crater' }));
    await screen.findByTestId('fingerprint');
    await userEvent.click(screen.getByRole('button', { name: 'Search all Earth land' }));
    await openDossier('Similar / Different');
    const card = await screen.findByTestId('analog-scorecard');
    expect(within(card).getByText('Day length').closest('tr')).toHaveTextContent('Different');
    expect(card).toHaveTextContent(/Near vacuum/);
  });

  it('site dossier: opens from a card, four tabs, keyboard + close, side panel stays light', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(1));
    expect(screen.queryByTestId('site-dossier')).toBeNull();            // not opened automatically
    expect(screen.queryByTestId('analog-scorecard')).toBeNull();        // details no longer stacked in the panel
    const ids = cardIds();
    await userEvent.click(document.querySelector(`[data-candidate-id="${ids[1]}"]`));   // clicking a card opens it
    const d = await screen.findByTestId('site-dossier');
    expect(d).toHaveTextContent('result #2');
    const tabs = within(d).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Similar / Different', 'Research', 'Measurements & sources']);
    expect(within(d).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    within(d).getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(d).getByRole('tab', { name: 'Similar / Different' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(d).findByTestId('analog-scorecard')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('tab', { name: 'Measurements & sources' }));
    expect(within(d).getByText(/Measured values \(reference vs candidate\)/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('site-dossier')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Open site dossier/ }));
    await userEvent.click(within(await screen.findByTestId('site-dossier')).getByRole('button', { name: /View on globe/ }));
    expect(screen.queryByTestId('site-dossier')).toBeNull();
    expect(screen.getByTestId('globe').dataset.selected).toBe(ids[1]);   // selection kept
  });

  it('brand: ELSEWHERE with the slogan, on the hub and in the top bar', async () => {
    render(<App />);
    expect(screen.getByText('ELSEWHERE', { selector: '.wordmark' })).toBeInTheDocument();
    expect(document.querySelector('.brand')).toHaveTextContent('ELSEWHERE');
    expect(screen.queryByText(/MissionMatch/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Skip intro / Explore map directly' }));
    expect(document.querySelector('.brand-tagline')).toHaveTextContent('Exploring other worlds starts with understanding our own.');
  });

  it('sound is off until the user turns it on', async () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /Sound off/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(screen.getByRole('button', { name: /Sound on/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Sound on/ }));
  });
});


