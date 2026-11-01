/**
 * records.js — 1 投ごとの記録を Nostr リレーに出す・読む
 *
 * 正しい記録は Blink の入金履歴（お金が入った証拠）。ここに出すのは、その写し：
 *   - スクリーンのパソコンが壊れても、リレーから「隠した」「どのラウンドか」を戻せる
 *   - あとで結果をだれでも見られる
 *
 * 形：NIP-78（kind 30078、アプリのデータ）。置き換えのできるイベントで、d タグごとに最新の 1 つが残る
 *   1 投   d = "<session>:<Blink の取引 id>"   content = { v, id, at, sats, r, n, m, round, hidden, hash }
 *   全体   d = "<session>:meta"                content = { v, kind: "meta", since, rounds, eventName }
 *   どちらも t タグに "satsmap" と "satsmap-<session>"
 *
 * 署名は、スクリーンのブラウザで作る記録専用の鍵（お金・ほかのアカウントとは関係ない）。
 * 秘密鍵はこのブラウザ（localStorage）にだけ置く。読むのに要るのは公開鍵（npub）だけ。
 */
window.SM = window.SM || {};

(function (SM) {
  const KIND = 30078;
  const KEY = "satsmap.recordKey.v1";
  const NT = () => window.NostrTools;

  const DEFAULT_RELAYS = ["wss://yabu.me", "wss://r.kojira.io", "wss://nos.lol", "wss://relay.damus.io", "wss://relay.primal.net"];

  let pool = null;
  const getPool = () => (pool = pool || new (NT().SimplePool)());

  let override = null; // 支払いページ：QR の URL で渡されたリレー
  function relays() {
    if (override) return override;
    const fromSettings = SM.settings ? SM.settings().recordRelays : null;
    const cfg = (window.SATS_CONFIG && window.SATS_CONFIG.recordRelays) || DEFAULT_RELAYS;
    const list = Array.isArray(fromSettings) && fromSettings.length ? fromSettings : cfg;
    return list.map((u) => String(u).trim()).filter(isRelayUrl).slice(0, 12);
  }
  // wss:// だけ（手元のテスト用に localhost の ws:// も）
  function isRelayUrl(u) {
    return /^wss:\/\/[a-z0-9.-]+(:\d+)?(\/\S*)?$/i.test(u) || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(u);
  }

  function secret() {
    try {
      const hex = localStorage.getItem(KEY);
      return hex && /^[0-9a-f]{64}$/.test(hex) ? NT().hexToBytes(hex) : null;
    } catch (e) {
      return null;
    }
  }
  function ensureKey() {
    let sk = secret();
    if (!sk) {
      sk = NT().generateSecretKey();
      try { localStorage.setItem(KEY, NT().bytesToHex(sk)); } catch (e) { /* 使えない */ }
    }
    return sk;
  }
  function pubkey() {
    const sk = secret();
    return sk ? NT().getPublicKey(sk) : "";
  }
  function npub() {
    const pk = pubkey();
    return pk ? NT().nip19.npubEncode(pk) : "";
  }
  /** ほかのパソコンで同じ鍵を使い続けるとき */
  function exportNsec() {
    const sk = secret();
    return sk ? NT().nip19.nsecEncode(sk) : "";
  }
  function importNsec(nsec) {
    const d = NT().nip19.decode(String(nsec).trim());
    if (d.type !== "nsec") throw new Error("nsec1… の形ではありません");
    localStorage.setItem(KEY, NT().bytesToHex(d.data));
    return npub();
  }
  /** 公開鍵を npub か 16 進数で */
  function parsePubkey(s) {
    const t = String(s || "").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
    const d = NT().nip19.decode(t);
    if (d.type !== "npub") throw new Error("npub1… の形ではありません");
    return d.data;
  }

  let lastCreated = 0;
  function sign(d, session, content) {
    // 置き換えのイベントは created_at が新しいほうが残る。続けて出しても前後が入れかわらないように
    lastCreated = Math.max(Math.floor(Date.now() / 1000), lastCreated + 1);
    return NT().finalizeEvent({
      kind: KIND,
      created_at: lastCreated,
      tags: [["d", `${session}:${d}`], ["t", "satsmap"], ["t", `satsmap-${session}`], ["alt", "Sats World Map の記録"]],
      content: JSON.stringify(content),
    }, ensureKey());
  }

  /** どれか 1 つのリレーが受け取れば true */
  async function send(event) {
    const urls = relays();
    if (!urls.length) return false;
    const tries = getPool().publish(urls, event, { maxWait: 8000 });
    try {
      await Promise.any(tries.map((p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 9000))])));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 1 投の記録。隠したもの・NG ワードのものは、名前とひとことを出さない。テストは出さない */
  function publishEntry(e, session, ngWords) {
    if (e.test) return Promise.resolve(true);
    const hidden = !!e.hidden;
    const content = {
      v: 1,
      id: e.id,
      at: Math.floor(e.at / 1000),
      sats: e.sats,
      r: e.r || null,
      n: hidden ? "" : SM.cleanNick(e.n, ngWords),
      m: hidden ? "" : SM.clean(e.m, ngWords) || "",
      round: e.round || 0,
      hidden,
      hash: e.hash || null,
    };
    return send(sign(e.id, session, content));
  }

  function publishMeta(meta, session) {
    return send(sign("meta", session, { v: 1, kind: "meta", ...meta }));
  }

  /** いまのお題（スマホの支払いページに出す） */
  function publishMission(m, session) {
    return send(sign("mission", session, {
      v: 1, kind: "mission",
      type: m.type, params: m.params || {}, startedAt: m.startedAt, endsAt: m.endsAt, state: m.state, by: m.by || "", no: m.no || 0,
    }));
  }

  /**
   * そのイベント（session）の記録をリレーから読む。
   * 返り値：{ entries: Map<取引 id, 記録>, meta: 全体 | null, relaysAnswered }
   * 署名が正しく、作者が pk のものだけ（SimplePool が署名を確かめる）。
   */
  async function fetchAll(session, pk = pubkey(), { maxWait = 6000 } = {}) {
    const out = { entries: new Map(), meta: null };
    if (!pk || !session) return out;
    const events = await getPool().querySync(relays(), { kinds: [KIND], authors: [pk], "#t": [`satsmap-${session}`], limit: 5000 }, { maxWait });
    const latest = new Map();
    for (const ev of events) {
      if (ev.pubkey !== pk || ev.kind !== KIND) continue;
      const d = (ev.tags.find((t) => t[0] === "d") || [])[1];
      if (!d || !d.startsWith(`${session}:`)) continue;
      const prev = latest.get(d);
      if (!prev || ev.created_at > prev.created_at) latest.set(d, ev);
    }
    latest.forEach((ev, d) => {
      let c;
      try { c = JSON.parse(ev.content); } catch (e) { return; }
      if (!c || c.v !== 1) return;
      if (d === `${session}:meta`) out.meta = c;
      else if (typeof c.id === "string" && Number.isFinite(c.sats)) out.entries.set(c.id, c);
    });
    return out;
  }

  /** 公開鍵の持ち主のイベント（session）の一覧（新しい順）。ほかのパソコンで続きから始めるとき */
  async function fetchSessions(pk = pubkey(), { maxWait = 6000 } = {}) {
    if (!pk) return [];
    const events = await getPool().querySync(relays(), { kinds: [KIND], authors: [pk], "#t": ["satsmap"], limit: 500 }, { maxWait });
    const seen = new Map();
    events.forEach((ev) => {
      const d = (ev.tags.find((t) => t[0] === "d") || [])[1] || "";
      const m = d.match(/^([a-z0-9]{6,32}):meta$/);
      if (!m) return;
      let c = null;
      try { c = JSON.parse(ev.content); } catch (e) { return; }
      const prev = seen.get(m[1]);
      if (!prev || ev.created_at > prev.created_at) seen.set(m[1], { session: m[1], created_at: ev.created_at, since: c && c.since, eventName: c && c.eventName });
    });
    return [...seen.values()].sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * 記録を見続ける（支払いページの「いまの会場」）。届くたびに onUpdate(Map<取引 id, 記録>) を呼ぶ。
   * 返り値で止める。
   */
  function watch(session, pk, onUpdate, onMission) {
    const latest = new Map(); // d -> event
    const items = new Map();
    let timer = 0;
    const flush = () => { timer = 0; onUpdate(new Map(items)); };
    const sub = getPool().subscribeMany(relays(), { kinds: [KIND], authors: [pk], "#t": [`satsmap-${session}`], limit: 5000 }, {
      onevent(ev) {
        if (ev.pubkey !== pk) return;
        const d = (ev.tags.find((t) => t[0] === "d") || [])[1];
        if (!d || !d.startsWith(`${session}:`) || d.endsWith(":meta")) return;
        const prev = latest.get(d);
        if (prev && prev.created_at >= ev.created_at) return;
        let c;
        try { c = JSON.parse(ev.content); } catch (e) { return; }
        if (d === `${session}:mission`) {
          latest.set(d, ev);
          if (c && c.v === 1 && onMission) onMission(c);
          return;
        }
        if (!c || c.v !== 1 || typeof c.id !== "string" || !Number.isFinite(c.sats) || c.sats <= 0) return;
        latest.set(d, ev);
        items.set(c.id, c);
        if (!timer) timer = setTimeout(flush, 250);
      },
      oneose() { if (!timer) flush(); },
    });
    return () => { clearTimeout(timer); sub.close(); };
  }
  function setRelays(list) {
    const ok = (list || []).map((u) => String(u).trim()).filter(isRelayUrl).slice(0, 12);
    override = ok.length ? ok : null;
  }

  function status() {
    if (!pool) return [];
    return [...pool.listConnectionStatus().entries()];
  }

  SM.records = {
    KIND, DEFAULT_RELAYS, relays, isRelayUrl, ensureKey, pubkey, npub, exportNsec, importNsec, parsePubkey,
    publishEntry, publishMeta, publishMission, fetchAll, fetchSessions, watch, setRelays, status,
  };
})(window.SM);
