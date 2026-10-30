// 自動の確認：Blink の API をまねて、スマホで投げる → スクリーンに出る、までを通す。
//   npm test            （SHOTS=フォルダ で画面を撮る）
// 本物の Blink にはつながない（api.blink.sv への通信は、ここで答える）。
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { serve } from "./serve.mjs";
import { startRelay } from "./test-relay.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SHOTS = process.env.SHOTS || "";
const WALLET = "wallet-btc-1";
let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
};

// ── Blink のまね ─────────────────────────────────────────
const blink = {
  invoices: [], // { pr, hash, sats, memo, paid, at }
  extra: [],    // 支払いページを通らない入金
  key: "blink_testkey",
  pay(i) { const inv = this.invoices[i]; inv.paid = true; inv.at = Math.floor(Date.now() / 1000); },
};
function gql(body, headers) {
  const q = body.query || "";
  const v = body.variables || {};
  const authed = headers["x-api-key"] === blink.key;
  if (q.includes("accountDefaultWallet")) {
    return v.u === "satsmap" ? { data: { accountDefaultWallet: { id: WALLET, walletCurrency: "BTC" } } } : { errors: [{ message: "Account does not exist for username" }] };
  }
  if (q.includes("lnInvoiceCreateOnBehalfOfRecipient")) {
    const { amount, memo, recipientWalletId } = v.input;
    if (recipientWalletId !== WALLET) return { errors: [{ message: "bad wallet" }] };
    const n = blink.invoices.length;
    const inv = { pr: `lnbc${amount}n1ptest${n}qqqq`, hash: `hash${n}`, sats: amount, memo, paid: false };
    blink.invoices.push(inv);
    return { data: { lnInvoiceCreateOnBehalfOfRecipient: { invoice: { paymentRequest: inv.pr, paymentHash: inv.hash, satoshis: amount }, errors: [] } } };
  }
  if (q.includes("lnInvoicePaymentStatusByPaymentRequest")) {
    const inv = blink.invoices.find((x) => x.pr === v.input.paymentRequest);
    return { data: { lnInvoicePaymentStatusByPaymentRequest: { status: inv && inv.paid ? "PAID" : "PENDING" } } };
  }
  if (q.includes("me")) {
    if (!authed) return { errors: [{ message: "Not authorized" }] };
    const txs = [...blink.invoices.filter((x) => x.paid), ...blink.extra]
      .sort((a, b) => b.at - a.at)
      .map((x) => ({
        cursor: `c-${x.hash}`,
        node: {
          id: `tx-${x.hash}`, direction: "RECEIVE", status: "SUCCESS", memo: x.memo, createdAt: x.at,
          settlementAmount: x.sats, settlementCurrency: "BTC",
          initiationVia: { __typename: "InitiationViaLn", paymentHash: x.hash },
        },
      }));
    return {
      data: {
        me: {
          username: "satsmap",
          defaultAccount: {
            wallets: [
              { id: "wallet-usd-1", walletCurrency: "USD", balance: 0, transactions: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
              { id: WALLET, walletCurrency: "BTC", balance: 0, transactions: { pageInfo: { hasNextPage: false, endCursor: null }, edges: txs.slice(0, v.first || 20) } },
            ],
          },
        },
      },
    };
  }
  return { errors: [{ message: `unknown query ${q.slice(0, 40)}` }] };
}

const server = await serve(0);
const relay = await startRelay(0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-api-key", "access-control-allow-methods": "POST, OPTIONS" };
async function mockBlink(ctx) {
  await ctx.route("https://api.blink.sv/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = gql(JSON.parse(req.postData() || "{}"), req.headers());
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}
await mockBlink(context);
// 記録は手元のテスト用リレーに出す
const useTestRelay = (ctx) => ctx.addInitScript((url) => {
  if (!localStorage.getItem("satsmap.settings.v1")) localStorage.setItem("satsmap.settings.v1", JSON.stringify({ recordRelays: [url] }));
}, relay.url);
await useTestRelay(context);

const errors = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

try {
  // 1. はじめはデモ
  const screen = await context.newPage();
  watch(screen, "screen");
  await screen.goto(`${base}/index.html`);
  await screen.waitForTimeout(1200);
  ok(await screen.locator("#status-chip").textContent() === "DEMO", "API キーがないとデモになる");
  ok(await screen.locator("#demo-card").isVisible(), "デモのボタンが出る");
  await screen.click("text=🗼 +2,100");
  await screen.waitForTimeout(3800);
  ok((await screen.locator("#stat-total-sats").textContent()) === "2,100", "デモの 1 投が数に入る");
  ok((await screen.locator("#stat-prefs").textContent()) === "1", "都道府県の制覇が 1 になる");
  await shot(screen, "1-demo");

  // 2. 管理画面で Blink を設定
  const admin = await context.newPage();
  watch(admin, "admin");
  await admin.goto(`${base}/admin.html`);
  await admin.fill("#username", "satsmap@blink.sv");
  await admin.fill("#apikey", blink.key);
  await admin.click("#test-blink");
  await admin.waitForFunction(() => /API キーで読めました/.test(document.getElementById("blink-log").textContent), null, { timeout: 5000 });
  const logText = await admin.locator("#blink-log").textContent();
  ok(/BTC ウォレットが見つかりました/.test(logText) && /一覧を読めました/.test(logText) && !/✗/.test(logText), "接続テストが通る");
  ok((await admin.locator("#pay-link").textContent()).endsWith("pay.html?u=satsmap"), "支払いページの URL にユーザー名が付く");
  await admin.click("#clear-tests");
  admin.once("dialog", (d) => d.accept());
  await admin.click("#reset");
  await screen.waitForTimeout(800);
  await screen.waitForFunction(() => document.getElementById("status-chip").textContent === "● LIVE", null, { timeout: 8000 });
  ok(true, "キーを入れるとスクリーンが LIVE になる");
  ok((await screen.locator("#stat-total-sats").textContent()) === "0", "やり直すと 0 に戻る");
  ok(await screen.locator("#pay-url").textContent().then((t) => t.includes("pay.html?u=satsmap")), "スクリーンの QR が支払いページを指す");

  // 3. スマホで投げる
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mockBlink(phoneCtx);
  const phone = await phoneCtx.newPage();
  watch(phone, "phone");
  // スクリーンの QR と同じ URL で開く
  const payUrl = "http://" + (await screen.locator("#pay-url").textContent());
  ok(/[?&]k=npub1/.test(payUrl) && /[?&]s=[a-z0-9]{6,}/.test(payUrl), "QR の URL に記録の鍵とイベントが入る");
  await phone.goto(payUrl);
  await phone.waitForSelector("#live:not([hidden])", { timeout: 8000 });
  ok(/まだだれも投げていません/.test(await phone.locator("#live-rank").textContent()), "支払いページに「いまの会場」が出る");
  ok((await phone.locator(".pref.fresh").count()) === 47, "まだだれも投げていない県に ★ が付く");
  await phone.click("#go");
  ok(/地域を選んで/.test(await phone.locator("#form-error").textContent()), "地域を選ばずに押すと、わけを出す");
  await phone.click('.pref[data-key="jp_prefecture:JP-13"]');
  await phone.click('.amt[data-amt="2100"]');
  await phone.fill("#nick", "ましゅ");
  await phone.fill("#msg", "はじめての Lightning！");
  await shot(phone, "2-pay-form");
  await phone.click("#go");
  await phone.waitForSelector("#invoice:not([hidden])");
  ok((await phone.locator("#open-wallet").getAttribute("href")).startsWith("lightning:lnbc2100"), "ウォレットで開くリンクが出る");
  const memo = blink.invoices[0].memo;
  ok(memo.startsWith("⚡SatsMap 🗼東京都 from ましゅ ##{") && memo.length < 400, "インボイスのメモに地域と名前が入る");
  await shot(phone, "3-pay-invoice");

  blink.pay(0);
  await phone.waitForSelector("#done:not([hidden])", { timeout: 6000 });
  ok(true, "払うと「届きました」になる");
  await phone.waitForSelector("#done-rank:not([hidden])", { timeout: 15000 });
  ok(/東京都.*初制覇.*1 位/.test(await phone.locator("#done-rank").textContent()), "自分の 1 投がスクリーンに出ると、スマホに「初制覇・1 位」が出る");
  await shot(phone, "4-pay-done");

  await screen.waitForFunction(() => document.getElementById("stat-total-sats").textContent === "2,100", null, { timeout: 12000 });
  ok(true, "スクリーンが Blink の受け取りを見つけて数に入れる");
  await screen.waitForSelector(".bubble", { timeout: 3000 });
  const bubble = await screen.locator(".bubble").first().textContent();
  ok(bubble.includes("ましゅ") && bubble.includes("はじめての Lightning！"), "吹き出しに名前とひとことが出る");
  // 吹き出しが東京の上あたりにあるか（日本地図の中）
  const b = await screen.locator(".bubble").first().boundingBox();
  const jp = await screen.locator("#card-japan").boundingBox();
  ok(b && jp && b.x + b.width / 2 > jp.x && b.x + b.width / 2 < jp.x + jp.width, "吹き出しが日本地図の上に出る");
  await shot(screen, "5-screen-paid");
  ok((await screen.locator("#latest-feed").textContent()).includes("ましゅ"), "最新の一覧に名前が出る");

  // 4. ラウンド・NG ワード・HTML を書いた名前
  await admin.click("#round-start");
  await screen.waitForFunction(() => /ROUND 1/.test(document.getElementById("round-title").textContent), null, { timeout: 3000 });
  ok(true, "管理画面からラウンドを始められる");

  for (const [nick, msg, key] of [["<img src=x onerror=alert(1)>", "死ね", "country:US"], ["くじら", "21000 いきます", "country:SV"]]) {
    await phone.click("#again");
    const r = key.split(":");
    if (r[0] === "country") {
      await phone.click('.seg-btn[data-tab="world"]');
      await phone.click(`[data-key="${key}"]`);
    }
    await phone.click(`.amt[data-amt="${nick === "くじら" ? 21000 : 21}"]`);
    await phone.fill("#nick", nick);
    await phone.fill("#msg", msg);
    await phone.click("#go");
    await phone.waitForSelector("#invoice:not([hidden])");
    blink.pay(blink.invoices.length - 1);
    await phone.waitForSelector("#done:not([hidden])", { timeout: 6000 });
  }
  await screen.waitForFunction(() => document.getElementById("stat-total-sats").textContent === "23,121", null, { timeout: 20000 });
  ok(true, "続けて投げても順に数に入る");
  await phone.waitForFunction(() => document.getElementById("live-sats").textContent === "23,121", null, { timeout: 15000 });
  ok((await phone.locator("#live-rank li").first().textContent()).includes("エルサルバドル"), "スマホの「いまの会場」も更新され、1 位が入れかわる");
  ok((await phone.locator(".pref.fresh").count()) === 46, "投げた県の ★ が消える");
  await shot(phone, "4b-pay-live");
  await screen.waitForTimeout(300);
  await shot(screen, "6-whale");
  const feed = await screen.locator("#latest-feed").innerHTML();
  ok(!feed.includes("死ね"), "NG ワードのひとことはスクリーンに出ない");
  ok(!feed.includes("<img") && (await screen.locator("#latest-feed img").count()) === 0, "名前に書いた HTML はそのまま文字として扱う");
  ok((await screen.locator("#tug-world").textContent()) === "21,021", "綱引き：世界チームに数が入る");
  ok((await screen.locator("#goal-now").textContent()) === "21,021", "ラウンドのゴールに、ラウンド中の分だけ入る");

  // 支払いページを通らない入金は、既定では数えない
  blink.extra.push({ hash: "direct1", sats: 500, memo: "personal payment", at: Math.floor(Date.now() / 1000) });
  await screen.waitForTimeout(9000);
  ok((await screen.locator("#stat-total-sats").textContent()) === "23,121", "SatsMap のメモがない入金は、既定では数えない");

  // 隠す
  await admin.waitForSelector("[data-hide]");
  await admin.locator('[data-hide][data-to="1"]').first().click();
  await screen.waitForTimeout(500);
  ok(!(await screen.locator("#latest-feed").textContent()).includes("21000 いきます"), "管理画面で隠すと、ひとことが消える");

  await admin.click("#round-end");
  await screen.waitForSelector("#result:not([hidden])", { timeout: 3000 });
  const result = await screen.locator("#result").textContent();
  ok(result.includes("ROUND 1 終了") && result.includes("21,021"), "ラウンドの結果が出る");
  await shot(screen, "7-result");

  // 開き直しても残る
  await screen.reload();
  await screen.waitForTimeout(1500);
  ok((await screen.locator("#stat-total-sats").textContent()) === "23,121", "開き直しても記録が残る（二重に数えない）");

  // 狭い画面（ノートパソコン）でもはみ出さない
  await screen.setViewportSize({ width: 1280, height: 720 });
  await screen.locator("#result").click();
  await screen.waitForTimeout(600);
  const overflow = await screen.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok(!overflow, "1280×720 でも横にはみ出さない");
  await shot(screen, "8-laptop");

  // 5. Nostr の記録
  await screen.waitForTimeout(2500);
  const latest = new Map();
  relay.events.filter((e) => e.kind === 30078).forEach((e) => {
    const d = e.tags.find((t) => t[0] === "d")[1];
    if (!latest.has(d) || latest.get(d).created_at < e.created_at) latest.set(d, e);
  });
  const recs = [...latest.values()].map((e) => JSON.parse(e.content));
  const items = recs.filter((c) => c.id);
  const session = await screen.evaluate(() => SM.session());
  ok(items.length === 3 && items.reduce((a, c) => a + c.sats, 0) === 23121, "本物の 3 投が Nostr に記録される（テストの 1 投は出さない）");
  ok([...latest.keys()].every((d) => d.startsWith(`${session}:`)), "記録の d タグがイベントごとに分かれる");
  const tokyo = items.find((c) => c.r === "jp_prefecture:JP-13");
  ok(tokyo && tokyo.n === "ましゅ" && tokyo.m === "はじめての Lightning！" && tokyo.round === 0, "記録に地域・名前・ひとこと・ラウンドが入る");
  const whale = items.find((c) => c.sats === 21000);
  ok(whale && whale.hidden && whale.n === "" && whale.m === "" && whale.round === 1, "隠したものは、名前とひとことを消して出し直す");
  const ngRec = items.find((c) => c.r === "country:US");
  ok(ngRec && ngRec.m === "", "NG ワードのひとことは Nostr にも出さない");
  const meta = recs.find((c) => c.kind === "meta");
  ok(meta && meta.rounds.length === 1 && meta.rounds[0].no === 1, "ラウンドの記録も Nostr に出る");
  const pk = await screen.evaluate(() => SM.records.pubkey());
  ok(relay.events.every((e) => e.pubkey === pk), "記録はこのブラウザの記録用の鍵で署名される");

  // 6. 別のパソコンで、Blink の履歴と Nostr の記録から作り直す
  const nsec = await admin.evaluate(() => SM.records.exportNsec());
  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await mockBlink(ctx2);
  await useTestRelay(ctx2);
  const screen2 = await ctx2.newPage();
  watch(screen2, "screen2");
  await screen2.goto(`${base}/index.html`);
  const admin2 = await ctx2.newPage();
  watch(admin2, "admin2");
  await admin2.goto(`${base}/admin.html`);
  await admin2.fill("#username", "satsmap");
  await admin2.fill("#apikey", blink.key);
  await admin2.click("#save-blink");
  admin2.once("dialog", (d) => d.accept(nsec));
  await admin2.click("#import-nsec");
  ok((await admin2.locator("#rec-npub").textContent()) === (await admin.locator("#rec-npub").textContent()), "nsec を読み込むと、同じ記録の鍵になる");
  await screen2.waitForFunction(() => document.getElementById("status-chip").textContent === "● LIVE", null, { timeout: 8000 });
  ok((await screen2.locator("#stat-total-sats").textContent()) === "0", "新しいパソコンは、はじめは 0（前の入金は数えない）");
  await admin2.click("#find-sessions");
  await admin2.waitForFunction(() => /見つかりました/.test(document.getElementById("rebuild-log").textContent), null, { timeout: 8000 });
  await admin2.selectOption("#rebuild-session", session);
  admin2.once("dialog", (d) => d.accept());
  await admin2.click("#rebuild");
  await admin2.waitForFunction(() => /作り直しました/.test(document.getElementById("rebuild-log").textContent), null, { timeout: 15000 });
  const rlog = await admin2.locator("#rebuild-log").textContent();
  ok(/3 投・23,121 sats/.test(rlog) && /Nostr の記録 3 件/.test(rlog), "Blink の履歴から 3 投を作り直し、Nostr の記録を読む");
  await screen2.waitForTimeout(800);
  ok((await screen2.locator("#stat-total-sats").textContent()) === "23,121", "作り直すと、スクリーンの集計が戻る");
  ok(!(await screen2.locator("#latest-feed").textContent()).includes("21000 いきます"), "隠したものは、作り直しても隠れたまま");
  const rounds = await screen2.evaluate(() => SM.entries().map((e) => e.round).sort().join(","));
  ok(rounds === "0,1,1", "どのラウンドの 1 投かも戻る");
  ok((await screen2.evaluate(() => SM.session())) === session, "同じイベントの記録に書き足すようになる");
  await shot(admin2, "9-rebuild");
  await ctx2.close();

  ok(errors.length === 0, `画面のエラーなし${errors.length ? `：\n  ${errors.join("\n  ")}` : ""}`);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  server.close();
  relay.close();
}
console.log(failed ? `\n${failed} 件 失敗` : "\nすべて通りました");
process.exit(failed ? 1 : 0);
