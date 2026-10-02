// Pure combat rules: no Three.js objects, no side effects, so they are unit tested.

export const GUARD_ARC_COS = Math.cos((80 * Math.PI) / 180); // block covers ±80° in front
export const STUNNED_DAMAGE_MUL = 1.5;

/**
 * Decides what a landed hit does.
 * @param move     { damage, stun?, push?, guard?, chip?, knockdown?, slam?, unblockable? }
 * @param attacker { x, z }
 * @param defender { x, z, yaw, blocking, guard, invulnerable, superArmor, stunned, damageTakenMul }
 * @returns {{type: 'ignored'|'blocked'|'guardBreak'|'armored'|'hit'|'knockdown'|'slam', damage: number, guard?: number, stun?: number, push?: number}}
 */
export function resolveHit(move, attacker, defender) {
  if (defender.invulnerable) return { type: 'ignored', damage: 0 };

  const dx = attacker.x - defender.x;
  const dz = attacker.z - defender.z;
  const len = Math.hypot(dx, dz) || 1;
  const facing = (Math.sin(defender.yaw) * dx + Math.cos(defender.yaw) * dz) / len;

  if (defender.blocking && !move.unblockable && facing >= GUARD_ARC_COS) {
    const guard = defender.guard - (move.guard ?? 10);
    if (guard <= 0) return { type: 'guardBreak', damage: 0, guard: 0 };
    return { type: 'blocked', damage: move.chip ?? 0, guard };
  }

  const damage = move.damage * (defender.stunned ? STUNNED_DAMAGE_MUL : 1) * (defender.damageTakenMul ?? 1);
  if (defender.superArmor) return { type: 'armored', damage };
  if (move.slam) return { type: 'slam', damage, push: move.push ?? 1.5 };
  if (move.knockdown) return { type: 'knockdown', damage, push: move.push ?? 1.5 };
  return { type: 'hit', damage, stun: move.stun ?? 0.35, push: move.push ?? 0.3 };
}

/** Sphere vs. vertical cylinder (a character's hurt volume). */
export function sphereHitsBody(center, radius, body) {
  const d = Math.hypot(center.x - body.x, center.z - body.z);
  if (d > radius + body.radius) return false;
  return center.y + radius >= body.y && center.y - radius <= body.y + body.height;
}

/** Ground circle vs. cylinder, with a vertical tolerance (stomps, ground slams). */
export function circleHitsBody(center, radius, body, maxDy = 1.2) {
  return Math.hypot(center.x - body.x, center.z - body.z) <= radius + body.radius && Math.abs(center.y - body.y) <= maxDy;
}

/** Capsule (segment a->b, radius) vs. cylinder, tested in the ground plane. */
export function beamHitsBody(a, b, radius, body) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((body.x - a.x) * abx + (body.z - a.z) * abz) / len2));
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  const py = a.y + (b.y - a.y) * t;
  if (Math.hypot(body.x - px, body.z - pz) > radius + body.radius) return false;
  return py + radius >= body.y && py - radius <= body.y + body.height;
}
