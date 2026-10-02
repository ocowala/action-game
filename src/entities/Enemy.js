import { ARCHETYPES } from '../ai/archetypes.js';
import { distXZ, pickWeighted, rand, wrapAngle, yawTo } from '../core/math.js';
import { Character } from './Character.js';

let nextId = 1;

/**
 * Gang enemy driven by a small state machine:
 *
 *   spawn -> approach -> circle --(token)--> windup -> attack -> circle
 *                          |  \-> block (blockers only, when the player swings)
 *   thrower:  kite --(ranged token)--> pickup -> throw -> kite
 *   any -> hurt | stunned -> circle,   any -> dead
 *
 * Attack tokens (AttackTokens) cap how many enemies commit to an attack at once.
 * An enemy also waits until it is on screen before attacking, so the player is
 * never hit by something they could not see coming.
 */
export class Enemy extends Character {
  constructor(game, { archetype, model, x, z }) {
    const cfg = ARCHETYPES[archetype];
    super(game, { modelId: model, team: 'enemy', hp: cfg.hp, radius: cfg.radius, guard: cfg.guard });
    this.id = `enemy${nextId++}`;
    this.cfg = cfg;
    this.archetype = archetype;
    this.damageMul = cfg.damageMul;
    this.position.set(x, 0, z);
    this.cooldown = rand(0.6, 1.4);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = rand(1.5, 3);
    this.lastPlayerSwing = -1;
    this.setState('spawn');
    this.play('fight_stance', { fade: 0 });
  }

  get player() {
    return this.game.player;
  }

  think(dt) {
    const player = this.player;
    if (!player.alive) {
      this.play('fight_stance', { fade: 0.3, restart: false });
      return;
    }
    const d = distXZ(this.position, player.position);
    const toPlayer = yawTo(this.position, player.position);
    this.cooldown -= dt;

    switch (this.state) {
      case 'spawn':
        this.faceYaw(toPlayer, dt, 6);
        if (this.stateTime > 0.4) this.setState(this.cfg.ranged ? 'kite' : 'approach');
        break;

      case 'approach':
        this.faceYaw(toPlayer, dt, 8);
        this.walkToward(player.position, this.cfg.speed, dt);
        if (d <= this.cfg.engageRange) this.setState('circle');
        this.considerBlock(d);
        break;

      case 'circle':
        this.circle(d, toPlayer, dt, this.cfg.circle);
        this.considerBlock(d);
        if (this.cooldown <= 0 && this.canSeeAndReach() && this.game.tokens.request(this.id, 'melee')) this.beginWindup();
        break;

      case 'kite':
        this.kite(d, toPlayer, dt);
        if (this.cooldown > 0 || !this.canSeeAndReach()) break;
        if (d < 1.8 && this.game.tokens.request(this.id, 'melee')) this.beginWindup();
        else if (d > 3 && this.game.tokens.request(this.id, 'ranged')) this.beginThrow();
        break;

      case 'windup': {
        // Close to striking range, then commit. The tell glow runs throughout.
        this.faceYaw(toPlayer, dt, 10);
        if (d > this.move.range + this.radius + player.radius - 0.25) {
          this.walkToward(player.position, this.cfg.speed * 1.25, dt);
          if (this.stateTime > 2.5) this.abortAttack();
        } else if (this.stateTime >= this.cfg.windup) {
          this.setState('attack');
          this.startAttack(this.move.clip);
        }
        break;
      }

      case 'attack': {
        // Track the player only until shortly before the first hit: a late
        // sidestep is honored.
        const firstHit = this.anim.clipMeta(this.anim.name)?.hits?.[0]?.start ?? 0;
        if (this.anim.time < firstHit - 0.08) this.faceYaw(toPlayer, dt, 5);
        if (this.anim.finished) this.finishAttack();
        break;
      }

      case 'throwPrep':
        this.faceYaw(toPlayer, dt, 6);
        if (this.anim.finished) {
          this.setState('throw');
          this.throwTarget = this.leadTarget(0.8);
          this.play('throw_bottle', { fade: 0.08 });
        }
        break;

      case 'throw':
        this.faceYaw(yawTo(this.position, this.throwTarget), dt, 8);
        if (this.anim.finished) this.finishAttack();
        break;

      case 'block':
        this.blocking = true;
        this.faceYaw(toPlayer, dt, 10);
        if (this.anim.name === 'block_hit' && this.anim.finished) this.play('block', { fade: 0.08 });
        if (this.stateTime > this.blockTime) {
          this.blocking = false;
          this.setState('circle');
        }
        break;

      case 'hurt':
      case 'stunned':
        this.stunTime -= dt;
        if (this.stunTime <= 0) {
          this.stunned = false;
          this.setState(this.cfg.ranged ? 'kite' : 'circle');
        }
        break;

      default:
        break;
    }
  }

  // --- movement ---------------------------------------------------------------

  walkToward(target, speed, dt) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    this.walk(dx, dz, speed, dt);
    this.play('walk', { fade: 0.2, restart: false, timeScale: speed / 2 });
  }

  /** Hold a distance band around the player while strafing. */
  circle(d, toPlayer, dt, [near, far]) {
    this.faceYaw(toPlayer, dt, 8);
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir *= -1;
      this.strafeTimer = rand(1.5, 3);
    }
    const radial = d > far ? 1 : d < near ? -0.7 : 0;
    const fx = Math.sin(toPlayer);
    const fz = Math.cos(toPlayer);
    const tangent = 0.55 * this.strafeDir;
    const mx = fx * radial + fz * tangent;
    const mz = fz * radial - fx * tangent;
    const before = this.position.clone();
    this.walk(mx, mz, this.cfg.speed * 0.6, dt);
    if (before.distanceToSquared(this.position) < 1e-6 && (radial || tangent)) this.strafeDir *= -1; // blocked
    if (radial || tangent) this.play('walk', { fade: 0.25, restart: false, timeScale: 0.7 });
    else this.play('fight_stance', { fade: 0.25, restart: false });
  }

  kite(d, toPlayer, dt) {
    const [near, far] = this.cfg.kite;
    this.circle(d, toPlayer, dt, [near, far]);
  }

  // --- decisions -------------------------------------------------------------

  /** Attacks only from where the player can see it coming. */
  canSeeAndReach() {
    return this.game.cameraRig.isVisible(this.position);
  }

  considerBlock(d) {
    const p = this.player;
    if (!this.cfg.blockChance || p.state !== 'attack' || p.swing === this.lastPlayerSwing || d > 2.4) return;
    this.lastPlayerSwing = p.swing;
    const facing = Math.abs(wrapAngle(yawTo(this.position, p.position) - this.yaw)) < 0.9;
    if (!facing || this.guard < 20 || Math.random() > this.cfg.blockChance) return;
    this.blockTime = rand(0.8, 1.4);
    this.blocking = true;
    this.setState('block');
    this.play('block', { fade: 0.05 });
  }

  beginWindup() {
    this.move = pickWeighted(this.cfg.moves);
    this.setState('windup');
    this.tell(this.cfg.windup + this.timeToFirstHit(this.move.clip), false);
  }

  beginThrow() {
    this.setState('throwPrep');
    this.play('pickup_bottle', { fade: 0.1 });
  }

  /** Aim where the player will be, roughly, when the projectile lands. */
  leadTarget(flightTime) {
    const p = this.player;
    const v = p.velocity ?? { x: 0, z: 0 };
    return p.position.clone().set(p.position.x + v.x * flightTime * 0.6, p.position.y + 1, p.position.z + v.z * flightTime * 0.6);
  }

  finishAttack() {
    this.game.tokens.release(this.id);
    this.cooldown = rand(...this.cfg.cooldown);
    this.setState(this.cfg.ranged ? 'kite' : 'circle');
  }

  abortAttack() {
    this.game.tokens.release(this.id);
    this.cooldown = rand(0.5, 1);
    this.setState(this.cfg.ranged ? 'kite' : 'circle');
  }

  onAnimEvent(ev, clip) {
    if (this.handleCommonEvent(ev, clip)) return;
    if (ev.type === 'grab' && ev.prop === 'bottle') {
      const prop = this.game.assets.prop('bottle');
      this.game.level.hideDebris(prop.object);
      this.holdProp('bottle', prop, ev.attach);
    } else if (ev.type === 'release') {
      const held = this.takeProp(ev.prop);
      if (held) this.game.projectiles.launch({ kind: ev.prop, held, owner: this, target: this.throwTarget, flightTime: 0.8, marker: true });
    }
  }

  // --- reactions -------------------------------------------------------------

  onHurt(stun, move) {
    this.game.tokens.release(this.id);
    this.releaseAllProps();
    super.onHurt(stun, move);
  }

  onGuardBreak(move) {
    this.game.tokens.release(this.id);
    super.onGuardBreak(move);
  }

  onSlammed(move) {
    this.game.tokens.release(this.id);
    super.onSlammed(move);
  }

  afterSlam() {
    this.cooldown = rand(0.8, 1.4);
    this.setState(this.cfg.ranged ? 'kite' : 'circle');
  }

  onDeath(source) {
    this.game.tokens.release(this.id);
    super.onDeath(source);
    this.game.events.emit('enemyDied', { enemy: this });
  }
}
