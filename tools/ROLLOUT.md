# PENDING ROLLOUT — 2026-07 maintainability refactor

**Status: NOT rolled out.** The `refactor/maintainability` branch (10 commits
off `beta-v0.108.0`, checkpoint tag `pre-refactor-2026-07-04`) replaces
`build_snapshots.py` with `build_snapshots.mjs` and migrates monsters/
encounters to stable `Key` columns. Until the steps below are complete,
`origin/master` and `origin/test` still run the OLD deploy workflow and the
OLD data schema. Delete this file (and `tools/migrate-to-keys.mjs`) from all
branches once rollout is verified.

## Why ordering matters

- GitHub Actions runs the deploy workflow **of the branch being pushed**.
- The OLD workflow only knows `build_snapshots.py`. If it ever builds a
  branch that carries only the `.mjs`, it logs "skipping snapshot
  generation" and deploys `/beta/` with **zero** entity pages — silently.
- The NEW workflow prefers `.mjs` and falls back to `.py`, so it handles
  old branches fine. Therefore: **new workflow must reach every pushable
  branch no later than the `.mjs` migration itself.**
- The js/ split (panels.js) + index.html/404.html script tags +
  build_snapshots.mjs + Key-migrated data must land **atomically per
  branch** — mixing old and new halves breaks the SPA or the build.

## Steps (each push needs explicit user approval)

1. **Beta**: merge `refactor/maintainability` → `beta-v0.108.0`
   (fast-forward; the refactor was built on it).
2. **Master** (its data/ differs from beta — do NOT merge the branch):
   ```bash
   git checkout master
   git checkout beta-v0.108.0 -- CLAUDE.md AGENTS.md README.md data/README.md \
     js css index.html 404.html build_snapshots.mjs tools .github .gitignore \
     rebuild.bat serve.bat .claude
   git rm build_snapshots.py
   node tools/migrate-to-keys.mjs        # migrates MASTER's own CSVs + renames its media/enemies
   node build_snapshots.mjs              # validation + regenerate index/404; must exit 0
   git add -A && git commit
   ```
3. **Test**: merge master → test (normal flow; resolve site-config keeping
   test's values if any).
4. **Push order: master FIRST**, then `beta-v0.108.0`, then `test`.
   (Master's new workflow builds the not-yet-pushed old beta via the .py
   fallback — that's expected and fine.)
5. **Verify deploy**: Actions green; spot-check
   `spirecodex.com/enemy/axebot/`, `/beta/`, `/beta/enemy/axebot/`
   (canonical → master), `sitemap.xml`.
6. **Cleanup**: delete `tools/migrate-to-keys.mjs` + this file on master,
   merge the deletion into beta + test. Optionally delete the
   `refactor/maintainability` branch; keep the `pre-refactor-2026-07-04`
   tag until confident. Quarantined pre-refactor files live in
   `../sts2_archive/` (see its MANIFEST.md).
