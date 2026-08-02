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
| `index.html` | Shell + views |
| `styles.css` | Themes / mobile / tablet |
| `db.js` | IndexedDB games store |
| `score.js` | Pure scoring helpers |
| `app.js` | UI + turn state machine |
| `sw.js` / `sw-rules.js` | Offline shell cache |
| `scripts/build-site.sh` | Stamps `__BUILD_HASH__` → `_site/` |

## Round phases

`bidding` → `tricks` → `bonuses` → `review` → next round (or `finished` after 10).

## Do not

- Add a bundler or framework unless asked
- Ship huge assets over Cloudflare’s 25 MiB file limit
