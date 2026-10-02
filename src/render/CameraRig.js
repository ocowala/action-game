import * as THREE from 'three';

const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/** True isometric elevation: the angle where all three axes foreshorten equally. */
export const ISO_PITCH = Math.atan(1 / Math.SQRT2); // ~35.26°

/**
 * Isometric arena camera: orthographic projection, turned 45° to the room,
 * looking down at the isometric angle. Sizes never change with distance, which
 * keeps spacing between fighters easy to read. The camera never orbits;
 * movement maps straight to the screen (stick right = screen right).
 *
 * It follows the player with damping, leans toward engaged enemies, clamps to
 * the arena, and can be pointed at something else for cinematics.
 */
export class CameraRig {
  constructor(camera, game, { yaw = (3 * Math.PI) / 4, pitch = ISO_PITCH, viewHeight = 12, distance = 40, bounds } = {}) {
    this.camera = camera;
    this.game = game;
    this.yaw = yaw; // camera forward on the ground = (sin yaw, cos yaw)
    this.pitch = pitch;
    this.distance = distance; // only places the camera; ortho size comes from viewHeight
    this.baseView = viewHeight;
    this.view = viewHeight;
    this.bounds = bounds;
    this.focus = null; // { position, view } overrides the player during cinematics
    this.target = new THREE.Vector3();
    this.trauma = 0;
    camera.userData.resize = () => this.applyView();
    this.applyView();
  }

  /** Sets the orthographic frustum from the current view height and window aspect. */
  applyView() {
    const aspect = innerWidth / innerHeight;
    const h = this.view / 2;
    Object.assign(this.camera, { left: -h * aspect, right: h * aspect, top: h, bottom: -h, near: 0.5, far: this.distance * 2 + 40 });
    this.camera.updateProjectionMatrix();
  }

  /** Screen shake, reserved for heavy impacts. Trauma is squared so it stays subtle. */
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  snap() {
    this.update(1, true);
  }

  update(dt, snap = false) {
    const game = this.game;
    const p = game.player.position;
    const desired = new THREE.Vector3(p.x, p.y + 1, p.z);
    let wantView = this.baseView;

    if (this.focus) {
      desired.copy(this.focus.position).setY(this.focus.position.y + 1);
      wantView = this.focus.view ?? this.baseView * 0.7;
    } else {
      // Lean toward the fight so incoming attackers stay on screen.
      let n = 0;
      const c = new THREE.Vector3();
      for (const e of game.enemies) {
        if (!e.alive || e.position.distanceTo(p) > 8) continue;
        c.add(e.position);
        n++;
      }
      if (n) {
        c.divideScalar(n);
        desired.x += (c.x - p.x) * 0.3;
        desired.z += (c.z - p.z) * 0.3;
        wantView += Math.min(1.5, n * 0.4);
      }
      if (game.boss?.alive && game.boss.state !== 'dormant') wantView += 1.5;
    }
    if (this.bounds) {
      desired.x = THREE.MathUtils.clamp(desired.x, this.bounds.minX, this.bounds.maxX);
      desired.z = THREE.MathUtils.clamp(desired.z, this.bounds.minZ, this.bounds.maxZ);
    }

    const k = snap ? 1 : 1 - Math.exp(-6 * dt);
    this.target.lerp(desired, k);
    const v = snap ? wantView : this.view + (wantView - this.view) * (1 - Math.exp(-2.5 * dt));
    if (Math.abs(v - this.view) > 1e-3) {
      this.view = v;
      this.applyView();
    }

    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(offset);

    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.25;
    if (s > 0) {
      const t = game.time * 40;
      this.camera.position.x += Math.sin(t * 1.3) * s;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * s;
    }
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  /** True if a character at `pos` is on screen (enemies never attack from off-screen). */
  isVisible(pos, margin = 0.2) {
    this.camera.updateMatrixWorld();
    _m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    _sphere.center.set(pos.x, pos.y + 1, pos.z);
    _sphere.radius = -margin; // the body must be inside the frame, not just touching it
    return _frustum.intersectsSphere(_sphere);
  }
}
