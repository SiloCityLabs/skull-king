# AGENTS.md

Context for AI agents working on **skull-king** scorekeeper.

## What this is

A **standalone static PWA** for Skull King scorekeeping — no bundler, no framework. Architecture patterned after [SiloCityLabs/recording](https://github.com/SiloCityLabs/recording).

| | |
|---|---|
| **Stack** | Plain HTML / CSS / JS (ES modules) |
| **Host** | Cloudflare Pages (`make build` → `_site`) |
| **License** | CC BY-SA 4.0 |

## Source map

| File | Role |
|---|---|
| `index.html` | Shell + views (home, setup, play, settings) |
| `styles.css` | Themes / mobile / tablet |
| `db.js` | IndexedDB games store |
| `score.js` | Pure scoring helpers |
| `app.js` | UI + turn state machine + settings / wake lock |
| `sw.js` / `sw-rules.js` | Offline shell cache |
| `scripts/build-site.sh` | Stamps `__BUILD_HASH__` → `_site/` |

## Settings

Persisted in `localStorage` (`skull-king.settings.v1`): default scoring, trick-mismatch toast, screen wake lock, haptic feedback. About section links SiloCityLabs + GitHub and shows stamped build hash.

Haptics prefer `navigator.vibrate` when the API reports success; otherwise play root `haptic.mp3`.

## Round phases

`bidding` → `tricks` → `bonuses` → `review` → next round. After round 10, if tied for first, overtime rounds 11+ (10 cards) continue until a sole leader → `finished`.

Swipe left/right (or tap round dots / scorepad cells) to browse completed round history; **Edit this round** fixes mistakes and restores the live position afterward.

## Scoring notes

Classic missed **zero** bid is **−10 × cards dealt** (rulebook), not −10 × tricks taken.

Official PDF: https://fgbradleys.com/wp-content/uploads/Skull-King-Rulebook.pdf

## Tests

```bash
npm install
npm test
```

Maintainer Vitest suite in `tests/` — not part of the Pages deploy.

## Do not

- Add a bundler or framework unless asked
- Ship huge assets over Cloudflare’s 25 MiB file limit
