#!/usr/bin/env bash
# Prepare the static site for Cloudflare Pages (or local preview of a stamped build).
# Output: _site/  — set Cloudflare "Build output directory" to `_site`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="_site"
rm -rf "$OUT"
mkdir -p "$OUT"

SHA="${CF_PAGES_COMMIT_SHA:-${GITHUB_SHA:-}}"
if [[ -z "$SHA" ]]; then
  SHA="$(git rev-parse HEAD 2>/dev/null || true)"
fi
SHORT_SHA="${SHA:0:7}"
if [[ -z "$SHORT_SHA" ]]; then
  SHORT_SHA="dev"
fi
echo "Build hash: $SHORT_SHA"

cp index.html styles.css db.js score.js app.js sw.js sw-rules.js manifest.webmanifest "$OUT/"
cp .nojekyll "$OUT/" 2>/dev/null || true
if [[ -f CNAME ]]; then
  cp CNAME "$OUT/"
fi
if [[ -f _headers ]]; then
  cp _headers "$OUT/"
fi

sed -i "s/__BUILD_HASH__/${SHORT_SHA}/g" "$OUT/index.html"
sed -i "s/__BUILD_HASH__/${SHORT_SHA}/g" "$OUT/sw.js"
sed -i "s/__BUILD_HASH__/${SHORT_SHA}/g" "$OUT/app.js"

mkdir -p "$OUT/icons"
cp -r icons/. "$OUT/icons/"

mkdir -p "$OUT/images"
# Ship compact brand art for the home hero; keep full refs out of deploy size if large.
for f in Image2_480x480.jpg Image3_480x480.webp; do
  if [[ -f "images/$f" ]]; then
    cp "images/$f" "$OUT/images/"
  fi
done
if [[ -d images/ref ]]; then
  mkdir -p "$OUT/images/ref"
  cp -r images/ref/. "$OUT/images/ref/" 2>/dev/null || true
fi

while IFS= read -r -d '' f; do
  echo "ERROR: $f exceeds Cloudflare Pages 25 MiB limit" >&2
  exit 1
done < <(find "$OUT" -type f -size +25M -print0 2>/dev/null || true)

echo "Built $OUT ($(du -sh "$OUT" | cut -f1))"
