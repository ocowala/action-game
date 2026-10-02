import * as THREE from 'three';
import { Boss } from '../ai/BossBrain.js';
import { AttackTokens } from '../ai/AttackTokens.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { EncounterManager } from '../encounter/EncounterManager.js';
import { Enemy } from '../entities/Enemy.js';
import { Player, ULT } from '../entities/Player.js';
import { Projectiles } from '../entities/Projectile.js';
import { Music } from '../audio/Music.js';
import { CameraRig } from '../render/CameraRig.js';
import { VFX } from '../vfx/VFX.js';
import { Level } from '../world/Level.js';
import { distXZ } from './math.js';

class Events {
  constructor() {
    this.handlers = new Map();
  }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(fn);
  }
  emit(name, payload) {
    for (const fn of this.handlers.get(name) ?? []) fn(payload);
  }
}

/**
 * Owns the world and runs the frame. Systems update in a fixed order:
 * input -> level -> characters -> separation -> combat -> projectiles -> AI
 * tokens -> encounters -> VFX -> camera -> HUD.
 */
export class Game {
  constructor({ renderer, assets, input, hud, level }) {
    this.renderer = renderer;
    this.assets = assets;
    this.input = input;
    this.hud = hud;
    this.levelData = level;
    this.events = new Events();
    this.time = 0;
    this.timers = [];
    this.freeze = false;
    this.lockPlayerInput = false;
    this.state = 'title';
    this.stats = { start: 0, damageTaken: 0, ults: 0 };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080a);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 120);
    renderer.attach(this.scene, this.camera);

    this.vfx = new VFX(this);
    this.level = new Level(this, level);
    this.cameraRig = new CameraRig(this.camera, this, level.camera);
    this.music = level.music ? new Music(level.music) : null;
    this.combat = new CombatSystem(this);
    this.tokens = new AttackTokens();
    this.projectiles = new Projectiles(this);
    this.enemies = [];
    this.player = new Player(this);
    this.scene.add(this.player.object);
    this.placePlayer(level.playerSpawn);
    this.spawnDormantBoss();
    this.encounters = new EncounterManager(this, level);
    this.wireEvents();
    this.cameraRig.snap();
    this.hud.setObjective('Get to the stairwell door');
  }

  get characters() {
    return [this.player, ...this.enemies];
  }

  // --- spawning ------------------------------------------------------------

  placePlayer({ x, z, yaw }) {
    this.player.position.set(x, 0, z);
    this.player.yaw = yaw ?? Math.PI / 2;
  }

  spawnEnemy(spec) {
    const e = new Enemy(this, spec);
    this.enemies.push(e);
    this.scene.add(e.object);
    return e;
  }

  /** The boss stands guard at the stairs from the start, untouchable until his intro. */
  spawnDormantBoss() {
    const spec = this.levelData.encounters.find((e) => e.boss)?.boss;
    if (!spec) return;
    this.boss = new Boss(this, spec);
    this.boss.invulnerable = true;
    this.enemies.push(this.boss);
    this.scene.add(this.boss.object);
  }

  spawnBoss() {
    if (!this.boss || !this.boss.alive || this.boss.state !== 'dormant') this.spawnDormantBoss();
    this.boss.beginIntro();
    return this.boss;
  }

  removeEnemy(e, immediate = false) {
    this.tokens.release(e.id);
    if (immediate || !e.alive) {
      e.object.removeFromParent();
      this.enemies = this.enemies.filter((x) => x !== e);
      if (e === this.boss && immediate) this.boss = null;
    }
  }

  // --- utilities -----------------------------------------------------------

  /** Freezes enemies (ult transformation cinematic) and voids pending attacks. */
  setFreeze(on) {
    this.freeze = on;
    if (on) {
      this.tokens.clear();
      for (const e of this.enemies) if (e.state === 'windup' || e.state === 'attack') e.setState(e.cfg?.ranged ? 'kite' : 'circle');
    }
  }

  later(seconds, fn) {
    this.timers.push({ at: this.time + seconds, fn });
  }

  // --- events ------------------------------------------------------------------

  wireEvents() {
    const ev = this.events;
    ev.on('damage', ({ target, source, amount }) => {
      if (source === this.player && target.team === 'enemy') this.player.addMeter(amount * ULT.perDamageDealt);
      if (target === this.player) this.stats.damageTaken += amount;
    });
    ev.on('ultStart', () => {
      this.stats.ults++;
      this.hud.toast('SHIVA', 1.5);
    });
    ev.on('encounterStart', ({ encounter }) => {
      if (encounter.boss) {
        this.lockPlayerInput = true;
        this.cameraRig.focus = { position: this.boss.position, distance: 9 };
        this.hud.showBoss(encounter.boss.name);
        this.hud.setObjective('Take him down');
      } else {
        this.hud.setObjective('Survive');
      }
    });
    ev.on('bossEngaged', () => {
      this.lockPlayerInput = false;
      this.cameraRig.focus = null;
    });
    ev.on('encounterCleared', ({ encounter }) => {
      if (encounter.boss) return;
      this.hud.toast(`${encounter.label.split(' /')[0]} cleared`, 1.6);
      this.hud.setObjective(encounter.id === 'wave2' ? 'Someone is waiting by the stairs...' : 'More are coming');
    });
    ev.on('bossDefeated', () => {
      this.hud.toast('Boss defeated', 2);
      this.hud.setWave('');
      this.later(1.6, () => {
        this.hud.hideBoss();
        this.level.unlockDoor();
        this.hud.toast('The stairwell door is open', 2.2);
        this.hud.setObjective('Take the stairs');
      });
    });
    ev.on('playerDied', () => {
      this.later(2.2, () => {
        this.state = 'dead';
        this.hud.showDeath(() => this.retry());
      });
    });
  }

  // --- flow -------------------------------------------------------------------------

  start() {
    this.state = 'playing';
    this.stats.start = this.time;
    this.hud.hideScreen();
    this.hud.showGameplay(true);
    this.music?.play();
    this.input.clearPresses();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.music?.pause();
      this.hud.showPause(() => this.togglePause());
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.music?.play();
      this.hud.hideScreen();
      this.input.clearPresses();
    }
  }

  retry() {
    const checkpoint = this.encounters.resetToCheckpoint();
    this.projectiles.clear();
    this.vfx.clear();
    this.tokens.clear();
    this.setFreeze(false);
    this.lockPlayerInput = false;
    this.cameraRig.focus = null;
    this.hud.hideBoss();
    if (!this.boss) this.spawnDormantBoss();
    this.player.respawn(checkpoint ?? { hp: this.player.maxHp, meter: 0, position: new THREE.Vector3(this.levelData.playerSpawn.x, 0, this.levelData.playerSpawn.z) });
    this.level.resetPickups();
    this.cameraRig.snap();
    this.state = 'playing';
    this.hud.hideScreen();
    this.input.clearPresses();
  }

  async completeLevel() {
    this.state = 'complete';
    this.lockPlayerInput = true;
    this.music?.fadeOut(1.5);
    await this.hud.fadeTo(1);
    const secs = Math.round(this.time - this.stats.start);
    this.hud.showLevelComplete(
      { time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, damageTaken: Math.round(this.stats.damageTaken), ults: this.stats.ults },
      () => location.reload(),
    );
  }

  // --- frame ------------------------------------------------------------------------

  update(dt) {
    this.input.update(this.time);
    if (this.input.consume('pause')) this.togglePause();
    if (this.state === 'dead' && this.input.consume('retry')) this.retry();
    if (this.state === 'title' && this.input.consume('confirm')) this.start();
    if (this.state !== 'playing' && this.state !== 'complete') {
      this.cameraRig.update(dt);
      return;
    }

    this.time += dt;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();

    this.level.update(dt);
    this.player.update(dt);
    for (const e of [...this.enemies]) {
      e.update(this.freeze ? 0 : dt);
      // Bodies stay down for a few seconds, then clear out (the boss stays).
      if (!e.alive && e !== this.boss && e.stateTime > 3) this.removeEnemy(e);
    }
    this.separate();
    this.combat.update();
    this.projectiles.update(dt);
    this.tokens.update(dt);
    this.encounters.update(dt);
    this.vfx.update(dt);
    this.cameraRig.update(dt);
    this.updateHud(dt);

    const door = this.levelData.door;
    if (this.state === 'playing' && this.level.doorState === 'open' && this.player.alive && this.player.position.x > door.exitAtX && this.player.position.y > 2) {
      this.completeLevel();
    }
  }

  /** Keeps characters from overlapping each other and the loose crates. */
  separate() {
    const chars = this.characters.filter((c) => c.alive && !c.invulnerable);
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const a = chars[i];
        const b = chars[j];
        const min = a.radius + b.radius;
        const d = distXZ(a.position, b.position);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / 2;
        const nx = (b.position.x - a.position.x) / d;
        const nz = (b.position.z - a.position.z) / d;
        a.translate(-nx * push, -nz * push);
        b.translate(nx * push, nz * push);
      }
    }
    for (const c of chars) {
      for (const p of this.level.pickups) {
        if (!p.available || p.kind !== 'crate' || Math.abs(p.position.y - c.position.y) > 1) continue;
        const d = distXZ(c.position, p.position);
        const min = c.radius + 0.5;
        if (d < min && d > 1e-4) c.translate(((c.position.x - p.position.x) / d) * (min - d), ((c.position.z - p.position.z) / d) * (min - d));
      }
    }
  }

  updateHud(dt) {
    const p = this.player;
    const ultFraction = p.form === 'shiva' ? Math.max(0, p.ultTime / ULT.duration) : p.meter / ULT.max;
    this.hud.updatePlayer(p, ultFraction);
    if (this.boss && this.boss.state !== 'dormant') this.hud.updateBoss(this.boss);
    this.hud.updateEnemyBars(this.enemies, this.camera);
    this.hud.update(dt);

    let prompt = null;
    if (p.alive && !this.lockPlayerInput) {
      if (p.state === 'carry') prompt = '<b>J</b> / <b>E</b>  Throw crate';
      else if (p.held.has('bottle')) prompt = '<b>J</b>  Throw bottle';
      else if (p.state === 'locomotion') {
        const pick = this.level.nearestPickup(p.position, 1.5);
        if (pick) prompt = `<b>E</b>  Pick up ${pick.kind}`;
        else if (this.level.inDoorZone(p.position)) prompt = this.level.doorState === 'open' ? 'Go through the door' : '<b>E</b>  Try the door';
        else if (p.ultReady) prompt = '<b>Q</b>  Become the Shiva avatar';
      }
    }
    this.hud.setPrompt(prompt);
  }

  render() {
    this.renderer.render();
  }
}
