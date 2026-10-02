import { AssetLibrary } from './assets/AssetLibrary.js';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { LEVEL1 } from './levels/level1.js';
import { Renderer } from './render/Renderer.js';
import { HUD } from './ui/HUD.js';

const MAX_DT = 1 / 30; // a long frame never tunnels a hit window

const hud = new HUD();
hud.showLoading();
const renderer = new Renderer(document.body);
const input = new Input(window);

try {
  const assets = await AssetLibrary.load('assets/', (f) => hud.setLoading(f));
  const game = new Game({ renderer, assets, input, hud, level: LEVEL1 });
  window.__game = game; // debug handle for the console
  // Dev: ?skip=wave2 or ?skip=boss jumps ahead for testing/tuning.
  const skip = new URLSearchParams(location.search).get('skip');
  if (skip && game.encounters.skipTo(skip)) game.player.position.x = skip === 'boss' ? 0.5 : -9;
  hud.showTitle(() => game.start());

  let last = performance.now();
  renderer.gl.setAnimationLoop((now) => {
    const dt = Math.min(MAX_DT, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
  });
} catch (err) {
  console.error(err);
  hud.showScreen(`<h1>Could not start</h1><p>${err.message}</p>`);
}
