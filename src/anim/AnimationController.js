import * as THREE from 'three';

const LOOP_MODES = { loop: THREE.LoopRepeat, once: THREE.LoopOnce, hold: THREE.LoopOnce };

/**
 * Splits horizontal root motion out of a clip. The returned clip keeps the
 * root's vertical bob (falls, hops) but pins X/Z to the rest pose; the removed
 * X/Z curve is replayed by the controller as entity movement.
 */
export function extractRootMotion(clip, rootName, rest) {
  const trackName = `${rootName}.position`;
  const track = clip.tracks.find((t) => t.name === trackName);
  if (!track) return { clip, curve: null };
  const times = track.times.slice();
  const xz = new Float32Array(times.length * 2);
  const values = track.values.slice();
  for (let i = 0; i < times.length; i++) {
    xz[i * 2] = values[i * 3] - rest.x;
    xz[i * 2 + 1] = values[i * 3 + 2] - rest.z;
    values[i * 3] = rest.x;
    values[i * 3 + 2] = rest.z;
  }
  const pinned = new THREE.VectorKeyframeTrack(trackName, times, values);
  const tracks = clip.tracks.map((t) => (t === track ? pinned : t));
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), curve: { times, xz } };
}

/** Linear sample of a root-motion curve at clip time t. */
export function sampleCurve(curve, t, out = { x: 0, z: 0 }) {
  const { times, xz } = curve;
  const n = times.length;
  if (t <= times[0]) return Object.assign(out, { x: xz[0], z: xz[1] });
  if (t >= times[n - 1]) return Object.assign(out, { x: xz[(n - 1) * 2], z: xz[(n - 1) * 2 + 1] });
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = (t - times[lo]) / (times[hi] - times[lo]);
  out.x = xz[lo * 2] + (xz[hi * 2] - xz[lo * 2]) * a;
  out.z = xz[lo * 2 + 1] + (xz[hi * 2 + 1] - xz[lo * 2 + 1]) * a;
  return out;
}

/**
 * Drives one model's clips from manifest data:
 * - crossfades between clips, honoring each clip's loop mode (loop/once/hold),
 * - fires timed manifest events exactly once as clip time crosses them,
 * - reports active hit windows for the combat system,
 * - accumulates root motion so gameplay can move the entity.
 */
export class AnimationController {
  constructor(root, clips, meta) {
    this.root = root;
    this.meta = meta;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = new Map();
    this.curves = new Map();
    const rootBone = root.getObjectByName(meta.root);
    const rest = rootBone ? rootBone.position.clone() : new THREE.Vector3();
    for (const [name, clip] of clips) {
      const { clip: stripped, curve } = extractRootMotion(clip, meta.root, rest);
      this.clips.set(name, stripped);
      if (curve) this.curves.set(name, curve);
    }
    this.alternates = new Map(); // name -> clone, so a clip can crossfade into itself
    this.current = null;
    this.layers = new Map();
    this.rootDelta = { x: 0, z: 0 };
    this._a = { x: 0, z: 0 };
    this._b = { x: 0, z: 0 };
  }

  has(name) {
    return this.clips.has(name);
  }

  clipMeta(name) {
    return this.meta.clips[name];
  }

  /**
   * @param {string} name clip name from the manifest
   * @param {{fade?: number, timeScale?: number, onEvent?: Function, onEnd?: Function, restart?: boolean}} opts
   */
  play(name, { fade = 0.12, timeScale = 1, onEvent = null, onEnd = null, restart = true } = {}) {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`${this.meta.root}: no clip "${name}"`);
    const prev = this.current;
    if (prev && prev.name === name && !restart) {
      prev.action.timeScale = timeScale;
      return prev;
    }
    const meta = this.meta.clips[name];
    let source = clip;
    if (prev && prev.name === name && fade > 0) {
      // Same clip again (jab, jab): alternate between two copies so it blends
      // from the recovery pose instead of snapping back to frame 0.
      if (!this.alternates.has(name)) this.alternates.set(name, clip.clone());
      const alt = this.alternates.get(name);
      source = prev.action.getClip() === alt ? clip : alt;
    }
    const action = this.mixer.clipAction(source);
    action.reset();
    const reversed = timeScale < 0;
    if (reversed) action.time = clip.duration; // play back from the last frame
    action.setLoop(LOOP_MODES[meta.loop] ?? THREE.LoopOnce, Infinity);
    action.clampWhenFinished = meta.loop !== 'loop';
    action.timeScale = timeScale;
    action.setEffectiveWeight(1);
    action.play();
    if (prev && prev.action !== action && fade > 0) action.crossFadeFrom(prev.action, fade, false);
    else if (prev && prev.action !== action) prev.action.stop();

    // Reversed playback skips events: they are authored for forward time.
    this.current = { name, action, meta, prevTime: reversed ? meta.length : -1e-6, onEvent: reversed ? null : onEvent, onEnd, ended: false, reversed };
    return this.current;
  }

  /** Plays a looping clip on top of the base clip, e.g. Shiva's shiva_ambient. */
  playLayer(name) {
    if (this.layers.has(name)) return;
    const action = this.mixer.clipAction(this.clips.get(name));
    action.setLoop(THREE.LoopRepeat, Infinity).play();
    this.layers.set(name, action);
  }

  stopLayer(name) {
    this.layers.get(name)?.stop();
    this.layers.delete(name);
  }

  get name() {
    return this.current?.name ?? null;
  }

  get time() {
    return this.current?.action.time ?? 0;
  }

  get length() {
    return this.current?.meta.length ?? 0;
  }

  get finished() {
    return this.current?.ended ?? true;
  }

  /** True once the clip's authored cancel point (or its end) has passed. */
  get cancellable() {
    const c = this.current;
    if (!c) return true;
    return c.ended || (c.meta.cancelAt !== undefined && c.action.time >= c.meta.cancelAt);
  }

  /** Hit windows active at the current clip time, with their index. */
  activeHits() {
    const c = this.current;
    if (!c?.meta.hits?.length) return [];
    const t = c.action.time;
    const out = [];
    c.meta.hits.forEach((hit, index) => {
      if (t >= hit.start && t <= hit.end) out.push({ hit, index, t });
    });
    return out;
  }

  /** Root motion accumulated since the last call, in model space (meters). */
  consumeRootMotion() {
    const d = { x: this.rootDelta.x, z: this.rootDelta.z };
    this.rootDelta.x = 0;
    this.rootDelta.z = 0;
    return d;
  }

  update(dt) {
    const c = this.current;
    const before = c ? Math.max(0, c.action.time) : 0;
    this.mixer.update(dt);
    if (!c) return;

    const after = c.action.time;
    const length = c.meta.length;
    const wrapped = c.meta.loop === 'loop' && after < before - 1e-6;

    // Events: fire everything in (prevTime, after], handling loop wrap.
    if (c.onEvent && c.meta.events?.length) {
      for (const ev of c.meta.events) {
        const crossed = wrapped ? ev.t > c.prevTime || ev.t <= after : ev.t > c.prevTime && ev.t <= after;
        if (crossed) c.onEvent(ev);
      }
    }
    c.prevTime = after;

    // Root motion delta for this frame.
    const curve = this.curves.get(c.name);
    if (curve) {
      const a = sampleCurve(curve, before, this._a);
      const b = sampleCurve(curve, after, this._b);
      if (wrapped) {
        const end = sampleCurve(curve, length, { x: 0, z: 0 });
        const start = sampleCurve(curve, 0, { x: 0, z: 0 });
        this.rootDelta.x += end.x - a.x + (b.x - start.x);
        this.rootDelta.z += end.z - a.z + (b.z - start.z);
      } else {
        this.rootDelta.x += b.x - a.x;
        this.rootDelta.z += b.z - a.z;
      }
    }

    const done = c.reversed ? after <= 1e-4 : after >= length - 1e-4;
    if (!c.ended && c.meta.loop !== 'loop' && done) {
      c.ended = true;
      c.onEnd?.(c.name);
    }
  }
}
