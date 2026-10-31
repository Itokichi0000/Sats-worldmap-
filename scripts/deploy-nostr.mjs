// Sats World Map を Nostr（nsite、NIP-5A の名前つきサイト）に上げる。
//
//   node scripts/deploy-nostr.mjs            （npm run deploy でも同じ）
//
// 1. 公開するファイル（dist/）を Blossom サーバーに置く（BUD-02）
// 2. 「どのパスにどのファイルか」の一覧（kind 35128、d=satsmap）に署名してリレーに出す
// 3. 開く場所：https://<公開鍵の 36 進数 50 桁>satsmap.nsite.lol/
//
// 署名は自分の署名アプリ（Clave・Amber・nsec.app など）で行う。秘密鍵はここに渡さない：
//   - 何も付けずに動かすと nostrconnect:// を出す。署名アプリで読む（または押す）と、つながって署名を頼む
//   - SATSMAP_BUNKER に bunker://… を入れておくと、それでつなぐ
// 名前つきサイトなので、同じ npub のいちばん上のサイト（kind 15128）は上書きしない。
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { getConversationKey, decrypt } from "nostr-tools/nip44";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from "nostr-tools/nip46";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const qrcode = require("qrcode-generator");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SATSMAP_SITE || "satsmap";          // d タグ（1〜13 文字）
const GATEWAY = process.env.SATSMAP_GATEWAY || "nsite.lol";
const OUT = process.env.SATSMAP_DEPLOY_OUT || path.join(root, ".nsite");
const config = JSON.parse(await readFile(path.join(root, ".nsite/config.json"), "utf8"));
const RELAYS = config.relays;
const SERVERS = config.servers;
const SIGNER_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const INDEX_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

if (!/^[a-z0-9-]{1,13}$/.test(SITE) || SITE.endsWith("-")) throw new Error(`サイトの名前（${SITE}）は a-z0-9- の 1〜13 文字`);

const log = (...a) => console.log(...a);

// Node の組み込みの WebSocket は、つながらなかったときに nostr-tools と組んで止まらなくなる（スタックがあふれる）。
// ws を使い、HTTPS_PROXY があればそれを通す
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
class NodeWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, agent ? { agent } : {});
    // つながる前に閉じられると ws は 'error' を出す。聞き手がないとプロセスごと止まるので受けておく
    // （nostr-tools は onerror・onclose で、そのリレーだけをつながらなかったものとして扱う）
    this.on("error", () => {});
  }
}
useWebSocketImplementation(NodeWebSocket);
process.on("unhandledRejection", (e) => log(`  （リレーとの接続：${e && e.message ? e.message : e}）`));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}：${ms / 1000} 秒たっても終わりません`)), ms))]);

function base36(hex) {
  let n = BigInt(`0x${hex}`);
  let s = "";
  while (n > 0n) { s = "0123456789abcdefghijklmnopqrstuvwxyz"[Number(n % 36n)] + s; n /= 36n; }
  return s.padStart(50, "0");
}

async function walk(dir, base = dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(p);
  }
  return out;
}

// ── 1. ファイルを集める ──
log("▶ 公開するファイルを集めています");
execFileSync(process.execPath, [path.join(root, "scripts/build-site.mjs")], { stdio: "inherit" });
const dist = path.join(root, "dist");
const files = [];
for (const f of (await walk(dist)).sort()) {
  const body = await readFile(f);
  const rel = "/" + path.relative(dist, f).split(path.sep).join("/");
  files.push({ path: rel, body, hash: sha256(body), type: TYPES[path.extname(f)] || "application/octet-stream" });
}
log(`  ${files.length} ファイル・${(files.reduce((s, f) => s + f.body.length, 0) / 1024).toFixed(0)} KB`);

// ── 2. 署名アプリとつなぐ ──
// 切れたらつなぎ直す（会場・プロキシでは、黙っている WebSocket が切られることがある）
const pool = new SimplePool({ enablePing: true, enableReconnect: true });
let signer;
// 出した nostrconnect:// を、やり直しても使えるように（1 日だけ）。秘密鍵ではなく、この接続のための使い捨ての鍵
await mkdir(OUT, { recursive: true });
const clientFile = path.join(OUT, "client.json");
let client = null;
if (existsSync(clientFile)) {
  try {
    const c = JSON.parse(readFileSync(clientFile, "utf8"));
    if (Date.now() / 1000 - c.at < 86400) client = c;
  } catch { /* 作り直す */ }
}
if (!client) {
  client = { sk: bytesToHex(generateSecretKey()), secret: bytesToHex(generateSecretKey()).slice(0, 16), at: Math.floor(Date.now() / 1000) };
  await writeFile(clientFile, JSON.stringify(client), { mode: 0o600 });
}
const clientSk = hexToBytes(client.sk);

/** nostrconnect:// の返事を待つ。切れたら since 付きで頼み直すので、切れているあいだの返事も拾える */
function waitNostrConnect(relays, secret, ms) {
  const clientPk = getPublicKey(clientSk);
  return new Promise((resolve, reject) => {
    let done = false;
    let sub = null;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(again);
      try { sub && sub.close(); } catch { /* */ }
      err ? reject(err) : resolve(val);
    };
    const open = () => {
      try { sub && sub.close(); } catch { /* */ }
      sub = pool.subscribeMany(relays, { kinds: [24133], "#p": [clientPk], since: client.at - 60 }, {
        onevent(ev) {
          if (!verifyEvent(ev)) return;
          try {
            const res = JSON.parse(decrypt(ev.content, getConversationKey(clientSk, ev.pubkey)));
            if (res.result === secret) finish(null, ev.pubkey);
          } catch { /* ほかの返事 */ }
        },
      });
    };
    const timer = setTimeout(() => finish(new Error("署名アプリとつながりませんでした（30 分）")), ms);
    const again = setInterval(open, 20000);
    open();
  });
}
if (process.env.SATSMAP_BUNKER) {
  const bp = await parseBunkerInput(process.env.SATSMAP_BUNKER);
  if (!bp) throw new Error("SATSMAP_BUNKER が bunker:// の形ではありません");
  signer = BunkerSigner.fromBunker(clientSk, bp, { pool, timeout: 300000 });
  log("▶ bunker:// でつないでいます（署名アプリで承認してください）");
  await withTimeout(signer.connect(), 300000, "署名アプリとの接続");
} else {
  const secret = client.secret;
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSk),
    relays: SIGNER_RELAYS,
    secret,
    perms: ["sign_event:24242", "sign_event:35128", "get_public_key"],
    name: "Sats World Map deploy",
  });
  const qr = qrcode(0, "L");
  qr.addData(uri);
  qr.make();
  await writeFile(path.join(OUT, "nostrconnect.txt"), uri + "\n");
  await writeFile(path.join(OUT, "nostrconnect.svg"), qr.createSvgTag({ cellSize: 6, margin: 4, scalable: false }).replace("<svg ", '<svg style="background:#fff" '));
  log("\n▶ 署名アプリで、次の nostrconnect:// を開いてください（QR：" + path.join(OUT, "nostrconnect.svg") + "）\n");
  log(uri + "\n");
  log("  つながるのを待っています（30 分まで）…");
  const remote = await waitNostrConnect(SIGNER_RELAYS, secret, 1800000);
  signer = BunkerSigner.fromBunker(clientSk, { pubkey: remote, relays: SIGNER_RELAYS, secret }, { pool, timeout: 300000 });
}
const pubkey = await withTimeout(signer.getPublicKey(), 300000, "公開鍵の取得");
const npub = nip19.npubEncode(pubkey);
const host = `${base36(pubkey)}${SITE}.${GATEWAY}`;
log(`✓ つながりました：${npub}`);

// 自分のリレー一覧（kind 10002）の書き込み先にも出す
let userRelays = [];
try {
  const ev = await pool.get(INDEX_RELAYS, { kinds: [10002], authors: [pubkey] }, { maxWait: 6000 });
  userRelays = (ev ? ev.tags : []).filter((t) => t[0] === "r" && /^wss:\/\//.test(t[1] || "") && t[2] !== "read").map((t) => t[1].replace(/\/$/, ""));
} catch { /* なくてもよい */ }
const publishRelays = [...new Set([...RELAYS, ...userRelays, "wss://relay.nsite.lol", "wss://purplepag.es"])].slice(0, 16);

// ── 3. Blossom に置く ──
log("▶ Blossom の許可（kind 24242）に署名を頼んでいます。署名アプリで承認してください");
const now = Math.floor(Date.now() / 1000);
const auth = await withTimeout(signer.signEvent({
  kind: 24242,
  created_at: now,
  content: "Upload Sats World Map",
  tags: [["t", "upload"], ["expiration", String(now + 3600)], ...[...new Set(files.map((f) => f.hash))].map((h) => ["x", h])],
}), 300000, "Blossom の許可の署名");
if (auth.pubkey !== pubkey) throw new Error("署名アプリが別の鍵で署名しました");
const authHeader = "Nostr " + Buffer.from(JSON.stringify(auth)).toString("base64");
if (process.env.SATSMAP_DRY_RUN) {
  log("✓ （試し）署名アプリとつながり、署名が返ってきました。ここで止めます");
  process.exit(0);
}

const placed = new Map(files.map((f) => [f.hash, new Set()]));
for (const server of SERVERS) {
  let ok = 0;
  for (const f of files) {
    const url = `${server.replace(/\/$/, "")}/${f.hash}`;
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) { placed.get(f.hash).add(server); ok++; continue; }
      const res = await fetch(`${server.replace(/\/$/, "")}/upload`, {
        method: "PUT",
        headers: { Authorization: authHeader, "Content-Type": f.type, "X-SHA-256": f.hash },
        body: f.body,
      });
      if (!res.ok) throw new Error(`${res.status} ${(res.headers.get("x-reason") || (await res.text())).slice(0, 120)}`);
      const j = await res.json().catch(() => ({}));
      if (j.sha256 && j.sha256 !== f.hash) throw new Error(`返ってきたハッシュが違う（${j.sha256}）`);
      placed.get(f.hash).add(server);
      ok++;
    } catch (e) {
      log(`  ✗ ${server} ${f.path}：${e.message}`);
    }
  }
  log(`  ${server}：${ok} / ${files.length}`);
}
const missing = files.filter((f) => placed.get(f.hash).size === 0);
if (missing.length) throw new Error(`どの Blossom サーバーにも置けなかったファイルがあります：${missing.map((f) => f.path).join(", ")}`);
const usedServers = SERVERS.filter((s) => files.every((f) => placed.get(f.hash).has(s)));

// ── 4. サイトの一覧（kind 35128）に署名して出す ──
const pathTags = files.map((f) => ["path", f.path, f.hash]);
const aggregate = sha256(Buffer.from(pathTags.map(([, p, h]) => `${h} ${p}\n`).sort().join(""), "utf8"));
log("▶ サイトの一覧（kind 35128）に署名を頼んでいます。署名アプリで承認してください");
const manifest = await withTimeout(signer.signEvent({
  kind: 35128,
  created_at: Math.floor(Date.now() / 1000),
  content: "",
  tags: [
    ["d", SITE],
    ...pathTags,
    ["x", aggregate, "aggregate"],
    ...(usedServers.length ? usedServers : SERVERS).map((s) => ["server", s]),
    ["title", "Sats World Map"],
    ["description", "ライトニングで地図を灯そう — 会場のスクリーンに映すミニゲーム"],
    ["source", "https://github.com/Itokichi0000/Sats-worldmap-"],
  ],
}), 300000, "サイトの一覧の署名");
if (manifest.pubkey !== pubkey) throw new Error("署名アプリが別の鍵で署名しました");
const results = await Promise.allSettled(pool.publish(publishRelays, manifest, { maxWait: 10000 }));
const okRelays = publishRelays.filter((_, i) => results[i].status === "fulfilled");
log(`  リレー：${okRelays.length} / ${publishRelays.length} が受け取りました（${okRelays.join(", ")}）`);
if (!okRelays.length) throw new Error("どのリレーも一覧を受け取りませんでした");

await writeFile(path.join(OUT, "last-deploy.json"), JSON.stringify({ npub, pubkey, site: SITE, url: `https://${host}/`, manifest: manifest.id, aggregate, relays: okRelays, servers: usedServers, at: new Date().toISOString() }, null, 2) + "\n");
log("\n✓ 上げました");
log(`  スクリーン：     https://${host}/`);
log(`  支払いページ：   https://${host}/pay.html`);
log(`  管理画面：       https://${host}/admin.html`);
try { await signer.close(); } catch { /* */ }
pool.close([...new Set([...publishRelays, ...SIGNER_RELAYS, ...INDEX_RELAYS])]);
setTimeout(() => process.exit(0), 500);
