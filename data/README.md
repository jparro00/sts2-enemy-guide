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
| `multiplayer-scaling.json` | — | act HP/effect multipliers, counter-power keys |

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
- HP strings: **every digit** gets scaled in multiplayer mode — don't put unrelated numbers in `HP`.

### Notes columns (`monsters.Notes`, `monster_moves.Notes`, `event_choices.Notes`)

Lines split on `\n` or at each tag. Tags: `[coop]` (🤝 badge), `[req]` (✦ requirement), `[info]` (💡, also the default for untagged lines), `[bug]` (⚠️). A line starting with 4 spaces or a tab becomes a sub-bullet of the previous item. Formatting house rules: wrap significant values in color tags (e.g. `[red]all[/red]`); co-op-only behavior always goes under `[coop]`.

### Lore bbcode (`events.Lore`, item `Description`s)

- `|` — paragraph separator
- `[b]…[/b]` — bold
- Color tags: `[green] [aqua] [blue] [red] [gold] [orange] [purple] [pink]`
- Animated effects (per-character): `[rainbow freq=…]`, `[jitter]`, `[sine]`, `[fade_in]`, `[thinky_dots]` — colors/bold may nest inside
- Snapshot builds (`build_snapshots.mjs`, via the `STATIC_RENDER` flag) render animated text as plain colored text — expected divergence from the live page.

## Images

- Enemy art: `media/enemies/<monsters.Key>.webp` (512×512, via `/render-sprite` skill)
- `encounters.AltImage` without a `/` resolves inside `media/enemies/`
- Events: `media/events/<events.Image>`; items per `Image` column in their category folder
- **Missing images fail silently** (`onerror` hides the tag) — a typo in a name shows as a blank icon, not an error.

## Intents (`monster_moves.Intent`)

Comma-separated keys from: `attack, multi_attack, block, buff, debuff, add_statuses, affliction, summon, sleeping, deathblow, escape, heal, stun, unknown`. Icons live in `media/intents/<key>.webp`; unrecognized keys render the `unknown` icon.
