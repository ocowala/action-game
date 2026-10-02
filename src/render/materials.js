import * as THREE from 'three';

// The converter names each glTF material after the rule that produced it
// (tools/asset-config.mjs). Here those names become real render materials:
// emissive signage, additive fire and beams, transparent glass.

function fxMaterial(src, { opacity = 1, additive = true, boost = 1 } = {}) {
  const m = new THREE.MeshBasicMaterial({
    map: src.map,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.color.setScalar(boost);
  m.name = src.name;
  m.userData.fx = true;
  return m;
}

function emissive(src, intensity) {
  const m = src.clone();
  m.emissive = new THREE.Color(1, 1, 1);
  m.emissiveMap = src.map;
  m.emissiveIntensity = intensity;
  return m;
}

function transparent(src, opacity) {
  const m = src.clone();
  Object.assign(m, { transparent: true, opacity, depthWrite: false, roughness: 0.1, metalness: 0.2 });
  return m;
}

const UPGRADES = {
  glass: (m) => transparent(m, 0.32),
  debris: (m) => transparent(m, 0.75),
  smoke: (m) => Object.assign(transparent(m, 0.5), { roughness: 1, metalness: 0 }),
  emissive: (m) => emissive(m, 1.6),
  sign: (m) => emissive(m, 2.2),
  signglow: (m) => fxMaterial(m, { opacity: 0.6, boost: 1.5 }),
  divine: (m) => emissive(m, 2.4),
  glow: (m) => fxMaterial(m, { opacity: 0.3 }),
  fire: (m) => fxMaterial(m, { opacity: 0.8, boost: 0.9 }),
  beam: (m) => fxMaterial(m, { opacity: 0.9, boost: 2.2 }),
  energy: (m) => fxMaterial(m, { opacity: 0.75, boost: 1.6 }),
};

/** Replaces converter materials in-place; shared materials stay shared. */
export function upgradeMaterials(root) {
  const cache = new Map();
  const upgrade = (m) => {
    if (!cache.has(m)) {
      const fn = UPGRADES[m.name];
      const out = fn ? fn(m) : m;
      if (!fn && out.isMeshStandardMaterial) {
        out.roughness = 0.9;
        out.metalness = 0;
      }
      cache.set(m, out);
    }
    return cache.get(m);
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(upgrade) : upgrade(o.material);
  });
}

/**
 * Gives a character its own copies of its lit materials so it can be tinted
 * (hit flash, attack tell) without affecting other instances.
 * @returns {THREE.Material[]} the tintable materials
 */
export function makeTintable(root) {
  const copies = new Map();
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m.isMeshStandardMaterial || m.userData.fx) return;
    if (!copies.has(m)) {
      const c = m.clone();
      c.userData.baseEmissive = c.emissive.clone();
      c.userData.baseEmissiveIntensity = c.emissiveIntensity;
      copies.set(m, c);
    }
    o.material = copies.get(m);
  });
  return [...copies.values()];
}

/** Applies a flat emissive tint on top of a material's own emissive. */
export function setTint(materials, color, amount) {
  for (const m of materials) {
    if (amount <= 0) {
      m.emissive.copy(m.userData.baseEmissive);
      m.emissiveIntensity = m.userData.baseEmissiveIntensity;
      continue;
    }
    if (m.emissiveMap) continue; // signage already glows; don't wash it out
    m.emissive.copy(color);
    m.emissiveIntensity = amount;
  }
}
