// Level 1 data: The Parking Garage. Positions are meters in garage space
// (see docs/DESIGN.md for the layout). Encounters run in order; each trigger
// is evaluated by EncounterManager.

export const LEVEL1 = {
  id: 'level1',
  title: 'Level 1: The Parking Garage',
  model: 'parking-garage',
  playerSpawn: { x: -13.4, z: 0, yaw: Math.PI / 2 },
  // True isometric view from the south-east corner looking north-west. The
  // walk to the stairs runs down-right across the screen, toward the camera,
  // so the player is seen from the front (like a car in a classic iso shot).
  camera: { yaw: (5 * Math.PI) / 4, viewHeight: 13, bounds: { minX: -11.5, maxX: 12.5, minZ: -6, maxZ: 5.5 } },
  music: 'audio/level1.mp3',
  door: {
    group: 'exit_door',
    open: 'exit_door_open',
    rattle: 'exit_door_rattle',
    // Standing on the landing in front of the door.
    zone: { minX: 13.6, maxX: 15, minZ: -2.6, maxZ: 0.2, minY: 2 },
    exitAtX: 14.3, // the east wall stops a body at ~14.58
  },
  encounters: [
    {
      id: 'wave1',
      label: 'Wave 1 / 2',
      trigger: { minX: -10 },
      tokens: { melee: 1, ranged: 1 },
      spawns: [
        { archetype: 'brawler', model: 'gang-member', x: -3, z: 7.2, delay: 0 },
        { archetype: 'brawler', model: 'gang-member-2', x: -9.5, z: -7.4, delay: 0.6 },
        { archetype: 'thrower', model: 'gang-member-3', x: 1.4, z: -6.2, delay: 1.2 },
      ],
    },
    {
      id: 'wave2',
      label: 'Wave 2 / 2',
      trigger: { afterCleared: 'wave1', delay: 2.5 },
      tokens: { melee: 2, ranged: 1 },
      spawns: [
        { archetype: 'henchman', model: 'henchmen', x: 6.5, z: 0.5, delay: 0 },
        { archetype: 'veteranBrawler', model: 'gang-member-2', x: -3, z: 7.2, delay: 0.8 },
        { archetype: 'veteranThrower', model: 'gang-member-3', x: -9.5, z: -7.4, delay: 1.6 },
      ],
    },
    {
      id: 'boss',
      label: 'Boss',
      trigger: { afterCleared: 'wave2', delay: 1.0, minX: 1.5 },
      tokens: { melee: 1, ranged: 0 },
      boss: { model: 'gang-boss', name: 'Viper, Gang Boss', x: 8.6, z: -1.25 },
    },
  ],
};
