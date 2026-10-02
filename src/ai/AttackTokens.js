// Attack token coordinator: enemies must hold a token to start an attack, so
// only a limited number swing at the player at once (classic brawler crowd
// control). A short global spacing stops two tokens being granted on the same
// frame, which would make simultaneous hits feel unfair.

export class AttackTokens {
  constructor({ melee = 1, ranged = 1, spacing = 0.6 } = {}) {
    this.limits = { melee, ranged };
    this.spacing = spacing;
    this.cooldown = 0;
    this.holders = new Map(); // id -> kind
  }

  configure({ melee, ranged, spacing }) {
    if (melee !== undefined) this.limits.melee = melee;
    if (ranged !== undefined) this.limits.ranged = ranged;
    if (spacing !== undefined) this.spacing = spacing;
  }

  count(kind) {
    let n = 0;
    for (const k of this.holders.values()) if (k === kind) n++;
    return n;
  }

  /** @returns {boolean} whether `id` now holds a token of `kind` */
  request(id, kind = 'melee') {
    if (this.holders.has(id)) return this.holders.get(id) === kind;
    if (this.cooldown > 0 || this.count(kind) >= (this.limits[kind] ?? 0)) return false;
    this.holders.set(id, kind);
    this.cooldown = this.spacing;
    return true;
  }

  holds(id) {
    return this.holders.has(id);
  }

  release(id) {
    this.holders.delete(id);
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  clear() {
    this.holders.clear();
    this.cooldown = 0;
  }
}
