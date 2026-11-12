/**
 * Geometry for the Orbit control. Everything is drawn in a 200 × 200 viewBox
 * centred on (100, 100); angles are in degrees, 0° at twelve o'clock and
 * increasing clockwise, which is the direction the seek ring fills.
 */

export const VIEW = 200;
export const C = VIEW / 2;

/** Seek ring: a band that sits flush against the outer edge of the buttons. */
export const RING_R = 95.5;
export const RING_W = 9;
export const RING_INNER = RING_R - RING_W / 2; // 91

/** The four direction buttons. Outer edge meets the ring with no gap. */
export const SEG_OUTER = RING_INNER;
export const SEG_INNER = 56;
/** Visible gap between neighbouring buttons, in viewBox units. */
export const SEG_GAP = 5;
/** Corner radius of each button. */
export const SEG_CORNER = 5;

/** The centre play button. */
export const CENTER_R = SEG_INNER - SEG_GAP;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function polar(r: number, deg: number, cx = C, cy = C): [number, number] {
  const a = rad(deg - 90);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const f = (n: number) => +n.toFixed(3);

/**
 * One direction button: an annular sector between `from` and `to` degrees,
 * with a gap of constant width on each side (not a constant angle, which would
 * make the gap taper) and rounded corners.
 */
export function segmentPath(from: number, to: number, scale = 1, opts = {} as {
  outer?: number;
  inner?: number;
  gap?: number;
  corner?: number;
}): string {
  const ro = (opts.outer ?? SEG_OUTER) * scale;
  const ri = (opts.inner ?? SEG_INNER) * scale;
  const half = ((opts.gap ?? SEG_GAP) * scale) / 2;
  const k = (opts.corner ?? SEG_CORNER) * scale;
  const cx = C * scale;
  const cy = C * scale;

  // Angular offset so the straight edge sits `half` units from the radial line.
  const offO = (Math.asin(half / ro) * 180) / Math.PI;
  const offI = (Math.asin(half / ri) * 180) / Math.PI;
  // Angular size of the corner rounding along each arc.
  const kO = (k / ro) * (180 / Math.PI);
  const kI = (k / ri) * (180 / Math.PI);

  const a0o = from + offO;
  const a1o = to - offO;
  const a0i = from + offI;
  const a1i = to - offI;

  // Points along each straight side, pulled in by the corner radius.
  const side = (aOuter: number, aInner: number, t: number) => {
    const [x1, y1] = polar(ro, aOuter, cx, cy);
    const [x2, y2] = polar(ri, aInner, cx, cy);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const u = t / len;
    return [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u] as const;
  };

  const p = (r: number, a: number) => polar(r, a, cx, cy).map(f).join(' ');

  const s1a = side(a0o, a0i, k); // start side, near outer
  const s1b = side(a0o, a0i, Math.hypot(...diff(polar(ro, a0o, cx, cy), polar(ri, a0i, cx, cy))) - k);
  const s2a = side(a1o, a1i, k);
  const s2b = side(a1o, a1i, Math.hypot(...diff(polar(ro, a1o, cx, cy), polar(ri, a1i, cx, cy))) - k);

  const largeO = a1o - a0o - 2 * kO > 180 ? 1 : 0;
  const largeI = a1i - a0i - 2 * kI > 180 ? 1 : 0;

  return [
    `M ${f(s1a[0])} ${f(s1a[1])}`,
    `Q ${p(ro, a0o)} ${p(ro, a0o + kO)}`,
    `A ${f(ro)} ${f(ro)} 0 ${largeO} 1 ${p(ro, a1o - kO)}`,
    `Q ${p(ro, a1o)} ${f(s2a[0])} ${f(s2a[1])}`,
    `L ${f(s2b[0])} ${f(s2b[1])}`,
    `Q ${p(ri, a1i)} ${p(ri, a1i - kI)}`,
    `A ${f(ri)} ${f(ri)} 0 ${largeI} 0 ${p(ri, a0i + kI)}`,
    `Q ${p(ri, a0i)} ${f(s1b[0])} ${f(s1b[1])}`,
    'Z',
  ].join(' ');
}

function diff(a: [number, number], b: [number, number]): [number, number] {
  return [b[0] - a[0], b[1] - a[1]];
}

/** Arc along a circle from `from` to `to` degrees (clockwise), as an open path. */
export function arcPath(r: number, from: number, to: number): string {
  const span = Math.max(0, Math.min(359.999, to - from));
  if (span <= 0) return '';
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, from + span);
  return `M ${f(x0)} ${f(y0)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
}

/** Circle as a path, for clip-path shapes. `ccw` reverses winding to cut holes. */
export function circlePath(r: number, cx: number, cy: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} ${f(cy)} Z`;
}

/** Angle (0–360, clockwise from top) of a point relative to a centre. */
export function angleOf(x: number, y: number, cx: number, cy: number): number {
  const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** The four direction buttons, centred on top, right, bottom and left. */
export const SEGMENTS = {
  top: [-45, 45],
  right: [45, 135],
  bottom: [135, 225],
  left: [225, 315],
} as const;
