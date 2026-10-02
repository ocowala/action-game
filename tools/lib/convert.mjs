// Converts one parsed .bbmodel into a GLB plus the metadata the manifest needs
// (sockets, clip lengths/loop modes, root-motion offsets, level colliders).
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { appendCube, cubeBounds } from './geometry.mjs';
import { GltfBuilder } from './gltf-writer.mjs';
import { sampleChannel, sampleTimes, sortKeyframes } from './keyframes.mjs';

const DEG = Math.PI / 180;

/** Rebuilds the outliner tree with groups resolved (bbmodel v5 stores groups separately). */
export function readTree(bb) {
  const groups = new Map((bb.groups ?? []).map((g) => [g.uuid, g]));
  const elements = new Map(bb.elements.map((e) => [e.uuid, e]));
  const build = (entry, parent) => {
    const g = groups.get(entry.uuid) ?? entry; // older formats inline group data
    const node = {
      uuid: g.uuid,
      name: g.name,
      origin: g.origin ?? [0, 0, 0],
      rotation: g.rotation ?? [0, 0, 0],
      visible: g.visibility !== false,
      parent,
      cubes: [],
      locators: [],
      children: [],
    };
    for (const child of entry.children ?? []) {
      if (typeof child !== 'string') {
        node.children.push(build(child, node));
        continue;
      }
      const el = elements.get(child);
      if (!el) continue;
      if (el.type === 'locator') node.locators.push(el);
      else if ((el.type ?? 'cube') === 'cube') node.cubes.push(el);
    }
    return node;
  };
  return bb.outliner.filter((e) => typeof e === 'object').map((e) => build(e, null));
}

function walk(nodes, fn) {
  for (const n of nodes) {
    fn(n);
    walk(n.children, fn);
  }
}

function ancestry(node) {
  const names = [];
  for (let n = node; n; n = n.parent) names.push(n.name);
  return names;
}

/** Rest transform of a group, in its parent's space, Blockbench px. */
function restOffset(node) {
  const p = node.parent?.origin ?? [0, 0, 0];
  return [node.origin[0] - p[0], node.origin[1] - p[1], node.origin[2] - p[2]];
}

function eulerQuat(degrees) {
  return new Quaternion().setFromEuler(new Euler(degrees[0] * DEG, degrees[1] * DEG, degrees[2] * DEG, 'ZYX'));
}

/** Model-space rest matrix of a group: points stored in Blockbench coordinates -> posed model space. */
function modelMatrix(node) {
  const m = new Matrix4();
  const chain = [];
  for (let n = node; n; n = n.parent) chain.unshift(n);
  for (const n of chain) {
    const o = new Vector3(...n.origin);
    m.multiply(new Matrix4().makeTranslation(o.x, o.y, o.z))
      .multiply(new Matrix4().makeRotationFromQuaternion(eulerQuat(n.rotation)))
      .multiply(new Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  }
  return m;
}

function decodeTexture(bb, warnings) {
  if (bb.textures.length !== 1) warnings.push(`expected 1 texture, found ${bb.textures.length}; using the first`);
  const tex = bb.textures[0];
  const base64 = tex.source.replace(/^data:image\/png;base64,/, '');
  const width = tex.uv_width ?? bb.resolution?.width ?? tex.width;
  const height = tex.uv_height ?? bb.resolution?.height ?? tex.height;
  return { name: tex.name, png: Buffer.from(base64, 'base64'), size: [width, height] };
}

/**
 * @param bb parsed .bbmodel JSON
 * @param options {
 *   scale, fps,
 *   materials: [{ name, match: RegExp, gltf: { emissive?: [r,g,b], alpha?: number } }],
 *   colliders?: { groups: string[], exclude?: RegExp }
 * }
 */
export function convertBBModel(bb, options) {
  const { scale = 1 / 16, fps = 60, materials: rules = [], colliders: colliderSpec } = options;
  const warnings = [];
  const roots = readTree(bb);
  const texture = decodeTexture(bb, warnings);
  const gltf = new GltfBuilder('snake-brawler bbmodel->glb');
  const texIndex = gltf.addPngTexture(texture.png, texture.name);

  // Materials: 'base' plus one per rule, named so the runtime can upgrade them.
  const materialIndex = new Map();
  const base = { pbrMetallicRoughness: { baseColorTexture: { index: texIndex }, metallicFactor: 0, roughnessFactor: 1 } };
  materialIndex.set('base', gltf.addMaterial({ name: 'base', ...base }));
  for (const rule of rules) {
    const m = { name: rule.name, pbrMetallicRoughness: { ...base.pbrMetallicRoughness } };
    if (rule.gltf?.emissive) {
      m.emissiveTexture = { index: texIndex };
      m.emissiveFactor = rule.gltf.emissive;
    }
    if (rule.gltf?.alpha !== undefined) {
      m.alphaMode = 'BLEND';
      m.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, rule.gltf.alpha];
    }
    materialIndex.set(rule.name, gltf.addMaterial(m));
  }
  const classify = (cube, group) => {
    const names = [cube.name, ...ancestry(group)];
    const rule = rules.find((r) => names.some((n) => r.match.test(n)));
    return rule ? rule.name : 'base';
  };

  // Nodes.
  const nodeIndex = new Map(); // group uuid -> gltf node index
  const nodeNames = new Map(); // name -> count, for duplicate detection
  const sockets = [];
  const pivots = {};
  const countName = (name) => nodeNames.set(name, (nodeNames.get(name) ?? 0) + 1);

  const emitGroup = (group) => {
    const pivot = new Vector3(...group.origin);
    const node = { name: group.name, children: [] };
    const offset = restOffset(group);
    if (offset.some((v) => v !== 0)) node.translation = offset.map((v) => v * scale);
    if (group.rotation.some((v) => v !== 0)) node.rotation = eulerQuat(group.rotation).toArray();
    if (!group.visible) node.extras = { hidden: true };
    countName(group.name);
    pivots[group.name] = group.origin.map((v) => +(v * scale).toFixed(4));

    const buckets = { visible: new Map(), hidden: new Map() };
    for (const cube of group.cubes) {
      const bucket = cube.visibility === false ? buckets.hidden : buckets.visible;
      const key = classify(cube, group);
      if (!bucket.has(key)) bucket.set(key, { positions: [], normals: [], uvs: [], indices: [], material: materialIndex.get(key) });
      appendCube(bucket.get(key), cube, { pivot, textureSize: texture.size, scale });
    }
    const primitives = (bucket) => [...bucket.values()].filter((p) => p.indices.length);

    const index = gltf.addNode(node);
    nodeIndex.set(group.uuid, index);
    const visible = primitives(buckets.visible);
    if (visible.length) node.mesh = gltf.addMesh(group.name, visible);
    const hidden = primitives(buckets.hidden);
    if (hidden.length) {
      const name = `${group.name}__hidden`;
      countName(name);
      node.children.push(gltf.addNode({ name, mesh: gltf.addMesh(name, hidden), extras: { hidden: true } }));
    }
    for (const loc of group.locators) {
      const p = loc.position ?? loc.from ?? [0, 0, 0];
      countName(loc.name);
      sockets.push(loc.name);
      node.children.push(gltf.addNode({ name: loc.name, translation: p.map((v, i) => (v - group.origin[i]) * scale) }));
    }
    for (const child of group.children) node.children.push(emitGroup(child));
    if (!node.children.length) delete node.children;
    return index;
  };
  for (const root of roots) gltf.json.scenes[0].nodes.push(emitGroup(root));
  for (const [name, count] of nodeNames) if (count > 1) warnings.push(`duplicate node name "${name}" (${count}x): animation binding may be ambiguous`);

  // Animations.
  const groupsByUuid = new Map();
  walk(roots, (g) => groupsByUuid.set(g.uuid, g));
  const rootGroup = roots.length === 1 ? roots[0] : null;
  const clips = {};

  for (const anim of bb.animations ?? []) {
    const length = Number(anim.length) || 0;
    if (length <= 0) {
      warnings.push(`clip "${anim.name}" has zero length; skipped`);
      continue;
    }
    const times = sampleTimes(length, fps);
    const channels = [];
    let rootMotion = [0, 0, 0];

    for (const [uuid, animator] of Object.entries(anim.animators ?? {})) {
      const group = groupsByUuid.get(uuid);
      const keyframes = animator.keyframes ?? [];
      if (!group || keyframes.length === 0) continue;
      const node = nodeIndex.get(uuid);
      const byChannel = (ch) => sortKeyframes(keyframes.filter((k) => k.channel === ch));

      const rot = byChannel('rotation');
      if (rot.length) {
        const values = [];
        const prev = new Quaternion();
        times.forEach((t, i) => {
          const v = sampleChannel(rot, t);
          // Free-format models: keyframe rotation adds straight onto the rest Euler.
          // (Negating X/Y is the Bedrock convention and mirrors every pose front-to-back:
          // fight_stance's arm_left x=+62 must raise the arm toward -Z, the face side.)
          const q = eulerQuat([group.rotation[0] + v[0], group.rotation[1] + v[1], group.rotation[2] + v[2]]);
          if (i > 0 && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); // keep hemisphere continuous
          prev.copy(q);
          values.push(q.x, q.y, q.z, q.w);
        });
        channels.push({ node, path: 'rotation', values });
      }

      const pos = byChannel('position');
      if (pos.length) {
        const rest = restOffset(group);
        const values = [];
        for (const t of times) {
          const v = sampleChannel(pos, t);
          // Same as rotation: free-format position keyframes are a plain offset.
          values.push((rest[0] + v[0]) * scale, (rest[1] + v[1]) * scale, (rest[2] + v[2]) * scale);
        }
        channels.push({ node, path: 'translation', values });
        if (group === rootGroup) {
          const a = sampleChannel(pos, 0);
          const b = sampleChannel(pos, length);
          rootMotion = [(b[0] - a[0]) * scale, (b[1] - a[1]) * scale, (b[2] - a[2]) * scale].map((v) => +v.toFixed(4));
        }
      }

      const scl = byChannel('scale');
      if (scl.length) {
        const values = [];
        for (const t of times) values.push(...sampleChannel(scl, t));
        channels.push({ node, path: 'scale', values });
      }
    }

    if (!channels.length) {
      warnings.push(`clip "${anim.name}" has no keyframes; skipped`);
      continue;
    }
    gltf.addAnimation(anim.name, times, channels);
    clips[anim.name] = { length: +length.toFixed(4), loop: anim.loop ?? 'once', rootMotion };
  }

  // Static level colliders: per-cube AABBs in meters.
  let colliders;
  if (colliderSpec) {
    colliders = [];
    walk(roots, (group) => {
      if (!ancestry(group).some((n) => colliderSpec.groups.includes(n))) return;
      const matrix = modelMatrix(group);
      for (const cube of group.cubes) {
        if (colliderSpec.exclude?.test(cube.name)) continue;
        const { min, max } = cubeBounds(cube, matrix);
        colliders.push({
          name: cube.name,
          group: group.name,
          min: min.toArray().map((v) => +(v * scale).toFixed(4)),
          max: max.toArray().map((v) => +(v * scale).toFixed(4)),
        });
      }
    });
  }

  return {
    glb: gltf.toGLB(),
    warnings,
    meta: {
      root: rootGroup?.name ?? null,
      sockets,
      pivots,
      clips,
      ...(colliders ? { colliders } : {}),
    },
  };
}
