// Dev tool: inspect converted models, play clips, and see manifest hit windows,
// sockets and events fire in real time. Open /viewer.html while `npm run dev` runs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationController } from './anim/AnimationController.js';
import { AssetLibrary } from './assets/AssetLibrary.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c33);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 6, 4);
scene.add(sun, new THREE.GridHelper(10, 20, 0x555555, 0x333333));
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
camera.position.set(2.5, 2, 3.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const ui = {
  model: document.getElementById('model'),
  clip: document.getElementById('clip'),
  slow: document.getElementById('slow'),
  info: document.getElementById('info'),
};
const lib = await AssetLibrary.load('assets/');
for (const id of Object.keys(lib.manifest.models)) ui.model.add(new Option(id, id));

let current = null;
const socketMarkers = [];
const hitMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true }));
hitMarker.visible = false;
scene.add(hitMarker);
const log = [];

function loadModel(id) {
  if (current) scene.remove(current.root);
  socketMarkers.length = 0;
  const { root, clips, meta } = lib.instantiate(id);
  scene.add(root);
  for (const s of meta.sockets) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: 0x30ff60, depthTest: false }));
    root.getObjectByName(s).add(m);
    socketMarkers.push(m);
  }
  const anim = new AnimationController(root, clips, meta);
  current = { id, root, anim, meta };
  ui.clip.innerHTML = '';
  for (const name of Object.keys(meta.clips)) ui.clip.add(new Option(name, name));
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  camera.position.copy(controls.target).add(new THREE.Vector3(0.6, 0.4, 0.9).multiplyScalar(Math.max(size, 2)));
  if (ui.clip.options.length) playClip(ui.clip.value);
}

function playClip(name) {
  log.length = 0;
  current.root.position.set(0, 0, 0);
  current.anim.play(name, {
    fade: 0.1,
    onEvent: (ev) => log.unshift(`${ev.t.toFixed(2)}s ${ev.type} ${ev.prop ?? ev.vfx ?? ''}`),
    onEnd: () => setTimeout(() => current.anim.name === name && playClip(name), 600),
  });
}

ui.model.onchange = () => loadModel(ui.model.value);
ui.clip.onchange = () => playClip(ui.clip.value);
loadModel(ui.model.value);

// Debug handle for scripted checks (e.g. setting an exact side view).
window.__viewer = { camera, controls, playClip, get current() { return current; } };

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() * (ui.slow.checked ? 0.25 : 1);
  const { anim, root, meta } = current;
  anim.update(dt);
  // Root motion: model faces -Z, apply delta directly in model space for preview.
  const d = anim.consumeRootMotion();
  root.position.x += d.x;
  root.position.z += d.z;

  const active = anim.activeHits();
  hitMarker.visible = active.length > 0;
  if (active.length) {
    const { hit } = active[0];
    hitMarker.scale.setScalar(hit.radius);
    if (hit.socket) root.getObjectByName(hit.socket).getWorldPosition(hitMarker.position);
    else hitMarker.position.copy(root.position).setY(0.5);
  }
  const clip = meta.clips[anim.name] ?? {};
  ui.info.textContent =
    `${anim.name}  t=${anim.time.toFixed(2)} / ${anim.length}  loop=${clip.loop}\n` +
    `rootMotion=${JSON.stringify(clip.rootMotion)}\n` +
    `hits=${JSON.stringify(clip.hits ?? [])}\n\nevents:\n${log.slice(0, 12).join('\n')}`;
  controls.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
