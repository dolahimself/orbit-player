/**
 * The film wheel: one fractional position drives both the semicircle dial at
 * the bottom of the page and the cards on the stage, which swing around a
 * pivot far below the screen. Dragging sets the position directly; letting go
 * hands it to a spring that settles on the nearest film.
 */

interface WheelOptions {
  count: number;
  stage: HTMLElement;
  cards: HTMLElement[];
  dial: HTMLElement;
  ticks: SVGSVGElement;
  dialItems: HTMLElement[];
  player: HTMLElement;
  dialIndex: HTMLElement;
  dialTitle: HTMLElement;
  titles: string[];
  video: HTMLVideoElement;
  onCommit: (index: number, autoplay: boolean) => void;
}

/** Degrees between films on the dial. */
const DIAL_STEP = 40;
const DIAL_R = 124;
const DIAL_CX = 180;
const DIAL_CY = 180;
const STIFFNESS = 210;
const DAMPING = 26;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function angleOf(x: number, y: number, cx: number, cy: number) {
  return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
}

export function createWheel(o: WheelOptions) {
  const max = o.count - 1;
  let pos = 0;
  let vel = 0;
  let target = 0;
  let committed = 0;
  let raf = 0;
  let last = 0;
  let cardStep = 18; // degrees between cards on the stage wheel
  let pivotR = 8000; // distance from a card's centre to the wheel's hub, below the screen
  let lastNearest = -1;

  // Drag state
  let dragging = false;
  let dragAngle = 0;
  let dragMoved = 0;
  let samples: { t: number; p: number }[] = [];
  let resumeAfter = false;
  let pausedForDrag = false;

  // ---------------------------------------------------------------- ticks

  const ns = 'http://www.w3.org/2000/svg';
  for (let a = -180; a < 180; a += 5) {
    const major = (((a % DIAL_STEP) + DIAL_STEP) % DIAL_STEP === 0);
    const line = document.createElementNS(ns, 'line');
    const r0 = major ? 150 : 158;
    const r1 = 168;
    const rad = (a * Math.PI) / 180;
    line.setAttribute('x1', String(Math.sin(rad) * r0));
    line.setAttribute('y1', String(-Math.cos(rad) * r0));
    line.setAttribute('x2', String(Math.sin(rad) * r1));
    line.setAttribute('y2', String(-Math.cos(rad) * r1));
    if (major) line.setAttribute('class', 'major');
    o.ticks.append(line);
  }

  // ---------------------------------------------------------------- layout

  function relayout() {
    const w = o.cards[0]?.offsetWidth ?? 800;
    const h = (w * 9) / 16;
    pivotR = w * 9 + h / 2;
    // Swing far enough that a neighbour sits just past the active card's edge.
    cardStep = (Math.asin(Math.min(1, (w * 0.98) / pivotR)) * 180) / Math.PI;
    render();
  }

  // ---------------------------------------------------------------- render

  function render() {
    const nearest = clamp(Math.round(pos), 0, max);

    o.cards.forEach((card, i) => {
      const d = i - pos;
      const a = Math.abs(d);
      const scale = 1 - Math.min(a, 1) * 0.1;
      const opacity = a < 1 ? 1 - a * 0.55 : Math.max(0, 0.45 - (a - 1) * 0.9);
      const deg = d * cardStep;
      const rad = (deg * Math.PI) / 180;
      const x = Math.sin(rad) * pivotR;
      const y = (1 - Math.cos(rad)) * pivotR;
      card.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${deg.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String(10 - Math.round(a));
      card.style.visibility = opacity < 0.01 ? 'hidden' : 'visible';
      card.toggleAttribute('data-active', i === nearest);
    });

    // The live player sits on top of the active card and steps aside while the wheel moves.
    const off = Math.abs(pos - committed);
    const op = clamp(1 - off * 3.2, 0, 1);
    o.player.style.opacity = op.toFixed(3);
    o.player.toggleAttribute('data-away', op < 0.5);

    o.ticks.style.transform = `rotate(${(-pos * DIAL_STEP).toFixed(3)}deg)`;
    o.dialItems.forEach((item, i) => {
      const deg = (i - pos) * DIAL_STEP;
      const rad = (deg * Math.PI) / 180;
      const x = DIAL_CX + Math.sin(rad) * DIAL_R;
      const y = DIAL_CY - Math.cos(rad) * DIAL_R;
      const a = Math.abs(deg);
      item.style.left = `${x.toFixed(2)}px`;
      item.style.top = `${y.toFixed(2)}px`;
      item.style.opacity = clamp(1.6 - a / 70, 0, 1).toFixed(3);
      item.style.scale = (i === nearest ? 1.08 : 0.86).toString();
      item.toggleAttribute('data-active', i === nearest);
    });

    if (nearest !== lastNearest) {
      lastNearest = nearest;
      o.dialIndex.innerHTML = `${String(nearest + 1).padStart(2, '0')} <span>/ ${String(o.count).padStart(2, '0')}</span>`;
      o.dialTitle.textContent = o.titles[nearest];
      if (dragging) navigator.vibrate?.(4);
    }

    // Moving away from the current film pauses it; landing back resumes.
    if (off > 0.35 && !o.video.paused) {
      o.video.pause();
      pausedForDrag = true;
    }
  }

  // ---------------------------------------------------------------- spring

  function tick(t: number) {
    const dt = Math.min(0.032, (t - last) / 1000 || 0.016);
    last = t;
    if (!dragging) {
      if (reduceMotion.matches) {
        pos = target;
        vel = 0;
      } else {
        const acc = STIFFNESS * (target - pos) - DAMPING * vel;
        vel += acc * dt;
        pos += vel * dt;
      }
    }
    render();
    const settled = !dragging && Math.abs(target - pos) < 0.0008 && Math.abs(vel) < 0.002;
    if (settled) {
      pos = target;
      vel = 0;
      render();
      onSettle();
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function onSettle() {
    if (target === committed && pausedForDrag && resumeAfter) o.video.play().catch(() => {});
    pausedForDrag = false;
  }

  function go(i: number) {
    target = clamp(i, 0, max);
    if (!dragging) resumeAfter = resumeAfter || !o.video.paused;
    if (target !== committed) {
      const autoplay = resumeAfter || !o.video.paused;
      committed = target;
      o.onCommit(target, autoplay);
      pausedForDrag = false;
      resumeAfter = false;
    }
    run();
  }

  function jump(i: number) {
    pos = target = committed = clamp(i, 0, max);
    vel = 0;
    relayout();
  }

  // ---------------------------------------------------------------- dial input

  const dialCenter = () => {
    const r = o.dial.getBoundingClientRect();
    const s = r.width / 360;
    return { x: r.left + DIAL_CX * s, y: r.top + DIAL_CY * s };
  };

  o.dial.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const c = dialCenter();
    dragging = true;
    dragAngle = angleOf(ev.clientX, ev.clientY, c.x, c.y);
    dragMoved = 0;
    samples = [{ t: performance.now(), p: pos }];
    resumeAfter = !o.video.paused || pausedForDrag;
    o.dial.setPointerCapture(ev.pointerId);
    o.dial.toggleAttribute('data-dragging', true);
    vel = 0;
    run();
  });

  o.dial.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const c = dialCenter();
    const a = angleOf(ev.clientX, ev.clientY, c.x, c.y);
    let d = a - dragAngle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    dragAngle = a;
    dragMoved += Math.abs(d);
    let next = pos - d / DIAL_STEP;
    // Rubber band past the first and last film.
    if (next < 0) next = pos < 0 ? pos - (d / DIAL_STEP) * 0.3 : next * 0.3;
    if (next > max) next = pos > max ? pos - (d / DIAL_STEP) * 0.3 : max + (next - max) * 0.3;
    pos = clamp(next, -0.45, max + 0.45);
    const now = performance.now();
    samples.push({ t: now, p: pos });
    samples = samples.filter((s) => now - s.t < 100);
  });

  const endDrag = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    o.dial.toggleAttribute('data-dragging', false);
    o.dial.releasePointerCapture?.(ev.pointerId);

    // A tap (little rotation) on a thumbnail jumps straight to it.
    if (dragMoved < 3) {
      const item = (document.elementFromPoint(ev.clientX, ev.clientY) as Element | null)?.closest<HTMLElement>('.dial-item');
      go(item ? Number(item.dataset.index) : committed);
      return;
    }
    const first = samples[0];
    const lastS = samples[samples.length - 1];
    const v = first && lastS && lastS.t > first.t ? (lastS.p - first.p) / ((lastS.t - first.t) / 1000) : 0;
    vel = v;
    go(Math.round(pos + clamp(v * 0.16, -1, 1)));
  };
  o.dial.addEventListener('pointerup', endDrag);
  o.dial.addEventListener('pointercancel', endDrag);

  // Wheel / trackpad: one film per notch, with a short cooldown.
  let wheelAcc = 0;
  let wheelLock = 0;
  o.dial.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const now = performance.now();
      wheelAcc += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (now < wheelLock) return;
      if (Math.abs(wheelAcc) > 40) {
        go(committed + Math.sign(wheelAcc));
        wheelAcc = 0;
        wheelLock = now + 380;
      }
    },
    { passive: false },
  );

  o.dial.addEventListener('keydown', (ev) => {
    const map: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      PageUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageDown: -1,
    };
    if (ev.key in map) {
      ev.preventDefault();
      ev.stopPropagation();
      go(committed + map[ev.key]);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      ev.stopPropagation();
      go(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      ev.stopPropagation();
      go(max);
    }
  });

  // Clicking a neighbouring card brings it forward.
  o.cards.forEach((card, i) =>
    card.addEventListener('click', () => {
      if (i !== committed) go(i);
    }),
  );

  new ResizeObserver(() => relayout()).observe(o.stage);

  return { go, jump, relayout };
}
