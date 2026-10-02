// Evaluates Blockbench animation channels the same way Blockbench previews them,
// so baked glTF tracks match what the animator saw in the editor.

export function numeric(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// A keyframe may carry two data points (pre/post) to author a discontinuity.
// side 0 is the value arriving at the key, side 1 the value leaving it.
function valueOf(keyframe, side) {
  const points = keyframe.data_points;
  const p = points[Math.min(side, points.length - 1)];
  return [numeric(p.x), numeric(p.y), numeric(p.z)];
}

// Uniform Catmull-Rom, identical to THREE.Interpolations.CatmullRom which
// Blockbench drives through THREE.SplineCurve.
export function catmullRom(t, p0, p1, p2, p3) {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export function sortKeyframes(keyframes) {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

/** Samples one channel (sorted keyframes) at `time`. Returns [x, y, z] in Blockbench units. */
export function sampleChannel(keyframes, time) {
  const n = keyframes.length;
  if (n === 0) return null;
  if (time <= keyframes[0].time) return valueOf(keyframes[0], 0);
  if (time >= keyframes[n - 1].time) return valueOf(keyframes[n - 1], 1);

  let i = 0;
  while (i < n - 2 && keyframes[i + 1].time <= time) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.time - a.time;
  const alpha = span > 0 ? (time - a.time) / span : 1;
  const from = valueOf(a, 1);
  const to = valueOf(b, 0);

  if (a.interpolation === 'step') return from;

  if (a.interpolation === 'catmullrom' || b.interpolation === 'catmullrom') {
    // Neighbours are only used when the key has a single data point; otherwise
    // the discontinuity breaks the curve, matching Blockbench.
    const before = i > 0 && a.data_points.length === 1 ? valueOf(keyframes[i - 1], 1) : from;
    const after = i + 2 < n && b.data_points.length === 1 ? valueOf(keyframes[i + 2], 0) : to;
    return [0, 1, 2].map((k) => catmullRom(alpha, before[k], from[k], to[k], after[k]));
  }

  // 'linear' (and 'bezier', which these assets do not use) fall back to lerp.
  return [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * alpha);
}

/** Uniform sample times covering [0, length], always including the end. */
export function sampleTimes(length, fps) {
  const times = [];
  const steps = Math.max(1, Math.ceil(length * fps - 1e-6));
  for (let s = 0; s <= steps; s++) times.push(Math.min(length, s / fps));
  return times;
}
