// Sound effects + ambient music. OFF by default (browser autoplay rules + user choice); nothing in the
// app depends on audio. Files: CC0 packs by Kenney and CC0 ambient tracks (see public/audio/CREDITS.md).
import { useEffect, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL || '/'}audio/`;
const FX = {
  hover: 0.25, click: 0.5, confirm: 0.6, back: 0.5, error: 0.5, pin: 0.7, open: 0.5,
  jump: 0.7, thrust: 0.55, warp: 0.6, land: 0.8, scan: 0.35, success: 0.6,
};
const KEY = 'missionmatch.sound';

// play() returns a Promise in modern browsers, undefined in older ones; never let it throw.
function safePlay(a) {
  try { const r = a.play(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ignore */ }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

class SoundManager {
  constructor() {
    const saved = typeof window === 'undefined' ? {} : load();
    this.enabled = saved.enabled === true;           // never on until the user turns it on
    this.volume = typeof saved.volume === 'number' ? saved.volume : 0.7;
    this.cache = {};
    this.ambient = null;
    this.listeners = new Set();
    this.lastHover = 0;
  }

  supported() { return typeof Audio !== 'undefined' && typeof window !== 'undefined' && !window.__VITEST__; }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* private mode */ }
    this.listeners.forEach((fn) => fn());
  }

  setEnabled(on) {
    this.enabled = on;
    this.save();
    if (on) this.startAmbient(); else this.stopAll();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ambient) this.ambient.volume = 0.35 * this.volume;
    this.save();
  }

  play(name, { volume = 1 } = {}) {
    if (!this.enabled || !this.supported() || !(name in FX)) return;
    if (name === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 90) return;
      this.lastHover = now;
    }
    try {
      const base = this.cache[name] || (this.cache[name] = new Audio(`${BASE}${name}.ogg`));
      const a = base.paused ? base : base.cloneNode();
      a.volume = Math.min(1, FX[name] * this.volume * volume);
      a.currentTime = 0;
      safePlay(a);
    } catch { /* ignore */ }
  }

  startAmbient() {
    if (!this.enabled || !this.supported()) return;
    if (!this.ambient) {
      this.ambient = new Audio(`${BASE}ambient.ogg`);
      this.ambient.loop = true;
    }
    this.ambient.volume = 0.35 * this.volume;
    safePlay(this.ambient);
  }

  stopAll() {
    try {
      this.ambient?.pause();
      Object.values(this.cache).forEach((a) => a.pause());
    } catch { /* ignore */ }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const sound = new SoundManager();

export function useSoundState() {
  const [, force] = useState(0);
  useEffect(() => sound.subscribe(() => force((n) => n + 1)), []);
  return { enabled: sound.enabled, volume: sound.volume };
}

/** UI feedback for every button/card: hover tick + click blip (delegated, one listener each). */
export function useUiSounds() {
  useEffect(() => {
    const sel = 'button:not(:disabled), .choice, [role="radio"]';
    const over = (e) => { if (e.target.closest?.(sel) && !e.target.closest('[data-silent]')) sound.play('hover'); };
    const click = (e) => {
      const el = e.target.closest?.(sel);
      if (el && !el.closest('[data-silent]') && !el.dataset.sound) sound.play('click');
      if (el?.dataset.sound) sound.play(el.dataset.sound);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('click', click);
    return () => { document.removeEventListener('pointerover', over); document.removeEventListener('click', click); };
  }, []);
}
