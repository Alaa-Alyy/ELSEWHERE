// "What experiment will you run?" - a creative framing of the EXISTING search profiles.
// It only chooses terrain_general or slope_focus; nothing here is measured or sent beyond the profile.
export const EXPERIMENTS = [
  { key: 'rover', icon: '🚙', title: 'Rover test drive', profile: 'slope_focus',
    text: 'Drive a prototype rover over ground with the same slope mix as your site.' },
  { key: 'landing', icon: '🛬', title: 'Landing & moonwalk rehearsal', profile: 'slope_focus',
    text: 'Practise touchdown and spacewalk traverses on matching slopes.' },
  { key: 'habitat', icon: '🏕️', title: 'Base camp survey', profile: 'terrain_general',
    text: 'Lay out a habitat on terrain with similar overall shape and relief.' },
  { key: 'geology', icon: '🪨', title: 'Field geology training', profile: 'terrain_general',
    text: 'Teach crews to read a landscape that looks like this one.' },
];

export const experimentByKey = (k) => EXPERIMENTS.find((e) => e.key === k) || null;

export default function ExperimentPicker({ body, onChoose }) {
  const where = body === 'moon' ? 'the Moon' : 'Mars';
  return (
    <div className="experiment-overlay" role="dialog" aria-modal="true" aria-labelledby="exp-title">
      <div className="experiment-card">
        <p className="kicker">Mission briefing · {body === 'moon' ? 'Moon' : 'Mars'}</p>
        <h2 id="exp-title">You made it to {where}! What experiment will you run?</h2>
        <p className="muted small">Your answer tells us what matters most when we compare terrain. We only compare terrain
          shape (slopes, relief, local roughness) - not soil, ice, temperature or radiation.</p>
        <div className="exp-grid">
          {EXPERIMENTS.map((e) => (
            <button key={e.key} className="exp-option" data-sound="confirm" onClick={() => onChoose(e)}>
              <span className="exp-icon" aria-hidden="true">{e.icon}</span>
              <span className="exp-title">{e.title}</span>
              <span className="exp-text">{e.text}</span>
              <span className="exp-profile">{e.profile === 'slope_focus' ? 'Slopes count most (70%)' : 'Balanced terrain (40/30/30)'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
