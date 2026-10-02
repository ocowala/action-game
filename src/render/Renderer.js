import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** WebGL renderer + bloom (so fire, the beam and the exit sign actually glow). */
export class Renderer {
  constructor(container) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.1;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.localClippingEnabled = true; // pillar cutaway
    container.appendChild(this.gl.domElement);
    this.composer = null;
    addEventListener('resize', () => this.resize());
  }

  attach(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.4, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    this.gl.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    if (this.camera?.isPerspectiveCamera) {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera?.userData.resize?.(); // orthographic: CameraRig owns the frustum
    }
  }

  render() {
    this.composer.render();
  }
}
