import * as THREE from 'three';
import { AnimationController } from '../anim/AnimationController.js';
import { CollisionWorld } from './Collision.js';

const LOCKED = new THREE.Color(1, 0.12, 0.08);
const UNLOCKED = new THREE.Color(0.15, 1, 0.35);

/**
 * The garage: static model + collision, the exit door and its two clips, the
 * pickups (crates and bottles are detached from the level model at load), the
 * light rig and the exit sign that turns green when the boss falls.
 */
export class Level {
  constructor(game, data) {
    this.game = game;
    this.data = data;
    const { root, clips, meta } = game.assets.instantiate(data.model);
    this.root = root;
    game.scene.add(root);
    this.collision = new CollisionWorld(meta.colliders);
    this.anim = new AnimationController(root, clips, meta);
    this.doorState = 'locked';
    this.rattleCooldown = 0;

    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'cutaway') o.visible = false;
      if (o.material.name === 'cutlow') {
        // Clip near-side pillars above head height (isometric cutaway).
        o.material = o.material.clone();
        o.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.6)];
        o.material.side = THREE.DoubleSide;
      }
      o.receiveShadow = true;
    });

    this.signMaterials = [];
    root.traverse((o) => {
      if (o.isMesh && (o.material.name === 'sign' || o.material.name === 'signglow') && !this.signMaterials.includes(o.material)) this.signMaterials.push(o.material);
    });

    this.pickups = [];
    root.updateMatrixWorld(true);
    const group = root.getObjectByName('pickups');
    for (const obj of [...(group?.children ?? [])]) {
      game.scene.attach(obj); // keep world transform, detach from the level
      this.pickups.push({
        id: obj.name,
        kind: obj.name.startsWith('crate') ? 'crate' : 'bottle',
        object: obj,
        position: obj.position,
        available: true,
      });
    }
    this.initial = this.pickups.map((p) => ({ p, pos: p.object.position.clone(), rot: p.object.rotation.clone() }));

    this.buildLights();
    this.setSign(LOCKED);
  }

  buildLights() {
    const scene = this.game.scene;
    scene.add(new THREE.HemisphereLight(0x7a86a0, 0x1e1812, 0.45));
    this.flicker = [];
    const xs = [-12.5, -7.9, -3.1, 1.4, 6];
    const zs = [-7.5, 0, 7.5];
    for (const x of xs) {
      for (const z of zs) {
        const l = new THREE.PointLight(0xd6e4ff, 30, 12, 1.8);
        l.position.set(x, 5.8, z);
        scene.add(l);
        if ((x === -3.1 && z === 7.5) || (x === 6 && z === -7.5)) this.flicker.push({ light: l, base: l.intensity });
      }
    }
    // Key light so characters read clearly from the high camera.
    const key = new THREE.DirectionalLight(0xffd9b0, 0.55);
    key.position.set(-4, 12, 8);
    scene.add(key);
    // The ceiling grid stops short of the stairwell; a dim fill keeps the steps readable.
    const stairs = new THREE.PointLight(0xffe2c0, 18, 9, 1.6);
    stairs.position.set(11.8, 4.5, -1.2);
    scene.add(stairs);
    this.exitLight = new THREE.PointLight(0xff2010, 6, 6, 2);
    this.exitLight.position.set(14.4, 4.2, -1.2);
    scene.add(this.exitLight);
  }

  setSign(color) {
    for (const m of this.signMaterials) {
      if (m.emissive) {
        m.emissive.copy(color);
        m.color.copy(color);
      } else {
        m.color.copy(color).multiplyScalar(1.5);
      }
    }
    this.exitLight?.color.copy(color);
  }

  // --- pickups -----------------------------------------------------------

  /** A crate with another crate stacked on it cannot be lifted. */
  covered(p) {
    return this.pickups.some((o) => o !== p && o.available && o.position.y > p.position.y + 0.3 && Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z) < 0.5);
  }

  nearestPickup(pos, maxDist, kind = null) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.pickups) {
      if (!p.available || (kind && p.kind !== kind) || this.covered(p) || Math.abs(p.position.y - pos.y) > 1.2) continue;
      const d = Math.hypot(p.position.x - pos.x, p.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  takePickup(p) {
    p.available = false;
    if (p.kind === 'bottle') this.hideDebris(p.object);
  }

  /** Puts a carried pickup back on the floor (the carrier got hit). */
  dropPickup(p, worldPos) {
    this.game.scene.add(p.object);
    const ground = this.collision.groundAt(worldPos.x, worldPos.z, worldPos.y);
    p.object.position.set(worldPos.x, ground, worldPos.z);
    p.object.rotation.set(0, Math.random() * Math.PI, 0);
    p.available = true;
  }

  /** The broken bottle model includes floor shards; hide them once it leaves the floor. */
  hideDebris(object) {
    object.traverse((o) => {
      if (o.isMesh && o.material.name === 'debris') o.visible = false;
    });
  }

  /** Destroys a pickup for good (thrown and broken). */
  consume(p) {
    p.available = false;
    p.object.removeFromParent();
  }

  resetPickups() {
    for (const { p, pos, rot } of this.initial) {
      this.game.scene.add(p.object);
      p.object.position.copy(pos);
      p.object.rotation.copy(rot);
      p.object.traverse((o) => (o.visible = !o.userData.hidden));
      p.available = true;
    }
  }

  // --- door ----------------------------------------------------------------

  inDoorZone(pos) {
    const z = this.data.door.zone;
    return pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ && pos.y >= z.minY;
  }

  /** Player pressed interact (or bumped the door). */
  tryDoor(character) {
    if (!this.inDoorZone(character.position)) return false;
    if (this.doorState === 'locked' && this.rattleCooldown <= 0) {
      this.anim.play(this.data.door.rattle, { fade: 0 });
      this.rattleCooldown = 1.2;
      this.game.hud.toast(this.game.boss ? 'Locked. The boss has the key.' : 'Locked. Clear the garage first.', 2);
    }
    return true;
  }

  unlockDoor() {
    if (this.doorState !== 'locked') return;
    this.doorState = 'open';
    this.setSign(UNLOCKED);
    this.anim.play(this.data.door.open, { fade: 0 });
    this.collision.setGroupEnabled(this.data.door.group, false);
  }

  update(dt) {
    this.anim.update(dt);
    this.rattleCooldown -= dt;
    for (const f of this.flicker) f.light.intensity = Math.random() < 0.06 ? f.base * 0.15 : f.base;
    if (this.doorState === 'locked' && this.game.player.alive && this.inDoorZone(this.game.player.position) && this.game.player.position.x > 14.2) {
      this.tryDoor(this.game.player);
    }
  }
}
