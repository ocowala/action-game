import * as THREE from 'three';
import { distXZ, wrapAngle, yawTo } from '../core/math.js';
import { Character } from './Character.js';

export const ULT = {
  max: 100,
  perDamageDealt: 0.45,
  perDamageTaken: 0.7,
  perBlock: 1.5,
  duration: 16, // seconds of Shiva control
  damageTakenMul: 0.4,
};

const WALK_SPEED = 3.1;
const CARRY_SPEED = 2.0;
const SHIVA_SPEED = 3.6;
// Click-timed chain: each press must land inside the combo window of the
// previous punch (from its hit frame until COMBO_GRACE after it recovers).
// Early presses are discarded so mashing does not chain; late ones restart.
const COMBO = ['jab', 'jab', 'hook', 'uppercut'];
const COMBO_GRACE = 0.3;
const SHIVA_COOLDOWNS = { tandava_stomp: 1.4, trinetra_agni: 5, trishul_prahar: 5 };
const _v = new THREE.Vector3();

/**
 * The spy. A flat state machine; each state owns which inputs it listens to.
 *
 * locomotion -> attack (jab > jab > hook > uppercut, click-timed window)
 *            -> block (hold) -> block_hit / stunned on guard break
 *            -> pickup -> carry -> throw
 *            -> ultIn -> shiva <-> shivaAttack -> ultOut -> locomotion
 * any        -> hurt | knockdown -> getUp | dead
 */
export class Player extends Character {
  constructor(game) {
    super(game, { modelId: 'main-character', team: 'player', hp: 100, guard: 100 });
    this.meter = 0;
    this.combo = 0;
    this.comboGrace = 0;
    this.ultTime = 0;
    this.cooldowns = {};
    this.lunge = null;
    this.setState('locomotion');
    this.play('fight_stance', { fade: 0 });
  }

  get form() {
    return this.modelId === 'shiva-avatar' ? 'shiva' : 'human';
  }

  get ultReady() {
    return this.meter >= ULT.max && this.form === 'human';
  }

  addMeter(amount) {
    if (this.form === 'shiva' || this.state === 'ultIn' || this.state === 'ultOut') return;
    this.meter = Math.min(ULT.max, this.meter + amount);
  }

  // --- input helpers ---------------------------------------------------------

  /** Camera-relative movement intent in world XZ. */
  moveIntent() {
    const { x, y } = this.game.input.move;
    const cy = this.game.cameraRig.yaw;
    const fx = Math.sin(cy);
    const fz = Math.cos(cy);
    return { x: fx * y - fz * x, z: fz * y + fx * x, mag: Math.hypot(x, y) };
  }

  /** Nearest living enemy roughly in the direction the player means to attack. */
  softTarget(maxDist = 3.2, coneDeg = 100) {
    const intent = this.moveIntent();
    const aim = intent.mag > 0.2 ? Math.atan2(intent.x, intent.z) : this.yaw;
    let best = null;
    let bestScore = Infinity;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = distXZ(this.position, e.position);
      if (d > maxDist) continue;
      const off = Math.abs(wrapAngle(yawTo(this.position, e.position) - aim));
      if (off > (coneDeg * Math.PI) / 180) continue;
      const score = d + off * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  nearbyThreat() {
    return this.game.enemies.some((e) => e.alive && distXZ(this.position, e.position) < 7);
  }

  // --- state machine -------------------------------------------------------------

  think(dt) {
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.lunge) {
      const step = Math.min(dt, this.lunge.t) * this.lunge.speed;
      this.translate(Math.sin(this.yaw) * step, Math.cos(this.yaw) * step);
      this.lunge.t -= dt;
      if (this.lunge.t <= 0) this.lunge = null;
    }
    if (this.game.lockPlayerInput) return;

    const input = this.game.input;
    switch (this.state) {
      case 'locomotion':
        this.locomotion(dt, WALK_SPEED);
        if (this.held.has('crate')) {
          this.state = 'carry';
          break;
        }
        if (input.consume('ult') && this.ultReady) return this.startUlt();
        if (input.isHeld('block') && !this.held.has('bottle')) return this.startBlock();
        this.comboGrace -= dt;
        if (input.consume('attack', 0.15)) {
          if (this.held.has('bottle')) return this.throwHeld('bottle', 'throw_bottle');
          const next = this.comboGrace > 0 && this.combo < COMBO.length - 1 ? this.combo + 1 : 0;
          return this.attack(next);
        }
        if (input.consume('interact')) this.interact();
        break;

      case 'carry':
        this.locomotion(dt, CARRY_SPEED, true);
        if (input.consume('attack') || input.consume('interact')) this.throwHeld('crate', 'throw');
        break;

      case 'attack': {
        // Turn a little toward intent during the wind-up only.
        if (this.anim.time < 0.08) this.steerToIntent(dt, 8);
        const hitStart = this.anim.clipMeta(this.anim.name)?.hits?.[0]?.start ?? 0;
        if (this.anim.time < hitStart) input.consume('attack'); // too early: discarded
        if (this.anim.cancellable) {
          if (this.combo < COMBO.length - 1 && input.consume('attack', 0.35)) return this.attack(this.combo + 1);
          if (input.isHeld('block')) return this.startBlock();
        }
        if (this.anim.finished) {
          // Window stays open briefly after recovery; the finisher resets the chain.
          this.toLocomotion(true);
          this.comboGrace = this.combo < COMBO.length - 1 ? COMBO_GRACE : 0;
        }
        break;
      }

      case 'block':
        this.blocking = true;
        if (!input.isHeld('block')) {
          this.blocking = false;
          return this.toLocomotion();
        }
        if (this.anim.name === 'block_hit' && this.anim.finished) this.play('block', { fade: 0.08 });
        this.steerToIntent(dt, 4);
        break;

      case 'hurt':
      case 'stunned':
        this.stunTime -= dt;
        if (this.stunTime <= 0) {
          this.stunned = false;
          this.toLocomotion();
        }
        break;

      case 'down':
        if (this.stateTime > 0.35) {
          this.setState('getUp');
          this.play('get_up', { fade: 0.1, timeScale: 1.5 });
        }
        break;

      case 'getUp':
        if (this.anim.finished) {
          this.invulnerable = false;
          this.toLocomotion();
        }
        break;

      case 'pickup':
      case 'throw':
        if (this.anim.finished) this.toLocomotion();
        break;

      case 'shiva':
        this.ultTime -= dt;
        this.locomotion(dt, SHIVA_SPEED);
        if (this.ultTime <= 0) return this.endUlt();
        if (input.consume('attack')) return this.shivaMove('palm_strike');
        if (input.consume('block')) return this.shivaMove('tandava_stomp');
        if (input.consume('special')) return this.shivaMove('trinetra_agni');
        if (input.consume('interact')) return this.shivaMove('trishul_prahar');
        break;

      case 'shivaAttack':
        this.ultTime -= dt * 0.5; // the clock slows while a move plays out
        if (this.anim.name === 'trinetra_agni') this.steerToIntent(dt, 1.6); // sweep the beam
        if (this.anim.name === 'palm_strike' && this.anim.cancellable && input.consume('attack', 0.4)) return this.shivaMove('palm_strike');
        if (this.anim.finished) {
          this.setState('shiva');
          this.play('fight_stance', { fade: 0.15 });
        }
        break;

      default:
        break; // ultIn / ultOut / dead are driven by animation callbacks
    }
  }

  locomotion(dt, speed, carrying = false) {
    const intent = this.moveIntent();
    const shiva = this.form === 'shiva';
    if (intent.mag > 0.1) {
      this.walk(intent.x, intent.z, speed, dt);
      this.faceYaw(Math.atan2(intent.x, intent.z), dt, 12);
      this.play(carrying ? 'hold_walk' : 'walk', { fade: 0.15, restart: false, timeScale: (speed / WALK_SPEED) * Math.max(0.6, intent.mag) });
    } else {
      const idle = carrying ? 'hold_overhead' : shiva || this.nearbyThreat() || this.held.size ? 'fight_stance' : 'idle';
      this.play(idle, { fade: 0.2, restart: false });
    }
  }

  steerToIntent(dt, rate) {
    const intent = this.moveIntent();
    if (intent.mag > 0.2) this.faceYaw(Math.atan2(intent.x, intent.z), dt, rate);
  }

  toLocomotion(keepCombo = false) {
    if (!keepCombo) this.combo = 0;
    this.blocking = false;
    this.setState(this.form === 'shiva' ? 'shiva' : 'locomotion');
  }

  attack(index) {
    this.combo = index;
    this.setState('attack');
    const target = this.softTarget();
    if (target) {
      this.yaw = yawTo(this.position, target.position);
      const gap = distXZ(this.position, target.position) - (this.radius + target.radius + 0.35);
      if (gap > 0.05) this.lunge = { t: 0.12, speed: Math.min(gap, 0.7) / 0.12 };
    }
    this.startAttack(COMBO[index], { fade: 0.05 });
  }

  startBlock() {
    this.setState('block');
    this.blocking = true;
    this.play('block', { fade: 0.06 });
  }

  // --- pickups & throws ---------------------------------------------------------

  interact() {
    const pickup = this.game.level.nearestPickup(this.position, 1.5);
    if (pickup) {
      this.pendingPickup = pickup;
      this.setState('pickup');
      this.yaw = yawTo(this.position, pickup.position);
      if (pickup.kind === 'crate') this.play('pickup_heavy', { fade: 0.1, timeScale: 1.6 });
      else this.play('pickup_bottle', { fade: 0.1, timeScale: 1.3 });
      return;
    }
    this.game.level.tryDoor(this);
  }

  throwHeld(propId, clip) {
    this.setState('throw');
    const target = this.softTarget(14, 45);
    if (target) this.yaw = yawTo(this.position, target.position);
    this.throwTarget = target ? target.position.clone().setY(target.position.y + 1) : this.position.clone().add(this.forward(_v).multiplyScalar(9));
    this.play(clip, { fade: 0.08, timeScale: 1.2 });
  }

  onAnimEvent(ev, clip) {
    if (this.handleCommonEvent(ev, clip)) return;
    if (ev.type === 'grab' && this.pendingPickup) {
      const pickup = this.pendingPickup;
      this.pendingPickup = null;
      if (!pickup.available) return;
      this.game.level.takePickup(pickup);
      const prop = { object: pickup.object, kind: pickup.kind, onDrop: (h) => this.game.level.dropPickup(pickup, h.worldPosition) };
      this.holdProp(ev.prop, prop, ev.attach);
    } else if (ev.type === 'release') {
      const held = this.takeProp(ev.prop);
      if (held) this.game.projectiles.launch({ kind: ev.prop, held, owner: this, target: this.throwTarget, flightTime: ev.prop === 'crate' ? 0.55 : 0.4 });
    }
  }

  onAnimEnd(clip) {
    if (clip === 'knockdown') this.setState('down');
    else if (clip === 'ult_ascend') this.becomeShiva();
    else if (clip === 'shiva_manifest') this.beginShivaControl();
    else if (clip === 'shiva_release') this.becomeHuman();
    else if (clip === 'ult_descent') this.finishUlt();
  }

  // --- reactions -------------------------------------------------------------------

  receiveHit(outcome, attacker, move) {
    if (outcome.type === 'blocked') this.addMeter(ULT.perBlock);
    // Getting hit mid-pickup or while carrying drops what you hold.
    if (outcome.type === 'hit' || outcome.type === 'knockdown' || outcome.type === 'guardBreak') {
      this.pendingPickup = null;
      if (this.form === 'human') this.releaseAllProps();
    }
    super.receiveHit(outcome, attacker, move);
  }

  applyDamage(amount, source) {
    this.addMeter(amount * ULT.perDamageTaken);
    super.applyDamage(amount, source);
  }

  onKnockdown() {
    this.blocking = false;
    this.invulnerable = true; // no hitting a downed player: get-up is always safe
    this.setState('knockdown');
    this.play('knockdown', { fade: 0.05 });
  }

  onDeath(source) {
    super.onDeath(source);
    this.game.events.emit('playerDied', {});
  }

  afterSlam() {
    this.toLocomotion();
  }

  /** Back to a checkpoint after a knockout. Never respawn weaker than 70% HP. */
  respawn({ hp, meter, position }) {
    this.releaseAllProps();
    if (this.form === 'shiva') this.setModel('main-character');
    this.alive = true;
    this.hp = Math.max(hp, this.maxHp * 0.7);
    this.guard = this.maxGuard;
    this.meter = meter;
    this.ultTime = 0;
    this.invulnerable = this.superArmor = this.blocking = this.stunned = false;
    this.damageTakenMul = 1;
    this.knockback = this.lunge = this.pendingPickup = null;
    this.position.copy(position);
    this.toLocomotion();
    this.play('fight_stance', { fade: 0 });
  }

  // --- Shiva ult ---------------------------------------------------------------

  startUlt() {
    this.setState('ultIn');
    this.invulnerable = true;
    this.blocking = false;
    this.releaseAllProps();
    this.game.setFreeze(true);
    this.game.events.emit('ultStart', {});
    this.play('ult_ascend', { fade: 0.1, timeScale: 1.4 });
  }

  becomeShiva() {
    this.setModel('shiva-avatar');
    this.play('shiva_manifest', { fade: 0, timeScale: 1.25 });
    this.game.vfx.flash(0.5);
  }

  beginShivaControl() {
    this.setState('shiva');
    this.ultTime = ULT.duration;
    this.invulnerable = false;
    this.superArmor = true;
    this.damageTakenMul = ULT.damageTakenMul;
    this.anim.playLayer('shiva_ambient');
    this.game.setFreeze(false);
    this.play('fight_stance', { fade: 0.2 });
  }

  shivaMove(clip) {
    if (this.cooldowns[clip] > 0) return;
    this.cooldowns[clip] = SHIVA_COOLDOWNS[clip] ?? 0;
    this.setState('shivaAttack');
    const target = this.softTarget(clip === 'trinetra_agni' ? 8 : 4, 120);
    if (target) this.yaw = yawTo(this.position, target.position);
    this.startAttack(clip, { fade: 0.08 });
  }

  endUlt() {
    this.setState('ultOut');
    this.invulnerable = true;
    this.superArmor = false;
    this.game.setFreeze(true);
    this.anim.stopLayer('shiva_ambient');
    this.play('shiva_release', { fade: 0.15, timeScale: 1.3 });
  }

  becomeHuman() {
    this.releaseAllProps();
    this.setModel('main-character');
    this.play('ult_descent', { fade: 0, timeScale: 1.4 });
  }

  finishUlt() {
    this.meter = 0;
    this.ultTime = 0;
    this.damageTakenMul = 1;
    this.invulnerable = false;
    this.game.setFreeze(false);
    this.game.events.emit('ultEnd', {});
    this.toLocomotion();
  }
}
