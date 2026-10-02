import * as THREE from 'three';
import { distXZ, pickWeighted, rand, wrapAngle, yawTo } from '../core/math.js';
import { Character } from '../entities/Character.js';
import { BOSS } from './archetypes.js';

const MELEE = [
  { clip: 'jab', range: 1.25, near: 3, mid: 0 },
  { clip: 'cross', range: 1.3, near: 2.5, mid: 1 },
  { clip: 'combo_3hit', range: 1.25, near: 2, mid: 1, phase2: 3 },
  { clip: 'haymaker', range: 1.45, near: 1.5, mid: 1.2 },
];
const BUSY = new Set(['attack', 'pursue', 'retreat', 'crateFetch', 'cratePickup', 'crateAim', 'crateThrow', 'molotov', 'phase', 'intro']);

/**
 * The gang boss. Guards the stairwell door, taunts, then fights in two phases.
 *
 * Phase 1 teaches: jab/cross, a 3-hit combo whose last hit is a knockdown, a
 * deliberately slow haymaker (red tell + "!"), blocking that only the uppercut
 * or a thrown crate reliably breaks, and crate tosses with a landing marker.
 * Phase 2 (at 50% HP, after an invulnerable phase_change shockwave) plays every
 * attack 20% faster, shortens recovery, and adds Molotov Rain: three lit bottles
 * thrown at and beside the player, each with a landing ring before it hits.
 *
 * Counterplay: he only flinches from heavy hits or once per cooldown, so the
 * player has to space, block and punish rather than mash.
 */
export class Boss extends Character {
  constructor(game, { model, name, x, z }) {
    super(game, { modelId: model, team: 'enemy', hp: BOSS.hp, radius: BOSS.radius, guard: BOSS.guard });
    this.id = 'boss';
    this.name = name;
    this.position.set(x, 0, z);
    this.yaw = -Math.PI / 2; // facing west, toward the garage
    this.phase = 1;
    this.cooldown = 1;
    this.flinchCd = 0;
    this.molotovCd = 3;
    this.crateCd = 4;
    this.lastPlayerSwing = -1;
    this.setState('dormant');
    this.play('fight_stance', { fade: 0 });
  }

  get player() {
    return this.game.player;
  }

  get atkScale() {
    return this.phase === 2 ? BOSS.phase2TimeScale : 1;
  }

  guardRegen() {
    return BOSS.guardRegen;
  }

  beginIntro() {
    this.setState('intro');
    this.invulnerable = true;
    this.play('intro_taunt', { fade: 0.2 });
  }

  think(dt) {
    const player = this.player;
    this.flinchCd -= dt;
    this.molotovCd -= dt;
    this.crateCd -= dt;
    this.cooldown -= dt;
    const d = distXZ(this.position, player.position);
    const toPlayer = yawTo(this.position, player.position);

    if (this.phase === 1 && this.hp <= this.maxHp * BOSS.phase2At && !BUSY.has(this.state) && this.state !== 'stunned') return this.startPhaseChange();
    if (!player.alive && this.state !== 'dead') {
      this.play('fight_stance', { fade: 0.3, restart: false });
      return;
    }

    switch (this.state) {
      case 'dormant':
        this.faceYaw(toPlayer, dt, 1.5);
        break;

      case 'neutral': {
        this.faceYaw(toPlayer, dt, 7);
        if (d > 3.4) this.walkToward(player.position, dt);
        else if (d < 1.1) {
          this.walk(-Math.sin(toPlayer), -Math.cos(toPlayer), BOSS.speed * 0.6, dt);
          this.play('walk', { fade: 0.2, restart: false, timeScale: -0.8 });
        } else this.play('fight_stance', { fade: 0.25, restart: false });
        this.considerBlock(d);
        if (this.state === 'neutral' && this.cooldown <= 0 && this.game.cameraRig.isVisible(this.position)) this.decide(d);
        break;
      }

      case 'pursue':
        this.faceYaw(toPlayer, dt, 9);
        this.walkToward(player.position, dt, 1.3);
        if (d <= this.move.range + this.radius + player.radius - 0.2) this.strike(this.move.clip);
        else if (this.stateTime > 3) this.endAttack();
        break;

      case 'attack': {
        const firstHit = this.anim.clipMeta(this.anim.name)?.hits?.[0]?.start ?? 0;
        if (this.anim.time < firstHit - 0.12) this.faceYaw(toPlayer, dt, 4);
        if (this.anim.finished) this.endAttack();
        break;
      }

      case 'block':
        this.blocking = true;
        this.faceYaw(toPlayer, dt, 10);
        if (this.anim.name === 'block_hit' && this.anim.finished) this.play('block', { fade: 0.08 });
        if (this.stateTime > this.blockTime) {
          this.blocking = false;
          // Punish the player for swinging into a guard.
          if (d < 2 && Math.random() < 0.5) {
            this.setState('pursue');
            this.move = MELEE[1];
          } else this.setState('neutral');
        }
        break;

      case 'hurt':
        this.stunTime -= dt;
        if (this.stunTime <= 0) this.setState('neutral');
        break;

      case 'stunned':
        this.stunTime -= dt;
        if (this.stunTime <= 0) {
          this.stunned = false;
          this.guard = this.maxGuard * 0.6;
          this.setState('neutral');
          this.cooldown = 0.4;
        }
        break;

      case 'crateFetch': {
        const c = this.crate;
        if (!c?.available) return this.endAttack();
        this.faceYaw(yawTo(this.position, c.position), dt, 8);
        if (distXZ(this.position, c.position) > 1.1) this.walkToward(c.position, dt, 1.2);
        else {
          this.setState('cratePickup');
          this.play('pickup_heavy', { fade: 0.1, timeScale: 1.7 });
        }
        if (this.stateTime > 5) this.endAttack();
        break;
      }

      case 'cratePickup':
        if (this.anim.finished) {
          if (!this.held.has('crate')) return this.endAttack();
          this.setState('crateAim');
          this.play('hold_overhead', { fade: 0.15 });
        }
        break;

      case 'crateAim':
        this.faceYaw(toPlayer, dt, 6);
        if (this.stateTime > 0.5) {
          this.setState('crateThrow');
          this.throwTarget = player.position.clone();
          this.play('throw', { fade: 0.1, timeScale: this.atkScale });
        }
        break;

      case 'crateThrow':
        if (this.anim.finished) this.endAttack();
        break;

      case 'retreat':
        // Back away facing the player to make room for Molotov Rain.
        this.faceYaw(toPlayer, dt, 8);
        this.walk(-Math.sin(toPlayer), -Math.cos(toPlayer), BOSS.speed, dt);
        this.play('walk', { fade: 0.15, restart: false, timeScale: -1 });
        if (this.stateTime > 1 || d > 4) this.startMolotovRain();
        break;

      case 'molotov':
        if (this.anim.name === 'light_molotov' || this.anim.time < 0.3) this.faceYaw(toPlayer, dt, 5);
        break;

      default:
        break; // intro / phase / dead: animation callbacks drive these
    }
  }

  walkToward(target, dt, mul = 1) {
    const speed = BOSS.speed * mul * (this.phase === 2 ? 1.15 : 1);
    this.walk(target.x - this.position.x, target.z - this.position.z, speed, dt);
    this.play('walk', { fade: 0.2, restart: false, timeScale: speed / 2.2 });
  }

  considerBlock(d) {
    const p = this.player;
    if (p.state !== 'attack' || p.swing === this.lastPlayerSwing || d > 2.4) return;
    this.lastPlayerSwing = p.swing;
    const facing = Math.abs(wrapAngle(yawTo(this.position, p.position) - this.yaw)) < 0.9;
    if (!facing || this.guard < 25 || Math.random() > BOSS.blockChance[this.phase - 1]) return;
    this.blockTime = rand(0.9, 1.5);
    this.blocking = true;
    this.setState('block');
    this.play('block', { fade: 0.05 });
  }

  decide(d) {
    const options = [];
    const near = d < 2.2;
    for (const m of MELEE) {
      const w = near ? (this.phase === 2 && m.phase2) || m.near : m.mid;
      if (w > 0) options.push({ kind: 'melee', move: m, weight: w });
    }
    const crate = this.crateCd <= 0 && d > 3.5 ? this.game.level.nearestPickup(this.position, 7, 'crate') : null;
    if (crate) options.push({ kind: 'crate', crate, weight: 2 });
    // Phase 2 headline move: if the player is hugging him, he backs off first.
    if (this.phase === 2 && this.molotovCd <= 0) options.push({ kind: 'molotov', weight: d > 2.5 ? 4 : 2.5 });
    const choice = pickWeighted(options);
    if (!choice) return;
    if (choice.kind === 'melee') {
      this.move = choice.move;
      this.setState('pursue');
    } else if (choice.kind === 'crate') {
      this.crate = choice.crate;
      this.crateCd = BOSS.crateCooldown;
      this.setState('crateFetch');
      this.tell(1.2, true);
    } else if (d < 3) {
      this.molotovCd = BOSS.molotovCooldown;
      this.setState('retreat');
    } else this.startMolotovRain();
  }

  strike(clip) {
    this.setState('attack');
    const scale = clip === 'haymaker' && this.phase === 1 ? BOSS.haymakerTimeScale : this.atkScale;
    this.startAttack(clip, { timeScale: scale });
  }

  endAttack() {
    this.blocking = false;
    this.releaseAllProps();
    this.setState('neutral');
    this.cooldown = rand(...BOSS.cooldown[this.phase - 1]);
  }

  // --- Molotov Rain -----------------------------------------------------------

  startMolotovRain() {
    this.molotovCd = BOSS.molotovCooldown;
    this.molotovThrows = 0;
    this.setState('molotov');
    this.play('light_molotov', { fade: 0.1 });
  }

  rainTarget(i) {
    const p = this.player.position;
    const toPlayer = yawTo(this.position, p);
    const side = [0, 2.3, -2.3][i] ?? 0;
    return new THREE.Vector3(p.x + Math.cos(toPlayer) * side, p.y, p.z - Math.sin(toPlayer) * side);
  }

  throwNextMolotov() {
    if (!this.held.has('molotov')) {
      this.holdProp('molotov', this.game.assets.prop('molotov'), 'socket_hand_r');
      this.handleCommonEvent({ type: 'ignite', prop: 'molotov' }, 'throw_molotov');
    }
    this.throwTarget = this.rainTarget(this.molotovThrows);
    this.play('throw_molotov', { fade: 0.08, timeScale: this.atkScale });
  }

  // --- animation hooks ----------------------------------------------------------

  onAnimEvent(ev, clip) {
    if (this.handleCommonEvent(ev, clip)) return;
    if (ev.type === 'grab') {
      if (ev.prop === 'crate') {
        const c = this.crate;
        if (!c?.available) return;
        this.game.level.takePickup(c);
        this.holdProp('crate', { object: c.object, onDrop: (h) => this.game.level.dropPickup(c, h.worldPosition) }, ev.attach);
      } else {
        this.holdProp(ev.prop, this.game.assets.prop(ev.prop), ev.attach);
      }
    } else if (ev.type === 'release') {
      const held = this.takeProp(ev.prop);
      if (!held) return;
      if (ev.prop === 'crate') {
        this.game.level.consume(this.crate);
        this.game.projectiles.launch({ kind: 'crate', held, owner: this, target: this.throwTarget, flightTime: 0.9, marker: true });
      } else {
        this.game.projectiles.launch({ kind: 'molotov', held, owner: this, target: this.throwTarget, flightTime: 0.95, marker: true });
        this.molotovThrows++;
      }
    }
  }

  onAnimEnd(clip) {
    switch (clip) {
      case 'intro_taunt':
        this.invulnerable = false;
        this.setState('neutral');
        this.cooldown = 0.8;
        this.game.events.emit('bossEngaged', { boss: this });
        break;
      case 'phase_change':
        this.invulnerable = false;
        this.phase = 2;
        this.setState('neutral');
        this.cooldown = 0.5;
        this.molotovCd = 0.5; // open phase 2 with the new move so the player sees it
        break;
      case 'guard_break':
        if (this.state === 'stunned') this.play('stunned', { fade: 0.1 });
        break;
      case 'light_molotov':
      case 'throw_molotov':
        if (this.state !== 'molotov') break;
        if (this.molotovThrows < 3) this.throwNextMolotov();
        else this.endAttack();
        break;
      default:
        break;
    }
  }

  startPhaseChange() {
    this.releaseAllProps();
    this.blocking = false;
    this.stunned = false;
    this.invulnerable = true;
    this.setState('phase');
    this.game.hud.toast('He is getting angry...', 2);
    this.play('phase_change', { fade: 0.1 });
  }

  // --- reactions -------------------------------------------------------------------

  receiveHit(outcome, attacker, move) {
    if (outcome.type === 'hit' || outcome.type === 'knockdown') {
      const heavy = move?.heavy && this.state !== 'phase' && this.state !== 'intro';
      if (!heavy && (BUSY.has(this.state) || this.flinchCd > 0)) {
        outcome = { ...outcome, type: 'armored' };
      } else {
        this.flinchCd = BOSS.flinchCooldown;
        this.releaseAllProps();
        outcome = { ...outcome, type: 'hit', stun: heavy ? 0.8 : 0.35 };
      }
    }
    super.receiveHit(outcome, attacker, move);
  }

  onGuardBreak(move) {
    this.releaseAllProps();
    super.onGuardBreak(move);
    this.stunTime = 2.2; // the punish window the block game builds toward
  }

  afterSlam() {
    this.setState('neutral');
    this.cooldown = 0.6;
  }

  onDeath(source) {
    super.onDeath(source);
    this.game.events.emit('bossDefeated', { boss: this });
  }
}
