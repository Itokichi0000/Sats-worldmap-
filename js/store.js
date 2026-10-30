/**
 * store.js — スクリーン（index.html）と管理画面（admin.html）が共有する設定と記録
 *
 * どちらも同じパソコン・同じブラウザで開く（localStorage を共有する）。
 * 記録（entries・round）を書くのはスクリーンだけ。管理画面は SM.bus で頼む。
 */
window.SM = window.SM || {};

(function (SM) {
  const K = {
    settings: "satsmap.settings.v1",
    apiKey: "satsmap.apiKey.v1",
    entries: "satsmap.entries.v1",
    round: "satsmap.round.v1",
    since: "satsmap.since.v1",
  };

  const DEFAULTS = {
    username: "",
    roundMinutes: 10,
    roundGoal: 21000,
    bigAt: 2100,       // これ以上は花火
    whaleAt: 21000,    // これ以上は画面いっぱいのクジラ
    sound: true,
    zoom: true,        // 届いたらその地域へ寄る
    rotate: false,     // 世界 ⇄ 日本 を順に大きく出す
    rotateSec: 20,
    showMessages: true,
    ngWords: [],
    countAll: false,   // SatsMap のメモがない入金（Lightning アドレスへ直接など）も数える
    pollSec: 4,
  };

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* いっぱい・使えない */ }
  }

  SM.settings = () => ({ ...DEFAULTS, ...read(K.settings, {}) });
  SM.saveSettings = (patch) => {
    const next = { ...SM.settings(), ...patch };
    write(K.settings, next);
    SM.bus.post({ type: "settings" });
    return next;
  };

  SM.apiKey = () => {
    try { return localStorage.getItem(K.apiKey) || ""; } catch (e) { return ""; }
  };
  SM.saveApiKey = (key) => {
    try {
      if (key) localStorage.setItem(K.apiKey, key);
      else localStorage.removeItem(K.apiKey);
    } catch (e) { /* 使えない */ }
    SM.bus.post({ type: "settings" });
  };

  // entries: { id, at（ミリ秒）, sats, r（"type:code" か null）, n, m, hidden, test, round }
  SM.entries = () => {
    const v = read(K.entries, []);
    return Array.isArray(v) ? v : [];
  };
  SM.saveEntries = (list) => write(K.entries, list.slice(-5000));

  // round: { no, startedAt, endsAt, goal, state: "idle" | "running" | "done" }
  SM.round = () => read(K.round, { no: 0, startedAt: 0, endsAt: 0, goal: DEFAULTS.roundGoal, state: "idle" });
  SM.saveRound = (r) => write(K.round, r);

  /** これより前（秒）の入金は数えない。イベントを始めたとき */
  SM.since = () => {
    let s = read(K.since, 0);
    if (!s) {
      s = Math.floor(Date.now() / 1000);
      write(K.since, s);
    }
    return s;
  };
  SM.resetSince = () => write(K.since, Math.floor(Date.now() / 1000));

  // スクリーンと管理画面のあいだの知らせ
  const listeners = new Set();
  let channel = null;
  try { channel = new BroadcastChannel("satsmap"); } catch (e) { channel = null; }
  if (channel) channel.onmessage = (ev) => listeners.forEach((fn) => fn(ev.data));
  SM.bus = {
    post(msg) { if (channel) channel.postMessage(msg); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  SM.DEFAULTS = DEFAULTS;
})(window.SM);
