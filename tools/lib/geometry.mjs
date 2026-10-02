// Turns Blockbench cubes into triangle lists. The face layout mirrors
// THREE.BoxGeometry (which Blockbench itself renders with), so per-face UVs land
// on the same corners they do in the editor.
import { Euler, Matrix4, Vector3 } from 'three';

const AXIS = { x: 0, y: 1, z: 2 };

// [face name, u axis, v axis, w (normal) axis, udir, vdir, normal sign]
export const FACE_LAYOUT = [
  ['east', 'z', 'y', 'x', -1, -1, 1],
  ['west', 'z', 'y', 'x', 1, -1, -1],
  ['up', 'x', 'z', 'y', 1, 1, 1],
  ['down', 'x', 'z', 'y', 1, -1, -1],
  ['south', 'x', 'y', 'z', 1, -1, 1],
  ['north', 'x', 'y', 'z', -1, -1, -1],
];

/** Rotation matrix for Blockbench degrees. Blockbench uses Euler order ZYX. */
export function blockbenchRotation(degrees = [0, 0, 0]) {
  const r = degrees.map((d) => (d * Math.PI) / 180);
  return new Matrix4().makeRotationFromEuler(new Euler(r[0], r[1], r[2], 'ZYX'));
}

/**
 * Appends one cube's faces to `out` ({positions, normals, uvs, indices}).
 * Positions are written relative to `pivot` (the owning group's origin) and scaled.
 */
export function appendCube(out, cube, { pivot, textureSize, scale }) {
  const inflate = cube.inflate ?? 0;
  const min = cube.from.map((v) => v - inflate);
  const max = cube.to.map((v) => v + inflate);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const origin = new Vector3(...(cube.origin ?? [0, 0, 0]));
  const rotation = blockbenchRotation(cube.rotation);
  const normalMatrix = new Matrix4().extractRotation(rotation);
  const [tw, th] = textureSize;

  const corner = new Vector3();
  const normal = new Vector3();

  for (const [name, u, v, w, udir, vdir, wsign] of FACE_LAYOUT) {
    const face = cube.faces?.[name];
    if (!face || face.texture === null || face.texture === undefined || face.texture === false) continue;
    const ui = AXIS[u];
    const vi = AXIS[v];
    const wi = AXIS[w];
    if (size[ui] * size[vi] === 0) continue; // zero-area face

    normal.set(0, 0, 0).setComponent(wi, wsign).applyMatrix4(normalMatrix).normalize();
    const [u1, v1, u2, v2] = face.uv;
    const base = out.positions.length / 3;

    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        const local = [0, 0, 0];
        local[ui] = (ix - 0.5) * size[ui] * udir;
        local[vi] = (iy - 0.5) * size[vi] * vdir;
        local[wi] = 0.5 * size[wi] * wsign;
        corner
          .set(center[0] + local[0], center[1] + local[1], center[2] + local[2])
          .sub(origin)
          .applyMatrix4(rotation)
          .add(origin)
          .sub(pivot)
          .multiplyScalar(scale);
        out.positions.push(corner.x, corner.y, corner.z);
        out.normals.push(normal.x, normal.y, normal.z);
        out.uvs.push((ix ? u2 : u1) / tw, (iy ? v2 : v1) / th);
      }
    }
    out.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }
}

/** Model-space AABB of a cube in Blockbench units, honoring cube and parent rotations. */
export function cubeBounds(cube, parentMatrix) {
  const origin = new Vector3(...(cube.origin ?? [0, 0, 0]));
  const rotation = blockbenchRotation(cube.rotation);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? cube.to[0] : cube.from[0], i & 2 ? cube.to[1] : cube.from[1], i & 4 ? cube.to[2] : cube.from[2]);
    p.sub(origin).applyMatrix4(rotation).add(origin);
    if (parentMatrix) p.applyMatrix4(parentMatrix);
    min.min(p);
    max.max(p);
  }
  return { min, max };
}
