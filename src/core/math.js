export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** Frame-rate independent exponential smoothing toward `target`. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Rotates `current` toward `target` by at most `maxStep` radians. */
export function turnTowards(current, target, maxStep) {
  const d = wrapAngle(target - current);
  return current + clamp(d, -maxStep, maxStep);
}

/** Yaw (radians) that faces from `from` to `to`; yaw 0 faces +Z. */
export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

export const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function pickWeighted(items, weightOf = (i) => i.weight) {
  const total = items.reduce((s, i) => s + Math.max(0, weightOf(i)), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0, weightOf(item));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
