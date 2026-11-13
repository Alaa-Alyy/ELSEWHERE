import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import ChatPanel from '../../frontend/src/components/ChatPanel.jsx';
import SourceList from '../../frontend/src/components/SourceList.jsx';
import { realApi, assetUrl } from '../../frontend/src/api/client.js';
import { CANDIDATES, REFERENCES } from '../../frontend/src/api/fixtures.js';

describe('safe rendering', () => {
  it('renders assistant text as text, never as HTML', () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <ChatPanel available messages={[{ role: 'assistant', content: evil }]} pending={false} error={null}
        sources={[]} context={{}} onSend={() => {}} onClose={() => {}} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('links only to registry sources with https landing URLs', () => {
    const { container } = render(
      <SourceList ids={['known', 'unknown', 'js']} sources={[
        { id: 'known', title: 'Known', landing_url: 'https://example.org', agency: 'A', product: 'P', version: '1' },
        { id: 'js', title: 'Bad', landing_url: 'javascript:alert(1)', agency: 'A', product: 'P', version: '1' },
      ]} />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.org');
  });

  it('accepts only approved preview asset paths', () => {
    expect(assetUrl('/assets/previews/mars-jezero.png')).toMatch(/\/assets\/previews\/mars-jezero\.png$/);
    expect(assetUrl('../../etc/passwd')).toBeNull();
    expect(assetUrl('C:\\data\\x.png')).toBeNull();
    expect(assetUrl(null)).toBeNull();
  });
});

describe('real API adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends IDs/settings only to /api/decision and maps the error envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'not_found', message: 'Unknown candidate', retryable: false } }), { status: 404 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await expect(realApi.postDecision({
      reference_id: 'mars-jezero', profile: 'terrain_general', slope_weight: 0,
      selected_candidate_id: 'earth-khaybar-r00-c00', alternative_candidate_id: null, score: 99,
    })).rejects.toMatchObject({ status: 404, code: 'not_found', retryable: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/decision$/);
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('score');
    expect(body.slope_weight).toBe(0);
  });

  it('passes slope_weight=0 in the rankings query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await realApi.getRankings({ reference_id: 'mars-jezero', profile: 'slope_focus', slope_weight: 0, top_k: 3 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('slope_weight=0');
  });
});

describe('fixtures follow the v2 contract and are labeled demo', () => {
  it('has 243 planned candidates with v2 IDs, all is_demo', () => {
    expect(CANDIDATES).toHaveLength(243);
    for (const c of CANDIDATES) {
      expect(c.id).toMatch(/^earth-(khaybar|pinacate|death-valley)-r\d{2}-c\d{2}$/);
      expect(c.analysis.is_demo).toBe(true);
      if (c.analysis.status === 'valid') {
        expect(c.metrics.slope_histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      } else {
        expect(c.metrics.relief_p95_p05_m).toBeNull();
      }
    }
    for (const r of REFERENCES) expect(r.analysis.is_demo).toBe(true);
  });
});
