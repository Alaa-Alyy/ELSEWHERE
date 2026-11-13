// Acceptance gate: a real (non-fixture) production build must not contain demo
// fixtures or anything that looks like a server secret.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'cesiumStatic') walk(p); } else if (/\.(js|html|css)$/.test(f)) files.push(p);
  }
})(dist);

const forbidden = [
  [/DEMO MOCK SERVER|demo-fixture-corpus/, 'demo fixture code in production bundle'],
  [/OPENAI_API_KEY/, 'OPENAI_API_KEY reference'],
  [/sk-[A-Za-z0-9_-]{20,}/, 'string that looks like an OpenAI key'],
  [/eyJ0eXAiOiJKV1Qi/, 'string that looks like a JWT/token'],
];

let failed = false;
for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  for (const [re, why] of forbidden) {
    if (re.test(txt)) { console.error(`FAIL ${why}: ${f}`); failed = true; }
  }
}
console.log(failed ? 'bundle check FAILED' : `bundle check passed (${files.length} files)`);
process.exit(failed ? 1 : 0);
