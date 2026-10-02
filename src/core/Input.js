// Keyboard + mouse + gamepad, mapped to game actions. Gameplay code asks for
// actions ("attack", "block"), never for keys, so rebinding stays in one table.

const KEYS = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down',
  ArrowLeft: 'camLeft', ArrowRight: 'camRight',
  KeyJ: 'attack', KeyK: 'block', KeyE: 'interact', KeyL: 'special', KeyQ: 'ult',
  Escape: 'pause', KeyP: 'pause', KeyR: 'retry', Enter: 'confirm', Space: 'confirm',
};
const MOUSE = { 0: 'attack', 2: 'block' };
// Standard gamepad layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 9 Start.
const PAD = { 0: 'interact', 1: 'special', 2: 'attack', 3: 'ult', 4: 'block', 5: 'block', 6: 'block', 9: 'pause' };
const DEADZONE = 0.22;

export class Input {
  constructor(target = window) {
    this.held = new Set();
    this.pressedAt = new Map();
    this.padHeld = new Set();
    this.padMove = { x: 0, y: 0 };
    this.padCam = 0;
    this.now = 0;
    this.usingPad = false;

    const press = (action) => {
      if (!this.held.has(action)) this.pressedAt.set(action, this.now);
      this.held.add(action);
    };
    target.addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a) return;
      e.preventDefault();
      this.usingPad = false;
      if (!e.repeat) press(a);
    });
    target.addEventListener('keyup', (e) => KEYS[e.code] && this.held.delete(KEYS[e.code]));
    target.addEventListener('mousedown', (e) => MOUSE[e.button] !== undefined && press(MOUSE[e.button]));
    target.addEventListener('mouseup', (e) => MOUSE[e.button] !== undefined && this.held.delete(MOUSE[e.button]));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Call once per frame before gameplay reads input. */
  update(now) {
    this.now = now;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (!pad) {
      this.padMove.x = this.padMove.y = this.padCam = 0;
      return;
    }
    for (const [index, action] of Object.entries(PAD)) {
      const down = pad.buttons[index]?.pressed;
      const key = `${action}#${index}`;
      if (down && !this.padHeld.has(key)) {
        this.pressedAt.set(action, now);
        this.usingPad = true;
      }
      if (down) this.padHeld.add(key);
      else this.padHeld.delete(key);
    }
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
    this.padMove.x = dz(pad.axes[0] ?? 0);
    this.padMove.y = -dz(pad.axes[1] ?? 0);
    this.padCam = dz(pad.axes[2] ?? 0);
    if (this.padMove.x || this.padMove.y) this.usingPad = true;
  }

  isHeld(action) {
    if (this.held.has(action)) return true;
    for (const key of this.padHeld) if (key.startsWith(`${action}#`)) return true;
    return false;
  }

  /** True if `action` was pressed within `buffer` seconds; consumes the press. */
  consume(action, buffer = 0.25) {
    const t = this.pressedAt.get(action);
    if (t === undefined || this.now - t > buffer) return false;
    this.pressedAt.delete(action);
    return true;
  }

  /** Movement intent: x = right, y = forward, length <= 1. */
  get move() {
    let x = this.padMove.x + (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    let y = this.padMove.y + (this.isHeld('up') ? 1 : 0) - (this.isHeld('down') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  get cameraTurn() {
    return this.padCam + (this.isHeld('camRight') ? 1 : 0) - (this.isHeld('camLeft') ? 1 : 0);
  }

  clearPresses() {
    this.pressedAt.clear();
  }
}
