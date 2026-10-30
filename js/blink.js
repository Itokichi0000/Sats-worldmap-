/**
 * blink.js — Blink（https://www.blink.sv）の GraphQL API
 *
 * キーの要らないもの（スマホの支払いページが使う）
 *   walletId(username)                 ユーザー名から BTC ウォレットの id
 *   createInvoice(username, sats, memo) その人宛てのインボイスを作る（lnInvoiceCreateOnBehalfOfRecipient）
 *   invoiceStatus(paymentRequest)      PENDING / PAID / EXPIRED
 *
 * API キー（Read）が要るもの（スクリーンだけが使う。キーはそのパソコンのブラウザにだけ置く）
 *   me(apiKey)                         アカウントとウォレット（接続テスト）
 *   receives(apiKey, { first, after }) 受け取った支払いの一覧（新しい順）
 */
window.SM = window.SM || {};

(function (SM) {
  const api = () => (window.SATS_CONFIG && window.SATS_CONFIG.blinkApi) || "https://api.blink.sv/graphql";

  class BlinkError extends Error {}

  async function gql(query, variables, apiKey) {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers["X-API-KEY"] = apiKey;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let res;
    try {
      res = await fetch(api(), { method: "POST", headers, body: JSON.stringify({ query, variables }), signal: ctl.signal });
    } catch (e) {
      throw new BlinkError(e.name === "AbortError" ? "Blink が 15 秒たっても返事をしません" : "Blink につながりません（ネットワーク）");
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* 下で */ }
    if (res.status === 401 || res.status === 403) throw new BlinkError("API キーが使えません（キーと、Read の権限を確かめてください）");
    if (!json) throw new BlinkError(`Blink の返事を読めません（${res.status}）`);
    if (json.errors && json.errors.length) throw new BlinkError(json.errors[0].message || "Blink のエラー");
    return json.data;
  }

  const walletCache = new Map();

  async function walletId(username) {
    if (!username) throw new BlinkError("受け取る Blink のユーザー名が設定されていません");
    if (walletCache.has(username)) return walletCache.get(username);
    const d = await gql(
      `query W($u: Username!) { accountDefaultWallet(username: $u, walletCurrency: BTC) { id walletCurrency } }`,
      { u: username },
    );
    const w = d && d.accountDefaultWallet;
    if (!w || !w.id) throw new BlinkError(`Blink のユーザー「${username}」が見つかりません`);
    walletCache.set(username, w.id);
    return w.id;
  }

  async function createInvoice(username, sats, memo) {
    const recipientWalletId = await walletId(username);
    const d = await gql(
      `mutation I($input: LnInvoiceCreateOnBehalfOfRecipientInput!) {
        lnInvoiceCreateOnBehalfOfRecipient(input: $input) {
          invoice { paymentRequest paymentHash satoshis }
          errors { message }
        }
      }`,
      { input: { recipientWalletId, amount: sats, memo, expiresIn: 15 } },
    );
    const p = d && d.lnInvoiceCreateOnBehalfOfRecipient;
    if (p && p.errors && p.errors.length) throw new BlinkError(p.errors[0].message);
    if (!p || !p.invoice || !p.invoice.paymentRequest) throw new BlinkError("インボイスを作れませんでした");
    return p.invoice;
  }

  let statusQuery = "byRequest";
  async function invoiceStatus(paymentRequest) {
    if (statusQuery === "byRequest") {
      try {
        const d = await gql(
          `query S($input: LnInvoicePaymentStatusByPaymentRequestInput!) { lnInvoicePaymentStatusByPaymentRequest(input: $input) { status } }`,
          { input: { paymentRequest } },
        );
        return d.lnInvoicePaymentStatusByPaymentRequest.status;
      } catch (e) {
        // 古い API にはない。古い形で聞き直す
        if (!/Cannot query field|Unknown type/i.test(e.message)) throw e;
        statusQuery = "legacy";
      }
    }
    const d = await gql(
      `query S($input: LnInvoicePaymentStatusInput!) { lnInvoicePaymentStatus(input: $input) { status errors { message } } }`,
      { input: { paymentRequest } },
    );
    return d.lnInvoicePaymentStatus.status;
  }

  async function me(apiKey) {
    const d = await gql(
      `query { me { username defaultAccount { wallets { id walletCurrency balance } } } }`,
      {},
      apiKey,
    );
    if (!d || !d.me) throw new BlinkError("API キーが使えません");
    return d.me;
  }

  /** 受け取った（成功した）BTC の支払い。{ id, sats, memo, at（秒）, hash } の新しい順 */
  async function receives(apiKey, { first = 30, after = null } = {}) {
    const d = await gql(
      `query R($first: Int, $after: String) {
        me { defaultAccount { wallets {
          id walletCurrency
          transactions(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { cursor node {
              id direction status memo createdAt settlementAmount settlementCurrency
              initiationVia { __typename ... on InitiationViaLn { paymentHash } }
            } }
          }
        } } }
      }`,
      { first, after },
      apiKey,
    );
    const wallet = d.me.defaultAccount.wallets.find((w) => w.walletCurrency === "BTC");
    if (!wallet) return { items: [], hasMore: false, cursor: null };
    const conn = wallet.transactions || { edges: [], pageInfo: {} };
    const items = conn.edges
      .map((e) => e.node)
      .filter((n) => n.direction === "RECEIVE" && n.status === "SUCCESS" && n.settlementCurrency === "BTC")
      .map((n) => ({
        id: n.id,
        sats: Math.abs(Number(n.settlementAmount) || 0),
        memo: n.memo || "",
        at: Number(n.createdAt) || 0,
        hash: (n.initiationVia && n.initiationVia.paymentHash) || null,
      }))
      .filter((n) => n.sats > 0);
    const last = conn.edges[conn.edges.length - 1];
    const oldest = conn.edges.reduce((m, e) => Math.min(m, Number(e.node.createdAt) || Infinity), Infinity);
    return { items, hasMore: !!conn.pageInfo.hasNextPage, cursor: last ? last.cursor : null, oldest, walletId: wallet.id };
  }

  SM.blink = { walletId, createInvoice, invoiceStatus, me, receives, BlinkError };
})(window.SM);
