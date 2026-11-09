import './style.css';
import results from './bench-results.json';
import devices from './device-results.json';
import { MODELS, type Backend, type ModelId } from './models';
import type { BenchResult, FromWorker } from './protocol';

type Metric = 'max_f' | 'iou' | 'mae';
type Scores = Record<Metric, number>;
interface QualityRow {
  label: string;
  megabytes: number;
  inputSize: number;
  browser: boolean;
  mine?: boolean;
  scores: Record<'dis-te' | 'duts-te', Scores>;
  images?: Record<'dis-te' | 'duts-te', number>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const RUNS: Record<Backend, number> = { webgpu: 20, wasm: 5 }; // WASM is slow; 5 runs keeps the page responsive
const SETS = ['dis-te', 'duts-te'] as const;
const METRICS: { key: Metric; higherIsBetter: boolean }[] = [
  { key: 'max_f', higherIsBetter: true },
  { key: 'iou', higherIsBetter: true },
  { key: 'mae', higherIsBetter: false },
];

function cell(text: string, className = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderQuality(rows: QualityRow[]) {
  const best = new Map<string, number>();
  for (const set of SETS) {
    for (const { key, higherIsBetter } of METRICS) {
      const values = rows.map((r) => r.scores[set][key]);
      best.set(`${set}.${key}`, higherIsBetter ? Math.max(...values) : Math.min(...values));
    }
  }
  const fullSize = (set: (typeof SETS)[number]) => Math.max(...rows.map((r) => r.images?.[set] ?? 0));
  let sampled = false;
  const body = $<HTMLTableElement>('quality').tBodies[0];
  for (const row of rows) {
    const tr = body.insertRow();
    if (row.mine) tr.className = 'mine';
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = `${row.label} @${row.inputSize}px`;
    tr.append(name, cell(`${row.megabytes} MB`), cell(row.browser ? 'Yes' : 'No'));
    for (const set of SETS) {
      const isSample = (row.images?.[set] ?? 0) < fullSize(set);
      sampled ||= isSample;
      for (const { key } of METRICS) {
        const v = row.scores[set][key];
        tr.append(cell(`${v.toFixed(3)}${isSample ? '†' : ''}`, v === best.get(`${set}.${key}`) ? 'best' : ''));
      }
    }
  }
  $('quality-notes').textContent = `${results.notes}${sampled ? ' † Scored on a fixed random sample of the set, not all of it.' : ''}`;
}

async function describeDevice(): Promise<string> {
  const parts = [navigator.userAgent.match(/\(([^)]+)\)/)?.[1] ?? 'Unknown device'];
  try {
    const adapter = 'gpu' in navigator ? await navigator.gpu.requestAdapter() : null;
    const info = adapter?.info;
    parts.push(info ? `GPU: ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'available'}` : 'No WebGPU');
  } catch {
    parts.push('WebGPU check failed');
  }
  return parts.join(' · ');
}

function benchOne(worker: Worker, modelId: ModelId, backend: Backend): Promise<BenchResult> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        $('bench-status').textContent = `Downloading ${MODELS[msg.modelId].label}… ${msg.total ? Math.round((msg.loaded / msg.total) * 100) : '?'}%`;
      } else if (msg.type === 'bench') resolve(msg.result);
      else if (msg.type === 'error') reject(new Error(msg.message));
    };
    worker.postMessage({ type: 'bench', modelId, backend, runs: RUNS[backend] });
  });
}

const ms = (v: number) => (v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`);

function renderDevices(list: { label: string; device: string; results: BenchResult[] }[]) {
  const body = $<HTMLTableElement>('devices').tBodies[0];
  for (const entry of list) {
    const tr = body.insertRow();
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = entry.label;
    name.title = entry.device;
    tr.append(name);
    for (const modelId of Object.keys(MODELS) as ModelId[]) {
      const runs = entry.results.filter((r) => r.modelId === modelId);
      const fastest = Math.min(...runs.map((r) => r.medianMs));
      for (const backend of ['webgpu', 'wasm'] as Backend[]) {
        const r = runs.find((x) => x.backend === backend);
        tr.append(r ? cell(`${ms(r.medianMs)} @${r.inputSize}`, r.medianMs === fastest ? 'best' : '') : cell('—'));
      }
    }
  }
}

async function runBenchmark(device: string) {
  const button = $<HTMLButtonElement>('run');
  const copy = $<HTMLButtonElement>('copy');
  const body = $<HTMLTableElement>('speed').tBodies[0];
  button.disabled = true;
  copy.hidden = true;
  $('speed-wrap').hidden = false; // empty until the first run, so hide the bare header before that
  body.replaceChildren();
  const collected: (BenchResult | { modelId: ModelId; backend: Backend; error: string })[] = [];
  const worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  const backends: Backend[] = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];

  for (const modelId of Object.keys(MODELS) as ModelId[]) {
    for (const backend of backends) {
      const label = `${MODELS[modelId].label} on ${backend === 'webgpu' ? 'WebGPU' : 'WASM'}`;
      $('bench-status').textContent = `Running ${label}…`;
      const tr = body.insertRow();
      tr.append(cell(MODELS[modelId].label), cell(backend === 'webgpu' ? 'WebGPU' : 'WASM (1 thread)'));
      try {
        const r = await benchOne(worker, modelId, backend);
        collected.push(r);
        tr.append(cell(`${r.inputSize}px`), cell(ms(r.firstMs)), cell(ms(r.medianMs), 'strong'), cell(ms(r.p90Ms)));
      } catch (err) {
        collected.push({ modelId, backend, error: String(err) });
        const td = cell(`Failed: ${String(err).slice(0, 120)}`, 'error');
        td.colSpan = 4;
        tr.append(td);
      }
    }
  }
  worker.terminate();
  $('bench-status').textContent = 'Done. Copy the results to share them.';
  button.disabled = false;
  button.textContent = 'Run again';
  copy.hidden = false;
  copy.onclick = async () => {
    const text = JSON.stringify({ device, date: new Date().toISOString(), results: collected }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      $('bench-status').textContent = 'Results copied to the clipboard.';
    } catch {
      $('bench-status').textContent = 'Clipboard blocked by the browser; results are logged to the console instead.';
      console.info(text);
    }
  };
}

renderQuality(results.quality as QualityRow[]);
renderDevices(devices as { label: string; device: string; results: BenchResult[] }[]);
describeDevice().then((device) => {
  $('device').textContent = device;
  $('run').addEventListener('click', () => runBenchmark(device));
});
