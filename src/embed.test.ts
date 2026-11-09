import { describe, expect, test } from 'vitest';
import { buildEmbedHtml, embedSnippet } from './embed';

const frame = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const scriptsOf = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

describe('buildEmbedHtml', () => {
  test('packs every frame and sizes the slider to the frame count', () => {
    const html = buildEmbedHtml([frame, frame, frame], 'rgb(240 240 238)');
    expect(html.match(/data:image\/webp;base64,/g)).toHaveLength(3 + 1); // + the first frame again, as the poster
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain('background:rgb(240 240 238)');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  test('a spin gets a Play/Pause button; a single frame does not', () => {
    expect(buildEmbedHtml([frame, frame], 'rgb(0 0 0)')).toContain('id="play"');
    expect(buildEmbedHtml([frame], 'rgb(0 0 0)')).not.toContain('id="play"');
  });

  test('originals add a Studio | Original switch, starting on Studio, and are packed alongside', () => {
    const plain = buildEmbedHtml([frame, frame], 'rgb(0 0 0)');
    expect(plain).not.toContain('data-view="original"');
    const both = buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame, frame] });
    expect(both).toContain('data-view="studio" aria-pressed="true"'); // starts in studio mode, and says so
    expect(both).toContain('data-view="original" aria-pressed="false"');
    expect(both.match(/data:image\/webp;base64,/g)).toHaveLength(4 + 1); // + the poster
  });

  test('originals must match the frames one to one, and be images', () => {
    expect(() => buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame] })).toThrow(/one to one/);
    expect(() => buildEmbedHtml([frame], 'rgb(0 0 0)', { originals: ['javascript:alert(1)'] })).toThrow(/originals/);
  });

  test('refuses anything that is not a base64 image, so markup cannot be injected', () => {
    expect(() => buildEmbedHtml(['data:image/webp;base64,AAA"></script><script>alert(1)//'], 'rgb(0 0 0)')).toThrow(/data URIs/);
    expect(() => buildEmbedHtml(['https://example.com/a.webp'], 'rgb(0 0 0)')).toThrow(/data URIs/);
    expect(() => buildEmbedHtml([frame], 'red;}</style><script>')).toThrow(/background/);
    expect(() => buildEmbedHtml([], 'rgb(0 0 0)')).toThrow(/no frames/);
  });

  test('accepts JPEG frames (Safari cannot encode WebP)', () => {
    expect(() => buildEmbedHtml(['data:image/jpeg;base64,/9j/4AAQ'], 'rgb(1 2 3)')).not.toThrow();
  });

  test('every inline script is syntactically valid JavaScript, with and without originals', () => {
    for (const html of [buildEmbedHtml([frame, frame], 'rgb(0 0 0)'), buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame, frame] })]) {
      const scripts = scriptsOf(html);
      expect(scripts.length).toBeGreaterThanOrEqual(2);
      for (const s of scripts) expect(() => new Function(s)).not.toThrow();
    }
  });

  test('loads in the right order: poster first, studio frames and viewer next, originals last', () => {
    const html = buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame, frame] });
    expect(html.indexOf('background:url(' + frame)).toBeLessThan(html.indexOf('const F='));
    expect(html.indexOf('const F=')).toBeLessThan(html.indexOf('self.O='));
    expect(buildEmbedHtml([frame], 'rgb(0 0 0)')).not.toContain('self.O=');
  });
});

test('embedSnippet points the iframe at the hosted file', () => {
  const code = embedSnippet('https://shop.example/spins/mug.html');
  expect(code).toContain('src="https://shop.example/spins/mug.html"');
  expect(code).toContain('loading="lazy"');
  expect(code).toContain('title="360° product view"');
});
