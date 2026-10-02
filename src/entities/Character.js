import * as THREE from 'three';
import { AnimationController } from '../anim/AnimationController.js';
import { clamp, turnTowards } from '../core/math.js';
import { makeTintable, setTint } from '../render/materials.js';

const GRAVITY = 18;
const TELL_COLOR = new THREE.Color(1, 0.45, 0.1);
const HEAVY_TELL_COLOR = new THREE.Color(1, 0.08, 0.02);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Shared base for the player, enemies and the boss: a model instance driven by an
 * AnimationController, a hurt cylinder, health/guard, hit reactions, held props,
 * and movement that goes through level collision.
 *
 * Subclasses implement `think(dt)` and may override `onAnimEvent` / `onAnimEnd`.
 */
export class Character {
  constructor(game, { modelId, team, hp, radius = 0.42, height = 1.95, guard = 0 }) {
    this.game = game;
    this.team = team;
    this.object = new THREE.Group();
    this.radius = radius;
    this.height = height;
    this.maxHp = this.hp = hp;
    this.maxGuard = this.guard = guard;
    this.guardIdle = 0;
    this.yaw = 0;
    this.vy = 0;
    this.state = 'idle';
    this.stateTime = 0;
    this.stunTime = 0;
    this.hitStop = 0;
    this.invulnerable = false;
    this.superArmor = false;
    this.blocking = false;
    this.stunned = false; // guard-broken: takes bonus damage
    this.damageTakenMul = 1;
    this.alive = true;
    this.swing = 0; // increments per attack so a hit window lands once per target
    this.timeScale = 1;
    this.held = new Map(); // propId -> { object, mixer, attach }
    this.lastHitBy = new Map(); // attacker -> last hit key, so a window lands once
    this.damageMul = 1;
    this.tint = { color: TELL_COLOR, amount: 0, pulse: 0, until: 0 };
    this.setModel(modelId);

    this.shadow = game.vfx.createBlobShadow(radius * 1.6);
    this.object.add(this.shadow);
  }

  /** Swaps the visual model (used by the Shiva transformation). */
  setModel(modelId) {
    if (this.model) this.object.remove(this.model);
    const { root, clips, meta } = this.game.assets.instantiate(modelId);
    this.modelId = modelId;
    this.model = root;
    this.model.rotation.y = Math.PI; // Blockbench models face -Z; entities face +Z
    this.object.add(root);
    this.anim = new AnimationController(root, clips, meta);
    this.sockets = Object.fromEntries(meta.sockets.map((s) => [s, root.getObjectByName(s)]));
    this.tintMaterials = makeTintable(root);
  }

  get position() {
    return this.object.position;
  }

  /** Hurt volume used by the combat system. */
  get body() {
    const p = this.object.position;
    return { x: p.x, y: p.y, z: p.z, radius: this.radius, height: this.height };
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  socketWorld(name, out = new THREE.Vector3()) {
    const s = this.sockets[name];
    if (!s) return out.copy(this.position).setY(this.position.y + 1.2);
    this.object.updateWorldMatrix(true, true);
    return s.getWorldPosition(out);
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  /** Plays a manifest clip with this character's event/end hooks attached. */
  play(name, opts = {}) {
    if (!this.anim.has(name)) return null;
    const { onEnd, ...rest } = opts;
    return this.anim.play(name, {
      ...rest,
      onEvent: (ev) => this.onAnimEvent(ev, name),
      onEnd: (clip) => {
        onEnd?.(clip);
        this.onAnimEnd(clip);
      },
    });
  }

  startAttack(clip, opts = {}) {
    this.swing++;
    return this.play(clip, { fade: 0.06, ...opts });
  }

  faceYaw(target, dt, rate = 10) {
    this.yaw = turnTowards(this.yaw, target, rate * dt);
  }

  /** Moves by a world-space XZ displacement, resolving level collision. */
  translate(dx, dz) {
    const p = this.position;
    p.x += dx;
    p.z += dz;
    this.game.level.collision.pushOut(p, this.radius, p.y);
  }

  // --- reactions ----------------------------------------------------------

  /** Called by CombatSystem with a resolved hit. */
  receiveHit(outcome, attacker, move) {
    if (outcome.type === 'ignored') return;
    if (outcome.damage > 0) this.applyDamage(outcome.damage, attacker);
    if (!this.alive) return;
    const push = outcome.push ?? 0;
    if (push && attacker) {
      _v.subVectors(this.position, attacker.position).setY(0).normalize();
      this.knockback = { x: _v.x * push, z: _v.z * push, t: 0.18 };
    }
    switch (outcome.type) {
      case 'blocked':
        this.guard = outcome.guard;
        this.guardIdle = 0;
        this.onBlocked(move);
        break;
      case 'guardBreak':
        this.guard = 0;
        this.onGuardBreak(move);
        break;
      case 'hit':
        this.onHurt(outcome.stun, move);
        break;
      case 'knockdown':
        this.onKnockdown(move);
        break;
      case 'slam':
        this.onSlammed(move);
        break;
      default:
        break; // 'armored': damage only
    }
  }

  applyDamage(amount, source) {
    this.hp = Math.max(0, this.hp - amount);
    this.game.events.emit('damage', { target: this, source, amount });
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      this.onDeath(source);
    }
  }

  onBlocked() {
    this.play('block_hit', { fade: 0.04 });
  }

  onGuardBreak() {
    this.blocking = false;
    this.stunned = true;
    this.stunTime = 1.4;
    this.setState('stunned');
    if (this.anim.has('guard_break')) this.play('guard_break', { fade: 0.05 });
    else this.play('hurt', { fade: 0.05, timeScale: 0.6 });
  }

  onHurt(stun) {
    this.blocking = false;
    this.stunTime = stun;
    this.setState('hurt');
    this.play('hurt', { fade: 0.04 });
  }

  onKnockdown() {
    // Characters without a knockdown clip take a long stagger instead.
    this.onHurt(1.1);
  }

  /**
   * Flattened by a crate: plays the death fall, stays down, then gets up
   * (get_up if the model has one, otherwise the fall played in reverse).
   */
  onSlammed() {
    this.blocking = false;
    this.releaseAllProps();
    this.invulnerable = true; // never juggle a downed fighter
    this.setState('slammed');
    this.slamPhase = 'fall';
    this.play('dead', { fade: 0.05, timeScale: 1.3, onEnd: () => {
      this.slamPhase = 'down';
      this.stateTime = 0;
    } });
  }

  updateSlam() {
    if (this.slamPhase !== 'down' || this.stateTime < 1.1) return;
    this.slamPhase = 'rise';
    const recover = () => {
      this.invulnerable = false;
      this.afterSlam();
    };
    if (this.anim.has('get_up')) this.play('get_up', { fade: 0.1, timeScale: 1.4, onEnd: recover });
    else this.play('dead', { fade: 0.05, timeScale: -1.6, onEnd: recover });
  }

  /** Where to go after getting back up; subclasses pick their neutral state. */
  afterSlam() {
    this.setState('idle');
  }

  onDeath() {
    this.blocking = false;
    this.releaseAllProps();
    this.setState('dead');
    this.play('dead', { fade: 0.1 });
  }

  // --- tells & tint ---------------------------------------------------------

  /** Glow that warns the player an attack is coming. Heavy tells are red and pulse. */
  tell(duration, heavy = false) {
    this.tint.color = heavy ? HEAVY_TELL_COLOR : TELL_COLOR;
    this.tint.until = this.game.time + duration;
    this.tint.heavy = heavy;
    if (heavy) this.game.vfx.alertMarker(this, duration);
  }

  updateTint(dt) {
    const remaining = this.tint.until - this.game.time;
    if (remaining > 0) {
      const pulse = this.tint.heavy ? 0.55 + 0.45 * Math.sin(this.game.time * 30) : 0.7;
      setTint(this.tintMaterials, this.tint.color, (this.tint.heavy ? 1.1 : 0.55) * pulse);
    } else {
      setTint(this.tintMaterials, this.tint.color, 0);
    }
  }

  /** Time from now until this clip's first hit window, for sizing a tell. */
  timeToFirstHit(clip, timeScale = 1) {
    const hits = this.anim.clipMeta(clip)?.hits;
    return hits?.length ? hits[0].start / timeScale : 0.5;
  }

  /** Manifest events every character understands. Returns true if handled. */
  handleCommonEvent(ev, clip) {
    const scale = this.anim.current?.action.timeScale || 1;
    switch (ev.type) {
      case 'tell': {
        const next = this.anim.clipMeta(clip)?.hits?.find((h) => h.start >= ev.t);
        this.tell((next ? next.start - ev.t : 0.7) / scale, ev.heavy);
        return true;
      }
      case 'vfx':
        this.game.vfx.spawn(ev.vfx, this, ev);
        if (ev.push) this.game.combat.pushAway(this, ev.push);
        return true;
      case 'prop': {
        let h = this.held.get(ev.prop);
        if (ev.attach) {
          if (h) {
            h.object.removeFromParent();
            this.sockets[ev.attach]?.add(h.object);
            h.attach = ev.attach;
          } else {
            h = this.holdProp(ev.prop, this.game.assets.prop(ev.prop), ev.attach);
          }
        }
        if (h && ev.play) this.playPropClip(ev.prop, ev.play);
        if (h && ev.removeAfter) {
          this.game.later(ev.removeAfter / scale, () => {
            if (this.held.get(ev.prop) === h) this.dropProp(ev.prop);
          });
        }
        return true;
      }
      case 'ignite':
        for (const [id, h] of this.held) {
          let lit = false;
          h.object.traverse((o) => {
            if (/flame/.test(o.name)) {
              o.traverse((c) => (c.visible = true));
              lit = true;
            }
          });
          if (lit && id === ev.prop) this.playPropClip(id, 'molotov_flame_flicker', true);
        }
        return true;
      case 'drop':
        this.dropProp(ev.prop);
        return true;
      default:
        return false;
    }
  }

  // --- props ----------------------------------------------------------------

  /** Attaches a prop object to a socket (or 'between_hands'). */
  holdProp(propId, prop, attach) {
    this.dropProp(propId);
    if (attach === 'between_hands') {
      this.game.scene.add(prop.object);
    } else {
      const socket = this.sockets[attach];
      prop.object.position.set(0, 0, 0);
      prop.object.rotation.set(0, 0, 0);
      (socket ?? this.object).add(prop.object);
    }
    const mixer = prop.clips ? new THREE.AnimationMixer(prop.object) : null;
    this.held.set(propId, { ...prop, attach, mixer });
    return this.held.get(propId);
  }

  playPropClip(propId, clipName, loop = false) {
    const h = this.held.get(propId);
    const clip = h?.clips?.get(clipName);
    if (!clip) return;
    const action = h.mixer.clipAction(clip);
    action.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
  }

  /** Detaches and returns a held prop (for throwing), or removes it. */
  takeProp(propId) {
    const h = this.held.get(propId);
    if (!h) return null;
    h.object.getWorldPosition(_w);
    h.object.removeFromParent();
    this.held.delete(propId);
    h.worldPosition = _w.clone();
    return h;
  }

  dropProp(propId) {
    const h = this.takeProp(propId);
    if (h?.onDrop) h.onDrop(h);
  }

  releaseAllProps() {
    for (const id of [...this.held.keys()]) this.dropProp(id);
  }

  updateProps(dt) {
    for (const h of this.held.values()) {
      h.mixer?.update(dt);
      if (h.attach === 'between_hands') {
        // Centered between both hands and facing with the body (crate overhead).
        this.socketWorld('socket_hand_l', _v);
        this.socketWorld('socket_hand_r', _w);
        h.object.position.addVectors(_v, _w).multiplyScalar(0.5);
        h.object.rotation.set(0, this.yaw, 0);
      }
    }
  }

  // --- frame update -------------------------------------------------------

  update(dt) {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.updateTint(dt);
      return;
    }
    const sdt = dt * this.timeScale;
    this.stateTime += sdt;
    if (this.alive) {
      if (this.state === 'slammed') this.updateSlam();
      else this.think(sdt);
    }

    this.anim.update(sdt);
    const rm = this.anim.consumeRootMotion();
    if (rm.x || rm.z) {
      // Model space is rotated by PI inside the entity, then by yaw.
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      const lx = -rm.x;
      const lz = -rm.z;
      this.translate(lx * c + lz * s, -lx * s + lz * c);
    }
    if (this.knockback) {
      const k = this.knockback;
      const step = Math.min(sdt, k.t) / 0.18;
      this.translate(k.x * step, k.z * step);
      k.t -= sdt;
      if (k.t <= 0) this.knockback = null;
    }

    // Guard regenerates after a short pause.
    this.guardIdle += sdt;
    if (this.maxGuard && !this.blocking && this.guardIdle > 1.5) this.guard = Math.min(this.maxGuard, this.guard + this.guardRegen() * sdt);

    this.applyGravity(sdt);
    this.object.rotation.y = this.yaw;
    this.updateProps(sdt);
    this.updateTint(dt);
    this.shadow.position.y = 0.02 + (this.groundY - this.position.y);
  }

  guardRegen() {
    return 25;
  }

  applyGravity(dt) {
    const p = this.position;
    this.groundY = this.game.level.collision.groundAt(p.x, p.z, p.y);
    if (p.y > this.groundY + 1e-3) {
      this.vy -= GRAVITY * dt;
      p.y = Math.max(this.groundY, p.y + this.vy * dt);
    } else {
      p.y = this.groundY;
      this.vy = 0;
    }
  }

  /** Walks along a desired world direction at `speed` (collision-aware). */
  walk(dirX, dirZ, speed, dt) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-4) return;
    const s = (clamp(len, 0, 1) * speed * dt) / len;
    this.translate(dirX * s, dirZ * s);
  }

  // Hooks for subclasses.
  think() {}
  onAnimEvent() {}
  onAnimEnd() {}
}
