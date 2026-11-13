import { useEffect, useRef, useState } from 'react';

export const STORY_SENTENCE = 'Exploring other worlds starts with understanding our own.';
export const STORY_QUESTION = 'Before we explore the Moon and Mars, where on Earth can we prepare?';

// Optional, short transition. Never blocks the tool: both buttons are usable immediately.
export default function Intro({ onStart, onSkip }) {
  const [showQuestion, setShowQuestion] = useState(false);
  const ctaRef = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShowQuestion(true); return undefined; }
    const t = setTimeout(() => setShowQuestion(true), 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { ctaRef.current?.focus(); }, []);

  return (
    <div className="intro" role="dialog" aria-modal="false" aria-labelledby="intro-title">
      <div className="intro-card">
        <h1 id="intro-title" className="intro-sentence">{STORY_SENTENCE}</h1>
        <p className={`intro-question ${showQuestion ? 'visible' : ''}`}>{STORY_QUESTION}</p>
        <div className="intro-actions">
          <button ref={ctaRef} className="btn primary" onClick={onStart}>Find our next training ground</button>
          <button className="btn ghost" onClick={onSkip}>Skip intro / Explore map directly</button>
        </div>
      </div>
    </div>
  );
}
