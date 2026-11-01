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
    session: "satsmap.session.v1",
    mission: "satsmap.mission.v1",
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
    missions: true,    // 数分ごとのお題
    missionMinutes: 4,
    fever: true,       // ラウンドの最後の 60 秒は演出を 1 段強く
    record: true,      // 1 投ごとの記録を Nostr リレーに出す
    recordRelays: [],  // 空なら js/config.js（なければ records.js の既定）
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

  // ほかのタブ（管理画面）で変えた設定は、知らせ（SM.bus）に中身を載せて送る。
  // ブラウザはタブのあいだの localStorage を少し遅れて同じにするので、知らせのあとに読むと古いことがある
  let latestSettings = null;
  let latestKey = null;
  SM.settings = () => ({ ...DEFAULTS, ...(latestSettings || read(K.settings, {})) });
  SM.saveSettings = (patch) => {
    const next = { ...SM.settings(), ...patch };
    write(K.settings, next);
    latestSettings = next;
    SM.bus.post({ type: "settings", settings: next });
    return next;
  };

  SM.apiKey = () => {
    if (latestKey !== null) return latestKey;
    try { return localStorage.getItem(K.apiKey) || ""; } catch (e) { return ""; }
  };
  SM.saveApiKey = (key) => {
    try {
      if (key) localStorage.setItem(K.apiKey, key);
      else localStorage.removeItem(K.apiKey);
    } catch (e) { /* 使えない */ }
    latestKey = key || "";
    SM.bus.post({ type: "settings", apiKey: latestKey });
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

  // いまのお題：{ type, params, startedAt, endsAt, state: "active" | "clear" | "fail", by, no }
  SM.mission = () => read(K.mission, null);
  SM.saveMission = (m) => write(K.mission, m);

  /** これより前（秒）の入金は数えない。イベントを始めたとき */
  SM.since = () => {
    let s = read(K.since, 0);
    if (!s) {
      s = Math.floor(Date.now() / 1000);
      write(K.since, s);
    }
    return s;
  };
  SM.setSince = (sec) => write(K.since, Math.floor(sec));

  /** イベント 1 回ぶんの名前（Nostr の記録の d・t タグに入る）。やり直すと新しくなる */
  const newSession = () => {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 12);
  };
  SM.session = () => {
    let id = read(K.session, "");
    if (!/^[a-z0-9]{6,32}$/.test(id)) {
      id = newSession();
      write(K.session, id);
    }
    return id;
  };
  SM.setSession = (id) => {
    if (/^[a-z0-9]{6,32}$/.test(id)) write(K.session, id);
  };
  SM.resetSince = () => {
    write(K.since, Math.floor(Date.now() / 1000));
    write(K.session, newSession());
  };

  // スクリーンと管理画面のあいだの知らせ
  const listeners = new Set();
  let channel = null;
  try { channel = new BroadcastChannel("satsmap"); } catch (e) { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const m = ev.data;
      if (m && m.type === "settings") {
        if (m.settings && typeof m.settings === "object") latestSettings = m.settings;
        if (typeof m.apiKey === "string") latestKey = m.apiKey;
      }
      listeners.forEach((fn) => fn(m));
    };
  }
  // 別のタブが localStorage を変えて、それがここに届いたら、そちらを読む
  addEventListener("storage", (ev) => {
    if (ev.key === K.settings) latestSettings = null;
    if (ev.key === K.apiKey) latestKey = null;
  });
  SM.bus = {
    post(msg) { if (channel) channel.postMessage(msg); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  SM.DEFAULTS = DEFAULTS;
})(window.SM);
