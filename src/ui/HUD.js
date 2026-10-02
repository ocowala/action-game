import * as THREE from 'three';
import './hud.css';

const CONTROLS = `
  <div class="controls">
    <span><b>WASD</b> / stick</span><span>Walk</span>
    <span><b>J</b> / LMB / X</span><span>Attack (time taps: jab, jab, hook, uppercut)</span>
    <span><b>K</b> / RMB / LB</span><span>Block (hold)</span>
    <span><b>E</b> / A</span><span>Pick up, throw, use door</span>
    <span><b>Q</b> / Y</span><span>Shiva avatar (when meter is full)</span>
    <span><b>Shiva</b></span><span>J palm · K stomp · L third-eye beam · E trishul</span>
    <span><b>Esc</b></span><span>Pause</span>
  </div>`;

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/** DOM HUD: player/boss bars, wave counter, prompts, overhead enemy bars and screens. */
export class HUD {
  constructor() {
    this.root = el(`
      <div id="hud">
        <div id="flash"></div>
        <div id="player-panel" class="hidden">
          <div class="label">Agent</div>
          <div class="bar"><i class="lag"></i><i class="fill-hp"></i></div>
          <div class="bar guard"><i></i></div>
          <div id="ult-row"><div class="bar ult"><i></i></div><span id="ult-key">Q</span></div>
        </div>
        <div id="objective"><div id="wave"></div><div id="objective-text"></div></div>
        <div id="enemy-bars"></div>
        <div id="boss" class="hidden">
          <div id="boss-name"></div>
          <div class="bar"><span class="notch"></span><i class="lag"></i><i class="fill-hp"></i></div>
          <div class="bar guard"><i></i></div>
        </div>
        <div id="prompt" class="hidden"></div>
        <div id="toast"></div>
        <div id="fade"></div>
      </div>`);
    document.body.appendChild(this.root);
    const $ = (s) => this.root.querySelector(s);
    this.panel = $('#player-panel');
    this.hp = $('#player-panel .fill-hp');
    this.hpLag = $('#player-panel .lag');
    this.guard = $('#player-panel .guard > i');
    this.ult = $('#player-panel .ult > i');
    this.wave = $('#wave');
    this.objective = $('#objective-text');
    this.boss = $('#boss');
    this.bossName = $('#boss-name');
    this.bossHp = $('#boss .fill-hp');
    this.bossLag = $('#boss .lag');
    this.bossGuard = $('#boss .guard > i');
    this.prompt = $('#prompt');
    this.toastEl = $('#toast');
    this.flashEl = $('#flash');
    this.fadeEl = $('#fade');
    this.enemyBars = $('#enemy-bars');
    this.bars = new Map();
    this.toastTimer = 0;
    this.screen = null;
    this._v = new THREE.Vector3();
  }

  // --- in-game -----------------------------------------------------------

  showGameplay(show) {
    this.panel.classList.toggle('hidden', !show);
  }

  updatePlayer(player, ultFraction) {
    const pct = `${(player.hp / player.maxHp) * 100}%`;
    this.hp.style.width = pct;
    this.hpLag.style.width = pct;
    this.guard.style.width = `${(player.guard / player.maxGuard) * 100}%`;
    this.ult.style.width = `${ultFraction * 100}%`;
    this.panel.classList.toggle('ult-ready', player.ultReady);
    this.panel.classList.toggle('shiva', player.form === 'shiva');
  }

  setWave(text) {
    this.wave.textContent = text;
  }

  setObjective(text) {
    this.objective.textContent = text;
  }

  showBoss(name) {
    this.bossName.textContent = name;
    this.boss.classList.remove('hidden');
  }

  hideBoss() {
    this.boss.classList.add('hidden');
  }

  updateBoss(boss) {
    const pct = `${(boss.hp / boss.maxHp) * 100}%`;
    this.bossHp.style.width = pct;
    this.bossLag.style.width = pct;
    this.bossGuard.style.width = `${(boss.guard / boss.maxGuard) * 100}%`;
  }

  setPrompt(html) {
    if (!html) {
      this.prompt.classList.add('hidden');
      return;
    }
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.remove('hidden');
  }

  toast(text, seconds = 1.5) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = 1;
    this.toastTimer = seconds;
  }

  flash(amount, color) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = amount;
    void this.flashEl.offsetWidth; // commit the start state, then fade (no rAF dependency)
    this.flashEl.style.transition = 'opacity 0.5s';
    this.flashEl.style.opacity = 0;
  }


  /** Small health bars over regular enemies (the boss has the big bar). */
  updateEnemyBars(enemies, camera) {
    const seen = new Set();
    for (const e of enemies) {
      if (!e.alive || e.id === 'boss') continue;
      seen.add(e);
      let bar = this.bars.get(e);
      if (!bar) {
        bar = el('<div class="enemy-bar"><i></i></div>');
        this.enemyBars.appendChild(bar);
        this.bars.set(e, bar);
      }
      this._v.copy(e.position).setY(e.position.y + e.height + 0.35).project(camera);
      const visible = this._v.z < 1;
      bar.style.display = visible ? 'block' : 'none';
      bar.style.left = `${(this._v.x * 0.5 + 0.5) * innerWidth}px`;
      bar.style.top = `${(-this._v.y * 0.5 + 0.5) * innerHeight}px`;
      bar.firstChild.style.width = `${(e.hp / e.maxHp) * 100}%`;
      bar.classList.toggle('guarding', e.blocking);
    }
    for (const [e, bar] of this.bars) {
      if (!seen.has(e)) {
        bar.remove();
        this.bars.delete(e);
      }
    }
  }

  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = 0;
    }
  }

  fadeTo(opacity) {
    this.fadeEl.style.opacity = opacity;
    return new Promise((r) => setTimeout(r, 950));
  }

  // --- screens -------------------------------------------------------------------

  showScreen(html, onButton) {
    this.hideScreen();
    this.screen = el(`<div class="screen"><div class="card">${html}</div></div>`);
    document.body.appendChild(this.screen);
    const button = this.screen.querySelector('button');
    if (button && onButton) button.addEventListener('click', onButton);
    return this.screen;
  }

  hideScreen() {
    this.screen?.remove();
    this.screen = null;
  }

  showLoading() {
    return this.showScreen(`<h1>Getting the Job</h1><h2>Loading assets</h2><div class="progress"><i></i></div>`);
  }

  setLoading(fraction) {
    const bar = this.screen?.querySelector('.progress > i');
    if (bar) bar.style.width = `${fraction * 100}%`;
  }

  showTitle(onStart) {
    this.showScreen(
      `<h1>Getting the Job</h1><h2>Level 1: The Parking Garage</h2>
       <p>Fight your way up the tower, one floor at a time. Start at the bottom.</p>
       ${CONTROLS}<button>Start</button>`,
      onStart,
    );
  }

  showPause(onResume) {
    this.showScreen(`<h1>Paused</h1>${CONTROLS}<button>Resume (Esc)</button>`, onResume);
  }

  showDeath(onRetry) {
    this.showScreen(`<h1>Knocked Out</h1><h2>Back to the last checkpoint</h2><p>Watch for the glow: orange is a quick hit, red with "!" is a big one. Block the quick ones, walk out of the big ones.</p><button>Retry (R)</button>`, onRetry);
  }

  showLevelComplete(stats, onReplay) {
    this.showScreen(
      `<h1>Level 2</h1><h2>The Nightclub. Coming soon</h2>
       <p>Garage cleared in ${stats.time}. Damage taken: ${stats.damageTaken}. Ultimates used: ${stats.ults}.</p>
       <button>Replay Level 1</button>`,
      onReplay,
    );
  }
}
