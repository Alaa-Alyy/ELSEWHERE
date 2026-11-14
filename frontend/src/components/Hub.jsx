import { useEffect, useRef, useState } from 'react';
import SpaceScene from './SpaceScene.jsx';
import { sound } from '../sound.js';

export const STORY_SENTENCE = 'Exploring other worlds starts with understanding our own.';
export const STORY_QUESTION = 'Before we explore the Moon and Mars, where on Earth can we prepare?';

const DESTINATIONS = [
  { key: 'moon', name: 'Moon', blurb: 'Craters, highlands and the permanently shadowed south pole.', data: 'NASA LOLA elevation' },
  { key: 'mars', name: 'Mars', blurb: 'Ancient lake beds, volcanoes and giant canyons.', data: 'NASA/USGS MOLA elevation' },
];

/**
 * Scene 1-2: cinematic space intro, then "choose your destination". The astronaut jumps onto the chosen
 * world; only then does onPick(body) fire (the same action as the old body radio).
 */
export default function Hub({ startAt = 'title', onPick, onSkip }) {
  const [phase, setPhase] = useState(startAt);       // title -> choose -> jumping
  const [showQuestion, setShowQuestion] = useState(false);
  const [jumpTo, setJumpTo] = useState(null);
  const [tip, setTip] = useState(null);
  const ctaRef = useRef(null);

  useEffect(() => {
    const reduce = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShowQuestion(true); return undefined; }
    const t = setTimeout(() => setShowQuestion(true), 1400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (phase === 'title') ctaRef.current?.focus(); }, [phase]);

  const choose = (body) => {
    if (phase === 'jumping') return;
    setTip(null);
    setPhase('jumping');
    setJumpTo(body);
  };

  return (
    <div className="hub">
      <SpaceScene
        interactive={phase === 'choose'}
        jumpTo={jumpTo}
        intro={startAt === 'title'}
        onChoose={choose}
        onEarth={() => setTip('Earth is home: it is where we will search for training grounds. First pick the Moon or Mars.')}
        onJumpDone={(b) => onPick(b)}
      />

      {phase === 'title' && (
        <div className="hub-title" role="dialog" aria-modal="false" aria-labelledby="intro-title">
          <p className="wordmark" aria-label="ELSEWHERE">ELSEWHERE</p>
          <p className="kicker">NASA Space Apps 2026</p>
          <h1 id="intro-title" className="intro-sentence">{STORY_SENTENCE}</h1>
          <p className={`intro-question ${showQuestion ? 'visible' : ''}`}>{STORY_QUESTION}</p>
          <div className="intro-actions">
            <button ref={ctaRef} className="btn primary big" data-sound="confirm"
              onClick={() => { sound.startAmbient(); setPhase('choose'); }}>
              Find our next training ground
            </button>
            <button className="btn ghost" onClick={onSkip}>Skip intro / Explore map directly</button>
          </div>
        </div>
      )}

      {phase === 'choose' && (
        <div className="hub-choose">
          <h2 className="hub-heading">Choose your destination</h2>
          <p className="muted">Click a world in orbit, or pick below. Drag to look around.</p>
          <div className="dest-row">
            {DESTINATIONS.map((d) => (
              <button key={d.key} className={`dest-card ${d.key}`} onClick={() => choose(d.key)} aria-label={`Go to ${d.name}`}>
                <span className={`dest-orb ${d.key}`} aria-hidden="true" />
                <span className="dest-name">{d.name}</span>
                <span className="dest-blurb">{d.blurb}</span>
                <span className="dest-data">{d.data}</span>
              </button>
            ))}
          </div>
          {tip && <p className="hub-tip" role="status">{tip}</p>}
        </div>
      )}

      {phase === 'jumping' && (
        <p className="hub-caption" role="status">Jumping to {jumpTo === 'moon' ? 'the Moon' : 'Mars'}...</p>
      )}
    </div>
  );
}
