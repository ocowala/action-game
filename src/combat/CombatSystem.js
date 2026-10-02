import * as THREE from 'three';
import { moveFor } from './moves.js';
import { beamHitsBody, circleHitsBody, resolveHit, sphereHitsBody } from './resolve.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();

/**
 * Each frame: builds the hit volume for every active manifest hit window, tests
 * it against opposing hurt cylinders, and applies resolved hits once per
 * (swing, window, tick) per target. Hit feel is deliberately minimal: the body
 * reaction animation plus a few frames of hitstop; shake only for heavy blows.
 */
export class CombatSystem {
  constructor(game) {
    this.game = game;
  }

  update() {
    const chars = this.game.characters;
    for (const attacker of chars) {
      if (!attacker.alive || attacker.hitStop > 0 || (this.game.freeze && attacker.team === 'enemy')) continue;
      const active = attacker.anim.activeHits();
      if (!active.length) continue;
      const clip = attacker.anim.name;
      for (const { hit, index, t } of active) {
        const move = moveFor(attacker.modelId, clip, index);
        if (!move) continue;
        const tick = hit.repeat ? Math.floor((t - hit.start) / hit.repeat) : 0;
        const key = `${attacker.swing}:${index}:${tick}`;
        for (const target of chars) {
          if (target === attacker || target.team === attacker.team || !target.alive) continue;
          if (target.lastHitBy.get(attacker) === key) continue;
          const point = this.test(attacker, hit, target);
          if (!point) continue;
          target.lastHitBy.set(attacker, key);
          this.applyHit(attacker, target, move, point);
        }
      }
    }
  }

  /** Returns a contact point if `hit` (from `attacker`) overlaps `target`, else null. */
  test(attacker, hit, target) {
    const body = target.body;
    switch (hit.shape) {
      case 'socket': {
        attacker.socketWorld(hit.socket, _a);
        return sphereHitsBody(_a, hit.radius, body) ? _a.clone() : null;
      }
      case 'radial': {
        const p = attacker.position;
        return circleHitsBody(p, hit.radius, body) ? new THREE.Vector3(body.x, body.y + 1, body.z) : null;
      }
      case 'front': {
        attacker.forward(_f).multiplyScalar(hit.forward ?? 1).add(attacker.position);
        return circleHitsBody(_f, hit.radius, body) ? new THREE.Vector3(body.x, body.y + 1, body.z) : null;
      }
      case 'beam': {
        attacker.socketWorld(hit.socket, _a);
        _b.copy(attacker.forward(_f)).multiplyScalar(hit.length).add(_a);
        _b.y = Math.max(attacker.position.y + 0.6, _a.y - 1); // the beam angles down toward the floor
        return beamHitsBody(_a, _b, hit.radius, body) ? new THREE.Vector3(body.x, body.y + 1.1, body.z) : null;
      }
      default:
        return null;
    }
  }

  /**
   * Resolves and applies one hit. `from` is where the blow comes from (for the
   * block arc); projectiles pass their own position.
   */
  applyHit(attacker, target, move, point, from = attacker?.position) {
    const scaled = attacker && attacker.damageMul !== 1 ? { ...move, damage: move.damage * attacker.damageMul } : move;
    const outcome = resolveHit(scaled, { x: from.x, z: from.z }, {
      x: target.position.x,
      z: target.position.z,
      yaw: target.yaw,
      blocking: target.blocking,
      guard: target.guard,
      invulnerable: target.invulnerable,
      superArmor: target.superArmor,
      stunned: target.stunned,
      damageTakenMul: target.damageTakenMul,
    });
    if (outcome.type === 'ignored') return outcome;
    target.receiveHit(outcome, attacker, move);

    const blocked = outcome.type === 'blocked';
    const stop = (move.hitstop ?? 0.05) * (blocked ? 0.6 : 1);
    target.hitStop = Math.max(target.hitStop, stop);
    if (attacker && attacker.position.distanceTo(target.position) < 3) attacker.hitStop = Math.max(attacker.hitStop, stop);

    const involvesPlayer = target === this.game.player || attacker === this.game.player;
    if (involvesPlayer && (move.heavy || outcome.type === 'guardBreak') && !blocked) this.game.cameraRig.shake(0.4);
    this.game.events.emit('hit', { attacker, target, outcome, move });
    return outcome;
  }

  /** Shoves opposing characters out of a radius (phase change, Shiva landing). */
  pushAway(source, radius) {
    for (const c of this.game.characters) {
      if (c.team === source.team || !c.alive || c.invulnerable) continue;
      const d = c.position.distanceTo(source.position);
      if (d > radius) continue;
      _f.subVectors(c.position, source.position).setY(0).normalize();
      const strength = (radius - d) * 0.9 + 0.6;
      c.knockback = { x: _f.x * strength, z: _f.z * strength, t: 0.18 };
      if (!c.superArmor && c.state !== 'dead') c.onHurt(0.45);
    }
  }

  /** Damage from the environment (fire): no stun, no block, skips i-frames. */
  environmentHit(target, damage) {
    if (target.invulnerable) return;
    target.applyDamage(damage * (target.damageTakenMul ?? 1), null);
  }
}
