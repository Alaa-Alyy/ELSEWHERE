import { useState } from 'react';
import { friendlyMessage } from '../api/errors.js';
import { fmt } from '../format.js';
import SourceList from './SourceList.jsx';

const MAX_LEN = 2000;
const SUGGESTIONS = [
  'Why this candidate?',
  'Why not the alternative?',
  'What changed when slope priority changed?',
  "What can't we infer from terrain data?",
];

// Assistant text is rendered as plain React text nodes (never as HTML).
export default function ChatPanel({ available, messages, pending, error, sources, context, onSend, onClose }) {
  const [text, setText] = useState('');

  const send = (msg) => {
    const m = msg.trim();
    if (!m || m.length > MAX_LEN || pending) return;
    onSend(m);
    setText('');
  };

  return (
    <section className="panel-section chat" aria-labelledby="chat-title">
      <div className="row space">
        <h3 id="chat-title">Explain this choice</h3>
        <button className="btn small ghost" onClick={onClose} aria-label="Close assistant">Close</button>
      </div>
      <p className="small muted">
        Context: {context.referenceId}, {context.profile}, slope weight {fmt(context.weights?.slope, 2)},
        selected {context.selectedId ?? 'none'}, alternative {context.alternativeId ?? 'none'}.
        The assistant explains measured evidence; it does not compute scores.
      </p>

      {!available && (
        <p className="notice" role="status">The assistant is unavailable right now. The evidence, comparison and decision brief still work.</p>
      )}

      <ol className="chat-log" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={`msg ${m.role}`}>
            <span className="msg-role">{m.role === 'user' ? 'You' : 'Assistant'}</span>
            <p className="msg-text">{m.content}</p>
            {m.reply?.limitations?.length > 0 && (
              <ul className="small muted">{m.reply.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            )}
            {m.reply?.source_ids?.length > 0 && <SourceList ids={m.reply.source_ids} sources={sources} title="Cited sources" />}
          </li>
        ))}
        {pending && <li className="pending">Thinking...</li>}
      </ol>
      {error && <p className="error" role="alert">Assistant unavailable: {friendlyMessage(error)}</p>}

      {available && (
        <>
          <div className="row wrap">
            {SUGGESTIONS.map((s) => <button key={s} className="btn small" onClick={() => send(s)} disabled={pending}>{s}</button>)}
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label htmlFor="chat-input" className="sr-only">Ask about this choice</label>
            <textarea id="chat-input" value={text} maxLength={MAX_LEN} rows={2}
              onChange={(e) => setText(e.target.value)} placeholder="Ask about this choice..." />
            <div className="row space">
              <span className="small muted">{text.length}/{MAX_LEN}</span>
              <button className="btn primary small" type="submit" disabled={pending || !text.trim()}>Send</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
