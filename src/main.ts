import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
// Every .glb in /assets is picked up automatically.
const modelUrls = import.meta.glob('/assets/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const SIZE = 50; // dense-label range: a label every 5 units within +/-50
const AXIS_LEN = 500; // axis lines and grids reach -500..+500 on every axis
const COLORS = { x: '#ff3653', y: '#8adb00', z: '#2c8fff' };
const fmt = (v: THREE.Vector3, d = 2) => `${v.x.toFixed(d)}, ${v.y.toFixed(d)}, ${v.z.toFixed(d)}`;
// Three.js (Y-up) -> Blender (Z-up), valid for the default glTF exporter setting "+Y Up".
const toBlender = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y);

// ---------- scene ----------
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1f23);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
camera.position.set(8, 6, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 10, 7);
scene.add(sun);

// Make helpers ignore the depth buffer so models can never hide them.
function onTop<T extends THREE.Object3D>(o: T, opacity: number, order = 999): T {
  o.renderOrder = order;
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | undefined;
    if (m) { m.depthTest = false; m.depthWrite = false; m.transparent = true; m.opacity = opacity; }
  });
  return o;
}

// ---------- overlays: grids, axis lines, labels ----------
// Grids span the full +/-500 axis range; size/divisions = 1000/1000 keeps 1 unit per cell.
const gridXZ = onTop(new THREE.GridHelper(AXIS_LEN * 2, AXIS_LEN * 2, 0x999999, 0x555555), 0.45);
const gridXY = onTop(new THREE.GridHelper(AXIS_LEN * 2, AXIS_LEN * 2, 0x999999, 0x555555), 0.3);
gridXY.rotation.x = Math.PI / 2;
const gridYZ = onTop(new THREE.GridHelper(AXIS_LEN * 2, AXIS_LEN * 2, 0x999999, 0x555555), 0.3);
gridYZ.rotation.z = Math.PI / 2;
scene.add(gridXZ, gridXY, gridYZ);

const labels = new THREE.Group();
scene.add(labels);
// Number labels: every 5 units near the origin (precise reading), then every 10 units
// out to +/-500 (every 5 across 1000 units would be 600 unreadable sprites).
const labelValues = new Set<number>();
for (let i = -SIZE; i <= SIZE; i += 5) labelValues.add(i);
for (let i = -AXIS_LEN; i <= AXIS_LEN; i += 10) if (Math.abs(i) > SIZE) labelValues.add(i);
const labelSteps = [...labelValues].sort((a, b) => a - b);
function makeLabel(text: string, pos: THREE.Vector3, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color; ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  s.position.copy(pos); s.scale.set(0.05, 0.025, 1); s.renderOrder = 1001;
  return s;
}
for (const k of ['x', 'y', 'z'] as const) {
  const dir = new THREE.Vector3(); dir[k] = 1;
  const geo = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-AXIS_LEN), dir.clone().multiplyScalar(AXIS_LEN)]);
  scene.add(onTop(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLORS[k] })), 1, 1000));
  for (const i of labelSteps) {
    if (i === 0) continue;
    const p = new THREE.Vector3(); p[k] = i;
    labels.add(makeLabel(String(i), p, COLORS[k]));
  }
}
labels.add(makeLabel('0', new THREE.Vector3(), '#ffffff'));

// ---------- overlays: marker ----------
const picked = new THREE.Vector3();
// Last picked point stored in MODEL-LOCAL space, so it survives scale changes.
let pickLocal: THREE.Vector3 | null = null;
const marker = new THREE.Group();
const dot = onTop(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd400 })), 1, 1002);
const drop = onTop(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd400 })), 1, 1002);
marker.add(dot, drop);
marker.visible = false;
scene.add(marker);
function setMarker(p: THREE.Vector3) {
  picked.copy(p);
  marker.position.copy(p);
  drop.geometry.dispose();
  drop.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -p.y, 0)]);
  marker.visible = true;
  $<HTMLButtonElement>('copy').disabled = false;
  $('pick').textContent = fmt(p, 3);
  $('pickB').textContent = fmt(toBlender(p), 3);
}
// Clearing happens when a new model loads (a pick on the old model is meaningless now).
function clearPick() {
  pickLocal = null;
  marker.visible = false;
  $<HTMLButtonElement>('copy').disabled = true;
  $('pick').textContent = 'click the model';
  $('pickB').textContent = '–';
}

// ---------- model ----------
// The model is never moved, scaled or recentered, so coordinates here match your game.
let model: THREE.Object3D | null = null;
const loader = new GLTFLoader();

// ---------- model scale (preview only) ----------
// Scales around the model origin, exactly like model.scale in your own project.
// Slider is logarithmic: value -1..1 -> 0.1x..10x.
const scaleEl = $<HTMLInputElement>('scale');
function applyScale() {
  const s = 10 ** scaleEl.valueAsNumber;
  $('scaleVal').textContent = `${s.toFixed(2)}×`;
  $('scaleCode').textContent = `model.scale.setScalar(${s.toFixed(3)})`;
  if (!model) return;
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  $('bounds').textContent = box.isEmpty() ? 'empty' : `min ${fmt(box.min)}\nmax ${fmt(box.max)}`;
  if (pickLocal) setMarker(model.localToWorld(pickLocal.clone()));
}
scaleEl.oninput = applyScale;
$('scaleVal').onclick = () => { scaleEl.value = '0'; applyScale(); };

function frame() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  controls.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist));
  controls.update();
}

let loadToken = 0; // guards against a slow load finishing after a newer one was requested
async function loadModel(url: string, name: string) {
  const token = ++loadToken;
  $('status').textContent = `Loading ${name}…`;
  try {
    const gltf = await loader.loadAsync(url);
    if (token !== loadToken) return; // a newer load started meanwhile: drop this result
    if (model) {
      scene.remove(model);
      model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    model = gltf.scene;
    scene.add(model);
    scaleEl.value = '0'; // each newly loaded model starts at 1x
    clearPick(); // and with no picked point
    applyScale(); // resets bounds readout at 1x
    $('status').textContent = '';
    frame();
  } catch (e) {
    if (token === loadToken) $('status').textContent = `Failed to load ${name}: ${String(e)}`;
  }
}

const sel = $<HTMLSelectElement>('models');
const paths = Object.keys(modelUrls).sort();
for (const p of paths) sel.add(new Option(p.replace('/assets/', ''), p));
const load = (p: string) => void loadModel(modelUrls[p], p.replace('/assets/', ''));
$('frame').onclick = frame;
if (paths.length) { sel.onchange = () => load(sel.value); load(paths[0]); }
else $('status').textContent = 'No .glb files found. Put them in the /assets folder and reload.';

// ---------- picking (click without dragging) ----------
const dom = renderer.domElement;
const raycaster = new THREE.Raycaster();
let down: { x: number; y: number } | null = null;
dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
dom.addEventListener('pointercancel', () => { down = null; });
dom.addEventListener('pointerup', (e) => {
  if (!down || !model) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved >= 4) return; // drag: orbiting, not a pick
  const r = dom.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObject(model, true)[0];
  if (hit) { setMarker(hit.point); pickLocal = model.worldToLocal(hit.point.clone()); }
});
$('copy').onclick = () => navigator.clipboard.writeText(`new THREE.Vector3(${picked.x.toFixed(3)}, ${picked.y.toFixed(3)}, ${picked.z.toFixed(3)})`);

// ---------- go to coordinates ----------
const num = (id: string) => { const v = $<HTMLInputElement>(id).valueAsNumber; return Number.isFinite(v) ? v : 0; };
const typed = () => new THREE.Vector3(num('gx'), num('gy'), num('gz'));
$('mark').onclick = () => { pickLocal = null; setMarker(typed()); };
$('look').onclick = () => {
  const p = typed();
  camera.position.copy(p);
  controls.target.set(p.x, p.y, p.z - 1);
  controls.update();
  pickLocal = null;
  setMarker(p);
};

// ---------- toggles ----------
const bind = (id: string, objs: THREE.Object3D[]) => {
  const el = $<HTMLInputElement>(id);
  const f = () => objs.forEach((o) => (o.visible = el.checked));
  el.onchange = f; f();
};
bind('gXZ', [gridXZ]); bind('gXY', [gridXY]); bind('gYZ', [gridYZ]); bind('gLbl', [labels]);

// ---------- gizmo (Blender-style axis widget, HTML overlay) ----------
const gizmo = $('gizmo');
const G = 60, R = 38;
const gAxes = [
  { n: 'X', d: new THREE.Vector3(1, 0, 0), c: COLORS.x, pos: true },
  { n: 'Y', d: new THREE.Vector3(0, 1, 0), c: COLORS.y, pos: true },
  { n: 'Z', d: new THREE.Vector3(0, 0, 1), c: COLORS.z, pos: true },
  { n: '-X', d: new THREE.Vector3(-1, 0, 0), c: COLORS.x, pos: false },
  { n: '-Y', d: new THREE.Vector3(0, -1, 0), c: COLORS.y, pos: false },
  { n: '-Z', d: new THREE.Vector3(0, 0, -1), c: COLORS.z, pos: false },
].map((a) => {
  const el = document.createElement('div');
  el.className = 'gz';
  el.style.background = a.c;
  el.style.opacity = a.pos ? '1' : '0.45';
  el.textContent = a.pos ? a.n : '';
  el.title = `View from ${a.n}`;
  el.onclick = () => viewFrom(a.d);
  gizmo.appendChild(el);
  return { ...a, el };
});
const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
const lines = gAxes.filter((a) => a.pos).map((a) => {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1', String(G)); l.setAttribute('y1', String(G));
  l.setAttribute('stroke', a.c); l.setAttribute('stroke-width', '2');
  svg.appendChild(l);
  return l;
});
gizmo.prepend(svg);
function updateGizmo() {
  const inv = camera.quaternion.clone().invert();
  let li = 0;
  for (const a of gAxes) {
    const v = a.d.clone().applyQuaternion(inv);
    const x = G + v.x * R, y = G - v.y * R;
    a.el.style.left = `${x - 10}px`; a.el.style.top = `${y - 10}px`;
    a.el.style.zIndex = String(Math.round((v.z + 1) * 10));
    if (a.pos) { lines[li].setAttribute('x2', String(x)); lines[li].setAttribute('y2', String(y)); li++; }
  }
}

let anim: { from: THREE.Vector3; q: THREE.Quaternion; dist: number; t: number } | null = null;
function viewFrom(dir: THREE.Vector3) {
  const offset = camera.position.clone().sub(controls.target);
  const dist = offset.length() || 10;
  const to = dir.clone();
  if (Math.abs(to.y) === 1) to.z += 0.001; // avoid looking exactly parallel to camera.up
  to.normalize();
  const from = offset.normalize();
  anim = { from, q: new THREE.Quaternion().setFromUnitVectors(from, to), dist, t: 0 };
  controls.enabled = false;
}

// ---------- loop ----------
new ResizeObserver(() => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(viewport);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (anim) {
    anim.t = Math.min(1, anim.t + dt / 0.35);
    const e = anim.t * anim.t * (3 - 2 * anim.t);
    const qt = new THREE.Quaternion().slerp(anim.q, e);
    camera.position.copy(controls.target).addScaledVector(anim.from.clone().applyQuaternion(qt), anim.dist);
    if (anim.t >= 1) { anim = null; controls.enabled = true; }
  }
  controls.update();
  dot.scale.setScalar(camera.position.distanceTo(marker.position) * 0.012);
  $('cam').textContent = fmt(camera.position);
  $('tgt').textContent = fmt(controls.target);
  updateGizmo();
  renderer.render(scene, camera);
});
