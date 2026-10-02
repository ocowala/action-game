import * as THREE from 'three';
import { THROWN } from '../combat/moves.js';
import { sphereHitsBody } from '../combat/resolve.js';

const GRAVITY = 14;
const RADIUS = { crate: 0.5, bottle: 0.25, molotov: 0.25 };

/**
 * Thrown crates, bottles and Molotovs. Each launch solves a ballistic arc that
 * reaches the target in `flightTime`. Enemy throws draw a landing marker so the
 * player always gets a readable warning.
 */
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  launch({ kind, held, owner, target, flightTime = 0.8, marker = false }) {
    const game = this.game;
    const obj = held.object;
    const from = held.worldPosition.clone();
    game.scene.add(obj);
    obj.position.copy(from);
    if (kind === 'bottle') game.level.hideDebris(obj);

    const to = target.clone();
    const lob = kind === 'molotov' || (kind === 'crate' && owner.team === 'enemy');
    if (lob) to.y = game.level.collision.groundAt(to.x, to.z, to.y + 0.5);
    const T = flightTime;
    const vel = new THREE.Vector3().subVectors(to, from).divideScalar(T);
    vel.y += 0.5 * GRAVITY * T;

    if (marker) game.vfx.groundMarker({ x: to.x, y: game.level.collision.groundAt(to.x, to.z, to.y + 0.5), z: to.z }, kind === 'molotov' ? 1.6 : 1.1, T);
    this.list.push({
      kind,
      obj,
      owner,
      team: owner.team,
      vel,
      t: 0,
      spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3).multiplyScalar(kind === 'crate' ? 0.4 : 1.5),
      prev: from.clone(),
    });
  }

  update(dt) {
    const game = this.game;
    this.list = this.list.filter((p) => {
      p.t += dt;
      p.prev.copy(p.obj.position);
      p.vel.y -= GRAVITY * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      const pos = p.obj.position;

      for (const c of game.characters) {
        if (c.team === p.team || !c.alive) continue;
        if (sphereHitsBody(pos, RADIUS[p.kind], c.body)) return this.impact(p, c);
      }
      const ground = game.level.collision.groundAt(pos.x, pos.z, pos.y + 0.6);
      if (pos.y <= ground + 0.05) return this.impact(p, null, ground);
      if (game.level.collision.raycast(p.prev, pos) < 1) return this.impact(p, null);
      return p.t < 4 || this.impact(p, null);
    });
  }

  impact(p, target, ground) {
    const game = this.game;
    const pos = p.obj.position.clone();
    p.obj.removeFromParent();
    if (p.kind === 'molotov') {
      const y = ground ?? game.level.collision.groundAt(pos.x, pos.z, pos.y + 0.5);
      game.vfx.fireZone({ x: pos.x, y, z: pos.z }, p.team === 'enemy' ? 'player' : 'enemy');
      return false;
    }
    if (target) game.combat.applyHit(p.owner, target, THROWN[p.kind], pos, p.prev);
    return false;
  }

  clear() {
    for (const p of this.list) p.obj.removeFromParent();
    this.list.length = 0;
  }
}
