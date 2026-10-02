// Runs the level's encounter list in order: waits for each trigger, spawns its
// enemies (staggered), tracks when they are all down, and keeps a checkpoint at
// the start of every encounter so a death restarts that fight, not the level.

/** Pure trigger check, unit tested. */
export function triggerReady(trigger, { cleared, clearedAt, now, playerX }) {
  if (trigger.afterCleared) {
    if (!cleared.has(trigger.afterCleared)) return false;
    if (now - (clearedAt.get(trigger.afterCleared) ?? now) < (trigger.delay ?? 0)) return false;
  }
  if (trigger.minX !== undefined && playerX < trigger.minX) return false;
  return true;
}

export class EncounterManager {
  constructor(game, level) {
    this.game = game;
    this.encounters = level.encounters;
    this.index = 0;
    this.running = null;
    this.cleared = new Set();
    this.clearedAt = new Map();
    this.checkpoint = null;
  }

  get current() {
    return this.encounters[this.index] ?? null;
  }

  update(dt) {
    const game = this.game;
    const enc = this.current;
    if (!enc) return;

    if (!this.running) {
      const ready = triggerReady(enc.trigger, {
        cleared: this.cleared,
        clearedAt: this.clearedAt,
        now: game.time,
        playerX: game.player.position.x,
      });
      if (ready && game.player.alive) this.start(enc);
      return;
    }

    const r = this.running;
    r.time += dt;
    while (r.queue.length && r.queue[0].delay <= r.time) {
      const spec = r.queue.shift();
      r.members.push(game.spawnEnemy(spec));
    }
    if (!r.queue.length && r.members.every((m) => !m.alive)) this.complete(enc);
  }

  start(enc) {
    const game = this.game;
    this.checkpoint = {
      hp: game.player.hp,
      meter: game.player.meter,
      position: game.player.position.clone(),
    };
    game.tokens.configure(enc.tokens);
    this.running = { enc, time: 0, members: [], queue: [...(enc.spawns ?? [])].sort((a, b) => a.delay - b.delay) };
    if (enc.boss) this.running.members.push(game.spawnBoss(enc.boss));
    game.hud.setWave(enc.label);
    game.events.emit('encounterStart', { encounter: enc });
  }

  complete(enc) {
    this.cleared.add(enc.id);
    this.clearedAt.set(enc.id, this.game.time);
    this.running = null;
    this.index++;
    this.game.events.emit('encounterCleared', { encounter: enc, last: !this.current });
  }

  /** Dev shortcut (?skip=<encounter id>): marks every earlier encounter cleared. */
  skipTo(id) {
    const target = this.encounters.findIndex((e) => e.id === id);
    if (target < 0) return false;
    for (const e of this.encounters.slice(0, target)) {
      this.cleared.add(e.id);
      this.clearedAt.set(e.id, -100);
    }
    this.index = target;
    return true;
  }

  /** After a death: remove this encounter's enemies and re-arm its trigger. */
  resetToCheckpoint() {
    if (this.running) {
      for (const m of this.running.members) this.game.removeEnemy(m, true);
      this.running = null;
    }
    return this.checkpoint;
  }
}
