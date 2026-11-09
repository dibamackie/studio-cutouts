import { describe, expect, test } from 'vitest';
import { buildEmbedHtml, embedSnippet } from './embed';

const frame = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const scriptOf = (html: string) => html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));

describe('buildEmbedHtml', () => {
  test('packs every frame and sizes the slider to the frame count', () => {
    const html = buildEmbedHtml([frame, frame, frame], 'rgb(240 240 238)');
    expect(html.match(/data:image\/webp;base64,/g)).toHaveLength(3);
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain('background:rgb(240 240 238)');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  test('a spin gets a Play/Pause button; a single frame does not', () => {
    expect(buildEmbedHtml([frame, frame], 'rgb(0 0 0)')).toContain('id="play"');
    expect(buildEmbedHtml([frame], 'rgb(0 0 0)')).not.toContain('id="play"');
  });

  test('originals add a Show original toggle and are packed alongside', () => {
    const plain = buildEmbedHtml([frame, frame], 'rgb(0 0 0)');
    expect(plain).not.toContain('id="view"');
    const both = buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame, frame] });
    expect(both).toContain('id="view"');
    expect(both.match(/data:image\/webp;base64,/g)).toHaveLength(4);
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

  test('the inline viewer script is syntactically valid JavaScript, with and without originals', () => {
    expect(() => new Function(scriptOf(buildEmbedHtml([frame, frame], 'rgb(0 0 0)')))).not.toThrow();
    expect(() => new Function(scriptOf(buildEmbedHtml([frame, frame], 'rgb(0 0 0)', { originals: [frame, frame] })))).not.toThrow();
  });
});

test('embedSnippet points the iframe at the hosted file', () => {
  const code = embedSnippet('https://shop.example/spins/mug.html');
  expect(code).toContain('src="https://shop.example/spins/mug.html"');
  expect(code).toContain('loading="lazy"');
  expect(code).toContain('title="360° product view"');
});
