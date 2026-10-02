// Minimal glTF 2.0 binary (GLB) writer. Only what the converter needs:
// nodes, meshes, one embedded PNG per model, materials and TRS animations.

const COMPONENT = { FLOAT: 5126, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125 };
const TARGET = { ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963 };
const SAMPLER = { NEAREST: 9728, CLAMP: 33071 };

export class GltfBuilder {
  constructor(generator) {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
      animations: [],
    };
    this.chunks = [];
    this.byteLength = 0;
  }

  addBufferView(bytes, target) {
    const padding = (4 - (this.byteLength % 4)) % 4;
    if (padding) {
      this.chunks.push(new Uint8Array(padding));
      this.byteLength += padding;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.byteLength += bytes.byteLength;
    return this.json.bufferViews.push(view) - 1;
  }

  addAccessor(array, type, { target, withBounds = false } = {}) {
    const componentType =
      array instanceof Float32Array ? COMPONENT.FLOAT
      : array instanceof Uint32Array ? COMPONENT.UNSIGNED_INT
      : COMPONENT.UNSIGNED_SHORT;
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const accessor = {
      bufferView: this.addBufferView(array, target),
      componentType,
      count: array.length / width,
      type,
    };
    if (withBounds) {
      const min = new Array(width).fill(Infinity);
      const max = new Array(width).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const k = i % width;
        if (array[i] < min[k]) min[k] = array[i];
        if (array[i] > max[k]) max[k] = array[i];
      }
      accessor.min = min;
      accessor.max = max;
    }
    return this.json.accessors.push(accessor) - 1;
  }

  addPngTexture(pngBytes, name) {
    const bufferView = this.addBufferView(pngBytes);
    const image = this.json.images.push({ bufferView, mimeType: 'image/png', name }) - 1;
    if (this.json.samplers.length === 0) {
      // Pixel art: nearest filtering, no mipmaps.
      this.json.samplers.push({
        magFilter: SAMPLER.NEAREST,
        minFilter: SAMPLER.NEAREST,
        wrapS: SAMPLER.CLAMP,
        wrapT: SAMPLER.CLAMP,
      });
    }
    return this.json.textures.push({ sampler: 0, source: image }) - 1;
  }

  addMaterial(material) {
    return this.json.materials.push(material) - 1;
  }

  /** primitives: [{ positions, normals, uvs, indices, material }] (plain arrays). */
  addMesh(name, primitives) {
    const out = primitives.map((p) => {
      const vertexCount = p.positions.length / 3;
      const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
      return {
        attributes: {
          POSITION: this.addAccessor(new Float32Array(p.positions), 'VEC3', { target: TARGET.ARRAY_BUFFER, withBounds: true }),
          NORMAL: this.addAccessor(new Float32Array(p.normals), 'VEC3', { target: TARGET.ARRAY_BUFFER }),
          TEXCOORD_0: this.addAccessor(new Float32Array(p.uvs), 'VEC2', { target: TARGET.ARRAY_BUFFER }),
        },
        indices: this.addAccessor(new IndexArray(p.indices), 'SCALAR', { target: TARGET.ELEMENT_ARRAY_BUFFER }),
        material: p.material,
      };
    });
    return this.json.meshes.push({ name, primitives: out }) - 1;
  }

  addNode(node) {
    return this.json.nodes.push(node) - 1;
  }

  /** channels: [{ node, path: 'translation'|'rotation'|'scale', values: number[] }], times shared. */
  addAnimation(name, times, channels) {
    const input = this.addAccessor(new Float32Array(times), 'SCALAR', { withBounds: true });
    const animation = { name, samplers: [], channels: [] };
    for (const c of channels) {
      const type = c.path === 'rotation' ? 'VEC4' : 'VEC3';
      const output = this.addAccessor(new Float32Array(c.values), type);
      const sampler = animation.samplers.push({ input, output, interpolation: 'LINEAR' }) - 1;
      animation.channels.push({ sampler, target: { node: c.node, path: c.path } });
    }
    this.json.animations.push(animation);
  }

  toGLB() {
    const json = this.json;
    for (const key of ['materials', 'textures', 'images', 'samplers', 'animations']) {
      if (json[key].length === 0) delete json[key];
    }
    json.buffers = [{ byteLength: this.byteLength }];

    const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
    const bin = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      bin.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const binBytes = pad(bin, 0);

    const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
    const glb = new Uint8Array(total);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true); // 'glTF'
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonBytes.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true); // 'JSON'
    glb.set(jsonBytes, 20);
    const binHeader = 20 + jsonBytes.byteLength;
    view.setUint32(binHeader, binBytes.byteLength, true);
    view.setUint32(binHeader + 4, 0x004e4942, true); // 'BIN'
    glb.set(binBytes, binHeader + 8);
    return glb;
  }
}

function pad(bytes, fill) {
  const padded = Math.ceil(bytes.byteLength / 4) * 4;
  if (padded === bytes.byteLength) return bytes;
  const out = new Uint8Array(padded).fill(fill);
  out.set(bytes);
  return out;
}
