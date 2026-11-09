// Dev server only: lets the app, driven from the browser, save the sample spin's exports into the repo.
// Two fixed destinations; the request picks one by name and can't choose a path.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';

const DESTINATIONS: Record<string, string> = {
  embed: 'public/embed/mug-spin.html', // hosted, so the app and README can link a live embed
  clip: 'docs/mug-clip.mp4', // shown in the README
};
const MAX_BYTES = 20_000_000;

export function saveSamplePlugin(): Plugin {
  return {
    name: 'save-sample-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-sample', (req, res) => {
        const what = new URL(req.url ?? '', 'http://localhost').searchParams.get('what') ?? '';
        const path = Object.hasOwn(DESTINATIONS, what) ? DESTINATIONS[what] : undefined;
        if (req.method !== 'POST' || !path) {
          res.statusCode = 400;
          res.end(`POST /__save-sample?what=${Object.keys(DESTINATIONS).join('|')}`);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.statusCode = 413;
            res.end('too large');
            req.destroy();
          } else chunks.push(chunk);
        });
        req.on('end', () => {
          if (res.writableEnded) return;
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, Buffer.concat(chunks));
          res.end(`wrote ${path} (${size} bytes)`);
        });
      });
    },
  };
}
