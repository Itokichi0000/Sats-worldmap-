// vendor/ と js/regions.js を node_modules から作り直す。
//   npm install && npm run vendor
// CDN に頼らず、サイトのファイルだけで動くようにする（会場の回線・nsite のため）。
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worldLow from "@amcharts/amcharts5-geodata/worldLow.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (p) => path.join(root, "node_modules", p);
const out = (p) => path.join(root, "vendor", p);

await rm(out(""), { recursive: true, force: true });
await mkdir(out("amcharts"), { recursive: true });

// amCharts 5（無料版・リンクウェア）。ロゴを消さない・LICENSE を一緒に置くことが条件
const entry = `
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import worldLow from "@amcharts/amcharts5-geodata/worldLow";
import japanLow from "@amcharts/amcharts5-geodata/japanLow";
import Animated from "@amcharts/amcharts5/themes/Animated";
import Dark from "@amcharts/amcharts5/themes/Dark";
Object.assign(window, {
  am5, am5map,
  am5geodata_worldLow: worldLow,
  am5geodata_japanLow: japanLow,
  am5themes_Animated: Animated,
  am5themes_Dark: Dark,
});
`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "js" },
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  outfile: out("amcharts/amcharts.js"),
  legalComments: "eof",
  logLevel: "warning",
});
await cp(nm("@amcharts/amcharts5/LICENSE"), out("amcharts/LICENSE"));

// Nostr（nostr-tools・Unlicense）。記録をリレーに出す・読むのに使う
await mkdir(out("nostr"), { recursive: true });
await build({
  stdin: {
    contents: `
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
window.NostrTools = { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, SimplePool, nip19, bytesToHex, hexToBytes };
`,
    resolveDir: root,
    loader: "js",
  },
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  outfile: out("nostr/nostr.js"),
  legalComments: "eof",
  logLevel: "warning",
});
await cp(nm("nostr-tools/LICENSE"), out("nostr/LICENSE"));

// QR コード（MIT）
await mkdir(out("qrcode"), { recursive: true });
await cp(nm("qrcode-generator/dist/qrcode.js"), out("qrcode/qrcode.js"));

// Font Awesome Free（アイコン CC BY 4.0・フォント OFL・コード MIT）
await mkdir(out("fontawesome/css"), { recursive: true });
await cp(nm("@fortawesome/fontawesome-free/css/all.min.css"), out("fontawesome/css/all.min.css"));
await cp(nm("@fortawesome/fontawesome-free/webfonts"), out("fontawesome/webfonts"), { recursive: true });
await cp(nm("@fortawesome/fontawesome-free/LICENSE.txt"), out("fontawesome/LICENSE.txt"));

// 国の一覧（世界地図にある国・地域だけ）。名前は画面で Intl.DisplayNames（日本語）に置き換える
const countries = worldLow.features
  .map((f) => ({ code: f.id, en: f.properties.name }))
  .filter((c) => /^[A-Z]{2}$/.test(c.code))
  .sort((a, b) => a.en.localeCompare(b.en));

await writeFile(
  path.join(root, "js/countries.js"),
  `// scripts/build-vendor.mjs が作る（手で直さない）。世界地図（amCharts worldLow）にある国・地域\n` +
    `window.SATS_COUNTRIES = ${JSON.stringify(countries.map((c) => [c.code, c.en]))};\n`,
);
console.log(`vendor/ を作りました（国 ${countries.length}）`);
