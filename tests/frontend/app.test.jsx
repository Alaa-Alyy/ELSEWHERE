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

import App from '../../frontend/src/App.jsx';
import { mockApi } from '../../frontend/src/api/mockClient.js';

const cardIds = () => [...document.querySelectorAll('[data-candidate-id]')].map((b) => b.dataset.candidateId);

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
    await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
    await userEvent.click(screen.getByRole('radio', { name: /Mars/ }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
    await userEvent.click(screen.getByRole('radio', { name: /Moon/ }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
    await userEvent.click(screen.getByRole('radio', { name: /Moon/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Tycho crater' }));
    await waitFor(() => expect(pinSpy).toHaveBeenCalledWith({ body: 'moon', lat: -43.3, lon: -11.2 }));
    expect(await screen.findByText(/Pinned moon window/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Mars/ }));
    expect(screen.queryByText(/Pinned moon window/)).toBeNull();
  });

  it('curated mode refuses a pin (only vetted references)', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Find our next training ground' }));
    await userEvent.click(screen.getByTestId('planet-click'));
    await screen.findByTestId('fingerprint');
    await userEvent.click(screen.getByRole('radio', { name: /3 curated regions/ }));
    expect(screen.getByRole('button', { name: 'Search the 3 curated regions' })).not.toBeDisabled();
    expect(screen.queryByText(/Pinned mars window/)).toBeNull();   // switched back to the vetted reference
  });
});


