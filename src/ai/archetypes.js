// Enemy tuning. Difficulty ramps by archetype rather than by hidden scaling:
// wave 1 is slow and solitary, wave 2 attacks in pairs and blocks, the boss
// mixes everything and speeds up at half health.

const brawler = {
  hp: 45,
  speed: 2.0,
  radius: 0.42,
  engageRange: 3.6, // start circling inside this
  circle: [2.6, 3.6], // preferred distance band while waiting for a token
  cooldown: [1.8, 2.8], // seconds between attacks once a token is released
  windup: 0.25, // extra pause after getting a token: part of the tell
  damageMul: 1,
  blockChance: 0,
  guard: 0,
  moves: [
    { clip: 'jab', weight: 3, range: 1.25 },
    { clip: 'hook', weight: 2, range: 1.2 },
  ],
};

const thrower = {
  ...brawler,
  hp: 32,
  speed: 1.9,
  ranged: true,
  kite: [5.5, 8.5], // keeps this distance band
  cooldown: [2.8, 3.8],
  moves: [{ clip: 'jab', weight: 1, range: 1.25 }],
};

export const ARCHETYPES = {
  brawler,
  thrower,
  veteranBrawler: { ...brawler, hp: 60, speed: 2.35, cooldown: [1.2, 2.0], windup: 0.18, damageMul: 1.25, circle: [2.3, 3.2] },
  veteranThrower: { ...thrower, hp: 40, cooldown: [2.2, 3.0], damageMul: 1.25 },
  henchman: {
    ...brawler,
    hp: 90,
    speed: 2.2,
    cooldown: [1.4, 2.2],
    windup: 0.2,
    damageMul: 1.1,
    blockChance: 0.55, // chance to raise guard when the player swings in front
    guard: 70,
    moves: [
      { clip: 'jab', weight: 2, range: 1.25 },
      { clip: 'hook', weight: 2, range: 1.2 },
      { clip: 'combo_jab_body_hook', weight: 3, range: 1.3 },
    ],
  },
};

export const BOSS = {
  hp: 420,
  speed: 2.2,
  radius: 0.48,
  guard: 100,
  guardRegen: 18, // per second, after 1.5 s without being hit
  blockChance: [0.35, 0.5], // per phase
  flinchCooldown: 1.6, // can't be stun-locked by jab spam
  phase2At: 0.5,
  phase2TimeScale: 1.2, // attacks play faster in phase 2
  cooldown: [[1.3, 2.1], [0.8, 1.4]],
  haymakerTimeScale: 0.85, // phase 1 haymaker is deliberately slow to teach the tell
  molotovCooldown: 9,
  crateCooldown: 11,
};
