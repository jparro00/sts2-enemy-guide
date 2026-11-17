// The smallest engine: answers every item with its input marked ⟦ ⟧ (translation), unmarked (back-translation)
// or "ok" (judge). It shows the contract every engine keeps, and lets translate.mjs --dry-run be tried end to end
// without a model:
//   <engine command> <work.json> <answers.json>
//   reads the work file (its "step", "brief", "language" and "items", each with an "n"), writes
//   { "engine": <name>, "model": <name>, "answers": { "<n>": answer } }   (answers as tools/l10n/fill.mjs takes them)
import fs from 'node:fs';

const [workFile, answersFile] = process.argv.slice(2);
const work = JSON.parse(fs.readFileSync(workFile, 'utf8'));
const answer = item => work.step === 'translation' ? `⟦${item.english}⟧`
  : work.step === 'back-translation' ? item.translation.replace(/[⟦⟧]/g, '')
  : 'ok';
fs.writeFileSync(answersFile, JSON.stringify({ engine: 'pseudo', model: 'none', answers: Object.fromEntries(work.items.map(i => [String(i.n), answer(i)])) }, null, 1));
