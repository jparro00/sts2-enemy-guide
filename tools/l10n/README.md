# tools/l10n — localization tools and how to run them

The site and the in-game panel (SpireCodexBridge) show every language in `js/config.js` LANGS: the game's
languages except Arabic. How the text is modelled (game text vs site text, `data/loc/` files, templates) is in
`data/README.md` § Localization. This file is the process: what to run, when, and how to do it from Claude Code.

## When you need what

| You changed | Run |
|---|---|
| A game update (new pack) | the whole of `/beta-pipeline` Step 8 |
| CSV wording, or added rows | `bind.mjs` (new rows), `extract.mjs` if it bound anything, then translate, review and prune (below). The build warns "untranslated" until then; a changed cell shows English in other languages until its new template is translated |
| A label in `data/loc/site/eng.json`, or new visible text in the JS | the same translate + review (never type visible English into the JS: add a key to `eng.json` and use `t()`) |
| `js/` rendering code | English unchanged (`render-pages.mjs` before and after + `check.mjs same`) and the fake-language check (`render-pages.mjs --pseudo` + `check.mjs pseudo`) |
| `js/i18n.js` formatting, or a language's culture | `check.mjs formatter` |
| A person sent translations | `merge.mjs <lang> <work.json> --human --translator=<who>` |
| Data the mod ships | the mod's pipeline (below): every page in every language, site vs mod |

Before any commit that touches data or `js/`: `node tools/l10n/check.mjs report --strict=all` and
`node build_snapshots.mjs` must pass.

## The tools

| Tool | Does |
|---|---|
| `extract.mjs` | the game's text the bindings use → `data/loc/game/<lang>.json`, stamped with the game version |
| `bind.mjs` | fills the game-key columns where the site's English is the game's |
| `pending.mjs <lang> <out> [--all] [--cross]` | the work file of what a language needs translated, with the game's terms, the game's own text for the same thing (`reference`), and `gameText` (the folder of the game's text in that language). `--cross` = the fix round (below) |
| `fill.mjs <work> <answers>` | writes answers `{ "<n>": answer }` into a work file by item number |
| `merge.mjs <lang> <work>` | translations → `data/loc/site/<lang>.json`, recorded in `data/loc/meta/<lang>.json`. `--check` first; `--prune` drops unused; `--human`; `--refresh-terms` after a change to how terms are found |
| `review.mjs blind / pairs / record / accept` | the review: blind back-translation, judge, record, a person keeping a flagged one |
| `translate.mjs <langs> --engine="<cmd>"` | all of it in one run with an engine command: translate, merge, review, fix rounds |
| `engines/claude.py` | the Claude API engine (needs `ANTHROPIC_API_KEY`; not yet run against the API) |
| `engines/pseudo.mjs` | the smallest engine: shows the contract, lets `translate.mjs --dry-run` run without a model |
| `check.mjs` | `report`, `rewording`, `formatter`, `same`, `pseudo` (see its header) |
| `render-pages.mjs` | renders every page in one language, for `check.mjs same` / `pseudo` |
| `translations.mjs` | shared: site/meta files, markup check, the game-term index (`termIndex`, `termsFor`) |
| `oracle/` | a .NET 9 tool that runs the game's own SmartFormat DLL (for `check.mjs formatter`) |

## Translating and reviewing

Every engine translation goes through the same gate. Human translations are never sent, overwritten or reviewed.

1. **Translate**: one work file per language (`pending.mjs`), filled, `merge.mjs --check` until 0 rejected (a
   rejection is a translation whose `{slot}`s or tags don't match the English: send those items back), then
   `merge.mjs`.
2. **Back-translate blind**: `review.mjs blind <lang> <blind.json>`. A translator who did NOT make the
   translations writes what each one says, in English, without seeing the English (items are hashed refs, not ids).
3. **Judge**: `review.mjs pairs <lang> <blind.json> <judge.json>` puts English, translation and back-translation
   side by side with the game's terms; the judge answers `"ok"` or `{ "verdict": "drift", "note": "..." }`, then
   `review.mjs record <lang> <judge.json>`.
4. **Fix round**: after every language's review is recorded, `pending.mjs <lang> <fix.json> --cross` for **every**
   language: each gets its own flagged strings to redo and every string flagged in any other language to check
   (answer it unchanged when it's right there). Merge, then blind + judge again (only changed translations come
   up). Repeat while the review flags anything new. What's left is a person's call: fix it with
   `merge.mjs --human`, or keep it with `review.mjs accept`.
5. **Prune** each language (`merge.mjs <lang> --prune`) and run the gates.

`translate.mjs` does steps 1-4 with any engine command (`--engine`, and `--review-engine` for another model on the
review). The engine contract: a command that takes `<work.json> <answers.json>` and writes
`{ "engine": ..., "model": ..., "answers": { "<n>": answer } }` (see `engines/pseudo.mjs`).

### From Claude Code, without an API key (agents as the engine)

Run the same steps by hand with subagents, one per language per pass, all languages in parallel (background
agents). Work files go in the session scratchpad, not the repo.

- **Translator** (per language): "Read `<work.json>` and follow its `brief`. Write `<answers.json>` as
  `{ "engine": "claude-code", "model": "<your model id>", "answers": { "<n>": "<translation>" } }` with every item.
  Check game names in the folder `gameText` names. Change nothing else." Then `fill.mjs`, `merge.mjs --check`,
  `merge.mjs`.
- **Back-translator** (per language, a NEW agent, never the translator): "Read `<blind.json>` and follow its brief.
  Write answers `{ "<n>": "<what it says in English>" }` with engine and model. Don't open the repo's data,
  `data/loc/`, or any other work file." Then `fill.mjs`.
- **Judge** (per language, another agent): "Read `<judge.json>` and follow its brief. Answer each item `"ok"` or
  `{ "verdict": "drift", "note": "..." }`; check names in `gameText`." Then `fill.mjs`, `review.mjs record`.

Lessons from the first full run (15 languages, 2026-11-16):
- **Judges vary.** One flagged nothing in ~460 items and missed real errors; a second judge caught three. A judge
  that flags nothing in a large batch gets a second judge. Others found 0 while the cross-language check still
  found errors in their language: the fix round must check every language, not just the one that flagged.
- **Almost every flag was a name that isn't the game's** (event options, intents, rarities, dishes, verdicts).
  Those aren't all in `terms`: translators and judges must look them up in `gameText`.
- **Verify a note before you brief a fix with it.** Notes and your own assumptions can be wrong: check the game's
  text in that language first (an act is 阶段 in the game's Chinese, not 幕; Beckon is the card "Llamada" in Spain
  Spanish but "Vislumbrar" in Latin American Spanish).
- **Term hints come from `translations.mjs`.** If a hint is wrong (a monster move shadowing a card of the same
  English name), fix `termIndex` / `termsFor`, then `merge.mjs <lang> --refresh-terms` for every language.
- Translations follow the game's text as written, even where its capitalization looks wrong (the user's call).

## Gates

- `node tools/l10n/check.mjs report --strict=all`: nothing missing, stale, untracked, unreviewed, flagged, or made
  with a game name the game has since renamed
- `node tools/l10n/render-pages.mjs . <pseudo.json> --pseudo` + `node tools/l10n/check.mjs pseudo <pseudo.json>`
- after `js/` changes: English unchanged (`render-pages.mjs` before/after + `check.mjs same`)
- `node tools/l10n/check.mjs formatter` after formatter or game changes (needs the .NET 9 SDK and the game)
- `node build_snapshots.mjs` (the deploy's own checks: version stamps, unextracted keys)

## The mod (Abyssal repo, SpireCodexBridge)

The mod carries the site's data and scripts and runs them with Jint. Its language list is
`CodexEngine.OtherLanguages` (must match LANGS; the build checks). Build it **only** through its pipeline:

    powershell -ExecutionPolicy Bypass -File C:\Users\jparr\Documents\claude\Abyssal\tools\build-bridge\build-bridge.ps1 -Live <sts2 ref> -Beta <sts2 ref>

It builds from committed refs and renders every page in every language on the site and in the mod, live and beta,
and fails on any difference (it caught Thai marks splitting off their letters, where Jint and Node iterate strings
differently). Never `dotnet build` the bridge's csproj directly: it copies into the real game's `mods\` (pass
`-p:ModsPath=<scratch folder>` if you must). `-Install` (mods\) and `-Workshop` need the user's go-ahead.

To see how the game itself shows a string in a language: the `/test-game` skill (`start.ps1 -Lang <code>`) runs an
isolated test copy of the game.
