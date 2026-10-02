// Static level collision built from the AABBs the asset build extracts from the
// garage model. Characters are vertical cylinders; a box is "floor" if its top is
// within step height of the feet and a wall otherwise, which is what makes the
// stairs walkable without any special casing.

export class CollisionWorld {
  constructor(boxes, { stepHeight = 0.45, bodyHeight = 1.7 } = {}) {
    this.stepHeight = stepHeight;
    this.bodyHeight = bodyHeight;
    this.boxes = boxes.map((b) => ({
      name: b.name,
      group: b.group,
      minX: b.min[0], minY: b.min[1], minZ: b.min[2],
      maxX: b.max[0], maxY: b.max[1], maxZ: b.max[2],
      enabled: true,
    }));
  }

  /** Enables/disables every box from a group (e.g. the exit door once it opens). */
  setGroupEnabled(group, enabled) {
    for (const b of this.boxes) if (b.group === group) b.enabled = enabled;
  }

  /** Highest walkable surface under (x, z) reachable from feet height `footY`. */
  groundAt(x, z, footY) {
    let best = 0;
    for (const b of this.boxes) {
      if (!b.enabled || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= footY + this.stepHeight && b.maxY > best) best = b.maxY;
    }
    return best;
  }

  /**
   * Pushes a cylinder (pos.x/z, radius) out of walls overlapping its body band.
   * Mutates pos; returns true if anything was hit.
   */
  pushOut(pos, radius, footY) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.boxes) {
        if (!b.enabled) continue;
        if (b.maxY <= footY + this.stepHeight || b.minY >= footY + this.bodyHeight) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        } else {
          // Center inside the box: leave along the shallowest axis.
          const exits = [
            [b.minX - radius - pos.x, 0],
            [b.maxX + radius - pos.x, 0],
            [0, b.minZ - radius - pos.z],
            [0, b.maxZ + radius - pos.z],
          ];
          exits.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          pos.x += exits[0][0];
          pos.z += exits[0][1];
        }
      }
    }
    return hit;
  }

  /** True if a cylinder at (x, z) would not overlap any wall. */
  isFree(x, z, radius, footY = 0) {
    const p = { x, z };
    return !this.pushOut(p, radius, footY);
  }

  /**
   * First hit along the segment from -> to (slab test), as a fraction in [0, 1].
   * Used to keep the camera out of pillars and walls.
   */
  raycast(from, to, ignoreBelow = -Infinity) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    let best = 1;
    for (const b of this.boxes) {
      if (!b.enabled || b.maxY < ignoreBelow) continue;
      let t0 = 0;
      let t1 = best;
      const axes = [
        [from.x, dx, b.minX, b.maxX],
        [from.y, dy, b.minY, b.maxY],
        [from.z, dz, b.minZ, b.maxZ],
      ];
      let miss = false;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            miss = true;
            break;
          }
          continue;
        }
        let ta = (lo - o) / d;
        let tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          miss = true;
          break;
        }
      }
      if (!miss && t0 < best) best = t0;
    }
    return best;
  }
}
