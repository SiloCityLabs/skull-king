# Skull King Scorekeeper

Turn-based **Skull King** scorecard PWA — bids, tricks, bonuses, and running totals offline.

Built on the same static PWA foundation as [SiloCityLabs/recording](https://github.com/SiloCityLabs/recording): plain HTML/CSS/JS, service worker, IndexedDB, Cloudflare Pages via `make build`.

## Features

- New voyage: 2–8 players, Classic or Rascal’s scoring
- Turn-based round flow: **Bid → Tricks → Bonuses → Review**
- Auto-calculated bid points, scaled bonuses, round points, running totals
- Scorepad view matching Grandpa Beck’s pad fields
- Saved games in IndexedDB; installable offline PWA
- Phone + tablet layouts

## Local preview

```bash
make build
python3 -m http.server 8080 --directory _site
```

Open http://localhost:8080

## Deploy

- Build command: `make build`
- Output directory: `_site`

## Scoring

See in-app **Scoring reference**, or [The Board Game Family — The new Skull King](https://www.theboardgamefamily.com/2021/09/the-new-skull-king/).

## License

CC BY-SA 4.0 (same as the recording foundation).
