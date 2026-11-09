// A 360° viewer on a canvas: drag or swipe to turn, arrow keys to step, space to play/pause.

const FULL_TURN_MS = 6000; // autoplay speed: one rotation every 6 s

export interface Spin {
  setCount(count: number): void;
  readonly index: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  redraw(): void;
}

export function createSpin(canvas: HTMLCanvasElement, draw: (index: number) => void, onChange: (index: number, count: number, playing: boolean) => void): Spin {
  let count = 0;
  let index = 0;
  let playing = false;
  let raf = 0;
  let lastStep = 0;
  let drag: { x: number; index: number; id: number } | null = null;

  const wrap = (i: number) => ((i % count) + count) % count;
  const show = (i: number) => {
    index = wrap(i);
    draw(index);
    onChange(index, count, playing);
  };

  const tick = (now: number) => {
    if (!playing) return;
    if (now - lastStep >= FULL_TURN_MS / count) {
      lastStep = now;
      show(index + 1);
    }
    raf = requestAnimationFrame(tick);
  };

  const spin: Spin = {
    setCount(n) {
      spin.pause();
      drag = null; // a drag that began on the previous spin must not steer this one
      count = n;
      index = 0;
      canvas.tabIndex = n > 1 ? 0 : -1;
      canvas.classList.toggle('spinnable', n > 1);
      if (n > 0) show(0);
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (n > 1 && !reduceMotion) spin.play();
    },
    get index() {
      return index;
    },
    get playing() {
      return playing;
    },
    play() {
      if (count < 2 || playing) return;
      playing = true;
      lastStep = performance.now();
      raf = requestAnimationFrame(tick);
      onChange(index, count, playing);
    },
    pause() {
      if (!playing) return;
      playing = false;
      cancelAnimationFrame(raf);
      onChange(index, count, playing);
    },
    redraw() {
      if (count > 0) draw(index);
    },
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (count < 2 || e.button !== 0) return; // primary button / touch / pen only, not right-click
    spin.pause();
    drag = { x: e.clientX, index, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const pxPerFrame = canvas.clientWidth / count; // dragging across the whole view = one full turn
    const next = drag.index - Math.round((e.clientX - drag.x) / pxPerFrame);
    if (wrap(next) !== index) show(next);
  });
  const endDrag = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('keydown', (e) => {
    if (count < 2) return;
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: count - 1 }[e.key];
    if (target !== undefined) {
      e.preventDefault();
      spin.pause();
      show(target);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (playing) spin.pause();
      else spin.play();
    }
  });
  return spin;
}
