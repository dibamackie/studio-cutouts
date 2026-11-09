# Studio

**Live: [studio-cutouts.vercel.app](https://studio-cutouts.vercel.app)** · **[Benchmarks](https://studio-cutouts.vercel.app/bench.html)**

Product photos that never leave your device. Drop in a product photo, several photos, or a short phone video walking around the object. The browser cuts it out with a neural network I trained (running on your GPU via WebGPU, or your CPU via WebAssembly), stands it in a studio scene with a contact shadow and floor reflection, and, for several frames, turns it into a drag-to-spin 360° view. Nothing is uploaded.

> **Status: milestone 5 of 6.** Studio scene, 360° spin, a 9:16 social clip and an embeddable spin are live; try the sample spin on the home page, or see the [sample embed](https://studio-cutouts.vercel.app/embed/mug-spin.html). Next: demo GIF and a failure gallery. See [Roadmap](#roadmap).

## Results

Studio v1 is a 4.5M-parameter U-Net (9.1 MB fp16) trained for this project; see [training/](training/README.md). Scored on the full public test sets, at each image's own resolution:

| Model | Download | Runs in browser | DIS-TE max F | IoU | MAE | DUTS-TE max F | IoU | MAE |
|---|---|---|---|---|---|---|---|---|
| BiRefNet_lite @1024 (large reference) | 177 MB | No | 0.953 | 0.902 | 0.013 | 0.884 | 0.811 | 0.036 |
| U²-Netp @320 (baseline) | 4.6 MB | Yes | 0.637 | 0.392 | 0.147 | 0.852 | 0.739 | 0.053 |
| **Studio v1 @512** | 9.1 MB | Yes | **0.774** | **0.623** | **0.085** | **0.867** | **0.761** | **0.049** |

DIS-TE (2,000 images) is fine detail: chairs, bikes, plants, jewelry. DUTS-TE (5,019) is everyday photos. Bold marks the best browser model.

- Studio v1 beats the U²-Netp baseline on every metric, by +0.14 max F and +0.23 IoU on DIS-TE.
- On everyday photos it reaches 98% of the large BiRefNet_lite's max F at 1/20 of the size. On fine detail BiRefNet is far ahead: DIS5K is in its training data and it sees 4× the pixels. Closing that gap is the v2 plan (see [training/README.md](training/README.md#full-test-sets)).

Speed, median ms per frame, measured with the [benchmark page](https://studio-cutouts.vercel.app/bench.html) (which times any device and copies the results as JSON):

| Device | Studio v1 WebGPU | Studio v1 WASM | U²-Netp WebGPU | U²-Netp WASM |
|---|---|---|---|---|
| Desktop, Chrome, RTX 3070 | **14 @512** | 229 @384 | 40 @320 | 1,422 @320 |
| Android 10 phone, Chrome, Imagination D-Series GPU | 510 @512 | **183 @384** | 1,595 @320 | 1,306 @320 |

On the desktop GPU, Studio v1 is about 3× faster than U²-Netp despite a 2.6× larger input, and on the CPU about 6× faster on both devices.

**360° spin**, on the 5-second sample walkaround (960×540, desktop, WebGPU): 108 candidate frames scored for sharpness, 36 kept, all 36 cut out and placed in about **3 s**. Frame-to-frame wobble, in % of the object's height:

| | Base height jumps | Size jumps | Sideways jumps |
|---|---|---|---|
| Raw video | 1.53% mean, 6.60% max | 2.77% mean, 7.85% max | 3.14% mean, 7.87% max |
| Studio spin | **0.35%** mean, 1.36% max | **0.59%** mean, 2.59% max | 3.19% mean, 7.78% max |

The base and size settle 4–5×. Sideways is left as filmed on purpose; see the engineering notes.

**Exports**, from the same sample spin (desktop Chrome):

| Export | Time | Size |
|---|---|---|
| 9:16 clip, 1080×1920, 8 s (two turns), H.264 MP4 | 1.2 s, encoded faster than real time | 1.4 MB ([`docs/mug-clip.mp4`](docs/mug-clip.mp4)) |
| Embeddable spin, 36 frames at 800 px | 1.4 s | 0.39 MB, one HTML file ([live](https://studio-cutouts.vercel.app/embed/mug-spin.html)) |

The clip holds each view for 60% of its slot and crossfades in the rest: blending the full slot made the mug's handle appear twice. In the tall frame the object is enlarged as far as its widest view allows, up to 1.3×.

The embeddable spin needs no server, script tag or third-party request. Upload the file anywhere and paste:

```html
<iframe src="https://your-site.example/studio-spin.html" width="600" height="600"
  style="border:0;max-width:100%;height:auto;aspect-ratio:1" loading="lazy" title="360° product view"></iframe>
```

Because only base64 image data and a validated colour go into that file, nothing a user drops in can inject markup into a host page (`buildEmbedHtml` rejects anything else; see `src/embed.test.ts`).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 (benchmarks at /bench.html)
npm test         # unit tests for the pre/post-processing
npm run build    # static site in dist/, deployable to Vercel or any static host
```

Add `?model=u2netp` to the app's URL to compare against the baseline on your own photos.

## How it works

```
files ──► frames.ts   one photo (≤4096 px) │ several photos, sorted by name │ a video: score 108 moments
              │       for sharpness on a 160 px copy, keep the sharpest of every 3 → 36 frames (≤1024 px)
              ▼
          worker      each frame: RGB/255 → ONNX Runtime Web (WebGPU 512 px, else WASM 384 px) → alpha
              ▼
          pipeline    per frame: object box (ignoring stray specks) + mean colour of the object
              │       across frames: median-smooth the boxes, match exposure to the median frame,
              │       scale every frame to the same object height, stand it on the floor line
              ▼
          scene/spin  backdrop + contact shadow + floor reflection + object; drag, arrow keys, autoplay
              ▼
          exports     studio JPG (1080×1080) · transparent PNG cropped to the object
                      9:16 clip (1080×1920 MP4, WebCodecs via Mediabunny; real-time recording fallback)
                      embeddable spin (one HTML file: frames as WebP data URIs + a 2 KB viewer)
```

- **Inference runs in a Web Worker**, so the page never freezes.
- **Models are cached with the Cache API** under versioned file names: the second visit loads without a network request.
- **The backend is measured, not assumed.** On a device's first visit the worker times the model on the CPU (WASM), then on the GPU (WebGPU), and keeps the GPU unless the CPU is at least 20% faster (the GPU runs the sharper 512 px input). The choice is saved in `localStorage`, so later visits skip the probe. The page says which backend won and by how much.
- **One input size per session.** Changing the input size makes WebGPU recompile its shaders (120–830 ms), so each backend gets a fixed size: 512 px on WebGPU (best quality, ~19 ms) and 384 px on the CPU (~200 ms instead of ~350 ms).
- **A warm-up run at load** compiles the shaders, so the inference time shown is the real per-photo cost.
- **Normalization and the sigmoid live inside the exported model**, so the browser code is just "RGB/255 in, alpha out". `src/models.ts` records each model's contract, which is how the U²-Netp baseline still runs side by side.

## Engineering notes

- **fp16 overflowed on WebGPU, and CPU checks couldn't see it.** The first spin test cut out a ghost of the mug. Studio v1's squeeze-and-excitation blocks average a whole feature map (256×256 values at 512 px input). ONNX Runtime's WebGPU backend summed that in fp16, which overflows past 65,504. The CPU sums in fp32, so the export's CPU parity check passed. Comparing WebGPU against the CPU on 23 images: the fp16 model broke 3 of them at 512 px, while fp32 broke none. The fix keeps just those 8 `ReduceMean` operations in fp32 (`FP32_OPS` in `training/studio_train/export.py`). Same 9.1 MB file, same DIS-TE score (0.7735), and WebGPU now agrees with the CPU on all 23 (mean IoU 0.99). The model ships as `studio-v1.1.fp16.onnx` so returning visitors don't keep the cached broken file.
- **Don't re-centre what the camera already centred.** Centring every frame on its bounding box made the mug jump sideways as its handle swung into view. Centring on the median column of the object's pixels was better, but measured against the handle-free rim it still added jitter (3.8% vs the raw 3.1% of object height per frame), because the anchor itself is noisy. The spin now corrects only slow aim drift (a 13-frame median), which leaves jitter at the raw level. Base height and size are re-normalized every frame, which is where the 4–5× gains come from.
- **WebGPU isn't always faster.** On an Android 10 phone with an Imagination D-Series GPU, Studio v1 took 510 ms per frame on WebGPU and 183 ms on a single CPU thread; U²-Netp was slower on WebGPU too. The first version of the app chose WebGPU whenever it existed, which made that phone about 3× slower and added ~4.8 s of GPU setup. Hence the first-visit probe.

- **Multithreaded WASM hangs inside a Web Worker** (ONNX Runtime Web 1.31.1): session creation never resolves with `numThreads > 1`, for both the WebGPU and WASM backends. The worker pins one thread. With Studio v1 the CPU fallback is still ~200 ms per photo, and the site doesn't need cross-origin isolation headers (COOP/COEP), which keeps static hosting and embedding simple.
- **The runtime is bigger than the model.** ONNX Runtime's WebGPU build is 7.3 MB gzipped, versus 9.1 MB for the model (fp16). Loading the smaller WASM-only build when WebGPU is unavailable is a planned optimization.
- **Picking the input size by measurement:** on DIS-VD, max F rises from 0.732 at 320 px to 0.774 at 512 px, with no loss on DUTS-TE, so the GPU path runs at 512 px.

## Roadmap

1. ✅ Baseline: off-the-shelf U²-Netp running in the browser end to end
2. ✅ Training pipeline and synthetic data generator; first trained model. See [training/README.md](training/README.md)
3. ✅ Swap in my model; benchmark page with quality tables and an on-device speed test (phone numbers still to collect)
4. ✅ Studio scene (4 backdrops, contact shadow, reflection, exposure matching) and 360° spin viewer from photos or video
5. ✅ Social export (9:16 clip) and an embeddable spin with an iframe snippet
6. Deploy, demo GIF, failure gallery

## Credits and licenses

- Code: MIT (see `LICENSE`).
- Studio v1 weights: trained on DUTS and DIS5K, so they are for research and demo use only. See `NOTICE`.
- Baseline model: [U²-Net / U²-Netp](https://github.com/xuebinqin/U-2-Net) by Xuebin Qin et al., Apache-2.0. ONNX export from [rembg](https://github.com/danielgatis/rembg).
- Inference: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT.
- Clip muxing: [Mediabunny](https://github.com/Vanilagy/mediabunny), MPL-2.0, unmodified.
- Sample video: rendered for this project in Blender with [`tools/render_sample_mug.py`](tools/render_sample_mug.py); same license as the code.
