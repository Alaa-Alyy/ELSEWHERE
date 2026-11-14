// Cartoon astronaut built only from three.js primitives (no external model, no licence issues).
// buildAstronaut() returns a Group plus named parts so scenes can animate arms/legs/visor.
import * as THREE from 'three';

const WHITE = 0xf4f6fb;
const SHADOW = 0xc9d1e0;
const ORANGE = 0xff8a3d;
const VISOR = 0xffb547;

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
}

function limb(radius, length, color) {
  const g = new THREE.CapsuleGeometry(radius, length, 6, 14);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  return m;
}

export function buildAstronaut() {
  const root = new THREE.Group();
  root.name = 'astronaut';
  const suit = mat(WHITE);
  const trim = mat(ORANGE, { roughness: 0.4 });

  // torso (chunky, cartoon proportions)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.45, 8, 20), suit);
  torso.position.y = 0;
  root.add(torso);

  // chest control box + belt
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.12), mat(SHADOW));
  box.position.set(0, 0.08, 0.4);
  root.add(box);
  [[-0.08, 0xff5a5a], [0.0, 0x5ee7ff], [0.08, 0x7dff9a]].forEach(([x, c]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), mat(c, { emissive: c, emissiveIntensity: 0.8 }));
    b.position.set(x, 0.1, 0.47);
    root.add(b);
  });
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.04, 10, 40), trim);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = -0.22;
  root.add(belt);

  // shoulder patch (orange)
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), trim);
  patch.position.set(-0.43, 0.25, 0.08);
  patch.rotation.y = -Math.PI / 2.4;
  root.add(patch);

  // backpack (life support)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.3), mat(SHADOW));
  pack.position.set(0, 0.08, -0.45);
  root.add(pack);
  [-0.18, 0.18].forEach((x) => {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16), mat(WHITE));
    tank.position.set(x, 0.08, -0.63);
    root.add(tank);
  });

  // head: big round helmet, gold visor, antenna
  const head = new THREE.Group();
  head.position.y = 0.78;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 24), suit);
  head.add(helmet);
  // three.js sphere: phi = PI/2 points along +z (the face), so centre the visor patch there
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 32, 24, Math.PI / 2 - Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.27, Math.PI * 0.4),
    new THREE.MeshStandardMaterial({ color: VISOR, roughness: 0.18, metalness: 0.35, emissive: 0x7a3c00, emissiveIntensity: 0.55 }),
  );
  visor.scale.set(1.12, 1, 1.12);
  visor.position.z = 0.08;
  head.add(visor);
  // visor shine
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  shine.scale.set(1.6, 0.7, 0.4);
  shine.position.set(-0.16, 0.12, 0.43);
  head.add(shine);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 12, 40), mat(SHADOW));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.36;
  head.add(ring);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), mat(SHADOW));
  antenna.position.set(0.24, 0.48, -0.1);
  antenna.rotation.z = -0.3;
  head.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), mat(ORANGE, { emissive: ORANGE, emissiveIntensity: 1.2 }));
  tip.position.set(0.29, 0.64, -0.1);
  head.add(tip);
  root.add(head);

  // arms (pivot at the shoulder so they can wave)
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.5 * side, 0.3, 0);
    const arm = limb(0.13, 0.42, WHITE);
    arm.position.y = -0.3;
    pivot.add(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), trim);
    glove.position.y = -0.62;
    pivot.add(glove);
    pivot.rotation.z = 0.35 * side;
    root.add(pivot);
    return pivot;
  });

  // legs + boots
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.2 * side, -0.55, 0);
    const leg = limb(0.15, 0.36, WHITE);
    leg.position.y = -0.25;
    pivot.add(leg);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 6, 12), mat(SHADOW));
    boot.rotation.x = Math.PI / 2;
    boot.position.set(0, -0.52, 0.06);
    pivot.add(boot);
    root.add(pivot);
    return pivot;
  });

  return { root, head, arms, legs, antennaTip: tip };
}

/** Idle "floating in space" pose; t in seconds. */
export function animateFloat(a, t) {
  a.root.position.y = Math.sin(t * 1.3) * 0.12;
  a.root.rotation.z = Math.sin(t * 0.7) * 0.08;
  a.arms[0].rotation.z = -0.5 - Math.sin(t * 1.1) * 0.15;
  a.arms[1].rotation.z = 0.9 + Math.sin(t * 3.2) * 0.45;          // friendly wave
  a.legs[0].rotation.x = Math.sin(t * 1.2) * 0.25;
  a.legs[1].rotation.x = -Math.sin(t * 1.2) * 0.25;
  a.head.rotation.y = Math.sin(t * 0.6) * 0.25;
  a.antennaTip.material.emissiveIntensity = 0.7 + Math.sin(t * 6) * 0.5;
}

/** Superhero "jump" pose (arms forward, legs back). */
export function poseJump(a, k = 1) {
  a.arms.forEach((p, i) => { p.rotation.x = -2.6 * k; p.rotation.z = (i ? 0.25 : -0.25) * k; });
  a.legs.forEach((p, i) => { p.rotation.x = (i ? 0.5 : 0.2) * k; });
}

let spriteCache = null;
/** Renders the astronaut once to a transparent PNG (data URL) for Cesium billboards. */
export function astronautSprite(size = 192) {
  if (spriteCache) return spriteCache;
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445577, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    scene.add(key);
    const a = buildAstronaut();
    a.arms[1].rotation.z = 2.3;           // waving
    a.arms[0].rotation.z = -0.5;
    a.root.rotation.y = 0.35;
    scene.add(a.root);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 0.2, 6.2);
    cam.lookAt(0, 0.05, 0);
    renderer.render(scene, cam);
    spriteCache = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    renderer.forceContextLoss();
  } catch {
    spriteCache = null;
  }
  return spriteCache;
}
