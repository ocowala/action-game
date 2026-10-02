import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { upgradeMaterials } from '../render/materials.js';

/**
 * Loads asset_manifest.json and every GLB it lists, then hands out instances.
 * The manifest is the source of truth for clip names, timings and sockets;
 * this class never hard-codes an asset name.
 */
export class AssetLibrary {
  static async load(baseUrl = 'assets/', onProgress = () => {}) {
    const response = await fetch(`${baseUrl}asset_manifest.json`);
    if (!response.ok) throw new Error(`asset_manifest.json: HTTP ${response.status}. Run "npm run assets".`);
    const manifest = await response.json();
    const loader = new GLTFLoader();
    const ids = Object.keys(manifest.models);
    let done = 0;
    const gltfs = await Promise.all(
      ids.map(async (id) => {
        const gltf = await loader.loadAsync(baseUrl + manifest.models[id].file);
        onProgress(++done / ids.length, id);
        return [id, gltf];
      }),
    );
    return new AssetLibrary(manifest, new Map(gltfs));
  }

  constructor(manifest, gltfs) {
    this.manifest = manifest;
    this.scenes = new Map();
    this.clips = new Map();
    for (const [id, gltf] of gltfs) {
      gltf.scene.traverse((o) => {
        if (o.userData.hidden) o.visible = false;
      });
      upgradeMaterials(gltf.scene);
      this.scenes.set(id, gltf.scene);
      this.clips.set(id, new Map(gltf.animations.map((c) => [c.name, c])));
    }
  }

  meta(modelId) {
    const meta = this.manifest.models[modelId];
    if (!meta) throw new Error(`Unknown model "${modelId}"`);
    return meta;
  }

  /** A fresh copy of a whole model. Geometry and materials are shared. */
  instantiate(modelId) {
    const meta = this.meta(modelId);
    return { root: this.scenes.get(modelId).clone(true), clips: this.clips.get(modelId), meta };
  }

  /**
   * A prop from the manifest's prop table, e.g. "molotov" or "crate".
   * Returns a container whose origin is the prop's pivot, plus the clips that
   * animate nodes inside it (filtered so a prop mixer never binds stray tracks).
   */
  prop(propId) {
    const spec = this.manifest.props[propId];
    if (!spec) throw new Error(`Unknown prop "${propId}"`);
    const source = this.scenes.get(spec.model).getObjectByName(spec.node);
    const node = source.clone(true);
    node.visible = true;

    // The node's own translation is its authored position in the prop sheet.
    // Cancel it with an offset parent so animated translations stay valid.
    const offset = new THREE.Group();
    offset.position.copy(source.position).negate();
    offset.add(node);
    const container = new THREE.Group();
    container.name = `prop:${propId}`;
    container.add(offset);
    container.scale.setScalar(spec.scale ?? 1);

    const names = new Set();
    node.traverse((o) => names.add(o.name));
    const clips = new Map();
    for (const [name, clip] of this.clips.get(spec.model)) {
      const tracks = clip.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
      if (tracks.length) clips.set(name, new THREE.AnimationClip(name, clip.duration, tracks));
    }
    return { object: container, node, clips };
  }
}
