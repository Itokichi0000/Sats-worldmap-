// 自動の確認に使う、NWC（NIP-47）のウォレットのまね。テスト用のリレーの上で答える
//   const w = await startFakeNwc(relayUrl)
//   w.payUri / w.screenUri   接続文字列（支払いページ用・スクリーン用。許すことを分けてある）
//   w.pay(i, { notify })     i 番目のインボイスを払ったことにする（notify: false なら知らせを出さない）
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { bytesToHex } from "@noble/hashes/utils.js";

useWebSocketImplementation(WebSocket);

export async function startFakeNwc(relayUrl, { encryption = "nip44_v2" } = {}) {
  const walletSk = generateSecretKey();
  const wallet = getPublicKey(walletSk);
  const pool = new SimplePool();
  const conns = new Map(); // クライアントの公開鍵 -> { perms }
  const invoices = []; // { invoice, payment_hash, amount, description, created_at, settled_at }
  const log = [];

  const makeConn = (perms) => {
    const sk = generateSecretKey();
    conns.set(getPublicKey(sk), { perms });
    return `nostr+walletconnect://${wallet}?relay=${encodeURIComponent(relayUrl)}&secret=${bytesToHex(sk)}`;
  };
  const payUri = makeConn(["make_invoice", "lookup_invoice"]);
  const screenUri = makeConn(["list_transactions", "lookup_invoice", "notifications"]);

  const now = () => Math.floor(Date.now() / 1000);
  const tx = (i) => ({
    type: "incoming",
    state: i.settled_at ? "settled" : "pending",
    invoice: i.invoice,
    description: i.description,
    payment_hash: i.payment_hash,
    amount: i.amount,
    fees_paid: 0,
    created_at: i.created_at,
    expires_at: i.created_at + 900,
    settled_at: i.settled_at || null,
  });

  // ウォレットの情報
  await Promise.any(pool.publish([relayUrl], finalizeEvent({
    kind: 13194, created_at: now(),
    tags: [["encryption", encryption === "nip44_v2" ? "nip44_v2 nip04" : "nip04"], ["notifications", "payment_received"]],
    content: "make_invoice lookup_invoice list_transactions get_balance notifications",
  }, walletSk)));

  const enc = (client, kind44, text) => kind44 ? nip44.encrypt(text, nip44.getConversationKey(walletSk, client)) : nip04.encrypt(walletSk, client, text);

  async function reply(req, body, use44) {
    const ev = finalizeEvent({
      kind: 23195, created_at: now(),
      tags: [["p", req.pubkey], ["e", req.id]],
      content: enc(req.pubkey, use44, JSON.stringify(body)),
    }, walletSk);
    await Promise.any(pool.publish([relayUrl], ev));
  }

  pool.subscribeMany([relayUrl], { kinds: [23194], "#p": [wallet], since: now() - 5 }, {
    async onevent(req) {
      const conn = conns.get(req.pubkey);
      const use44 = req.tags.some((t) => t[0] === "encryption" && t[1] === "nip44_v2");
      let msg;
      try {
        msg = JSON.parse(use44 ? nip44.decrypt(req.content, nip44.getConversationKey(walletSk, req.pubkey)) : nip04.decrypt(walletSk, req.pubkey, req.content));
      } catch { return; }
      log.push({ method: msg.method, use44 });
      const fail = (code, message) => reply(req, { result_type: msg.method, error: { code, message } }, use44);
      if (!conn) return fail("UNAUTHORIZED", "知らない接続");
      if (!conn.perms.includes(msg.method)) return fail("RESTRICTED", `${msg.method} は許されていません`);
      const p = msg.params || {};
      if (msg.method === "make_invoice") {
        const n = invoices.length;
        const i = { invoice: `lnbc${p.amount / 1000}n1pnwc${n}qqqq`, payment_hash: bytesToHex(randomBytes(32)), amount: p.amount, description: p.description || "", created_at: now(), settled_at: 0 };
        invoices.push(i);
        return reply(req, { result_type: "make_invoice", result: tx(i) }, use44);
      }
      if (msg.method === "lookup_invoice") {
        const i = invoices.find((x) => x.payment_hash === p.payment_hash || x.invoice === p.invoice);
        if (!i) return fail("NOT_FOUND", "インボイスが見つかりません");
        return reply(req, { result_type: "lookup_invoice", result: tx(i) }, use44);
      }
      if (msg.method === "list_transactions") {
        const list = invoices.filter((i) => i.settled_at && (!p.from || i.settled_at >= p.from)).sort((a, b) => b.settled_at - a.settled_at);
        const page = list.slice(p.offset || 0, (p.offset || 0) + (p.limit || 50)).map(tx);
        return reply(req, { result_type: "list_transactions", result: { transactions: page } }, use44);
      }
      return fail("NOT_IMPLEMENTED", msg.method);
    },
  });

  return {
    wallet, payUri, screenUri, invoices, log,
    async pay(i, { notify = true } = {}) {
      const inv = invoices[i];
      inv.settled_at = now();
      if (!notify) return;
      for (const [client, c] of conns) {
        if (!c.perms.includes("notifications")) continue;
        const use44 = encryption === "nip44_v2";
        await Promise.any(pool.publish([relayUrl], finalizeEvent({
          kind: use44 ? 23197 : 23196, created_at: now(),
          tags: [["p", client]],
          content: enc(client, use44, JSON.stringify({ notification_type: "payment_received", notification: tx(inv) })),
        }, walletSk)));
      }
    },
    close() { pool.close([relayUrl]); },
  };
}
