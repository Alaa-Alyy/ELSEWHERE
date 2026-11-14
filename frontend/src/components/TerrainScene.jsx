import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildAstronaut, animateFloat } from '../scene/astronaut.js';

// Two cartoon "diorama" blocks built from REAL 20 x 20 elevation grids (1 km cells).
// Shape is real; colours are illustrative. Same vertical exaggeration for both blocks.
const BLOCK = 10;                       // scene units for 20 km -> 1 unit = 2 km
const UNIT_M = 20000 / BLOCK;
const MAX_VE = 5;
const MAX_HEIGHT_UNITS = 4.5;

/** One vertical exaggeration for BOTH windows (fair comparison), lowered only if the taller one would not fit. */
export function sharedExaggeration(a, b) {
  const tallest = Math.max(1, ...[a, b].map((g) => (Number(g?.max_m) - Number(g?.min_m)) || 0));
  const ve = Math.min(MAX_VE, MAX_HEIGHT_UNITS / (tallest / UNIT_M));
  return Math.max(1, Math.round(ve * 10) / 10);
}

// Side walls from the terrain edge down to the base, so the window reads as one solid block.
function skirt(top, n, color, gradient) {
  const p = top.attributes.position;
  const verts = [];
  const edge = (idx) => {
    for (let k = 0; k < idx.length - 1; k += 1) {
      const a = idx[k]; const b = idx[k + 1];
      const ax = p.getX(a); const ay = p.getY(a); const az = p.getZ(a);
      const bx = p.getX(b); const by = p.getY(b); const bz = p.getZ(b);
      verts.push(ax, ay, az, ax, 0, az, bx, by, bz, bx, by, bz, ax, 0, az, bx, 0, bz);
    }
  };
  const row = (r) => Array.from({ length: n }, (_, c) => r * n + c);
  const col = (c) => Array.from({ length: n }, (_, r) => r * n + c);
  edge(row(0)); edge(row(n - 1).reverse()); edge(col(0).reverse()); edge(col(n - 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshToonMaterial({ color, gradientMap: gradient, side: THREE.DoubleSide }));
}

export const PALETTES = {
  mars: ['#6e2a12', '#c4562a', '#f3a874'],
  moon: ['#3a3f4c', '#8d96a8', '#eef1f6'],
  arid: ['#7d4f24', '#c99a5c', '#f3dfb2'],
  semi_arid: ['#56622b', '#a49f58', '#e3d7a2'],
  wet: ['#1d5326', '#4c8d38', '#c6d99c'],
  earth: ['#6b5a3a', '#a89068', '#e3d3ae'],
};

function lerpColor(stops, t) {
  const cs = stops.map((s) => new THREE.Color(s));
  const k = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(k));
  return cs[i].clone().lerp(cs[i + 1], k - i);
}

function toonGradient() {
  const data = new Uint8Array([90, 150, 210, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
}

function buildBlock(grid, palette, gradient, ve) {
  const n = grid.size;
  const rows = grid.elevation_m;
  const min = Number(grid.min_m); const max = Number(grid.max_m);
  const range = Math.max(1, max - min);
  const g = new THREE.PlaneGeometry(BLOCK, BLOCK, n - 1, n - 1);   // vertex order: north row first, west to east
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const r = Math.floor(i / n); const c = i % n;
    const e = rows[r]?.[c];
    const v = e === null || e === undefined ? min : e;
    pos.setZ(i, ((v - min) / UNIT_M) * ve);
    const col = lerpColor(palette, (v - min) / range);
    colors.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.rotateX(-Math.PI / 2);                // north -> away from the viewer, height -> +y
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.6, BLOCK),
    new THREE.MeshToonMaterial({ color: new THREE.Color(palette[0]).multiplyScalar(0.7), gradientMap: gradient }));
  base.position.y = -0.3;
  const wall = skirt(g, n, new THREE.Color(palette[0]).multiplyScalar(0.85), gradient);
  const group = new THREE.Group();
  group.add(top, wall, base);
  const mid = Math.floor(n / 2);
  const ce = rows[mid]?.[mid];
  group.userData.centerY = (((ce ?? min) - min) / UNIT_M) * ve;
  return group;
}

export default function TerrainScene({ left, right, leftPalette, rightPalette }) {
  const wrapRef = useRef(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { wrap.classList.add('no-webgl'); return undefined; }
    const reduce = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 200);
    camera.position.set(0, 9.5, 17.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enablePan = false; controls.enableDamping = true;
    controls.minDistance = 12; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI * 0.47;
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30243a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-8, 14, 10);
    scene.add(sun);

    const gradient = toonGradient();
    const ve = sharedExaggeration(left, right);
    const blocks = [];
    const astros = [];
    [[left, leftPalette, -6.2], [right, rightPalette, 6.2]].forEach(([grid, pal, x]) => {
      const b = buildBlock(grid, pal, gradient, ve);
      b.position.x = x;
      scene.add(b);
      const a = buildAstronaut();
      a.root.scale.setScalar(0.8);
      a.root.position.set(0, b.userData.centerY + 1.0, 0);
      b.add(a.root);
      blocks.push(b); astros.push(a);
    });

    const resize = () => {
      const w = wrap.clientWidth || 1; const h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
    let spin = !reduce;
    const stop = () => { spin = false; };
    renderer.domElement.addEventListener('pointerdown', stop);
    // (An IntersectionObserver pause inside the scrolling side panel never woke up again; render always.)
    const visible = true;
    const io = null;
    const clock = new THREE.Clock();
    let raf = 0; let t = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      t += dt;
      if (spin) blocks.forEach((b) => { b.rotation.y += dt * 0.25; });
      astros.forEach((a, i) => {
        animateFloat(a, t + i);
        a.root.position.y = blocks[i].userData.centerY + 1.0 + Math.abs(Math.sin(t * 2 + i)) * 0.18;  // little hops
        a.root.rotation.z = 0;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', stop);
      controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      gradient.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [left, right, leftPalette, rightPalette]);
  return <div ref={wrapRef} className="terrain-scene" />;
}
