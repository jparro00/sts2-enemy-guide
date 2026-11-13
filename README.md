# STS2 Enemy Reference

An unofficial reference guide for **Slay the Spire 2**. Look up enemy attack patterns, event outcomes, and item details without leaving your run.

**[Open the Guide →](https://spirecodex.com/)**

---

## Enemies

Easily look up enemy details. Every enemy's full attack cycle, HP range, and status powers — organized by act and type so you can find what you need fast.

![Enemy detail view](media/readme-enemy.png)

## Events

Easily reference event information for each of the acts. Event outcomes are laid out clearly, with the exact cards, relics, potions, and enchantments you'll gain or lose — plus lore text animated the same way it appears in the game.

![Event detail view](media/readme-event.png)

## Link settings

Any page link can preset the display settings, e.g. `spirecodex.com/beta/enemy/ruby-raider-brute/?players=3&dread=1&boss=vantom`. They apply to that visit only, and the address bar then keeps tracking your settings so you can copy it to share exactly what you see.

| Parameter | Values |
|---|---|
| `players` | `1`–`4` |
| `act` | `overgrowth`, `underdocks`, `hive`, `glory` or `events`. Also sets which act an enemy that appears in several acts is scaled for. |
| `dread` | `1` or `0` (beta, when the patch has Dread mode) |
| `boss` | Act boss keys, comma-separated, one per act (Dread only). Acts left out use their first boss. |
| `enemies` | Encounter pages only: enemy keys, comma-separated, e.g. `/encounter/ruby-raiders/?enemies=ruby-raider-axe,ruby-raider-brute,ruby-raider-tracker`. Shows just those enemies. Pool encounters also have a picker for this. |
| `moves` | Encounter and enemy pages: `enemy:move` pairs, comma-separated, where the move is its name in lowercase with hyphens, e.g. `/encounter/corpse-slugs/?moves=corpse-slug:whip-slap,corpse-slug:glomp`. Marks those moves in the enemy's moves table and underlines them in its attack pattern. Repeat an enemy for duplicates on different moves; a move named twice shows a count. |

## Game watcher (Windows)

`tools/game-watcher.mjs` follows a run while you play and opens the matching page, with these link settings filled in, each time a fight or event starts. It opens its own browser window; place it once and Chrome remembers where. Run `tools\game-watcher.bat` (needs Node 22+), or `node tools/game-watcher.mjs --dry-run` to print the links without a browser.

It reads only the game's own log and save files. Pool encounters show the enemies that were actually rolled. In a solo run the game doesn't log which event you entered, so the watcher works it out from the run's event queue; an event whose entry requirement depends on your deck can occasionally be guessed wrong.

With the **SpireCodexBridge** mod installed, the watcher also marks each enemy's current move every turn (`moves=`, updated in place) and opens the exact event in solo runs. The game records intents nowhere else, so this needs the mod. It is read-only and marked `affects_gameplay: false`, so co-op partners don't need it. Like any mod, it makes the game use its separate modded save profile.

---

All game assets and data belong to [Mega Crit](https://www.megacrit.com/). This is an unofficial fan project, not affiliated with or endorsed by Mega Crit. Enemy patterns are kept current with the latest game patch — the exact version is shown in the site's banner and footer.
