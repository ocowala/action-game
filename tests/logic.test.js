import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AttackTokens } from '../src/ai/AttackTokens.js';
import { extractRootMotion, sampleCurve } from '../src/anim/AnimationController.js';
import { beamHitsBody, resolveHit, sphereHitsBody } from '../src/combat/resolve.js';
import { triggerReady } from '../src/encounter/EncounterManager.js';
import { CollisionWorld } from '../src/world/Collision.js';
import { sampleChannel } from '../tools/lib/keyframes.mjs';

const kf = (time, x, interpolation = 'linear') => ({ time, interpolation, data_points: [{ x, y: 0, z: 0 }] });

describe('keyframe sampling (Blockbench semantics)', () => {
  it('holds the first/last value outside the keyed range', () => {
    const keys = [kf(0.2, 10), kf(0.4, 20)];
    expect(sampleChannel(keys, 0)[0]).toBe(10);
    expect(sampleChannel(keys, 1)[0]).toBe(20);
  });
  it('lerps linear segments and passes through catmull-rom keys', () => {
    expect(sampleChannel([kf(0, 0), kf(1, 10)], 0.5)[0]).toBeCloseTo(5);
    const cr = [kf(0, 0, 'catmullrom'), kf(1, 10, 'catmullrom'), kf(2, 0, 'catmullrom')];
    expect(sampleChannel(cr, 1)[0]).toBeCloseTo(10);
    expect(sampleChannel(cr, 0.5)[0]).toBeGreaterThan(5); // curve overshoots the straight line toward the peak
  });
  it('accepts numeric strings', () => {
    expect(sampleChannel([{ time: 0, interpolation: 'linear', data_points: [{ x: '62', y: '0', z: '-15' }] }], 0)).toEqual([62, 0, -15]);
  });
});

describe('root motion', () => {
  const track = new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0.1, 0, 0.5, 0.2, -0.3]);
  const clip = new THREE.AnimationClip('get_up', 1, [track]);
  const { clip: stripped, curve } = extractRootMotion(clip, 'root', new THREE.Vector3());

  it('pins horizontal motion in the clip but keeps the vertical bob', () => {
    const v = stripped.tracks[0].values;
    expect([v[3], v[4], v[5]]).toEqual([0, expect.closeTo(0.2), 0]);
  });
  it('replays the removed X/Z as a curve', () => {
    expect(sampleCurve(curve, 1)).toEqual({ x: 0.5, z: expect.closeTo(-0.3) });
    expect(sampleCurve(curve, 0.5).x).toBeCloseTo(0.25);
  });
});

describe('hit resolution', () => {
  const jab = { damage: 6, stun: 0.4, guard: 12 };
  const defender = (o = {}) => ({ x: 0, z: 0, yaw: 0, blocking: false, guard: 100, invulnerable: false, superArmor: false, stunned: false, damageTakenMul: 1, ...o });
  const front = { x: 0, z: 1 }; // yaw 0 faces +Z
  const behind = { x: 0, z: -1 };

  it('blocks from the front and drains guard', () => {
    expect(resolveHit(jab, front, defender({ blocking: true }))).toMatchObject({ type: 'blocked', damage: 0, guard: 88 });
  });
  it('does not block from behind', () => {
    expect(resolveHit(jab, behind, defender({ blocking: true })).type).toBe('hit');
  });
  it('breaks guard when it runs out', () => {
    expect(resolveHit({ ...jab, guard: 50 }, front, defender({ blocking: true, guard: 40 })).type).toBe('guardBreak');
  });
  it('ignores i-frames, honors super armor, knockdowns and stun bonus', () => {
    expect(resolveHit(jab, front, defender({ invulnerable: true })).type).toBe('ignored');
    expect(resolveHit(jab, front, defender({ superArmor: true }))).toMatchObject({ type: 'armored', damage: 6 });
    expect(resolveHit({ ...jab, knockdown: true }, front, defender()).type).toBe('knockdown');
    expect(resolveHit(jab, front, defender({ stunned: true })).damage).toBe(9);
  });
  it('a crate flattens (slam) unless armored, and can be blocked', () => {
    const crate = { damage: 26, slam: true, guard: 60 };
    expect(resolveHit(crate, front, defender())).toMatchObject({ type: 'slam', damage: 26 });
    expect(resolveHit(crate, front, defender({ superArmor: true })).type).toBe('armored');
    expect(resolveHit(crate, front, defender({ blocking: true })).type).toBe('blocked');
  });
  it('unblockable moves go through a guard', () => {
    expect(resolveHit({ ...jab, unblockable: true }, front, defender({ blocking: true })).type).toBe('hit');
  });
  it('tests hit volumes against a body cylinder', () => {
    const body = { x: 0, y: 0, z: 0, radius: 0.4, height: 1.9 };
    expect(sphereHitsBody({ x: 0.7, y: 1.4, z: 0 }, 0.4, body)).toBe(true);
    expect(sphereHitsBody({ x: 0.7, y: 2.6, z: 0 }, 0.4, body)).toBe(false);
    expect(beamHitsBody({ x: -3, y: 1.5, z: 0.5 }, { x: 3, y: 1.5, z: 0.5 }, 0.3, body)).toBe(true);
  });
});

describe('attack tokens', () => {
  it('caps simultaneous attackers and spaces grants', () => {
    const t = new AttackTokens({ melee: 2, spacing: 0.5 });
    expect(t.request('a')).toBe(true);
    expect(t.request('b')).toBe(false); // spacing cooldown
    t.update(0.6);
    expect(t.request('b')).toBe(true);
    t.update(0.6);
    expect(t.request('c')).toBe(false); // limit reached
    t.release('a');
    expect(t.request('c')).toBe(true);
  });
  it('tracks melee and ranged separately', () => {
    const t = new AttackTokens({ melee: 1, ranged: 1, spacing: 0 });
    expect(t.request('a', 'melee')).toBe(true);
    expect(t.request('b', 'ranged')).toBe(true);
    expect(t.request('c', 'melee')).toBe(false);
  });
});

describe('encounter triggers', () => {
  const base = { cleared: new Set(['wave1']), clearedAt: new Map([['wave1', 10]]), now: 11, playerX: 0 };
  it('waits for the previous wave plus its delay', () => {
    expect(triggerReady({ afterCleared: 'wave1', delay: 2.5 }, base)).toBe(false);
    expect(triggerReady({ afterCleared: 'wave1', delay: 2.5 }, { ...base, now: 13 })).toBe(true);
    expect(triggerReady({ afterCleared: 'wave2' }, base)).toBe(false);
  });
  it('needs the player past a line', () => {
    expect(triggerReady({ minX: 1.5 }, base)).toBe(false);
    expect(triggerReady({ minX: 1.5 }, { ...base, playerX: 2 })).toBe(true);
  });
});

describe('level collision', () => {
  // A wall and a three-step staircase (0.19 m rise per 0.375 m), like the garage.
  const steps = [0, 1, 2].map((i) => ({ name: `step_${i}`, group: 'staircase', min: [i * 0.375, 0, -1], max: [3, 0.1875 * (i + 1), 1] }));
  const world = new CollisionWorld([{ name: 'wall', group: 'structure', min: [-3, 0, -1], max: [-2, 3, 1] }, ...steps]);

  it('pushes a body out of walls', () => {
    const p = { x: -1.8, z: 0 };
    expect(world.pushOut(p, 0.42, 0)).toBe(true);
    expect(p.x).toBeCloseTo(-1.58);
  });
  it('treats low steps as floor so stairs are climbable', () => {
    const p = { x: -0.2, z: 0 };
    expect(world.pushOut(p, 0.42, 0)).toBe(false); // two steps ahead are still within step height
    expect(world.groundAt(0.2, 0, 0)).toBeCloseTo(0.1875);
    expect(world.groundAt(0.9, 0, 0.375)).toBeCloseTo(0.5625);
  });
  it('raycasts for the camera', () => {
    expect(world.raycast({ x: 0, y: 1, z: 0 }, { x: -4, y: 1, z: 0 })).toBeCloseTo(0.5);
  });
});
