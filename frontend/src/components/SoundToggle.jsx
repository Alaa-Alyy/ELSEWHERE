import { sound, useSoundState } from '../sound.js';

export default function SoundToggle() {
  const { enabled, volume } = useSoundState();
  return (
    <div className="sound-toggle">
      <button className="btn small ghost" aria-pressed={enabled} data-silent
        onClick={() => sound.setEnabled(!enabled)} title={enabled ? 'Turn sound off' : 'Turn sound on'}>
        <span aria-hidden="true">{enabled ? '🔊' : '🔇'}</span> {enabled ? 'Sound on' : 'Sound off'}
      </button>
      {enabled && (
        <input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Volume"
          onChange={(e) => sound.setVolume(Number(e.target.value))} />
      )}
    </div>
  );
}
