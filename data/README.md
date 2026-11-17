# data/ — canonical site data

Hand-maintained CSVs fetched by the SPA at runtime (`js/data.js`) and re-read at deploy time by `build_snapshots.mjs`. Editing these requires **no build step** — refresh the page.

Parsing is a hand-rolled CSV parser (`js/csv-parser.js`): first row is the header, quoted fields supported. Column names below are exact and case-sensitive.

## Files

| File | Keyed by | Consumed for |
|---|---|---|
| `monsters.csv` | `Key` (stable slug, e.g. `ruby-raider-axe` — also the URL slug and image filename; `Name` is display-only) | enemy detail panels |
| `monster_moves.csv` | `Enemy` → joins `monsters.Key` | move tables + `<Move Name>` tooltips |
| `encounters.csv` | `Key` (stable slug — also the URL slug; collisions like Seapunk easy/hard are pre-disambiguated as `seapunk-easy`); `Enemies` lists `monsters.Key` values | encounter grid/panels |
| `events.csv` | `Key` (stable id) | event panels |
| `event_choices.csv` | `Event` → joins `events.Key` | event outcome tables |
| `powers.csv` | `Key` — the `{power_key}` reference target | power tooltips/reference |
| `cards.csv`, `relics.csv`, `potions.csv`, `enchantments.csv` | `Key` | unified `itemsRef` reference tables |
| `beta_changes.csv` | `Type:Name` where Type ∈ `monster` \| `encounter` \| `event` and Name is that entity's **Key** | "Beta Patch" badges |
| `multiplayer-scaling.json` | — | act HP/effect multipliers, counter-power keys, powers whose description shows the player count (playerCountDecrement) |
| `game_gaps.csv` | `Type,GameId` | game ids the data knowingly doesn't cover (see [Game ids](#game-ids-gameids-gamemoves)); read only by the mod's build pipeline |

**Keys are stable identifiers**: renaming an entity's display `Name`/`Encounter` is safe; changing a `Key` changes its live URL, image path, and every join — don't. New monsters get `Key` = slugified Name; new encounters get slugified name plus `-<category>` only if the name collides with another encounter.

## Column split conventions (exact — the renderers depend on them)

- `monsters.Powers` — split on `;`
- `monsters.References`, `monster_moves.References`, `event_choices.References` — split on `,` (values are `Key`s into powers/cards/relics/potions/enchantments)
- `encounters.Enemies` — split on `;` (values are `monsters.Key`)
- `events.Acts` — split on `,`
- Booleans (`HpScalePlayerCountOnly`, `ScalesInMultiplayer`) — literal lowercase string `true`
- `encounters.Zone` / `events.Act` values must match a `csvName` in `ACTS` (`js/config.js`) — `Overgrowth`, `Underdocks`, `Hive`, `Glory` (+ `Shared` for events)
- In `Effects`/`Change` text, `;` renders as a line break

## Inline micro-syntax (inside cell text)

- `{power_key}` — power reference → icon + name + tooltip from `powers.csv`. Unknown keys render as literal text.
- `<Move Name>` — move reference with tooltip. **Must start with a capital letter** (that's how the regex avoids HTML tags). Only resolves for moves of the same enemy.
- `N (M)` — base value with Ascension value in parens, e.g. `Deal 8 (10) damage`. Multiplayer scaling rewrites both numbers; scalable `{power} N (M)` values scale only when the power's `ScalesInMultiplayer` is true.
  - Which Ascension raises `M`: **A8** (Tough Enemies, `AscensionLevel.ToughEnemies` in the game code) for HP, **A9** (Deadly Enemies) for everything else. A value outside `HP` that the game raises at A8 is written `N (A8 M)`, e.g. `{block} 5 (A8 9)`; the `A8 ` doesn't show on the page. Check the `GetValueIfAscension` call's level when adding a pair.
  - With a known Ascension (`?asc=0`–`10`, which the in-game panel's links set, or Dread) each pair renders as the one value for that level.
- HP strings: **every digit** gets scaled in multiplayer mode — don't put unrelated numbers in `HP`.

### Notes columns (`monsters.Notes`, `monster_moves.Notes`, `event_choices.Notes`)

Lines split on `\n` or at each tag. Tags: `[coop]` (🤝 badge), `[req]` (✦ requirement), `[info]` (💡, also the default for untagged lines), `[bug]` (⚠️). A line starting with 4 spaces or a tab becomes a sub-bullet of the previous item. Formatting house rules: wrap significant values in color tags (e.g. `[red]all[/red]`); co-op-only behavior always goes under `[coop]`.

### Lore bbcode (`events.Lore`, item `Description`s)

- `|` — paragraph separator
- `[b]…[/b]` — bold
- Color tags: `[green] [aqua] [blue] [red] [gold] [orange] [purple] [pink]`
- Animated effects (per-character): `[rainbow freq=…]`, `[jitter]`, `[sine]`, `[fade_in]`, `[thinky_dots]` — colors/bold may nest inside
- The game's inline icons, as its text writes them: `[img]res://images/packed/sprite_fonts/ironclad_energy_icon.png[/img]` (one per energy, as the game shows 1–4) and `star_icon.png`; shown from `media/ui/<name>.webp`. Descriptions that are the game's text keep them so they stay word for word the game's (Outmaneuver, Sown)
- Snapshot builds (`build_snapshots.mjs`, via the `STATIC_RENDER` flag) render animated text as plain colored text — expected divergence from the live page.

## Dread mode columns (optional)

Dread is a game mode (beta v0.113.0+) with every Ascension modifier on, Dread-only boss buffs, and per-boss **Dominions** that affect the act's other fights. The site shows it through a **Dread** toggle next to the player-count buttons. The toggle appears only when at least one column below is filled, so branches without Dread data (e.g. live, before Dread ships) need nothing.

With Dread on, every `N (M)` pair renders as its ascension value `M` (it overrides `?asc=`). Fill a Dread column only where Dread differs from that; Dread values are written as a single number (no `(M)`) and are highlighted.

| File | Column | Meaning |
|---|---|---|
| `monsters.csv` | `DreadHP` | HP in Dread (replaces `HP`) |
| `monsters.csv` | `DreadPattern` | Pattern in Dread (replaces `Pattern`) |
| `monsters.csv` | `DreadStartsWith` | Replaces `StartsWith` |
| `monsters.csv` | `DreadNotes` | Extra note lines shown only in Dread (appended, same tag syntax as `Notes`) |
| `monster_moves.csv` | `DreadEffects` | Effects in Dread (replaces `Effects`) |
| `monster_moves.csv` | `Mode` | empty = always shown; `dread` = only in Dread (Dread-only moves); `no-dread` = hidden in Dread (moves Dread skips) |
| `encounters.csv` | `DreadEnemies` | Monster Keys in Dread (replaces `Enemies`, `;`-separated) |
| `encounters.csv` | `DreadMulti` | Multi badge in Dread (replaces `Multi`) |
| `encounters.csv` | `Dominion` | Boss encounters only: the Dominion effect (`{power}` refs allowed, `;` = line break). With Dread on, panels in that zone show the Dominion of the act boss picked in the boss picker (toolbar or the panel's Dominion block) |
| `encounters.csv` | `DominionPower` | Boss encounters only, for Dominions that give enemies a power: `{power} N`, then optional `; <scope> N` overrides. Added to each enemy's STARTS WITH in the zone's other fights (fixed amount, no multiplayer scaling; 0 = none), and a fight's Dominion block says only what that fight's enemies get (plus the enemies joining mid-fight when they get something else); the boss's own panel shows the whole `Dominion` text. Scopes, first match wins: `spawned-minion` (a minion listed in `Spawns`), `spawned` (any enemy in `Spawns`), `multi` (2+ starting enemies, i.e. `Enemies` minus `Spawns`), then the fight's category `easy` / `hard` / `elite`; otherwise `N`. E.g. Waterfall Giant: `{explosive} 5; multi 3; easy 4; elite 7; spawned-minion 0` |
| `encounters.csv` | `Spawns` | Monster Keys from `Enemies` that join mid-fight rather than starting it (`;`-separated), from the encounter's `GenerateMonsters()` vs. `AllPossibleMonsters`. Used by `DominionPower` scopes |

The columns are trailing and optional: rows without Dread data can stop at the last regular column (the parser fills missing fields with `''`). Write power amounts in Dominion text as `7 {plating}` (number first) so multiplayer scaling, which only rewrites `{power} N`, leaves them alone. `build_snapshots.mjs` validates `{power}`/`<Move>` refs in these columns, `DreadEnemies` keys, `Mode` values, the `DominionPower` format, and that every `Spawns` key is in the encounter's enemy list.

## Game ids (`GameIds`, `GameMoves`)

Which game ids each row is. The in-game panel (SpireCodexBridge) and `tools/game-watcher.mjs` place the current fight and event with these columns only, so names, descriptions, values and move lists can change freely: only these columns tie a row to the game.

| File | Column | Values |
|---|---|---|
| `monsters.csv` | `GameIds` | the game's monster ids (`AXE_RUBY_RAIDER`). Several when the site merges monsters (Decimillipede: its three segments); one id on several rows when the site splits one (`TEST_SUBJECT` on each stage, in stage order) |
| `monster_moves.csv` | `GameMoves` | the move state ids the game reports for this row (`SWING_1;SWING_2`), from the monster's `new MoveState("…")` calls. A move left empty is never marked as the enemy's current move in a fight |
| `encounters.csv` | `GameIds` | the game's encounter ids (`RUBY_RAIDERS_NORMAL`) |
| `events.csv` | `GameIds` | the game's event id (`ABYSSAL_BATHS`) |

Ids are `;`-separated, capitals, digits and `_` (a model's id is its class name in that form: `AxeRubyRaider` → `AXE_RUBY_RAIDER`). The columns are the last ones in each file. A new monster, move, encounter or event needs its ids filled in.

Game text keys (localization only; `tools/l10n/bind.mjs` fills them from the game's text and leaves a filled cell alone):

| File | Column | Values |
|---|---|---|
| `powers.csv`, `cards.csv`, `relics.csv`, `potions.csv`, `enchantments.csv` | `GameIds` | the row's key prefix in its game text table (`ARTIFACT_POWER`, `BAD_LUCK`), or `table:prefix` for text the game keeps in another table (`static_hover_tips:BLOCK`, `card_keywords:INNATE`); empty for things the game doesn't have |
| `cards.csv` | `GameTitle` | the title key the game's code picks when it isn't `<ID>.title` (`DINGY_DAGGER.title.dingy`: the Dingy Dagger is named by its upgrades) |
| `monsters.csv` | `GameEntry` | the game entry the monster's name and move titles are under when the game's code names it from another one than its id (`DECIMILLIPEDE_SEGMENT` for the segments, `HATCHLING` for the hatched Tough Egg) |
| `event_choices.csv` | `GameOption` | `PAGE.OPTION` of the event's game id (`INITIAL.DIVE_INTO_WATER`): the option whose title the Choice is |
| `events.csv` | `PanelName` | The event panel's title where it shows more than Name, as the game shows it (Reflections: "Reflections snoitcelfeR"); its card and search show Name. A game title that is the name and then its mirror image gives the card each language's first half (镜中倒影, Reflejos); set by hand |
| `events.csv` | `GameLore` | the event's game pages the Lore is, in order, when not the opening page alone (`INITIAL;ENTER`: the site shows the page after the opening one in the same passage) |
| `event_choices.csv`, `events.csv`, the reference files | `GameVars` | the values that make the game's text the site's English (`Gold=40`, `EntrantNumber=101-998`, `@relics:KEY` for a game string, `^KEYWORD` / `$KEYWORD` a card's keywords) |

`game_gaps.csv` lists the game's ids the site doesn't cover on purpose (test monsters, event fights, Ancients, moves with no row): `Type` (`monster` | `move` | `encounter` | `event`), `GameId` (`MONSTER:STATE` for a move), `Note`.

The mod's build pipeline (Abyssal `tools/build-bridge`) checks both against the installed game and stops on: an id on a row that the game doesn't have, a game id on two encounter or event rows (or a move state on two moves of one enemy), and a game id that is on no row and not in `game_gaps.csv`. `build_snapshots.mjs` checks the format.

## Images

- Enemy art: `media/enemies/<monsters.Key>.webp` (512×512, via `/render-sprite` skill)
- `encounters.AltImage` without a `/` resolves inside `media/enemies/`
- Events: `media/events/<events.Image>`; items per `Image` column in their category folder
- **Missing images fail silently** (`onerror` hides the tag) — a typo in a name shows as a blank icon, not an error.

## Intents (`monster_moves.Intent`)

Comma-separated keys from: `attack, multi_attack, block, buff, debuff, add_statuses, affliction, summon, sleeping, deathblow, escape, heal, stun, unknown`. Icons live in `media/intents/<key>.webp`; unrecognized keys render the `unknown` icon.

## Localization (`data/loc/`)

Every string the site and the in-game panel show is either **game text** or **site text** (`js/i18n.js`):

- **Game text**: the game's own string, looked up by the game key a row is bound to (the columns above, and `gameId` in `ACTS`). A bound field whose English is the game's English shows the game's string in other languages; one that differs is the site's own wording.
- **Site text**: the site's own wording. English lives where it always has: the CSV cells (names, notes, patterns, effects, compositions, Dominions, beta changes) and `data/loc/site/eng.json` (labels and phrases the code shows, `{slot}`s filled by the code).

| File | What |
|---|---|
| `loc/game/<lang>.json` | the game's text the bindings use, per language, with the game version (English also lists the keys looked for that the game doesn't have, `absent`). Written by `node tools/l10n/extract.mjs` (reads the game's pack); never edited by hand |
| `loc/site/eng.json` | the site's labels and phrases in English (`ui`) |
| `loc/site/<lang>.json` | a language's translations: `ui` (key → `{ en, text }`, `en` being the English it was made from) and `text` (template → translation). Written by `tools/l10n/merge.mjs` only |
| `loc/meta/<lang>.json` | the record behind each translation (not loaded by the site or the mod): who made it (`by`: engine + model, or human + translator), when, the game's names it used, and its back-translation review (`tools/l10n/translations.mjs` documents the fields) |

A cell's translation is keyed by its **template**: the English with `<Move>` refs, `{power}` refs and values taken out (`{m1}`, `{p1}`, `{n1}`): `Apply 2 {weak}` and `Apply 3 {frail}` are both `Apply {n1} {p1}`. Effects, Dominions and beta changes are translated per `;` clause, patterns per line, lore and choice text per `|` paragraph, notes per line. A translation stands only for the English it was made from: change a cell's wording and its old translation stops applying (the page shows English there) until it's redone.

English pages render the data as written, with no lookups. Game text is formatted the game's way: `js/i18n.js` copies its formatter (SmartFormat: per-language plural rules, numbers as the game's .NET cultures write them), and `check.mjs formatter` holds that copy to the game's own DLL (`tools/l10n/oracle`) in every language.

**Translations** come from a pluggable engine (any command that fills a work file: `tools/l10n/translate.mjs`, `tools/l10n/engines/`) or a person, and each is recorded in `loc/meta`. A person's translation is never overwritten by an engine's (`merge.mjs` keeps it; a translation edited outside `merge.mjs` fails the strict check). An engine's translation is reviewed by a separate back-translation without the English (`review.mjs`), then judged against the English; a flagged one is retranslated with the judge's note, and every string flagged in one language is checked in all of them (the fix round, `pending.mjs --cross`). A translator gets each string's game terms (the game's name in the language for every game name the English uses) and, for site wording on a bound field, the game's own text for the same thing as a reference.

**Checks** (`tools/l10n`):
- `render-pages.mjs` + `check.mjs same`: English identical before and after a code change
- `render-pages.mjs --pseudo` + `check.mjs pseudo`: every shown string comes from a table
- `check.mjs report [--strict=all]`: game text vs site wording per table; per language: missing or stale, untracked, not reviewed, flagged, or made with a game name the game has since renamed
- `check.mjs rewording [--adopt]`: after an extract, the fields that were the game's text and aren't (the game reworded them)
- `check.mjs formatter`: the formatter against the game's
- `build_snapshots.mjs` (the deploy): the game text's version stamps against the branch's version, every game key the data uses extracted; missing translations only warn

The process (what to run when, from Claude Code with agents or with an engine command, lessons from earlier runs): **`tools/l10n/README.md`**.

Adding a language: an entry in `LANGS` (`js/config.js`) and in `FORMAT_CULTURES` (`js/i18n.js`: the game's culture, its plural rule, its separators; `check.mjs formatter` confirms them), `node tools/l10n/extract.mjs`, then translate and review it (`/beta-pipeline` Step 8). The mod carries the languages in `CodexEngine.OtherLanguages` (its build checks they match `LANGS`).
