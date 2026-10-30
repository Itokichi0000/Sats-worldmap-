#!/usr/bin/env bash
# Sats World Map を Nostr（nsite）に上げる。自分の Mac で動かす。
#
#   bash scripts/deploy-nsite.sh            （npm run deploy でも同じ）
#
# 1. 公開するファイルだけを dist/ に集める（scripts/build-site.mjs）
# 2. nsyte（https://github.com/sandwichfarm/nsyte）で、ファイルを Blossom に置き、
#    場所の一覧（kind 15128）に署名してリレーに出す
#    署名は自分の鍵で行う。秘密鍵は打ち込まない：署名アプリ（Clave・nsec.app など）の bunker:// でつなぐ
#    SATSMAP_SITE_SEC に bunker:// か nbunksec を入れておくと、それで署名する
# 3. 開く場所：https://<署名した人の npub>.nsite.lol/
#
# 置き場所（リレー・Blossom サーバー）は .nsite/config.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v nsyte >/dev/null 2>&1; then
  echo "nsyte がありません。入れてから、もう一度動かしてください：" >&2
  echo "  curl -fsSL https://nsyte.run/get/install.sh | bash" >&2
  echo "（または Deno で：deno install -A -f -g -n nsyte jsr:@nsyte/cli）" >&2
  exit 1
fi

if grep -q 'blinkUsername: ""' js/config.js; then
  echo "！ js/config.js の blinkUsername が空です。管理画面で入れた名前を使い、支払いページの URL に ?u= が付きます。"
  echo "  （スクリーンの QR はそれで動きます。ポスターなどに支払いページの URL を刷るなら、config.js に書いてから上げてください）"
fi

echo "▶ 公開するファイルを集めています"
node scripts/build-site.mjs

if [ -n "${SATSMAP_SITE_SEC:-}" ]; then
  echo "▶ SATSMAP_SITE_SEC の署名者で上げます"
  nsyte deploy ./dist --fallback /index.html --sec "$SATSMAP_SITE_SEC"
else
  echo "▶ 上げます。署名者を聞かれたら、署名アプリの bunker:// でつないでください（秘密鍵は打ち込まない）"
  echo "  （先に nsyte bunker connect 'bunker://…' でつないでおくこともできます）"
  nsyte deploy ./dist --fallback /index.html
fi

echo
echo "✓ 上げました。開く場所：https://<署名した npub>.nsite.lol/"
echo "  スクリーン：…/   管理画面：…/admin.html   支払いページ：…/pay.html"
