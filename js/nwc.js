/**
 * nwc.js — Nostr Wallet Connect（NIP-47）。サーバーなしで、Nostr のリレー越しに自分のウォレットへ頼む
 *
 *   SM.nwc.parse(uri)                 nostr+walletconnect://… を読む
 *   SM.nwc.client(uri)                接続（同じ文字列なら使い回す）
 *     .request(method, params)        頼んで返事を待つ
 *     .onPayment(cb)                  「受け取った」の知らせ（payment_received）
 *     .info()                         ウォレットができること・暗号の形（kind 13194）
 *   SM.nwc.makeInvoice(c, sats, memo) → { paymentRequest, paymentHash }
 *   SM.nwc.lookup(c, hash)            → "PAID" | "PENDING" | "EXPIRED"
 *   SM.nwc.listIncoming(c, { from, limit, offset }) → { items, raw }
 *
 * 接続は 2 つに分けて使う：
 *   支払いページ用：make_invoice・lookup_invoice だけ（QR に載るので、だれでも読める。お金は動かせない）
 *   スクリーン用：  list_transactions・lookup_invoice・notifications（会場のパソコンのブラウザにだけ置く）
 */
window.SM = window.SM || {};

(function (SM) {
  const NT = () => window.NostrTools;

  class NwcError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code || "";
    }
  }

  const isRelay = (u) => /^wss:\/\/[a-z0-9.-]+(:\d+)?(\/\S*)?$/i.test(u) || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(u);

  function parse(uri) {
    const s = String(uri || "").trim();
    const m = s.match(/^nostr\+walletconnect:\/\/([0-9a-fA-F]{64})\?(.+)$/);
    if (!m) throw new NwcError("NWC の接続文字列（nostr+walletconnect://…）ではありません", "PARSE");
    const q = new URLSearchParams(m[2]);
    const secret = (q.get("secret") || "").toLowerCase();
    const relays = q.getAll("relay").map((r) => r.trim()).filter(isRelay);
    if (!/^[0-9a-f]{64}$/.test(secret)) throw new NwcError("NWC の接続文字列に secret がありません", "PARSE");
    if (!relays.length) throw new NwcError("NWC の接続文字列にリレーがありません", "PARSE");
    return { wallet: m[1].toLowerCase(), relays, secret, lud16: q.get("lud16") || "" };
  }

  let pool = null;
  const getPool = () => (pool = pool || new (NT().SimplePool)({ enablePing: true, enableReconnect: true }));
  const clients = new Map();

  function client(uri) {
    const key = String(uri || "").trim();
    if (clients.has(key)) return clients.get(key);
    const c = parse(key);
    const sk = NT().hexToBytes(c.secret);
    const me = NT().getPublicKey(sk);
    const conv = NT().nip44.getConversationKey(sk, c.wallet);
    let infoP = null;

    function info() {
      if (!infoP) {
        infoP = getPool().get(c.relays, { kinds: [13194], authors: [c.wallet] }, { maxWait: 6000 })
          .catch(() => null)
          .then((ev) => {
            const tag = (name) => ((ev && ev.tags.find((t) => t[0] === name)) || [])[1] || "";
            const enc = tag("encryption").split(/\s+/).filter(Boolean);
            return {
              found: !!ev,
              methods: ev ? ev.content.split(/\s+/).filter(Boolean) : [],
              notifications: tag("notifications").split(/\s+/).filter(Boolean),
              // 新しい形（NIP-44）に対応していればそちら。書いていなければ、昔からの NIP-04
              encryption: enc.includes("nip44_v2") ? "nip44_v2" : "nip04",
            };
          });
      }
      return infoP;
    }

    const encrypt = (enc, text) => (enc === "nip44_v2" ? NT().nip44.encrypt(text, conv) : NT().nip04.encrypt(sk, c.wallet, text));
    const decrypt = (content) => (content.includes("?iv=") ? NT().nip04.decrypt(sk, c.wallet, content) : NT().nip44.decrypt(content, conv));

    async function request(method, params = {}, timeout = 20000) {
      const { encryption } = await info();
      const tags = [["p", c.wallet]];
      if (encryption === "nip44_v2") tags.push(["encryption", "nip44_v2"]);
      const ev = NT().finalizeEvent({
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: encrypt(encryption, JSON.stringify({ method, params })),
      }, sk);
      return new Promise((resolve, reject) => {
        let done = false;
        let sent = false;
        const finish = (err, val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(sendTimer);
          try { sub.close(); } catch (e) { /* 閉じ済み */ }
          err ? reject(err) : resolve(val);
        };
        const send = () => {
          if (sent || done) return;
          sent = true;
          Promise.any(getPool().publish(c.relays, ev)).catch(() => finish(new NwcError("NWC のリレーにつながりません", "RELAY")));
        };
        // 返事を待つ購読を先に開いてから頼む（返事を取りこぼさないように）
        const sub = getPool().subscribeMany(c.relays, { kinds: [23195], authors: [c.wallet], "#e": [ev.id] }, {
          onevent(r) {
            let res;
            try { res = JSON.parse(decrypt(r.content)); } catch (e) { return; }
            if (res.error) finish(new NwcError(res.error.message || res.error.code || "ウォレットのエラー", res.error.code));
            else finish(null, res.result || {});
          },
          oneose: send,
        });
        const sendTimer = setTimeout(send, 1500);
        const timer = setTimeout(() => finish(new NwcError(`ウォレットが ${timeout / 1000} 秒たっても返事をしません（${method}）`, "TIMEOUT")), timeout);
      });
    }

    /** 「受け取った」の知らせ。返り値で止める */
    function onPayment(cb) {
      const sub = getPool().subscribeMany(c.relays, { kinds: [23196, 23197], authors: [c.wallet], "#p": [me], since: Math.floor(Date.now() / 1000) - 10 }, {
        onevent(ev) {
          let n;
          try { n = JSON.parse(decrypt(ev.content)); } catch (e) { return; }
          if (n && n.notification_type === "payment_received" && n.notification) cb(normalize(n.notification));
        },
      });
      return () => sub.close();
    }

    const api = { wallet: c.wallet, pubkey: me, relays: c.relays, lud16: c.lud16, request, onPayment, info };
    clients.set(key, api);
    return api;
  }

  /** NIP-47 の取引を、スクリーンの形にそろえる */
  function normalize(t) {
    const settled = !!(t.settled_at || t.state === "settled" || (t.preimage && t.state !== "pending"));
    return {
      id: t.payment_hash,
      hash: t.payment_hash,
      sats: Math.floor((Number(t.amount) || 0) / 1000),
      memo: t.description || "",
      at: Number(t.settled_at || t.created_at) || 0,
      paid: settled,
      incoming: t.type ? t.type === "incoming" : true,
      expiresAt: Number(t.expires_at) || 0,
    };
  }

  async function makeInvoice(c, sats, memo) {
    const r = await c.request("make_invoice", { amount: Math.round(sats) * 1000, description: memo, expiry: 900 });
    if (!r.invoice) throw new NwcError("ウォレットがインボイスを返しませんでした", "NO_INVOICE");
    return { paymentRequest: r.invoice, paymentHash: r.payment_hash || "", satoshis: sats };
  }

  async function lookup(c, invoice) {
    const params = invoice.paymentHash ? { payment_hash: invoice.paymentHash } : { invoice: invoice.paymentRequest };
    const t = normalize(await c.request("lookup_invoice", params, 15000));
    if (t.paid) return "PAID";
    if (t.expiresAt && t.expiresAt * 1000 < Date.now()) return "EXPIRED";
    return "PENDING";
  }

  /** 受け取った（支払われた）取引。新しい順 */
  async function listIncoming(c, { from = 0, limit = 50, offset = 0 } = {}) {
    const r = await c.request("list_transactions", { from, limit, offset, type: "incoming", unpaid: false });
    const list = Array.isArray(r.transactions) ? r.transactions : [];
    const items = list.map(normalize).filter((t) => t.incoming && t.paid && t.sats > 0 && t.id).sort((x, y) => y.at - x.at);
    const oldest = list.reduce((m, t) => Math.min(m, Number(t.settled_at || t.created_at) || Infinity), Infinity);
    return { items, raw: list.length, oldest };
  }

  SM.nwc = { parse, client, makeInvoice, lookup, listIncoming, normalize, NwcError };
})(window.SM);
