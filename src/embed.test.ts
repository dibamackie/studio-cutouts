import { describe, expect, test } from 'vitest';
import { buildEmbedHtml, embedSnippet } from './embed';

const frame = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

describe('buildEmbedHtml', () => {
  test('packs every frame and sizes the slider to the frame count', () => {
    const html = buildEmbedHtml([frame, frame, frame], 'rgb(240 240 238)');
    expect(html.match(/data:image\/webp;base64,/g)).toHaveLength(3);
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain('background:rgb(240 240 238)');
    expect(html.startsWith('<!doctype html>')).toBe(true);
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

  test('the inline viewer script is syntactically valid JavaScript', () => {
    const html = buildEmbedHtml([frame, frame], 'rgb(0 0 0)');
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
  });
});

test('embedSnippet points the iframe at the hosted file', () => {
  const code = embedSnippet('https://shop.example/spins/mug.html');
  expect(code).toContain('src="https://shop.example/spins/mug.html"');
  expect(code).toContain('loading="lazy"');
  expect(code).toContain('title="360° product view"');
});
