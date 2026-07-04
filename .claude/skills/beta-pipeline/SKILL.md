---
name: beta-pipeline
description: Run the STS2 beta patch pipeline — fetch patch notes, decompile game files, cross-reference changes, update CSVs, and prepare beta branch for deployment.
---

# Beta Patch Update Pipeline

When invoked, run through the following steps for a new STS2 beta patch. If a version argument is provided (e.g. `/beta-pipeline 0.102.0`), use that version. Otherwise, fetch patch notes first to determine the latest version.

## Scope — what this app actually tracks
The app is an **enemy & event reference** (see `README.md`). It only cares about:
- **Enemies** — HP, attack patterns/moves, powers, encounters.
- **Events** — outcomes, requirements (IsAllowed), lore.
- **Cards / relics / potions / enchantments — ONLY when referenced by an event.** These files (`cards.csv`, `relics.csv`, `potions.csv`, `enchantments.csv`) exist solely so event detail views can render the items events give/remove. A card/relic/potion balance change matters **only if a *changed* item is referenced by an event** — verify with `grep -i "<item>" data/event_choices.csv data/events.csv` before acting.

Therefore the huge player-facing card-balance batches and new (multiplayer) deck cards in most patches are **out of scope** — they are deck cards, not event rewards. Do not update `cards.csv` for a deck-card rebalance unless that exact card appears in an event. When in doubt about scope, re-read `README.md` rather than guessing from the CSV file list.

## Step 1: Fetch patch notes
```bash
curl -s "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=2868840&count=5&maxlength=99999&feeds=steam_community_announcements"
```
- Parse JSON to find the latest beta patch post by title
- Extract sections: Enemies, Events, Potions & Relics, Ancients, and relevant General/Content changes
- Present the patch notes summary to the user and confirm this is the correct patch before proceeding

## Step 2: Create branch and update config

If a `beta-v{VERSION}` branch already exists, just check it out and skip the rest of this step.

### 2a. Decide what to branch FROM — read master's config, don't assume
The branch source depends on whether an active beta branch already exists. **`master`'s `site-config.json` is the source of truth** — check it first:
```bash
git show master:site-config.json   # look at betaVersion
```

- **`betaVersion` is `""` (empty) → the previous beta was already promoted to live, so there is NO active beta branch.** This new beta is a *between-release* beta. **Branch from `master`:**
  ```bash
  git checkout master && git checkout -b beta-v{VERSION}
  ```
  Master already contains all promoted content (plus any live hotfixes), and its `beta_changes.csv` was reset to header-only on promotion — so this beta's changelog correctly starts fresh. The retired `beta-v*` branches are dead; never branch from them.

- **`betaVersion` names a version (e.g. `"0.106.0"`) → that beta is still active (not yet released).** Branch from the latest beta branch to carry forward all prior beta-only data (CSV rows, assets, changelog):
  ```bash
  PREV=$(git branch -r | grep beta-v | sort -V | tail -1)   # e.g. origin/beta-v0.106.0
  git checkout {PREV} && git checkout -b beta-v{VERSION}
  ```

You can also confirm the situation from git log: a recent `Promote beta ... to live` + `Clear betaVersion ...` pair on master means the last beta was released (→ branch from master).

### 2b. Update `site-config.json` on the **beta** branch
- Set `betaVersion` to the new version string
- Set `isBeta` to `true`

### 2c. If (and only if) you branched from master, re-tag the beta on **master**
When branching from master, `master`'s config has an empty `betaVersion`, so the live→beta cross-link banner is currently off. Restore it by tagging the new beta on master:
- On `master`: set `betaVersion` to `{VERSION}`, but **keep `isBeta: false`** (master stays the live build). Leave `gameVersion` as the live version.
- Commit this on master (local only — do NOT push without asking). This is required so the deploy shows the cross-link banner on live pointing at `/beta/`.
- Then create/populate the beta branch from that updated master.
- (When branching from an active beta branch instead, master already carries the correct `betaVersion` — no master change needed.)

## Step 3: Decompile game files
Run the GDRE tools extraction:
```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=/d/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=/c/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://src/Core/Models/Monsters/*.cs" \
  "--include=res://src/Core/Models/Events/*.cs" \
  "--include=res://src/Core/Models/Encounters/*.cs" \
  "--include=res://localization/eng/powers.json" \
  "--include=res://localization/eng/monsters.json" \
  "--include=res://localization/eng/events.json" \
  "--include=res://localization/eng/relics.json" \
  "--include=res://localization/eng/potions.json" \
  "--include=res://localization/eng/cards.json" \
  "--include=res://localization/eng/enchantments.json"
```
Files land at:
- `raw/src/Core/Models/Monsters/*.cs`
- `raw/src/Core/Models/Events/*.cs`
- `raw/src/Core/Models/Encounters/*.cs`
- `raw/localization/eng/*.json`

## Step 4: Extract new asset images
Only if the patch adds new powers/relics/potions/enchantments:
- Identify new assets from patch notes or by diffing JSON files against existing data
- Naming conventions:
  - Powers: `res://images/powers/{key}_power.png` -> `media/powers/{key}_power.webp`
  - Relics: `res://images/relics/{key}.png` -> `media/relics/{key}.webp`
  - Potions: `res://images/potions/{key}.png` -> `media/potions/{key}.webp`
  - Enchantments: `res://images/enchantments/{key}.png` -> `media/enchantments/{key}.webp`
- Targeted extraction:
```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=/d/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=/c/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://images/powers/{name}_power.png*"
```
- Convert PNG to webp and place in appropriate `media/` folder

## Step 5: Cross-reference patch notes against decompiled CS files
For each change mentioned in the patch notes:
- **Enemy changes**: Read CS in `raw/src/Core/Models/Monsters/`, verify HP, move damage, ascension scaling, patterns, powers
- **Event changes**: Read CS in `raw/src/Core/Models/Events/`, verify IsAllowed requirements, choice effects, gold amounts, HP loss
- **Encounter changes**: Read CS in `raw/src/Core/Models/Encounters/`, verify enemy composition
- Use JSON files in `raw/localization/eng/` to verify power descriptions, monster names, event text
- CS pattern: `GetValueIfAscension(Level, ascensionValue, normalValue)` — ascension value comes FIRST

## Step 6: Update CSV data files
Update the relevant CSVs based on verified changes (see `data/README.md` for schemas):
- `data/monsters.csv` — HP, Pattern, Notes, Powers, StartsWith, References. New monsters need a `Key` (slugified display name, e.g. `ruby-raider-axe`) — it becomes the URL slug and image filename; never change an existing Key.
- `data/monster_moves.csv` — Effects, Intent, Notes, References. `Enemy` column holds the monster's `Key`.
- `data/encounters.csv` — Enemies (monster `Key`s, `;`-separated), Composition, Emoji, Category. New encounters need a `Key` (slugified name, plus `-<category>` if the name collides with another encounter).
- `data/events.csv` — Notes (requirements/tags), Acts
- `data/event_choices.csv` — Effect, Notes, References
- `data/powers.csv` — if new powers or description changes

### CSV formatting rules
- **Always quote fields that contain commas** — wrap the entire field in `"` (e.g. `"attack, buff"`, `"Damage 10; Apply 2 {weak}, 2 {vulnerable}"`)
- Multi-line CSV fields must be wrapped in `"` quotes with closing `"` on the last line
- Ascension scaling format: `base(ascension)` or `min-max(asc_min-asc_max)`
- Move references use `<Move Name>` angle brackets
- Power references use `{power_key}` curly braces
- Note tags: `[info]`, `[bug]`, `[req]`, `[coop]`
- Color tags on significant values: `[red]` for costs/penalties, `[green]` for gains, `[blue]` for quantities, `[gold]` for Gold/card-related terms
  - Example: "Lose all Gold" -> "Lose [red]all[/red] [gold]Gold[/gold]"
- Coop tag format: `[coop]🤝 Decision made as a group in co-op.`
- When removing an enemy entirely, clean up monsters.csv, monster_moves.csv, AND encounters.csv

## Step 7: Update beta_changes.csv
- Add a row for every changed encounter, monster, and event
- Format: `Type,Name,Change,Patch`
  - Type: `encounter`, `monster`, or `event`
  - Name: the entity's **Key** (monsters/encounters: their `Key` column; events: `events.csv` Key)
  - Patch: version number (e.g. `0.101.0`)
- Change description should be concise patch-note style
- If a monster/event was changed in a previous beta patch AND this patch, update the existing row's Change description and set Patch to the latest version

## Step 8: Present changes for review
- Show a summary of all changes made
- Do NOT commit or push — NEVER push to remote unless the user explicitly says to push

## Paths
- Game: `D:/Steam/steamapps/common/Slay the Spire 2/`
- PCK: `D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck`
- GDRE: `C:/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe`
- Repo: `C:/Users/jparr/Documents/claude/sts2/`
- Raw output: `C:/Users/jparr/Documents/claude/sts2/raw/`

## Promotion: releasing a beta to live

When Mega Crit ships the beta as a live patch, promote the active beta branch's content to master (reference: commits `7bf1aba` + `5294d8c`, the v0.107.0 → v0.107.1 promotion):

1. **On `master`**, bring over the beta branch's content — data and media only, never a wholesale merge (beta → master merges are forbidden):
   ```bash
   git checkout master
   git checkout beta-v{VERSION} -- data/ media/
   ```
2. **Fix up `site-config.json` on master**: set `gameVersion` to the new live version (may differ from the beta version, e.g. beta 0.107.0 shipped as 0.107.1); keep `isBeta: false`; set `betaVersion` to `""` (no active beta) — or to the next beta's version if one is already running.
3. **Reset `data/beta_changes.csv` to header-only** (`Type,Name,Change,Patch`) — live has no active beta diff. (The beta branch's copy carried the changelog; it retires with the branch.)
4. Check whether the live patch added content the beta didn't have (patch notes vs beta notes) — usually out of scope (deck cards etc.), but verify enemies/events.
5. Commit on master. Push **only with explicit user approval** (this deploys live).
6. The promoted `beta-v*` branch is now retired — leave it; only the highest `beta-v*` deploys, and its canonicals point at master, so a stale `/beta/` is harmless until the next beta starts.
7. The next beta then follows Step 2a above (branches from master, since `betaVersion` is empty).

## Branch management
- Beta branches deploy to `/beta/` on the site
- Always merge master -> beta, NEVER beta -> master
- When merging, `site-config.json` will conflict — always keep `isBeta: true` on beta
- Push master first when pushing both branches, then merge master into beta, then push beta
- NEVER push to remote unless the user explicitly asks to push
- Always safe to push `test` without asking; never push `master` or `beta-*` without permission

### Deployment flow & branch-file dependencies
- The GitHub Actions workflow lives at `.github/workflows/deploy.yml` and triggers on pushes to `master`, `beta-*`, `test`. **The version of the workflow that actually runs is the one from the branch being pushed.**
- Regardless of which branch triggers it, the workflow does the same job: checks out master fresh into `main-site/`, builds it, then iterates over all `beta-*` and `test` remote branches and builds each one into `_site/beta/` and `_site/test/`. So the deployed output is the same regardless of which branch was pushed — *as long as the workflow content is the same on whatever branch you push.*
- Files-per-branch matrix (memorize this — it's not obvious):
  | File | Effective branch |
  |------|------------------|
  | `robots.txt` | Only master's served at `spirecodex.com/robots.txt`. Copies on beta/test are inert. |
  | `.github/workflows/deploy.yml` | The triggering branch's version runs. Must be up to date on every branch you'll ever push to. |
  | `build_snapshots.mjs` | Each branch's own copy is invoked when the workflow builds that branch. |
- For the canonical-tag SEO strategy: beta's `build_snapshots.mjs` reads from `master-data/` (a directory the workflow copies in from master's `data/` before building beta). For each entity that also exists on master, beta's build emits `rel="canonical"` + `og:url` pointing to the master URL. Beta-only entities get self-canonical.
- The workflow's `Checkout and copy extra branches` step also forces `noindex=true` for `test` only — beta is allowed to be indexed (with canonicals doing the dedup work).
- Before pushing changes that touch workflow / build_snapshots / robots.txt, **propagate them to every branch that will ever be pushed**:
  - Update on master first (commit there).
  - Merge master into the active `beta-v*` branch.
  - Merge master into `test` (fast-forward usually). This is critical — if `test` has the old workflow and someone pushes to it, the old workflow would rebuild beta with `noindex=true` forced, undoing the SEO setup.
  - Don't touch retired `beta-v*` branches (they're dead; no one pushes to them).
- When creating the next beta branch, follow Step 2a's rule: branch from the previous beta **only if it's still active** (unreleased); after a promotion, branch from master. Never branch from a retired beta.
