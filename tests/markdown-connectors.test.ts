import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES, calcUnderwriting } from '../src/engine/underwriting';
import { computeDOEFactorial, runMonteCarloStress } from '../src/engine/doe';
import { evaluateLocalStormHazard } from '../src/engine/fiduciary';
import { PERSONA_PROFILES } from '../src/engine/personas';
import { buildQuantFallbackMarkdown, formatMarkdownToDuskHTML } from '../src/engine/markdown';
import { buildGoogleMapsLinks } from '../src/connectors/googleMaps';
import { KDENSE_SCIENTIFIC_SKILLS, buildKDenseSkillPrompt } from '../src/connectors/kdense';

describe('Markdown Renderer, Quant Dossiers & Connectors', () => {
  it('escapes HTML and uses valid Dusk CSS tokens (no --color-ink-1 or --color-hairline)', () => {
    const html = formatMarkdownToDuskHTML(
      '### Heading\n- **Bold** <script>alert(1)</script>\n\n| Col1 | Col2 |\n|---|---|\n| A | B |'
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('--color-ink-1');
    expect(html).not.toContain('--color-hairline');
    expect(html).toContain('--color-ink');
    expect(html).toContain('--color-rule');
  });

  it('renders whole percentages (20% down, not 0.2% down) in Quant LP Brief', () => {
    const p = DEFAULT_PROPERTIES[0];
    const m = calcUnderwriting(p, 'hold');
    const md = buildQuantFallbackMarkdown({
      type: 'lp_memo',
      parcel: p,
      metrics: m,
      doe: computeDOEFactorial(p, 'hold'),
      mc: runMonteCarloStress(p, 'hold', 200, 42),
      hazard: evaluateLocalStormHazard(p),
      properties: DEFAULT_PROPERTIES,
      strategy: 'hold',
      persona: PERSONA_PROFILES.pe_ic,
    });
    expect(md).toContain('20% down');
    expect(md).not.toContain('0.2% down');
  });

  it('builds valid Google Maps deep links and optional Street View static image', () => {
    const noKey = buildGoogleMapsLinks(DEFAULT_PROPERTIES[0]);
    expect(noKey.maps3D).toContain('google.com/maps/@32.542100,-97.320800');
    expect(noKey.streetViewStaticImg).toBeNull();

    const withKey = buildGoogleMapsLinks(DEFAULT_PROPERTIES[0], 'test-key');
    expect(withKey.streetViewStaticImg).toContain('maps.googleapis.com/maps/api/streetview');
  });

  it('builds K-Dense /skill prompt containing parcel JSON and DOE metrics', () => {
    const p = DEFAULT_PROPERTIES[0];
    const prompt = buildKDenseSkillPrompt({
      skill: KDENSE_SCIENTIFIC_SKILLS[0],
      parcel: p,
      metrics: calcUnderwriting(p, 'hold'),
      doe: computeDOEFactorial(p, 'hold'),
    });
    expect(prompt).toContain('/skill:experimental-design');
    expect(prompt).toContain(p.address);
    expect(prompt).toContain('doe2x3');
  });
});
