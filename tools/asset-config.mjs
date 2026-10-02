// Which Blockbench sources become game assets, and how their materials and
// colliders are classified. Rules are first-match-wins and test the element
// name and then each ancestor group name.

export const SCALE = 1 / 16; // Blockbench px -> meters
export const FPS = 60; // animation bake rate

const fire = { name: 'fire', match: /^(flame|fireball|ember|fire_splash|molotov_flame|lighter_flame|fire_[ab]$)/, gltf: { emissive: [1, 0.55, 0.15] } };

export const MODELS = [
  { id: 'main-character', source: 'main-character.bbmodel' },
  { id: 'gang-member', source: 'gang-member.bbmodel' },
  { id: 'gang-member-2', source: 'gang-member-2.bbmodel' },
  { id: 'gang-member-3', source: 'gang-member-3.bbmodel' },
  { id: 'henchmen', source: 'henchmen.bbmodel' },
  { id: 'gang-boss', source: 'gang-boss.bbmodel' },
  {
    id: 'shiva-avatar',
    source: 'shiva-avatar.bbmodel',
    materials: [{ name: 'divine', match: /^(third_eye_glow|third_eye_iris|bindi|crescent_moon)$/, gltf: { emissive: [1, 0.8, 0.45] } }],
  },
  {
    id: 'props',
    source: 'props.bbmodel',
    materials: [
      { name: 'beam', match: /^(trinetra_beam|data_beam|scan_beam)$/, gltf: { emissive: [1, 0.7, 0.3], alpha: 0.85 } },
      { name: 'energy', match: /^(shockwave_ring|sonic_ring|energy_orb|laser_beams)$/, gltf: { emissive: [0.9, 0.9, 1], alpha: 0.7 } },
      { name: 'divine', match: /^tri_gem$/, gltf: { emissive: [1, 0.3, 0.2] } },
      fire,
      { name: 'smoke', match: /^smoke_\d+$/, gltf: { alpha: 0.55 } },
      { name: 'glass', match: /^shard_\d+$/, gltf: { alpha: 0.6 } },
    ],
  },
  {
    id: 'parking-garage',
    source: 'parking-garage.bbmodel',
    materials: [
      // Hidden at runtime by the isometric camera (south-east corner): the two
      // near walls, their decals and everything overhead. The exit door, its
      // frame and the sign stay; only the wall slab around them goes.
      { name: 'cutaway', match: /^(wall_south|wall_east|wall_streak_\d+|stair_wall_shadow|exit_passage_dark|pipe_\d|beam_.*|light_housing_.*|light_tube_.*)$/ },
      // Pillars are cut down to stubs at runtime so they never hide the fight.
      { name: 'cutlow', match: /^pillar_\d+_[ns]$/ },
      // The exit sign gets its own materials so it can turn red -> green on unlock.
      { name: 'sign', match: /^exit_sign$/, gltf: { emissive: [1, 1, 1] } },
      { name: 'signglow', match: /^exit_sign_glow$/, gltf: { emissive: [1, 1, 1], alpha: 0.5 } },
      { name: 'glow', match: /^light_glow_.*$/, gltf: { emissive: [1, 1, 1], alpha: 0.35 } },
      { name: 'emissive', match: /^(light_tube_.*|exit_sign|headlight_[lr]|taillight_[lr])$/, gltf: { emissive: [1, 1, 1] } },
      { name: 'glass', match: /^(cabin_glass|door_window)$/, gltf: { alpha: 0.35 } },
      // Floor shards around a broken bottle; hidden when the bottle is held or thrown.
      { name: 'debris', match: /^floor_shard_\d+$/, gltf: { alpha: 0.75 } },
    ],
    colliders: {
      groups: ['structure', 'staircase', 'cars'],
      // Decals and overhead dressing that never touch the walkable band.
      exclude: /^(wall_streak_.*|pipe_\d|beam_.*|stair_wall_shadow|step_nosing_\d+|exit_passage_dark|exit_sign.*|grime_strip|plate|headlight_[lr]|taillight_[lr]|grille|rim)$/,
    },
  },
];
