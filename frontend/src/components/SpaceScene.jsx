import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildAstronaut, animateFloat, poseJump } from '../scene/astronaut.js';
import { sound } from '../sound.js';

// Decorative, semi-realistic planets (NASA textures) orbiting a cartoon astronaut. Sizes, distances and
// speeds are NOT to scale; only the relative order (Mars slower than Earth, Moon around Earth) is kept.
const TEX = `${import.meta.env.BASE_URL || '/'}textures/`;
const BODIES = {
  earth: { radius: 0.95, orbit: 5.4, speed: 0.11, spin: 0.25, tilt: 23.4, glow: 0x6fb6ff, label: 'Earth', sub: 'Home: where we search for analogs' },
  mars: { radius: 0.66, orbit: 8.6, speed: 0.11 * 0.53, spin: 0.24, tilt: 25.2, glow: 0xff9a6a, label: 'Mars', sub: 'Pin any crater, valley or plain' },
  moon: { radius: 0.32, orbit: 1.75, speed: 0.55, spin: 0.55, tilt: 6.7, glow: null, label: 'Moon', sub: 'Pin the south pole or a landing site' },
};
const ORBIT_TILT = 0.22;
export const JUMP_SECONDS = 2.1;
export const DIVE_SECONDS = 0.9;

const reduceMotion = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function glowMaterial(color, power = 3.2, strength = 1.1) {
  return new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, p: { value: power }, s: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 c; uniform float p; uniform float s; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), p) * s; gl_FragColor = vec4(c, f); }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

function radialSprite(inner, outer, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starfield(count = 5000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tint = [new THREE.Color(0xffffff), new THREE.Color(0xbcd4ff), new THREE.Color(0xffe6c4), new THREE.Color(0xc9b8ff)];
  for (let i = 0; i < count; i += 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(120 + Math.random() * 180);
    pos.set([v.x, v.y, v.z], i * 3);
    const c = tint[i % tint.length].clone().multiplyScalar(0.55 + Math.random() * 0.45);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95 }));
}

function orbitLine(radius, color = 0xffffff, opacity = 0.16) {
  const pts = [];
  for (let i = 0; i <= 160; i += 1) {
    const a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius * 0.92));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

/**
 * Props: interactive (planets clickable), jumpTo ('moon'|'mars'|null), onChoose(body), onEarth(),
 * onJumpDone(body), intro (cinematic dolly-in on mount).
 */
export default function SpaceScene({ interactive = false, jumpTo = null, onChoose, onEarth, onJumpDone, intro = true }) {
  const wrapRef = useRef(null);
  const labelRefs = useRef({});
  const flashRef = useRef(null);
  const api = useRef({});
  const cb = useRef({});
  cb.current = { onChoose, onEarth, onJumpDone, interactive };

  useEffect(() => {
    const wrap = wrapRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      wrap.classList.add('no-webgl');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    wrap.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040b);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    const home = new THREE.Vector3(0, 3.4, 15.5);
    camera.position.copy(intro && !reduceMotion() ? new THREE.Vector3(0, 9, 42) : home);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 26;
    controls.autoRotate = !reduceMotion();
    controls.autoRotateSpeed = 0.25;

    // light: a distant sun + soft fill so the cartoon astronaut stays friendly
    // key light from the front-left so the planets show their day side and a soft terminator
    scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
    scene.add(new THREE.HemisphereLight(0xdce9ff, 0x221535, 0.75));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.8);
    sun.position.set(-30, 16, 34);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7fb8ff, 0.8);
    rim.position.set(25, -6, -30);
    scene.add(rim);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite('rgba(255,236,200,1)', 'rgba(255,170,80,0)'), blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sunGlow.position.set(-95, 34, -70);
    sunGlow.scale.setScalar(34);
    scene.add(sunGlow);

    scene.add(starfield());
    [[-40, 10, -90, 'rgba(120,80,255,.35)', 90], [55, -15, -100, 'rgba(40,140,255,.28)', 110], [10, 35, -120, 'rgba(255,90,160,.18)', 80]]
      .forEach(([x, y, z, c, s]) => {
        const neb = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialSprite(c, 'rgba(0,0,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
        neb.position.set(x, y, z);
        neb.scale.setScalar(s);
        scene.add(neb);
      });

    // astronaut at the centre of the "system"
    const astro = buildAstronaut();
    scene.add(astro.root);

    // orbit plane (slightly tilted for depth)
    const system = new THREE.Group();
    system.rotation.x = ORBIT_TILT;
    scene.add(system);
    system.add(orbitLine(BODIES.earth.orbit, 0x9ccfff, 0.22));
    system.add(orbitLine(BODIES.mars.orbit, 0xffb08a, 0.22));

    const loader = new THREE.TextureLoader();
    const meshes = {};
    const pivots = {};
    const make = (key) => {
      const b = BODIES[key];
      const tex = loader.load(`${TEX}${key}.jpg`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const holder = new THREE.Group();           // carries the axial tilt
      holder.rotation.z = THREE.MathUtils.degToRad(b.tilt);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 64, 48),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
      mesh.userData.body = key;
      holder.add(mesh);
      if (b.glow) {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 1.16, 48, 32), glowMaterial(b.glow));
        holder.add(glow);
      }
      const hover = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 1.32, 48, 32), glowMaterial(0xffd27a, 2.2, 0));
      holder.add(hover);
      mesh.userData.hover = hover;
      meshes[key] = mesh;
      return holder;
    };
    const earthPivot = new THREE.Group();
    earthPivot.add(make('earth'));
    system.add(earthPivot);
    pivots.earth = earthPivot;
    const moonOrbit = orbitLine(BODIES.moon.orbit, 0xdddddd, 0.18);
    earthPivot.add(moonOrbit);
    const moonPivot = new THREE.Group();
    moonPivot.add(make('moon'));
    earthPivot.add(moonPivot);
    pivots.moon = moonPivot;
    const marsPivot = new THREE.Group();
    marsPivot.add(make('mars'));
    system.add(marsPivot);
    pivots.mars = marsPivot;

    const phase = { earth: 0.6, mars: 2.6, moon: 0 };
    const place = (dt) => {
      phase.earth += BODIES.earth.speed * dt;
      phase.mars += BODIES.mars.speed * dt;
      phase.moon += BODIES.moon.speed * dt;
      earthPivot.position.set(Math.cos(phase.earth) * BODIES.earth.orbit, 0, Math.sin(phase.earth) * BODIES.earth.orbit * 0.92);
      marsPivot.position.set(Math.cos(phase.mars) * BODIES.mars.orbit, 0, Math.sin(phase.mars) * BODIES.mars.orbit * 0.92);
      moonPivot.position.set(Math.cos(phase.moon) * BODIES.moon.orbit, 0, Math.sin(phase.moon) * BODIES.moon.orbit * 0.92);
      Object.entries(meshes).forEach(([k, m]) => { m.rotation.y += BODIES[k].spin * dt; });
    };
    place(0);

    // ---- picking (click vs drag)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered = null;
    let down = null;
    const pick = (ev) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(Object.values(meshes), false)[0];
      return hit?.object.userData.body || null;
    };
    const onMove = (ev) => {
      if (state.jump) return;
      const b = pick(ev);
      if (b !== hovered) {
        hovered = b;
        if (b && cb.current.interactive) sound.play('hover');
      }
      renderer.domElement.style.cursor = b && cb.current.interactive ? 'pointer' : 'grab';
    };
    const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev) => {
      if (!down || state.jump) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 6 || !cb.current.interactive) return;
      const b = pick(ev);
      if (b === 'earth') cb.current.onEarth?.();
      else if (b) cb.current.onChoose?.(b);
    };
    const el = renderer.domElement;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);

    // ---- resize
    const resize = () => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // ---- animation loop
    const state = { jump: null, t: 0, introT: 0 };
    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    const project = (obj, key) => {
      const lab = labelRefs.current[key];
      if (!lab) return;
      obj.getWorldPosition(tmp);
      tmp.y += BODIES[key].radius * 1.25;
      tmp.project(camera);
      const visible = tmp.z < 1;
      const x = (tmp.x * 0.5 + 0.5) * wrap.clientWidth;
      const y = (-tmp.y * 0.5 + 0.5) * wrap.clientHeight;
      lab.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      lab.style.opacity = visible && !state.jump ? '1' : '0';
      lab.classList.toggle('hot', hovered === key);
    };
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      state.t += dt;
      const j = state.jump;
      place(j ? dt * 0.05 : dt);

      Object.entries(meshes).forEach(([k, m]) => {
        const on = (hovered === k && cb.current.interactive && !j) || (j && j.body === k);
        const s = m.userData.hover.material.uniforms.s;
        s.value += ((on ? 1.25 : 0) - s.value) * 0.12;
        const target = on && !j ? 1.12 : 1;
        m.parent.scale.setScalar(m.parent.scale.x + (target - m.parent.scale.x) * 0.12);
      });

      if (!j) {
        animateFloat(astro, state.t);
        if (state.introT < 1 && intro && !reduceMotion()) {
          state.introT = Math.min(1, state.introT + dt / 3.2);
          const e = 1 - (1 - state.introT) ** 3;
          camera.position.lerpVectors(new THREE.Vector3(0, 9, 42), home, e);
        }
        controls.update();
      } else {
        // cartoon jump: bezier arc from the centre to the planet, then a dive into it.
        // Wall-clock time, so slow devices skip frames instead of slowing the whole sequence.
        j.t = (performance.now() - j.t0) / 1000;
        const target = new THREE.Vector3();
        meshes[j.body].getWorldPosition(target);
        const r = BODIES[j.body].radius;
        const k = Math.min(1, j.t / JUMP_SECONDS);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const end = target.clone().add(j.side.clone().multiplyScalar(r * 0.95));
        const ctrl = j.start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 3.2, 0));
        const p = j.start.clone().multiplyScalar((1 - e) ** 2).add(ctrl.multiplyScalar(2 * (1 - e) * e)).add(end.clone().multiplyScalar(e * e));
        astro.root.position.copy(p);
        astro.root.scale.setScalar(1 - 0.72 * e);
        astro.root.lookAt(target);
        astro.root.rotateX(Math.PI / 2 * e);
        astro.root.rotation.z += Math.sin(k * Math.PI) * 0.4;
        poseJump(astro, Math.sin(Math.min(1, k * 1.4) * Math.PI / 2));
        // camera: watch the arc from where we are, then glide in behind the astronaut and dive
        const follow = Math.max(0, (k - 0.45) / 0.55);
        const camGoal = target.clone().add(j.side.clone().multiplyScalar(r * 5.5)).add(new THREE.Vector3(0, r * 1.4, 0));
        camera.position.lerp(camGoal, 0.05 * follow);
        controls.target.lerp(k < 0.5 ? p : target, 0.07);
        if (j.t > JUMP_SECONDS) {
          const d = Math.min(1, (j.t - JUMP_SECONDS) / DIVE_SECONDS);
          camera.position.lerp(target.clone().add(j.side.clone().multiplyScalar(r * 1.05)), 0.12 * d + 0.02);
          if (flashRef.current) flashRef.current.style.opacity = String(d);
          if (!j.dived) { j.dived = true; sound.play('open'); }
          if (d >= 1 && !j.done) {
            j.done = true;
            cb.current.onJumpDone?.(j.body);
          }
        }
        camera.lookAt(controls.target);
      }
      project(meshes.earth, 'earth');
      project(meshes.moon, 'moon');
      project(meshes.mars, 'mars');
      renderer.render(scene, camera);
    };
    tick();

    api.current.jump = (body) => {
      if (state.jump) return;
      controls.enabled = false;
      controls.autoRotate = false;
      const target = new THREE.Vector3();
      meshes[body].getWorldPosition(target);
      const side = camera.position.clone().sub(target).normalize();
      state.jump = { body, t: 0, t0: performance.now(), start: astro.root.position.clone(), side };
      // safety net: never strand the user if rendering stalls
      setTimeout(() => {
        if (state.jump && !state.jump.done) { state.jump.done = true; cb.current.onJumpDone?.(body); }
      }, (JUMP_SECONDS + DIVE_SECONDS) * 1000 + 2500);
      sound.play('jump');
      setTimeout(() => sound.play('thrust', { volume: 0.6 }), 250);
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      api.current = {};
    };
  }, [intro]);

  useEffect(() => {
    if (!jumpTo) return;
    if (reduceMotion() || !api.current.jump) { onJumpDone?.(jumpTo); return; }
    api.current.jump(jumpTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo]);

  return (
    <div ref={wrapRef} className={`space-scene ${interactive ? 'interactive' : ''}`}>
      {Object.entries(BODIES).map(([key, b]) => (
        <div key={key} ref={(n) => { labelRefs.current[key] = n; }} className={`planet-label ${key}`} aria-hidden="true">
          <span className="planet-name">{b.label}</span>
          {interactive && <span className="planet-sub">{key === 'earth' ? b.sub : `Click to jump · ${b.sub}`}</span>}
        </div>
      ))}
      <div ref={flashRef} className={`jump-flash ${jumpTo || ''}`} />
    </div>
  );
}
