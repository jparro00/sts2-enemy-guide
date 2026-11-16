// Writes a translator's answers into a work file by item number, so nobody copies the long ids by hand.
//
// Usage: node tools/l10n/fill.mjs <work.json> <answers.json> [--engine=... --model=... | --translator=...]
//   answers.json: { "<n>": answer } for the work file's items (their "n"), or an engine's
//   { engine, model, answers: { "<n>": answer } } (which also names who answered). By the work file's step:
//     translation (pending.mjs)        the translation
//     back-translation (review blind)  the back-translation
//     judge (review pairs)             "ok", or { "verdict": "drift", "note": "..." }
// Answers for numbers the file doesn't have are an error; items without an answer are left as they are.
import fs from 'node:fs';
import { opt, isMain } from './lib.mjs';

const FIELD = { 'back-translation': 'back', judge: 'verdict', translation: 'translation' };

// Applies `answers` (either shape above) to `work` in place; `who` ({ engine, model, translator }) overrides the
// answers' own names. Returns how many items are still without an answer.
export function fillWork(work, answers, who = {}) {
  const wrapped = answers && typeof answers.answers === 'object' && !Array.isArray(answers.answers);
  const map = wrapped ? answers.answers : answers;
  const byN = new Map(work.items.map(i => [String(i.n), i]));
  const unknown = Object.keys(map).filter(n => !byN.has(n));
  if (unknown.length) throw new Error(`no items numbered ${unknown.slice(0, 10).join(', ')}`);
  for (const [n, a] of Object.entries(map)) {
    const item = byN.get(n);
    if (work.step === 'back-translation') item.back = a;
    else if (work.step === 'judge') {
      const v = typeof a === 'string' ? { verdict: a, note: '' } : a;
      if (v.verdict !== 'ok' && v.verdict !== 'drift') throw new Error(`item ${n}: verdict must be ok or drift`);
      item.verdict = v.verdict; item.note = v.note || '';
    } else item.translation = a;
  }
  for (const f of ['engine', 'model', 'translator']) {
    const v = who[f] || (wrapped ? answers[f] : '');
    if (v) work[f] = v;
  }
  return work.items.filter(i => !i[FIELD[work.step] || 'translation']).length;
}

if (isMain(import.meta.url)) {
  const [workFile, answersFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!workFile || !answersFile) { console.error('usage: fill.mjs <work.json> <answers.json> [--engine= --model= | --translator=]'); process.exit(2); }
  const work = JSON.parse(fs.readFileSync(workFile, 'utf8'));
  const answers = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  let left;
  try { left = fillWork(work, answers, { engine: opt('engine', ''), model: opt('model', ''), translator: opt('translator', '') }); }
  catch (e) { console.error(`fill: ${e.message}`); process.exit(1); }
  fs.writeFileSync(workFile, JSON.stringify(work, null, 1) + '\n');
  const n = Object.keys(answers.answers && typeof answers.answers === 'object' ? answers.answers : answers).length;
  console.log(`fill: ${n} answers; ${left} of ${work.items.length} items still without one`);
}
