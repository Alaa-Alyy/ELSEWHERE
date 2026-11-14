import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildAstronaut, poseJump } from '../scene/astronaut.js';
import { sound } from '../sound.js';

const TEX = `${import.meta.env.BASE_URL || '/'}textures/`;
export const TRAVEL_SECONDS = 3.6;

/** Scene 6: warp back to Earth while the real search runs underneath. Skippable; never blocks results. */
export default function TravelOverlay({ from = 'mars', onDone }) {
  const wrapRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const reduce = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { doneRef.current?.(); return undefined; }
    const wrap = wrapRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { doneRef.current?.(); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    wrap.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040b);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.9));
    scene.add(new THREE.HemisphereLight(0xdce9ff, 0x221535, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-5, 4, 8);
    scene.add(key);

    // warp streaks
    const N = 1400;
    const pos = new Float32Array(N * 6);
    const speed = new Float32Array(N);
    const reset = (i, z) => {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 40;
      const x = Math.cos(a) * r; const y = Math.sin(a) * r;
      pos.set([x, y, z, x, y, z - 1], i * 6);
      speed[i] = 40 + Math.random() * 60;
    };
    for (let i = 0; i < N; i += 1) reset(i, -Math.random() * 300);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.85 }));
    scene.add(streaks);

    // Earth ahead, growing
    const tex = new THREE.TextureLoader().load(`${TEX}earth.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    earth.rotation.z = THREE.MathUtils.degToRad(23.4);
    earth.position.set(0, 0, -60);
    scene.add(earth);

    // the astronaut, superhero pose
    const astro = buildAstronaut();
    poseJump(astro, 1);
    astro.root.scale.setScalar(0.55);
    scene.add(astro.root);

    const resize = () => {
      const w = wrap.clientWidth || 1; const h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    sound.play('warp');
    const clock = new THREE.Clock();
    const t0 = performance.now();
    let t = 0;
    let raf = 0;
    let finished = false;
    // wall-clock end + safety timeout: slow GPUs drop frames, the cut-scene never runs long
    const safety = setTimeout(() => { if (!finished) { finished = true; doneRef.current?.(); } }, TRAVEL_SECONDS * 1000 + 1500);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      t = (performance.now() - t0) / 1000;
      const k = Math.min(1, t / TRAVEL_SECONDS);
      const warp = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;       // slow down on arrival
      for (let i = 0; i < N; i += 1) {
        const o = i * 6;
        const dz = speed[i] * dt * (0.15 + warp);
        pos[o + 2] += dz; pos[o + 5] += dz;
        pos[o + 5] = pos[o + 2] - (0.5 + 5 * warp);
        if (pos[o + 2] > 5) reset(i, -300);
      }
      g.attributes.position.needsUpdate = true;
      streaks.material.opacity = 0.2 + 0.7 * warp;
      const e = k * k * (3 - 2 * k);
      earth.position.z = -60 + 52 * e;
      earth.scale.setScalar(1 + 2.2 * e);
      earth.rotation.y += dt * 0.4;
      astro.root.position.set(-2.2 + 2.2 * e, -1.2 + 1.4 * e + Math.sin(t * 6) * 0.05, -4 - 2.5 * e);
      astro.root.rotation.set(-0.9, 0.5 - 0.5 * e, 0.2 + Math.sin(t * 2) * 0.1);
      camera.position.set(Math.sin(t * 3) * 0.04, Math.cos(t * 2.4) * 0.04, 0);
      camera.lookAt(0, 0, -10);
      renderer.render(scene, camera);
      if (k >= 1 && !finished) { finished = true; doneRef.current?.(); }
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      ro.disconnect();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={wrapRef} className="travel-overlay" role="status" aria-live="polite">
      <div className="travel-text">
        <p className="kicker">Leaving {from === 'moon' ? 'the Moon' : 'Mars'}</p>
        <h2>Heading home to Earth</h2>
        <p className="muted">Comparing your site's terrain fingerprint with Earth's land, window by window...</p>
      </div>
      <button className="btn ghost small travel-skip" onClick={() => onDone?.()}>Skip</button>
    </div>
  );
}
