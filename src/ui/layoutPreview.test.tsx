import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '../engine/config';
import { LayoutPreview } from './LayoutPreview';

describe('LayoutPreview measurements', () => {
  it('draws every official layout with distances and no NaN', () => {
    expect(LAYOUTS.length).toBe(45);
    for (const l of LAYOUTS) {
      const html = renderToStaticMarkup(<LayoutPreview layout={l} width={300} showMeasurements />);
      expect(html, l.id).not.toContain('NaN');
      expect(html, l.id).toContain('dim-line');
    }
  });
  it('a side deployment shows its width (12"), not the table length', () => {
    const l = LAYOUTS.find((x) => x.deployment === 'dawn-of-war')!;
    const html = renderToStaticMarkup(<LayoutPreview layout={l} width={300} showMeasurements />);
    expect(html).toContain('>12&quot;<');
    expect(html).not.toContain('>60&quot;<');
  });
});
