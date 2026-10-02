// How much each attack hurts. *When* it hurts (hit windows) lives in the asset
// manifest; this table is pure game balance, keyed by model id and clip name.
// Multi-hit clips list one entry per hit window.
//
// damage   HP removed            stun   hitstun seconds
// push     knockback meters      guard  guard meter drained when blocked
// hitstop  freeze-frame seconds  heavy  screen shake (heavy blows only)

const light = (damage, extra = {}) => ({ damage, stun: 0.38, push: 0.25, guard: 14, hitstop: 0.05, ...extra });

export const MOVES = {
  'main-character': {
    jab: light(6, { stun: 0.4, guard: 12 }),
    hook: light(8, { stun: 0.48, push: 0.4, guard: 18, hitstop: 0.06 }),
    // The finisher drains guard hard: the intended answer to a blocking enemy.
    uppercut: { damage: 13, stun: 0.8, push: 1.3, guard: 45, hitstop: 0.09, heavy: true },
  },
  'shiva-avatar': {
    palm_strike: { damage: 16, stun: 0.5, push: 0.9, guard: 30, hitstop: 0.06 },
    tandava_stomp: { damage: 20, knockdown: true, push: 2.8, guard: 60, hitstop: 0.08, heavy: true },
    trinetra_agni: { damage: 7, stun: 0.3, push: 0.15, unblockable: true, hitstop: 0.02 },
    trishul_prahar: { damage: 40, knockdown: true, push: 3.2, unblockable: true, hitstop: 0.12, heavy: true },
  },
  'gang-member': { jab: light(5), hook: light(8, { stun: 0.45, push: 0.45, guard: 22 }) },
  'gang-member-2': { jab: light(5), hook: light(8, { stun: 0.45, push: 0.45, guard: 22 }) },
  'gang-member-3': { jab: light(5) },
  henchmen: {
    jab: light(6),
    hook: light(9, { stun: 0.45, push: 0.45, guard: 24 }),
    combo_jab_body_hook: [light(5, { stun: 0.3 }), light(6, { stun: 0.35 }), { damage: 11, stun: 0.6, push: 1, guard: 30, hitstop: 0.07 }],
  },
  'gang-boss': {
    jab: light(7, { guard: 16 }),
    cross: light(10, { stun: 0.5, push: 0.6, guard: 25, hitstop: 0.06 }),
    // Long wind-up, big payoff. Blocking it costs most of the guard meter.
    haymaker: { damage: 22, knockdown: true, push: 2.2, guard: 75, hitstop: 0.12, heavy: true },
    combo_3hit: [light(6), light(6), { damage: 16, knockdown: true, push: 2, guard: 60, hitstop: 0.1, heavy: true }],
  },
};

export const THROWN = {
  // A crate flattens the target: it drops like it's dead (the 'dead' clip) but
  // survives with a big chunk of health gone, then gets back up.
  crate: { damage: 26, slam: true, push: 1.6, guard: 60, hitstop: 0.1, heavy: true },
  bottle: { damage: 10, stun: 0.5, push: 0.4, guard: 20, hitstop: 0.05 },
};

export const FIRE = { radius: 1.6, tick: 0.5, damage: 5, burn: 4.5 };

export function moveFor(modelId, clip, hitIndex = 0) {
  const m = MOVES[modelId]?.[clip];
  if (Array.isArray(m)) return m[Math.min(hitIndex, m.length - 1)];
  return m ?? null;
}
