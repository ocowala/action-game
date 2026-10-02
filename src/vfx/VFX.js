import * as THREE from 'three';
import { FIRE } from '../combat/moves.js';

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Transient visuals, kept deliberately sparse so nothing competes with the
 * fighters: blob shadows, landing markers and "!" alerts (gameplay tells),
 * fire zones, and the shockwave/pillar effects reserved for the Shiva ult and
 * the boss phase change. Regular hits get no particles: the body reaction is the feedback.
 */
export class VFX {
  constructor(game) {
    this.game = game;
    this.effects = []; // { update(dt) -> bool alive }
    this.shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  }


  createBlobShadow(radius) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    return m;
  }



  /** Named effects fired from manifest 'vfx' events. */
  spawn(name, character) {
    const p = character.position;
    switch (name) {
      case 'shockwave':
        this.shockwave(p, character.modelId === 'shiva-avatar' ? 2.2 : 1.6);
        break;
      case 'ult_charge':
        this.pillar(character, 2.2);
        break;
      default:
        break;
    }
  }

  /** Expanding ring: the shockwave_ring prop plus a flat readable ground ring. */
  shockwave(pos, scale = 1.6) {
    const prop = this.game.assets.prop('shockwave');
    prop.object.position.set(pos.x, pos.y + 0.05, pos.z);
    prop.object.scale.multiplyScalar(scale / 1.6);
    this.game.scene.add(prop.object);
    const mixer = new THREE.AnimationMixer(prop.object);
    const clip = prop.clips.get('shockwave_expand');
    if (clip) {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, pos.y + 0.04, pos.z);
    this.game.scene.add(ring);
    this.game.cameraRig.shake(0.35);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        mixer.update(dt);
        const r = 0.5 + t * 7 * scale;
        ring.scale.setScalar(r);
        ring.material.opacity = Math.max(0, 0.8 - t * 1.4);
        if (t < 0.65) return true;
        prop.object.removeFromParent();
        ring.removeFromParent();
        ring.geometry.dispose();
        ring.material.dispose();
        return false;
      },
    });
  }

  /** Column of light for the ult transformation. */
  pillar(character, duration) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.2, 12, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.copy(character.position).setY(character.position.y + 6);
    this.game.scene.add(m);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        m.material.opacity = Math.sin(Math.min(1, t / duration) * Math.PI) * 0.55;
        m.rotation.y += dt;
        if (t < duration) return true;
        m.removeFromParent();
        return false;
      },
    });
  }

  /**
   * Where a thrown object will land: a ring that fills as the impact approaches.
   * This is the tell for crate tosses and Molotov Rain.
   */
  groundMarker(pos, radius, duration, color = 0xff4020) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    for (const m of [ring, fill]) m.rotation.x = -Math.PI / 2;
    group.add(ring, fill);
    group.position.set(pos.x, pos.y + 0.03, pos.z);
    this.game.scene.add(group);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / duration);
        fill.scale.setScalar(Math.max(0.01, k));
        ring.material.opacity = 0.5 + 0.4 * Math.sin(t * 20);
        if (t < duration) return true;
        group.removeFromParent();
        return false;
      },
    });
  }

  /** Floating "!" above a character winding up a heavy attack. */
  alertMarker(character, duration) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff3a1a';
    g.font = 'bold 56px system-ui';
    g.textAlign = 'center';
    g.fillText('!', 32, 54);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sprite.scale.setScalar(0.8);
    sprite.renderOrder = 10;
    this.game.scene.add(sprite);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        sprite.position.copy(character.position).setY(character.position.y + character.height + 0.6 + Math.sin(t * 12) * 0.08);
        if (t < duration && character.alive) return true;
        sprite.removeFromParent();
        return false;
      },
    });
  }

  /**
   * A burning patch from a Molotov: molotov_impact -> fire_burn (loop) -> fire_dieout.
   * Damages only `targetTeam` (the boss's own fire does not hurt him).
   */
  fireZone(pos, targetTeam = 'player') {
    const prop = this.game.assets.prop('molotov_fire');
    prop.object.position.set(pos.x, pos.y + 0.02, pos.z);
    prop.object.rotation.y = Math.random() * Math.PI * 2;
    this.game.scene.add(prop.object);
    const mixer = new THREE.AnimationMixer(prop.object);
    const play = (name, loop) => {
      mixer.stopAllAction();
      const clip = prop.clips.get(name);
      if (!clip) return;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.play();
    };
    play('molotov_impact', false);
    const light = new THREE.PointLight(0xff7a20, 0, 7, 2);
    light.position.set(pos.x, pos.y + 1, pos.z);
    this.game.scene.add(light);

    let t = 0;
    let phase = 'impact';
    let tick = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        mixer.update(dt);
        light.intensity = (phase === 'dieout' ? Math.max(0, 1 - (t - FIRE.burn - 1) / 1.4) : 1) * (5 + Math.sin(t * 23) * 1.5 + Math.sin(t * 9) * 1);
        if (phase === 'impact' && t > 1) {
          phase = 'burn';
          play('fire_burn', true);
        } else if (phase === 'burn' && t > FIRE.burn + 1) {
          phase = 'dieout';
          play('fire_dieout', false);
        }
        if (phase !== 'dieout' && t > 0.15) {
          tick -= dt;
          if (tick <= 0) {
            tick = FIRE.tick;
            for (const c of this.game.characters) {
              if (c.team !== targetTeam || !c.alive) continue;
              if (Math.hypot(c.position.x - pos.x, c.position.z - pos.z) < FIRE.radius + c.radius * 0.5 && Math.abs(c.position.y - pos.y) < 1) {
                this.game.combat.environmentHit(c, FIRE.damage);
              }
            }
          }
        }
        if (t < FIRE.burn + 2.4) return true;
        prop.object.removeFromParent();
        light.removeFromParent();
        return false;
      },
    });
  }

  flash(amount = 0.6, color = '#fff2cc') {
    this.game.hud.flash(amount, color);
  }

  update(dt) {
    this.effects = this.effects.filter((e) => e.update(dt));
  }

  clear() {
    for (const e of this.effects) e.update(1e6);
    this.effects.length = 0;
  }
}
